/**
 * Teste de fumaça das notificações e integrações: notificações automáticas, e-mail (SMTP), webhook assinado,
 * entrada de e-mail e alertas de SLA. Precisa de uma API real E de:
 *   - DATABASE_URL (para ajustar prazos de SLA);
 *   - API iniciada com REDE_PERMITE_INTERNA=true e SLA_VARREDURA_MS=2000, porque os receptores de teste
 *     (SMTP e webhook) escutam no IP da rede local, já que loopback é sempre barrado.
 *
 *   BASE_URL=http://127.0.0.1:3100/api DATABASE_URL=postgresql://... node test/smoke/integracoes.mjs
 */
import { createHmac } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';

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
  console.log(`  ✗ ${nome}`, detalhe === undefined ? '' : JSON.stringify(detalhe).slice(0, 300));
};

async function api(token, metodo, caminho, corpo, headers = {}) {
  const h = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers };
  if (corpo !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + caminho, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return { status: r.status, dados: await r.json().catch(() => null) };
}
const login = (email, password) => api(null, 'POST', '/auth/login', { email, password });

function ipLocal() {
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista ?? []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
}

/** Servidor SMTP mínimo: aceita tudo e guarda as mensagens recebidas. */
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
        else if (cmd.startsWith('AUTH')) socket.write('235 autenticado\r\n');
        else if (cmd.startsWith('MAIL FROM')) socket.write('250 ok\r\n');
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

function receptorWebhook(host) {
  const recebidos = [];
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      recebidos.push({ headers: req.headers, corpo });
      res.writeHead(200).end('ok');
    });
  });
  return new Promise((resolve) => servidor.listen(0, host, () => resolve({ recebidos, porta: servidor.address().port, fechar: () => servidor.close() })));
}

async function main() {
  const host = ipLocal();
  if (!host) console.log('  (sem IP de rede local: testes de SMTP e webhook serão pulados)');
  if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL (ajuste de prazos de SLA).');
  const require = createRequire(`${process.cwd()}/package.json`);
  const pg = require('pg');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const adm = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const A = adm.dados.access_token;
  const me = (await api(A, 'GET', '/auth/me')).dados;
  const idCliente = me.id_cliente;

  const novo = async (nome, perfil) => {
    const email = `${nome}.${sufixo}@teste.local`.toLowerCase();
    const r = await api(A, 'POST', '/admin/usuarios', { nome, email, senha_hash: SENHA, cargo: 'Teste', perfil });
    confere(`cria ${nome}`, r.status === 201, r);
    const t = (await login(email, SENHA)).dados.access_token;
    return { id: r.dados.id, email, token: t };
  };
  const tec = await novo('TecnicoNotif', 'TECNICO');
  const ges = await novo('GestorNotif', 'GESTOR');
  const sol = await novo('SolicNotif', 'SOLICITANTE');

  // política de SLA para todas as prioridades (idempotente)
  const hor = await api(A, 'POST', '/admin/horarios-comerciais', { nome: `H ${sufixo}`, fuso_horario: 'America/Cuiaba' });
  for (let d = 0; d <= 6; d += 1) await api(A, 'POST', `/admin/horarios-comerciais/${hor.dados.id}/intervalos`, { dia_semana: d, hora_inicio: '00:00', hora_fim: '23:59' });
  for (const p of ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA']) {
    await api(A, 'POST', '/admin/politicas-sla', { nome: `SLA ${p} ${sufixo}`, prioridade_alvo: p, tipo_chamado_alvo: 'AMBOS', tempo_resposta_min: 30, tempo_resolucao_min: 240, id_horario_comercial: hor.dados.id });
  }
  const cat = await api(ges.token, 'POST', '/categorias', { nome: `Notif ${sufixo}` });

  const notificacoes = async (u) => (await api(u.token, 'GET', '/notificacoes')).dados ?? [];
  const tem = async (u, texto) => (await notificacoes(u)).some((n) => `${n.titulo} ${n.mensagem}`.includes(texto));

  // execuções anteriores deixam integrações ativas: só pode haver uma SMTP ativa
  for (const i of (await api(A, 'GET', '/integracoes')).dados ?? []) {
    if (i.tipo === 'SMTP' && i.status === 'ATIVO') await api(A, 'PATCH', `/admin/integracoes/${i.id}`, { status: 'INATIVO' });
  }

  // ---------- SMTP ----------
  let smtp = null;
  if (host) {
    smtp = await servidorSmtp(host);
    const integ = await api(A, 'POST', '/admin/integracoes', { nome: `SMTP ${sufixo}`, tipo: 'SMTP', configuracoes: { host, port: smtp.porta, user: 'robo', password: 'segredo-smtp-123', from: 'ITSM <itsm@teste.local>' } });
    confere('cria integração SMTP', integ.status === 201 && integ.dados.configuracoes.password === '[criptografado]', integ);
    const teste = await api(A, 'POST', `/admin/integracoes/${integ.dados.id}/testar`);
    confere('teste do SMTP envia e-mail', teste.status === 200 && teste.dados.status === 'SUCESSO', teste);
    confere('e-mail de teste chegou ao servidor', smtp.mensagens.some((m) => m.para === ADMIN_EMAIL), smtp.mensagens.map((m) => m.para));
    confere('segunda SMTP ativa é recusada', (await api(A, 'POST', '/admin/integracoes', { nome: `Outra ${sufixo}`, tipo: 'SMTP', configuracoes: { host, port: 25 } })).status === 409);
    confere('SMTP sem host é recusado', (await api(A, 'POST', '/admin/integracoes', { nome: `ruim ${sufixo}`, tipo: 'SMTP', configuracoes: { port: 25 } })).status === 400);
    const edit = await api(A, 'PATCH', `/admin/integracoes/${integ.dados.id}`, { configuracoes: { host, port: smtp.porta, password: '[criptografado]', user: 'robo', from: 'ITSM <itsm@teste.local>' } });
    confere('edição mantém o segredo já gravado', edit.status === 200 && edit.dados.configuracoes.password === '[criptografado]', edit);
  }

  // ---------- webhook ----------
  let hook = null;
  if (host) {
    hook = await receptorWebhook(host);
    const integ = await api(A, 'POST', '/admin/integracoes', { nome: `Hook ${sufixo}`, tipo: 'WEBHOOK', configuracoes: { url: `http://${host}:${hook.porta}/eventos`, secret: 'segredo-do-hook', eventos: ['chamado.criado', 'chamado.status_alterado', 'sla.vencido', 'sla.perto_de_vencer'] } });
    confere('cria webhook', integ.status === 201, integ);
    const loop = await api(A, 'POST', '/admin/integracoes', { nome: `Loop ${sufixo}`, tipo: 'WEBHOOK', configuracoes: { url: 'http://127.0.0.1:9/x' } });
    const tLoop = await api(A, 'POST', `/admin/integracoes/${loop.dados.id}/testar`);
    confere('webhook para loopback é barrado na entrega', tLoop.dados?.status === 'FALHA' && /não permitido/.test(tLoop.dados?.dados_log ?? ''), tLoop.dados);
    await api(A, 'PATCH', `/admin/integracoes/${loop.dados.id}`, { status: 'INATIVO' });
    const t = await api(A, 'POST', `/admin/integracoes/${integ.dados.id}/testar`);
    confere('teste do webhook entrega o evento', t.dados?.status === 'SUCESSO', t);
    const assinatura = hook.recebidos[0]?.headers['x-itsm-signature'];
    const esperado = hook.recebidos[0] && `sha256=${createHmac('sha256', 'segredo-do-hook').update(hook.recebidos[0].corpo).digest('hex')}`;
    confere('webhook vem assinado (HMAC)', assinatura && assinatura === esperado, assinatura);
  }

  // ---------- notificações automáticas ----------
  const ab = await api(sol.token, 'POST', '/chamados', { titulo: 'Impressora parada', descricao: 'A impressora do andar não imprime.', id_categoria: cat.dados.id, tipo: 'INCIDENTE', prioridade: 'CRITICA' });
  const id = ab.dados.id;
  await pausa(800);
  confere('chamado crítico notifica o gestor', await tem(ges, `#${id}`), await notificacoes(ges));
  await api(ges.token, 'PATCH', `/chamados/${id}`, { id_tecnico_atribuido: tec.id });
  await pausa(300);
  confere('atribuição notifica o técnico', await tem(tec, `Chamado #${id} atribuído a você`));
  await api(tec.token, 'PATCH', `/chamados/${id}/status`, { status_novo: 'EM_ATENDIMENTO' });
  await pausa(300);
  confere('início do atendimento notifica o solicitante', await tem(sol, `Chamado #${id} atualizado`));
  await api(sol.token, 'POST', `/chamados/${id}/comentarios`, { mensagem: 'Já reiniciei e continua igual' });
  await pausa(300);
  confere('comentário do solicitante notifica o técnico', await tem(tec, `Novo comentário no chamado #${id}`));
  await api(tec.token, 'POST', `/chamados/${id}/comentarios`, { mensagem: 'Vou verificar o driver' });
  await pausa(300);
  confere('comentário do técnico notifica o solicitante', await tem(sol, `Novo comentário no chamado #${id}`));
  await api(tec.token, 'POST', `/chamados/${id}/comentarios`, { mensagem: 'Nota técnica sigilosa', tipo_visibilidade: 'INTERNO' });
  await pausa(300);
  confere('nota interna não notifica o solicitante', !(await tem(sol, 'Nota interna')));
  await api(tec.token, 'POST', `/chamados/${id}/pausas`, { motivo_pausa: 'AGUARDANDO_SOLICITANTE' });
  await pausa(300);
  confere('pausa aguardando o solicitante o avisa', await tem(sol, `Chamado #${id} aguarda uma resposta sua`));
  await api(tec.token, 'PATCH', `/chamados/${id}/pausas/retomar`);
  await api(tec.token, 'PATCH', `/chamados/${id}/status`, { status_novo: 'RESOLVIDO', resolucao: 'Driver reinstalado' });
  await pausa(300);
  confere('resolução notifica o solicitante', await tem(sol, `Chamado #${id} resolvido`));
  await api(sol.token, 'PATCH', `/chamados/${id}/status`, { status_novo: 'EM_ATENDIMENTO' });
  await pausa(300);
  confere('reabertura notifica o técnico', await tem(tec, `Chamado #${id} reaberto`));
  const ap = await api(sol.token, 'POST', '/aprovacoes', { descricao: 'Preciso de um toner novo', id_aprovador: ges.id, id_chamado: id });
  await pausa(300);
  confere('pedido de aprovação notifica o aprovador', await tem(ges, 'Aprovação pendente'));
  await api(ges.token, 'POST', `/aprovacoes/${ap.dados.id}/decisao`, { status: 'APROVADO' });
  await pausa(300);
  confere('decisão notifica o solicitante', await tem(sol, 'Aprovação aprovada'));
  const naoLidas = await api(sol.token, 'GET', '/notificacoes/nao-lidas/total');
  confere('contador de não lidas reflete as notificações', naoLidas.dados.total >= 5, naoLidas.dados);

  if (smtp) {
    await pausa(1200);
    const paraSol = smtp.mensagens.filter((m) => m.para === sol.email);
    confere('notificações também saem por e-mail', paraSol.length >= 3, smtp.mensagens.map((m) => m.para));
    confere('e-mail traz o texto do evento', smtp.mensagens.some((m) => /resolvido/i.test(m.corpo)));
  }

  if (hook) {
    await pausa(500);
    const eventos = hook.recebidos.map((r) => r.headers['x-itsm-event']);
    confere('webhook recebeu chamado.criado e chamado.status_alterado', eventos.includes('chamado.criado') && eventos.includes('chamado.status_alterado'), eventos);
    confere('webhook não recebe eventos que não assina', !eventos.includes('chamado.comentado'), eventos);
  }

  // ---------- alertas de SLA ----------
  const ab2 = await api(sol.token, 'POST', '/chamados', { titulo: 'Lentidão no sistema', descricao: 'O ERP está muito lento hoje.', id_categoria: cat.dados.id, tipo: 'INCIDENTE', prioridade: 'ALTA' });
  const ab3 = await api(sol.token, 'POST', '/chamados', { titulo: 'Mouse falhando', descricao: 'O mouse trava de vez em quando.', id_categoria: cat.dados.id, tipo: 'INCIDENTE', prioridade: 'MEDIA' });
  for (const c of [ab2.dados.id, ab3.dados.id]) {
    await api(tec.token, 'PATCH', `/chamados/${c}`, { id_tecnico_atribuido: tec.id });
    await api(tec.token, 'PATCH', `/chamados/${c}/status`, { status_novo: 'EM_ATENDIMENTO' });
  }
  await db.query(`UPDATE chamados SET data_previsao_resolucao = now() - interval '2 minutes' WHERE id = $1`, [ab2.dados.id]);
  await db.query(`UPDATE chamados SET data_previsao_resolucao = now() + interval '5 minutes' WHERE id = $1`, [ab3.dados.id]);
  await pausa(5000);
  confere('SLA vencido notifica o técnico', await tem(tec, `SLA vencido no chamado #${ab2.dados.id}`), await notificacoes(tec));
  confere('chamado vencido ganha sla_vencido', (await api(tec.token, 'GET', `/chamados/${idCliente}/${ab2.dados.id}`)).dados.sla_vencido === true);
  confere('SLA perto de vencer notifica o técnico', await tem(tec, `SLA perto de vencer no chamado #${ab3.dados.id}`), await notificacoes(tec));
  const antes = (await notificacoes(tec)).length;
  await pausa(5000);
  confere('o alerta não se repete a cada varredura', (await notificacoes(tec)).length === antes);
  const alertas = await db.query(`SELECT tipo, count(*)::int AS n FROM sla_alertas WHERE id_cliente = $1 GROUP BY tipo`, [idCliente]);
  confere('alertas ficam registrados uma vez por chamado', alertas.rows.every((r) => r.n >= 1));

  // ---------- entrada de e-mail ----------
  const token = `token-entrada-${sufixo}-abcdefghij`;
  const entrada = await api(A, 'POST', '/admin/integracoes', { nome: `Entrada ${sufixo}`, tipo: 'EMAIL_ENTRADA', configuracoes: { token, id_categoria: cat.dados.id, prioridade: 'BAIXA', tipo: 'REQUISICAO' } });
  confere('cria integração de entrada de e-mail', entrada.status === 201 && entrada.dados.configuracoes.token === '[criptografado]', entrada);
  const corpo = { de: sol.email, assunto: 'Pedido de monitor extra', texto: 'Gostaria de um segundo monitor.' };
  confere('entrada sem token é 401', (await api(null, 'POST', '/entrada/email', corpo)).status === 401);
  confere('entrada com token errado é 401', (await api(null, 'POST', '/entrada/email', corpo, { 'X-Integration-Token': 'x'.repeat(30) })).status === 401);
  const cria = await api(null, 'POST', '/entrada/email', corpo, { 'X-Integration-Token': token });
  confere('e-mail recebido abre chamado', cria.status === 201 && cria.dados.acao === 'CHAMADO', cria);
  const detalhe = await api(sol.token, 'GET', `/chamados/${idCliente}/${cria.dados.id_chamado}`);
  confere('chamado nasce com origem EMAIL e categoria da integração', detalhe.dados?.origem === 'EMAIL' && detalhe.dados?.id_categoria === cat.dados.id && detalhe.dados?.prioridade === 'BAIXA', detalhe.dados);
  const resp = await api(null, 'POST', '/entrada/email', { de: sol.email, assunto: `Re: [#${cria.dados.id_chamado}] Pedido de monitor extra`, texto: 'Pode ser de 24 polegadas.' }, { 'X-Integration-Token': token });
  confere('resposta com #id vira comentário', resp.status === 201 && resp.dados.acao === 'COMENTARIO', resp);
  confere('remetente desconhecido é 404', (await api(null, 'POST', '/entrada/email', { ...corpo, de: 'estranho@fora.com' }, { 'X-Integration-Token': token })).status === 404);

  smtp?.fechar();
  hook?.fechar();
  await db.end();

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
