/**
 * Teste de fumaça da autenticação: sessão com refresh token em cookie httpOnly (rotação e detecção de reuso),
 * revogação, troca e recuperação de senha por e-mail, verificação em duas etapas (TOTP) e auditoria de login.
 * Requer a API compilada (`dist/`, usa o mesmo TOTP dela), iniciada com APP_URL, e `DATABASE_URL` não é usado.
 *
 *   BASE_URL=http://127.0.0.1:3100/api node test/smoke/autenticacao.mjs
 */
import net from 'node:net';
import os from 'node:os';
import { codigoDoPasso, passoAtual } from '../../dist/auth/totp.js';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100/api';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@itsm.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@123456';
const SENHA = 'Senha@12345';
const sufixo = Date.now().toString().slice(-6);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0;
const falhas = [];
const confere = (nome, cond, detalhe) => {
  if (cond) return void (ok += 1);
  falhas.push(nome);
  console.log(`  ✗ ${nome}`, detalhe === undefined ? '' : JSON.stringify(detalhe).slice(0, 400));
};

/** Cliente HTTP com "pote de cookies" mínimo: guarda só o itsm_refresh. */
function cliente() {
  const jar = { refresh: null };
  return {
    jar,
    async chamar(metodo, caminho, { token, corpo, ajax = false, cookie = true, headers = {} } = {}) {
      const h = { ...headers };
      if (token) h.Authorization = `Bearer ${token}`;
      if (ajax) h['X-Requested-With'] = 'XMLHttpRequest';
      if (cookie && jar.refresh) h.Cookie = `itsm_refresh=${jar.refresh}`;
      if (corpo !== undefined) h['Content-Type'] = 'application/json';
      const r = await fetch(BASE + caminho, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      const setCookie = r.headers.getSetCookie?.() ?? [];
      const novo = setCookie.find((c) => c.startsWith('itsm_refresh='));
      if (novo) {
        const valor = novo.split(';')[0].slice('itsm_refresh='.length);
        jar.refresh = valor || null;
      }
      return { status: r.status, dados: await r.json().catch(() => null), setCookie };
    },
  };
}

const anonimo = (m, c, corpo, headers) => cliente().chamar(m, c, { corpo, headers });

function ipLocal() {
  for (const lista of Object.values(os.networkInterfaces())) for (const i of lista ?? []) if (i.family === 'IPv4' && !i.internal) return i.address;
  return null;
}

function servidorSmtp(host) {
  const mensagens = [];
  const servidor = net.createServer((socket) => {
    socket.write('220 teste ESMTP\r\n');
    let emDados = false;
    let corpo = '';
    let para = '';
    socket.on('data', (buf) => {
      const texto = buf.toString('utf8');
      if (emDados) {
        corpo += texto;
        if (corpo.endsWith('\r\n.\r\n')) {
          emDados = false;
          mensagens.push({ para, corpo: corpo.slice(0, -5) });
          corpo = '';
          socket.write('250 ok\r\n');
        }
        return;
      }
      for (const linha of texto.split('\r\n').filter(Boolean)) {
        const cmd = linha.toUpperCase();
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) socket.write('250-teste\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (cmd.startsWith('AUTH')) socket.write('235 ok\r\n');
        else if (cmd.startsWith('RCPT TO')) {
          para = linha.slice(linha.indexOf('<') + 1, linha.indexOf('>'));
          socket.write('250 ok\r\n');
        } else if (cmd === 'DATA') {
          emDados = true;
          socket.write('354 envie\r\n');
        } else if (cmd === 'QUIT') {
          socket.write('221 tchau\r\n');
          socket.end();
        } else socket.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => servidor.listen(0, host, () => resolve({ mensagens, porta: servidor.address().port, fechar: () => servidor.close() })));
}

const desquotar = (qp) => qp.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** TOTP no lado do "celular": a mesma implementação da API (RFC 6238). */
const codigoAgora = (segredo, deslocamento = 0) => codigoDoPasso(segredo, passoAtual() + deslocamento);

async function main() {
  const admin = cliente();
  const adm = await admin.chamar('POST', '/auth/login', { corpo: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  confere('login do admin', adm.status === 200 && adm.dados.access_token, adm);
  const A = adm.dados.access_token;

  const criar = async (nome, perfil) => {
    const email = `${nome}.${sufixo}@teste.local`.toLowerCase();
    const r = await admin.chamar('POST', '/admin/usuarios', { token: A, corpo: { nome, email, senha_hash: SENHA, cargo: 'Teste', perfil } });
    confere(`cria ${nome}`, r.status === 201, r);
    return { id: r.dados.id, email };
  };

  // ---------- sessão e cookie ----------
  const u1 = await criar('SessaoUm', 'SOLICITANTE');
  const c1 = cliente();
  const l1 = await c1.chamar('POST', '/auth/login', { corpo: { email: u1.email, password: SENHA } });
  confere('login devolve o token de acesso', l1.status === 200 && l1.dados.access_token && l1.dados.expires_in > 0, l1.dados?.expires_in);
  confere('o corpo da resposta NÃO traz o refresh token', !('refresh_token' in l1.dados), Object.keys(l1.dados));
  const cookie = l1.setCookie.find((c) => c.startsWith('itsm_refresh='));
  confere('refresh vai em cookie HttpOnly, SameSite=Lax e restrito a /api/auth', /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie) && /Path=\/api\/auth/i.test(cookie), cookie);
  const T1 = l1.dados.access_token;
  confere('token de acesso funciona', (await c1.chamar('GET', '/auth/me', { token: T1 })).dados?.email === u1.email);

  confere('refresh sem o cabeçalho X-Requested-With é recusado (CSRF)', (await c1.chamar('POST', '/auth/refresh')).status === 400);
  confere('refresh sem cookie é 401', (await cliente().chamar('POST', '/auth/refresh', { ajax: true })).status === 401);
  const cookieAntigo = c1.jar.refresh;
  const r1 = await c1.chamar('POST', '/auth/refresh', { ajax: true });
  confere('refresh devolve novo token de acesso', r1.status === 200 && r1.dados.access_token, r1);
  confere('refresh rotaciona o cookie', c1.jar.refresh && c1.jar.refresh !== cookieAntigo);
  const T2 = r1.dados.access_token;
  confere('novo token de acesso funciona', (await c1.chamar('GET', '/auth/me', { token: T2 })).status === 200);

  // Duas abas renovando ao mesmo tempo: o cookie antigo ainda vale por alguns segundos, sem derrubar a sessão.
  const aba = cliente();
  aba.jar.refresh = cookieAntigo;
  const dupla = await aba.chamar('POST', '/auth/refresh', { ajax: true });
  confere('cookie recém-trocado ainda é aceito (corrida entre abas)', dupla.status === 200 && dupla.dados.access_token, dupla);
  confere('sessão segue viva após a corrida', (await c1.chamar('GET', '/auth/me', { token: T2 })).status === 200);

  await pausa(16_000);
  const reuso = cliente();
  reuso.jar.refresh = cookieAntigo;
  confere('reuso de refresh token antigo é recusado', (await reuso.chamar('POST', '/auth/refresh', { ajax: true })).status === 401);
  confere('e derruba a sessão inteira (suspeita de roubo)', (await c1.chamar('POST', '/auth/refresh', { ajax: true })).status === 401);

  // ---------- listar e revogar sessões ----------
  const c2 = cliente();
  const c3 = cliente();
  const l2 = await c2.chamar('POST', '/auth/login', { corpo: { email: u1.email, password: SENHA } });
  const l3 = await c3.chamar('POST', '/auth/login', { corpo: { email: u1.email, password: SENHA } });
  const lista = await c2.chamar('GET', '/auth/sessoes', { token: l2.dados.access_token });
  confere('lista as sessões ativas, marcando a atual', lista.status === 200 && lista.dados.length === 2 && lista.dados.filter((s) => s.atual).length === 1, lista.dados);
  const outra = lista.dados.find((s) => !s.atual);
  confere('revoga outra sessão', (await c2.chamar('DELETE', `/auth/sessoes/${outra.id}`, { token: l2.dados.access_token })).status === 200);
  confere('a sessão revogada não renova mais', (await c3.chamar('POST', '/auth/refresh', { ajax: true })).status === 401);
  confere('o token de acesso da sessão revogada cai na hora', (await c3.chamar('GET', '/auth/me', { token: l3.dados.access_token })).status === 401);
  const sair = await c2.chamar('POST', '/auth/logout', { ajax: true });
  confere('logout encerra a sessão', sair.status === 200 && sair.dados.encerrada === true, sair);
  confere('após o logout o token de acesso cai', (await c2.chamar('GET', '/auth/me', { token: l2.dados.access_token })).status === 401);
  confere('e o refresh não funciona mais', (await anonimo('POST', '/auth/refresh', undefined, { 'X-Requested-With': 'XMLHttpRequest', Cookie: `itsm_refresh=${c2.jar.refresh ?? 'x'}` })).status === 401);

  // ---------- troca de senha ----------
  const u2 = await criar('TrocaSenha', 'SOLICITANTE');
  const ca = cliente();
  const cb = cliente();
  const la = await ca.chamar('POST', '/auth/login', { corpo: { email: u2.email, password: SENHA } });
  const lb = await cb.chamar('POST', '/auth/login', { corpo: { email: u2.email, password: SENHA } });
  const tokA = la.dados.access_token;
  confere('troca com senha atual errada é 403', (await ca.chamar('POST', '/auth/senha', { token: tokA, corpo: { senha_atual: 'errada-errada', nova_senha: 'Nova@Senha99' } })).status === 403);
  confere('senha fraca é recusada', (await ca.chamar('POST', '/auth/senha', { token: tokA, corpo: { senha_atual: SENHA, nova_senha: 'apenasletras' } })).status === 400);
  const troca = await ca.chamar('POST', '/auth/senha', { token: tokA, corpo: { senha_atual: SENHA, nova_senha: 'Nova@Senha99' } });
  confere('troca a própria senha (não precisa ser admin)', troca.status === 200 && troca.dados.access_token, troca);
  confere('o token novo mantém esta sessão', (await ca.chamar('GET', '/auth/me', { token: troca.dados.access_token })).status === 200);
  confere('o token antigo desta sessão cai (versão mudou)', (await ca.chamar('GET', '/auth/me', { token: tokA })).status === 401);
  confere('as outras sessões são encerradas', (await cb.chamar('GET', '/auth/me', { token: lb.dados.access_token })).status === 401);
  confere('senha antiga não loga mais', (await anonimo('POST', '/auth/login', { email: u2.email, password: SENHA })).status === 401);
  confere('senha nova loga', (await anonimo('POST', '/auth/login', { email: u2.email, password: 'Nova@Senha99' })).status === 200);

  // ---------- recuperação de senha por e-mail ----------
  const host = ipLocal();
  if (host) {
    for (const i of (await admin.chamar('GET', '/integracoes', { token: A })).dados ?? []) {
      if (i.tipo === 'SMTP' && i.status === 'ATIVO') await admin.chamar('PATCH', `/admin/integracoes/${i.id}`, { token: A, corpo: { status: 'INATIVO' } });
    }
    const smtp = await servidorSmtp(host);
    const integ = await admin.chamar('POST', '/admin/integracoes', { token: A, corpo: { nome: `SMTP auth ${sufixo}`, tipo: 'SMTP', configuracoes: { host, port: smtp.porta, user: 'robo', password: 'x-segredo-123', from: 'ITSM <itsm@teste.local>' } } });
    confere('configura o SMTP', integ.status === 201, integ);

    const u3 = await criar('Esqueci', 'SOLICITANTE');
    const generico = await anonimo('POST', '/auth/esqueci-senha', { email: u3.email });
    const inexistente = await anonimo('POST', '/auth/esqueci-senha', { email: `ninguem.${sufixo}@teste.local` });
    confere('resposta é igual para e-mail existente e inexistente', generico.status === 200 && inexistente.status === 200 && generico.dados.mensagem === inexistente.dados.mensagem, [generico.dados, inexistente.dados]);
    await pausa(1500);
    const email = smtp.mensagens.find((m) => m.para === u3.email);
    confere('e-mail de redefinição chega ao usuário', !!email, smtp.mensagens.map((m) => m.para));
    confere('nenhum e-mail para a conta que não existe', !smtp.mensagens.some((m) => m.para.startsWith('ninguem.')));
    const token = email && /redefinir-senha\?token=([A-Za-z0-9_-]+)/.exec(desquotar(email.corpo))?.[1];
    confere('o e-mail traz o link com o token', !!token, email?.corpo.slice(-300));
    if (token) {
      confere('token inválido é recusado', (await anonimo('POST', '/auth/redefinir-senha', { token: 'x'.repeat(43), nova_senha: 'Redefinida@99' })).status === 400);
      confere('senha fraca é recusada na redefinição', (await anonimo('POST', '/auth/redefinir-senha', { token, nova_senha: 'curta' })).status === 400);
      const antesLogin = await anonimo('POST', '/auth/login', { email: u3.email, password: SENHA });
      const red = await anonimo('POST', '/auth/redefinir-senha', { token, nova_senha: 'Redefinida@99' });
      confere('redefine a senha com o token', red.status === 200 && red.dados.redefinida === true, red);
      confere('o link só vale uma vez', (await anonimo('POST', '/auth/redefinir-senha', { token, nova_senha: 'Outra@Senha77' })).status === 400);
      confere('a sessão anterior à redefinição cai', (await anonimo('GET', '/auth/me', undefined, { Authorization: `Bearer ${antesLogin.dados.access_token}` })).status === 401);
      confere('loga com a senha redefinida', (await anonimo('POST', '/auth/login', { email: u3.email, password: 'Redefinida@99' })).status === 200);
    }
    await admin.chamar('PATCH', `/admin/integracoes/${integ.dados.id}`, { token: A, corpo: { status: 'INATIVO' } });
    smtp.fechar();
  } else {
    console.log('  (sem IP de rede local: recuperação por e-mail foi pulada)');
  }

  // ---------- verificação em duas etapas ----------
  const u4 = await criar('ComMfa', 'TECNICO');
  const cm = cliente();
  const lm = await cm.chamar('POST', '/auth/login', { corpo: { email: u4.email, password: SENHA } });
  const tm = lm.dados.access_token;
  confere('MFA começa desligado', (await cm.chamar('GET', '/auth/me', { token: tm })).dados.mfa_ativo === false);
  const conf = await cm.chamar('POST', '/auth/mfa/configurar', { token: tm });
  confere('configurar devolve segredo e URL otpauth', conf.status === 200 && /^[A-Z2-7]{32}$/.test(conf.dados.segredo) && conf.dados.otpauth_url.startsWith('otpauth://totp/'), conf.dados);
  confere('ativar com código errado é recusado', (await cm.chamar('POST', '/auth/mfa/ativar', { token: tm, corpo: { codigo: '000000' } })).status === 400);
  const segredo = conf.dados.segredo;
  const ativ = await cm.chamar('POST', '/auth/mfa/ativar', { token: tm, corpo: { codigo: codigoAgora(segredo) } });
  confere('ativa o MFA e devolve 8 códigos de recuperação', ativ.status === 200 && ativ.dados.codigos_recuperacao?.length === 8, ativ.dados);
  const recuperacao = ativ.dados.codigos_recuperacao ?? [];
  confere('MFA aparece ativo no /me', (await cm.chamar('GET', '/auth/me', { token: tm })).dados.mfa_ativo === true);

  const semCodigo = await anonimo('POST', '/auth/login', { email: u4.email, password: SENHA });
  confere('login sem código pede o segundo fator', semCodigo.status === 401 && semCodigo.dados.mfa_obrigatorio === true, semCodigo);
  const errada = await anonimo('POST', '/auth/login', { email: u4.email, password: 'senha-errada-1' });
  confere('com senha errada não revela que há MFA', errada.status === 401 && !errada.dados.mfa_obrigatorio, errada.dados);
  confere('código errado é recusado', (await anonimo('POST', '/auth/login', { email: u4.email, password: SENHA, codigo_mfa: '123456' })).status === 401);
  // o passo do código usado na ativação já foi consumido: usa o do passo seguinte
  const proximo = codigoAgora(segredo, 1);
  const comCodigo = await anonimo('POST', '/auth/login', { email: u4.email, password: SENHA, codigo_mfa: proximo });
  confere('login com o código do aplicativo', comCodigo.status === 200, comCodigo);
  confere('o mesmo código não vale duas vezes (anti-reuso)', (await anonimo('POST', '/auth/login', { email: u4.email, password: SENHA, codigo_mfa: proximo })).status === 401);
  const rec = await anonimo('POST', '/auth/login', { email: u4.email, password: SENHA, codigo_mfa: recuperacao[0] });
  confere('código de recuperação permite entrar', rec.status === 200, rec);
  confere('código de recuperação vale uma vez', (await anonimo('POST', '/auth/login', { email: u4.email, password: SENHA, codigo_mfa: recuperacao[0] })).status === 401);

  const admReset = await admin.chamar('POST', `/admin/usuarios/${u4.id}/mfa/resetar`, { token: A });
  confere('admin reseta o MFA de quem perdeu o aparelho', admReset.status === 200, admReset);
  const semMfa = await anonimo('POST', '/auth/login', { email: u4.email, password: SENHA });
  confere('depois do reset o login volta a ser só com senha', semMfa.status === 200, semMfa);
  // quem não é admin (aqui, o próprio usuário, com token válido) não pode resetar o MFA de ninguém
  const proibido = await cliente().chamar('POST', `/admin/usuarios/${u4.id}/mfa/resetar`, { token: semMfa.dados.access_token });
  confere('usuário comum não reseta MFA de ninguém', proibido.status === 403, proibido);

  // desativar pelo próprio usuário
  const cn = cliente();
  const ln = await cn.chamar('POST', '/auth/login', { corpo: { email: u4.email, password: SENHA } });
  const conf2 = await cn.chamar('POST', '/auth/mfa/configurar', { token: ln.dados.access_token });
  await cn.chamar('POST', '/auth/mfa/ativar', { token: ln.dados.access_token, corpo: { codigo: codigoAgora(conf2.dados.segredo) } });
  const tokNovo = (await anonimo('POST', '/auth/login', { email: u4.email, password: SENHA, codigo_mfa: codigoAgora(conf2.dados.segredo, 1) })).dados.access_token;
  confere('desativar exige senha', (await cn.chamar('POST', '/auth/mfa/desativar', { token: tokNovo, corpo: { senha: 'errada-errada', codigo: codigoAgora(conf2.dados.segredo, -1) } })).status === 403);

  // ---------- auditoria de segurança ----------
  const aud = await admin.chamar('GET', '/admin/auditoria?limite=200', { token: A });
  const acoes = new Set(aud.dados.map((l) => l.acao));
  for (const a of ['LOGIN', 'LOGIN_FALHA', 'LOGOUT', 'SESSION_REVOKE', 'PASSWORD_CHANGE', 'MFA_ENABLE', 'MFA_RESET']) {
    confere(`auditoria registra ${a}`, acoes.has(a), [...acoes]);
  }
  const falha = aud.dados.find((l) => l.acao === 'LOGIN_FALHA');
  confere('LOGIN_FALHA traz o usuário e o motivo, sem a senha', falha?.id_usuario && falha.valor_novo?.motivo && !JSON.stringify(falha).toLowerCase().includes('senha12345'), falha);
  confere('LOGIN grava o IP', aud.dados.filter((l) => l.acao === 'LOGIN').every((l) => l.endereco_ip));

  console.log(`\n${ok} verificações ok, ${falhas.length} falha(s).`);
  if (falhas.length) {
    console.log(falhas.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Erro inesperado:', e);
  process.exit(1);
});
