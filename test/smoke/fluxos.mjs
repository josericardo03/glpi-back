/**
 * Teste de fumaça de ponta a ponta: percorre os fluxos principais contra uma API real (com banco real).
 *
 *   BASE_URL=http://127.0.0.1:3100/api ADMIN_EMAIL=admin@itsm.local ADMIN_PASSWORD=... \
 *   DATABASE_URL=postgresql://... node test/smoke/fluxos.mjs
 *
 * Use um banco descartável: o script cria clientes, usuários e chamados. `DATABASE_URL` é opcional e só serve
 * para o cenário de e-mail repetido em dois clientes. Sai com código 1 se algum passo falhar.
 */
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100/api';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@itsm.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@123456';
const SENHA = 'Senha@12345';
const sufixo = Date.now().toString().slice(-6);

let ok = 0;
const falhas = [];

function confere(nome, condicao, detalhe) {
  if (condicao) {
    ok += 1;
    return;
  }
  falhas.push(`${nome}${detalhe === undefined ? '' : ` -> ${typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe)}`}`);
  console.log(`  ✗ ${nome}`, detalhe === undefined ? '' : JSON.stringify(detalhe).slice(0, 300));
}

async function api(token, metodo, caminho, corpo, extra = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra.headers };
  let body;
  if (corpo instanceof FormData) body = corpo;
  else if (corpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  const r = await fetch(BASE + caminho, { method: metodo, headers, body });
  const tipo = r.headers.get('content-type') ?? '';
  const dados = tipo.includes('json') ? await r.json().catch(() => null) : await r.arrayBuffer().then((b) => Buffer.from(b));
  return { status: r.status, dados, headers: r.headers };
}

async function login(email, password, idCliente) {
  const r = await api(null, 'POST', '/auth/login', { email, password, ...(idCliente ? { id_cliente: idCliente } : {}) });
  return r;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const arquivo = (nome, conteudo, tipo = 'application/octet-stream') => {
  const f = new FormData();
  f.append('arquivo', new Blob([conteudo], { type: tipo }), nome);
  return f;
};

async function main() {
  console.log(`Fumaça em ${BASE}`);

  // ---------- autenticação ----------
  const adm = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  confere('login do admin', adm.status === 200 && adm.dados?.access_token, adm);
  const A = adm.dados.access_token;
  const me = await api(A, 'GET', '/auth/me');
  confere('/auth/me', me.status === 200 && me.dados.perfil === 'ADMIN', me);
  const idCliente = me.dados.id_cliente;
  confere('login com senha errada é 401', (await login(ADMIN_EMAIL, 'errada-errada')).status === 401);
  confere('rota protegida sem token é 401', (await api(null, 'GET', '/chamados')).status === 401);

  // ---------- usuários ----------
  const novoUsuario = async (nome, perfil) => {
    const r = await api(A, 'POST', '/admin/usuarios', {
      nome,
      email: `${nome.toLowerCase().replace(/\W/g, '')}.${sufixo}@teste.local`,
      senha_hash: SENHA,
      cargo: 'Teste',
      perfil,
    });
    confere(`cria usuário ${nome}`, r.status === 201, r);
    return { ...r.dados, email: r.dados.email };
  };
  const uTec = await novoUsuario('Tecnico', 'TECNICO');
  const uGes = await novoUsuario('Gestor', 'GESTOR');
  const uSol = await novoUsuario('Solicitante', 'SOLICITANTE');
  const uSol2 = await novoUsuario('Solicitante2', 'SOLICITANTE');
  const tok = async (u) => {
    const r = await login(u.email, SENHA);
    confere(`login ${u.perfil}`, r.status === 200, r);
    return r.dados.access_token;
  };
  const T = await tok(uTec);
  const G = await tok(uGes);
  const S = await tok(uSol);
  const S2 = await tok(uSol2);

  // o admin não pode se desativar
  const autoDesativar = await api(A, 'PATCH', `/admin/usuarios/${me.dados.id}`, { status: 'DESATIVADO' });
  confere('admin não desativa a própria conta', autoDesativar.status === 400, autoDesativar);
  confere('solicitante não acessa /admin', (await api(S, 'GET', '/admin/auditoria')).status === 403);

  // ---------- SLA: horário, política ----------
  const hor = await api(A, 'POST', '/admin/horarios-comerciais', { nome: `24h ${sufixo}`, fuso_horario: 'America/Rio_Branco' });
  confere('cria horário comercial (Rio Branco)', hor.status === 201, hor);
  confere('fuso inválido é recusado', (await api(A, 'POST', '/admin/horarios-comerciais', { nome: 'x', fuso_horario: 'Mars/Base' })).status === 400);
  for (let dia = 0; dia <= 6; dia += 1) {
    const r = await api(A, 'POST', `/admin/horarios-comerciais/${hor.dados.id}/intervalos`, { dia_semana: dia, hora_inicio: '00:00', hora_fim: '23:59' });
    if (r.status !== 201) confere(`intervalo dia ${dia}`, false, r);
  }
  for (const prioridade of ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA']) {
    const r = await api(A, 'POST', '/admin/politicas-sla', {
      nome: `SLA ${prioridade}`,
      prioridade_alvo: prioridade,
      tipo_chamado_alvo: 'AMBOS',
      tempo_resposta_min: 30,
      tempo_resolucao_min: 240,
      id_horario_comercial: hor.dados.id,
    });
    // 409 = política já criada por uma execução anterior neste banco
    confere(`política ${prioridade}`, r.status === 201 || r.status === 409, r);
  }
  const invalida = await api(A, 'POST', '/admin/politicas-sla', {
    nome: 'invertida',
    prioridade_alvo: 'CRITICA',
    tipo_chamado_alvo: 'REQUISICAO',
    tempo_resposta_min: 300,
    tempo_resolucao_min: 100,
    id_horario_comercial: hor.dados.id,
  });
  confere('política com resposta >= solução é 400', invalida.status === 400, invalida);
  const feriado = await api(A, 'POST', '/admin/feriados', { nome: 'Teste', dia: 1, mes: 1 });
  confere('cria feriado', feriado.status === 201, feriado);
  confere('atualiza feriado (auditado)', (await api(A, 'PATCH', `/admin/feriados/${feriado.dados.id}`, { nome: 'Teste 2' })).status === 200);
  confere('remove feriado', (await api(A, 'DELETE', `/admin/feriados/${feriado.dados.id}`)).status === 200);

  // ---------- cadastros ----------
  const cat = await api(G, 'POST', '/categorias', { nome: `Rede ${sufixo}` });
  confere('gestor cria categoria', cat.status === 201, cat);
  const grupo = await api(G, 'POST', '/grupos-suporte', { nome: `Equipe ${sufixo}` });
  confere('gestor cria grupo', grupo.status === 201, grupo);
  confere('adiciona membro ao grupo', (await api(G, 'POST', `/grupos-suporte/${grupo.dados.id}/membros`, { id_usuario: uTec.id })).status === 201);
  const membros = await api(G, 'GET', '/grupos-suporte/membros');
  confere('lista membros com carga', membros.status === 200 && membros.dados.some((m) => m.id_usuario === uTec.id && typeof m.carga_trabalho_pct === 'number'), membros);
  confere('técnico não lista membros', (await api(T, 'GET', '/grupos-suporte/membros')).status === 403);

  // ---------- chamado: abertura e detalhe ----------
  const ab = await api(S, 'POST', '/chamados', {
    titulo: 'Sem acesso à rede',
    descricao: 'Não consigo acessar a rede da empresa desde hoje cedo.',
    id_categoria: cat.dados.id,
    tipo: 'INCIDENTE',
    prioridade: 'ALTA',
  });
  confere('solicitante abre chamado', ab.status === 201 && ab.dados.data_previsao_resolucao, ab);
  const idCh = ab.dados.id;
  const det0 = await api(S, 'GET', `/chamados/${idCliente}/${idCh}`);
  confere('detalhe traz o nome do solicitante', det0.dados?.solicitante?.nome === 'Solicitante', det0.dados?.solicitante);
  confere('detalhe traz a categoria com nome', det0.dados?.categoria?.nome?.startsWith('Rede'), det0.dados?.categoria);
  confere('outro solicitante não vê o chamado', (await api(S2, 'GET', `/chamados/${idCliente}/${idCh}`)).status === 403);

  // ---------- atribuição ----------
  const atr = await api(T, 'PATCH', `/chamados/${idCh}`, { id_tecnico_atribuido: uTec.id, id_grupo_responsavel: grupo.dados.id });
  confere('técnico + grupo atribuídos', atr.status === 200 && atr.dados.id_grupo_responsavel === grupo.dados.id, atr);
  const det1 = await api(S, 'GET', `/chamados/${idCliente}/${idCh}`);
  confere('solicitante vê o nome do técnico', det1.dados?.tecnico?.nome === 'Tecnico', det1.dados?.tecnico);
  confere('solicitante vê o nome do grupo', det1.dados?.grupo?.nome?.startsWith('Equipe'), det1.dados?.grupo);

  // ---------- atendimento ----------
  confere('NOVO -> EM_ATENDIMENTO', (await api(T, 'PATCH', `/chamados/${idCh}/status`, { status_novo: 'EM_ATENDIMENTO' })).status === 200);
  const interno = await api(T, 'POST', `/chamados/${idCh}/comentarios`, { mensagem: 'Nota interna do técnico', tipo_visibilidade: 'INTERNO' });
  confere('cria nota interna', interno.status === 201, interno);
  const publico = await api(S, 'POST', `/chamados/${idCh}/comentarios`, { mensagem: 'Aviso do solicitante' });
  confere('solicitante comenta', publico.status === 201, publico);
  confere('solicitante não cria nota interna', (await api(S, 'POST', `/chamados/${idCh}/comentarios`, { mensagem: 'x', tipo_visibilidade: 'INTERNO' })).status === 403);

  const anexoInterno = await api(T, 'POST', `/chamados/${idCh}/anexos`, Object.assign(arquivo('log.txt', 'linha de log', 'text/plain'), {}));
  confere('anexa log ao chamado', anexoInterno.status === 201, anexoInterno);
  const f2 = arquivo('interno.txt', 'segredo interno', 'text/plain');
  f2.append('id_comentario', String(interno.dados.id));
  const anexoNota = await api(T, 'POST', `/chamados/${idCh}/anexos`, f2);
  confere('anexa arquivo à nota interna', anexoNota.status === 201, anexoNota);
  const f3 = arquivo('print.png', PNG, 'image/png');
  f3.append('id_comentario', String(publico.dados.id));
  const anexoPub = await api(S, 'POST', `/chamados/${idCh}/anexos`, f3);
  confere('solicitante anexa print ao comentário', anexoPub.status === 201, anexoPub);
  const f4 = arquivo('x.txt', 'oi', 'text/plain');
  f4.append('id_comentario', String(interno.dados.id));
  confere('solicitante não anexa à nota interna', (await api(S, 'POST', `/chamados/${idCh}/anexos`, f4)).status === 403);
  confere('arquivo .exe é recusado', (await api(T, 'POST', `/chamados/${idCh}/anexos`, arquivo('mal.exe', 'MZ'))).status === 400);
  confere('HTML renomeado para .png é recusado', (await api(T, 'POST', `/chamados/${idCh}/anexos`, arquivo('mal.png', '<script>alert(1)</script>', 'image/png'))).status === 400);
  const baixa = await api(T, 'GET', `/chamados/${idCh}/anexos/${anexoNota.dados.id}`);
  confere('técnico baixa anexo de nota interna', baixa.status === 200 && baixa.dados.toString() === 'segredo interno', baixa.status);
  confere('solicitante NÃO baixa anexo de nota interna', (await api(S, 'GET', `/chamados/${idCh}/anexos/${anexoNota.dados.id}`)).status === 404);
  confere('nosniff nas respostas', baixa.headers.get('x-content-type-options') === 'nosniff');
  const det2 = await api(S, 'GET', `/chamados/${idCliente}/${idCh}`);
  confere('solicitante não vê a nota interna', !det2.dados.comentarios_chamados.some((c) => c.tipo_visibilidade === 'INTERNO'));
  confere('solicitante não vê o anexo da nota interna', !det2.dados.anexos_chamados.some((a) => a.id === anexoNota.dados.id));
  confere('comentário traz o autor', det2.dados.comentarios_chamados.every((c) => c.autor?.nome), det2.dados.comentarios_chamados);
  confere('solicitante não vê worklogs', Array.isArray(det2.dados.worklogs) && det2.dados.worklogs.length === 0);
  const wl = await api(T, 'POST', `/chamados/${idCh}/worklogs`, { descricao_atividade: 'Análise dos logs', tempo_trabalhado_min: 20, data_execucao: new Date().toISOString() });
  confere('técnico registra worklog', wl.status === 201, wl);
  const detT = await api(T, 'GET', `/chamados/${idCliente}/${idCh}`);
  confere('técnico vê worklog com nome', detT.dados.worklogs[0]?.tecnico?.nome === 'Tecnico', detT.dados.worklogs);

  // ---------- pausa e concorrência ----------
  const pausas = await Promise.all([
    api(T, 'POST', `/chamados/${idCh}/pausas`, { motivo_pausa: 'AGUARDANDO_TERCEIRO' }),
    api(T, 'POST', `/chamados/${idCh}/pausas`, { motivo_pausa: 'AGUARDANDO_TERCEIRO' }),
  ]);
  const codigos = pausas.map((p) => p.status).sort();
  confere('duas pausas simultâneas: uma passa, a outra falha', codigos[0] === 201 && codigos[1] >= 400 && codigos[1] < 500, codigos);
  confere('solicitante não pausa', (await api(S, 'PATCH', `/chamados/${idCh}/status`, { status_novo: 'PENDENTE', motivo_pausa: 'AGUARDANDO_TERCEIRO' })).status === 403);
  const retomadas = await Promise.all([api(T, 'PATCH', `/chamados/${idCh}/pausas/retomar`), api(T, 'PATCH', `/chamados/${idCh}/pausas/retomar`)]);
  const ret = retomadas.map((p) => p.status).sort();
  confere('duas retomadas simultâneas: uma passa, a outra falha', ret[0] === 200 && ret[1] >= 400 && ret[1] < 500, ret);

  // ---------- resolver, reabrir, concluir ----------
  confere('resolver sem resolução é 400', (await api(T, 'PATCH', `/chamados/${idCh}/status`, { status_novo: 'RESOLVIDO' })).status === 400);
  confere('EM_ATENDIMENTO -> RESOLVIDO', (await api(T, 'PATCH', `/chamados/${idCh}/status`, { status_novo: 'RESOLVIDO', resolucao: 'Cabo reconectado' })).status === 200);
  const reab = await api(S, 'PATCH', `/chamados/${idCh}/status`, { status_novo: 'EM_ATENDIMENTO' });
  confere('solicitante reabre chamado resolvido', reab.status === 200, reab);
  const detR = await api(S, 'GET', `/chamados/${idCliente}/${idCh}`);
  confere('reabertura limpa a resolução', detR.dados.resolucao === null && detR.dados.data_resolucao === null, detR.dados.resolucao);
  confere('segundo solicitante não reabre', (await api(S2, 'PATCH', `/chamados/${idCh}/status`, { status_novo: 'EM_ATENDIMENTO' })).status === 403);
  confere('resolve de novo', (await api(T, 'PATCH', `/chamados/${idCh}/status`, { status_novo: 'RESOLVIDO', resolucao: 'Trocado o switch' })).status === 200);
  const concl = await api(S, 'PATCH', `/chamados/${idCh}/status`, { status_novo: 'CONCLUIDO' });
  confere('solicitante conclui', concl.status === 200, concl);
  const csat = await api(S, 'POST', '/pesquisas-csat', { id_chamado: idCh, nota_satisfacao: 5, comentarios: 'Ótimo' });
  confere('CSAT registrado', csat.status === 201, csat);
  confere('CSAT duplicado é 409', (await api(S, 'POST', '/pesquisas-csat', { id_chamado: idCh, nota_satisfacao: 4 })).status === 409);
  const detF = await api(S, 'GET', `/chamados/${idCliente}/${idCh}`);
  confere('detalhe indica CSAT avaliado', detF.dados.csat?.avaliado === true, detF.dados.csat);
  confere('histórico traz reabertura e usuário', detF.dados.historico_status_chamados.some((h) => h.status_anterior === 'RESOLVIDO' && h.status_novo === 'EM_ATENDIMENTO' && h.usuario?.nome), detF.dados.historico_status_chamados.slice(0, 2));

  // ---------- listagens e painéis (SQL cru) ----------
  const lista = await api(T, 'GET', '/chamados?status=CONCLUIDO&ordenar=prioridade:desc&limite=10');
  confere('lista chamados com filtro', lista.status === 200 && lista.dados.length >= 1 && lista.headers.get('x-total-count'), lista.status);
  confere('lista por busca', (await api(T, 'GET', '/chamados?busca=rede')).status === 200);
  confere('triagem', (await api(T, 'GET', '/triagem')).status === 200);
  const resumo = await api(T, 'GET', '/dashboards/resumo?periodo=7d');
  confere('dashboard resumo', resumo.status === 200 && resumo.dados.kpis, resumo);
  const dia = new Date().toISOString().slice(0, 10);
  const tma = await api(G, 'GET', `/relatorios/tma?de=${dia}&ate=${dia}`);
  confere('relatório TMA', tma.status === 200 && tma.dados.total_fechados >= 1, tma);
  confere('solicitante vê só o próprio painel', (await api(S2, 'GET', '/dashboards/resumo')).dados?.kpis?.total_periodo === 0);

  // ---------- ativos ----------
  const ativo = await api(T, 'POST', '/ativos', { codigo_patrimonio: `PAT-${sufixo}`, nome: 'Switch Core', tipo_ativo: 'SWITCH' });
  confere('cria ativo', ativo.status === 201, ativo);
  const ativo2 = await api(T, 'POST', '/ativos', { codigo_patrimonio: `PAT2-${sufixo}`, nome: 'Servidor ERP', tipo_ativo: 'SERVIDOR', id_usuario_atribuido: uSol.id });
  confere('cria ativo 2', ativo2.status === 201, ativo2);
  confere('vincula ativo ao chamado', (await api(T, 'POST', `/chamados/${idCh}/ativos`, { id_ativo: ativo.dados.id })).status === 201);
  confere('especificação', (await api(T, 'POST', `/ativos/${ativo.dados.id}/especificacoes`, { chave: 'Portas', valor: '48' })).status === 201);
  confere('especificação duplicada é 409', (await api(T, 'POST', `/ativos/${ativo.dados.id}/especificacoes`, { chave: 'Portas', valor: '24' })).status === 409);
  const man = await api(T, 'POST', `/ativos/${ativo.dados.id}/manutencoes`, { descricao_servico: '[Preventiva] Limpeza', custo_manutencao: 150.5, data_inicio: new Date().toISOString() });
  confere('manutenção', man.status === 201 && man.dados.tecnico?.nome === 'Tecnico', man);
  confere('relacionamento de dependência', (await api(T, 'POST', '/ativos/relacionamentos', { id_ativo_origem: ativo2.dados.id, id_ativo_destino: ativo.dados.id, tipo_relacionamento: 'DEPENDE_DE' })).status === 201);
  const detAt = await api(T, 'GET', `/ativos/${ativo.dados.id}`);
  confere('detalhe do ativo completo', detAt.status === 200 && detAt.dados.especificacoes.length === 1 && detAt.dados.manutencoes.length === 1 && detAt.dados.dependencias.some((d) => d.relacao === 'SUPORTA') && detAt.dados.chamados.length === 1, detAt.dados);
  confere('impacto do ativo', (await api(T, 'GET', `/ativos/${ativo.dados.id}/impacto`)).dados?.afetados?.length === 1);
  confere('solicitante vê só os próprios ativos', (await api(S, 'GET', '/ativos')).dados.length === 1);
  confere('solicitante não vê ativo alheio', (await api(S, 'GET', `/ativos/${ativo.dados.id}`)).status === 404);
  confere('lista de relacionamentos', (await api(T, 'GET', '/ativos/relacionamentos')).status === 200);

  // mapas de software: várias coleções nomeadas de dependências
  const mapaPadrao = (await api(T, 'GET', '/mapas-software')).dados?.find((m) => m.nome === 'Principal');
  confere('mapa Principal criado com a primeira dependência', !!mapaPadrao && mapaPadrao.total_ligacoes >= 1, mapaPadrao);
  const relPadrao = (await api(T, 'GET', '/ativos/relacionamentos')).dados;
  confere('relacionamento informa o mapa', relPadrao.length >= 1 && relPadrao.every((r) => typeof r.id_mapa === 'number'), relPadrao);
  const mapaRede = await api(T, 'POST', '/mapas-software', { nome: `Rede ${sufixo}`, descricao: 'Dependências da rede' });
  confere('cria mapa', mapaRede.status === 201 && mapaRede.dados.total_ligacoes === 0, mapaRede);
  confere('nome de mapa repetido (sem diferenciar maiúsculas) é 409', (await api(T, 'POST', '/mapas-software', { nome: `REDE ${sufixo}` })).status === 409);
  confere('nome de mapa curto demais é 400', (await api(T, 'POST', '/mapas-software', { nome: 'x' })).status === 400);
  const ativo3 = await api(T, 'POST', '/ativos', { codigo_patrimonio: `PAT3-${sufixo}`, nome: 'Firewall', tipo_ativo: 'OUTRO' });
  confere('cria ativo 3', ativo3.status === 201, ativo3);
  const relRede = await api(T, 'POST', '/ativos/relacionamentos', { id_ativo_origem: ativo3.dados.id, id_ativo_destino: ativo.dados.id, id_mapa: mapaRede.dados.id, tipo_relacionamento: 'DEPENDE_DE' });
  confere('dependência no mapa escolhido', relRede.status === 201 && relRede.dados.id_mapa === mapaRede.dados.id, relRede);
  const repetidaOutroMapa = await api(T, 'POST', '/ativos/relacionamentos', { id_ativo_origem: ativo2.dados.id, id_ativo_destino: ativo.dados.id, id_mapa: mapaRede.dados.id, tipo_relacionamento: 'DEPENDE_DE' });
  confere('dependência já existente em outro mapa é 409 e diz qual', repetidaOutroMapa.status === 409 && String(repetidaOutroMapa.dados?.message).includes('Principal'), repetidaOutroMapa.dados);
  confere('mapa inexistente é 404', (await api(T, 'POST', '/ativos/relacionamentos', { id_ativo_origem: ativo3.dados.id, id_ativo_destino: ativo2.dados.id, id_mapa: 999999, tipo_relacionamento: 'DEPENDE_DE' })).status === 404);
  const soRede = await api(T, 'GET', `/ativos/relacionamentos?id_mapa=${mapaRede.dados.id}`);
  confere('lista de dependências filtra por mapa', soRede.status === 200 && soRede.dados.length === 1 && soRede.headers.get('x-total-count') === '1' && soRede.dados[0].origem.id === ativo3.dados.id, soRede.dados);
  confere('filtro de mapa inválido é 400', (await api(T, 'GET', '/ativos/relacionamentos?id_mapa=abc')).status === 400);
  const impRede = await api(T, 'GET', `/ativos/${ativo.dados.id}/impacto?id_mapa=${mapaRede.dados.id}`);
  const impPadrao = await api(T, 'GET', `/ativos/${ativo.dados.id}/impacto?id_mapa=${mapaPadrao.id}`);
  const impTodos = await api(T, 'GET', `/ativos/${ativo.dados.id}/impacto`);
  confere('impacto por mapa só considera as dependências do mapa', impRede.dados?.afetados?.length === 1 && impRede.dados.afetados[0].id === ativo3.dados.id && impPadrao.dados?.afetados?.length === 1 && impPadrao.dados.afetados[0].id === ativo2.dados.id && impTodos.dados?.afetados?.length === 2, { impRede: impRede.dados, impPadrao: impPadrao.dados, impTodos: impTodos.dados });
  const renomeado = await api(T, 'PATCH', `/mapas-software/${mapaRede.dados.id}`, { nome: `Rede e firewall ${sufixo}`, descricao: '' });
  confere('renomeia mapa e limpa a descrição', renomeado.status === 200 && renomeado.dados.nome.startsWith('Rede e firewall') && renomeado.dados.descricao === null && renomeado.dados.total_ligacoes === 1, renomeado.dados);
  confere('renomear para um nome já usado é 409', (await api(T, 'PATCH', `/mapas-software/${mapaRede.dados.id}`, { nome: 'principal' })).status === 409);
  confere('solicitante não vê os mapas', (await api(S, 'GET', '/mapas-software')).status === 403);
  confere('apagar mapa com dependências exige confirmação (409)', (await api(T, 'DELETE', `/mapas-software/${mapaRede.dados.id}`)).status === 409);
  const apagado = await api(T, 'DELETE', `/mapas-software/${mapaRede.dados.id}?com_ligacoes=true`);
  confere('apaga o mapa junto com as dependências', apagado.status === 200 && apagado.dados.ligacoes_removidas === 1, apagado.dados);
  confere('depois de apagar, o impacto geral volta a 1', (await api(T, 'GET', `/ativos/${ativo.dados.id}/impacto`)).dados?.afetados?.length === 1);
  confere('apagar mapa que não existe é 404', (await api(T, 'DELETE', `/mapas-software/${mapaRede.dados.id}`)).status === 404);

  // filtros e totais no servidor (ativos): busca, tipo e resumo
  const buscaSwitch = await api(T, 'GET', `/ativos?busca=PAT-${sufixo}`);
  confere('ativos: busca por código filtra no servidor', buscaSwitch.status === 200 && buscaSwitch.dados.length === 1 && buscaSwitch.headers.get('x-total-count') === '1', buscaSwitch.dados);
  const porTipoSrv = await api(T, 'GET', '/ativos?tipo_ativo=SERVIDOR&limite=1');
  confere('ativos: filtro por tipo respeita o total', porTipoSrv.status === 200 && porTipoSrv.dados.length === 1 && Number(porTipoSrv.headers.get('x-total-count')) >= 1 && porTipoSrv.dados.every((a) => a.tipo_ativo === 'SERVIDOR'), porTipoSrv.dados);
  const resumoAtivos = await api(T, 'GET', '/ativos/resumo');
  confere('ativos: resumo agrega por tipo e status', resumoAtivos.status === 200 && resumoAtivos.dados.total >= 2 && resumoAtivos.dados.por_tipo.SWITCH >= 1 && resumoAtivos.dados.por_tipo.SERVIDOR >= 1 && typeof resumoAtivos.dados.por_status === 'object', resumoAtivos.dados);
  const resumoSol = await api(S, 'GET', '/ativos/resumo');
  confere('ativos: resumo do solicitante conta só os dele', resumoSol.status === 200 && resumoSol.dados.total === 1, resumoSol.dados);

  // filtros e totais no servidor (usuários)
  const usrBusca = await api(T, 'GET', `/usuarios?busca=${encodeURIComponent(uSol.email)}`);
  confere('usuários: busca por e-mail filtra no servidor', usrBusca.status === 200 && usrBusca.dados.length === 1 && usrBusca.dados[0].id === uSol.id && usrBusca.headers.get('x-total-count') === '1', usrBusca.dados);
  const usrPerfil = await api(T, 'GET', `/usuarios?perfil=GESTOR&busca=${sufixo}&limite=1`);
  confere('usuários: filtro por perfil + total', usrPerfil.status === 200 && usrPerfil.dados.length === 1 && usrPerfil.dados[0].perfil === 'GESTOR' && Number(usrPerfil.headers.get('x-total-count')) >= 1, usrPerfil.dados);
  confere('usuários: departamento inválido é 400', (await api(T, 'GET', '/usuarios?id_departamento=abc')).status === 400);
  const usrSol = await api(S, 'GET', '/usuarios?limite=1');
  confere('usuários: solicitante recebe o total só dos aprovadores', usrSol.status === 200 && Number(usrSol.headers.get('x-total-count')) >= 1 && usrSol.dados.every((u) => !('email' in u)), usrSol.dados);

  // ---------- base de conhecimento ----------
  const ck = await api(T, 'POST', '/categorias-kb', { nome: `KB ${sufixo}` });
  confere('cria categoria KB', ck.status === 201, ck);
  const art = await api(T, 'POST', '/artigos-kb', { id_categoria: ck.dados.id, titulo: 'Como reiniciar o roteador', conteudo: 'Desligue, espere 10 segundos e ligue.', status: 'PUBLICADO' });
  confere('publica artigo', art.status === 201, art);
  const antes = await api(S, 'GET', `/artigos-kb/${art.dados.id}`);
  await new Promise((r) => setTimeout(r, 1100));
  confere('visualizar artigo', (await api(S, 'POST', `/artigos-kb/${art.dados.id}/visualizar`)).status === 200);
  const depois = await api(S, 'GET', `/artigos-kb/${art.dados.id}`);
  confere('visualizar não altera data_atualizacao', antes.dados.data_atualizacao === depois.dados.data_atualizacao, [antes.dados.data_atualizacao, depois.dados.data_atualizacao]);
  confere('contador de visualizações subiu', depois.dados.visualizacoes === antes.dados.visualizacoes + 1);
  confere('feedback do artigo', (await api(S, 'POST', `/artigos-kb/${art.dados.id}/feedback`, { util: true })).status === 201);
  confere('lista de artigos', (await api(S, 'GET', '/artigos-kb')).dados.length >= 1);
  confere('rota antiga /kb/artigos não existe mais', (await api(T, 'POST', '/kb/artigos', {})).status === 404);
  const img = await api(T, 'POST', `/artigos-kb/${art.dados.id}/imagens`, arquivo('f.png', PNG, 'image/png'));
  confere('envia imagem ao artigo', img.status === 201, img);
  confere('baixa imagem do artigo', (await api(S, 'GET', `/artigos-kb/${art.dados.id}/imagens/${img.dados.id}`)).status === 200);
  const rasc = await api(T, 'POST', '/artigos-kb', { id_categoria: ck.dados.id, titulo: 'Rascunho órfão', conteudo: 'texto do rascunho', status: 'RASCUNHO' });
  confere('exclui rascunho', (await api(T, 'DELETE', `/artigos-kb/${rasc.dados.id}`)).status === 200);
  confere('não exclui artigo publicado', (await api(T, 'DELETE', `/artigos-kb/${art.dados.id}`)).status === 409);
  confere('categorias KB com total', (await api(S, 'GET', '/categorias-kb')).dados.some((c) => c.total_artigos === 1));

  // ---------- aprovações ----------
  const ab2 = await api(S, 'POST', '/chamados', { titulo: 'Preciso de licença', descricao: 'Licença do editor de imagens.', id_categoria: cat.dados.id, tipo: 'REQUISICAO', prioridade: 'MEDIA' });
  const ap = await api(S, 'POST', '/aprovacoes', { descricao: 'Aprovação da licença', id_aprovador: uGes.id, id_chamado: ab2.dados.id });
  confere('solicitante pede aprovação', ap.status === 201, ap);
  confere('não pede aprovação de chamado alheio', (await api(S2, 'POST', '/aprovacoes', { descricao: 'Aprovação alheia', id_aprovador: uGes.id, id_chamado: ab2.dados.id })).status === 404);
  confere('aprovador não pode ser o próprio solicitante', (await api(G, 'POST', '/aprovacoes', { descricao: 'Autoaprovação', id_aprovador: uGes.id, id_chamado: ab2.dados.id })).status === 400);
  confere('lista de aprovações pendentes', (await api(G, 'GET', '/aprovacoes')).dados.length >= 1);
  const decisoes = await Promise.all([
    api(G, 'POST', `/aprovacoes/${ap.dados.id}/decisao`, { status: 'APROVADO' }),
    api(G, 'POST', `/aprovacoes/${ap.dados.id}/decisao`, { status: 'REJEITADO', justificativa_aprovador: 'Sem orçamento' }),
  ]);
  const dec = decisoes.map((d) => d.status).sort();
  confere('decisões simultâneas: só uma vale', dec[0] === 200 && dec[1] === 409, dec);
  confere('aprovação decidida some das pendentes', !(await api(G, 'GET', '/aprovacoes')).dados.some((a) => a.id === ap.dados.id));
  confere('histórico de aprovações (TODOS)', (await api(S, 'GET', '/aprovacoes?status=TODOS')).dados.some((a) => a.id === ap.dados.id && a.status !== 'PENDENTE'));

  // ---------- ITIL ----------
  const prob = await api(G, 'POST', '/problemas', { titulo: 'Quedas de rede recorrentes', descricao: 'Padrão nas manhãs', prioridade: 'ALTA', id_chamado: idCh });
  confere('gestor cria problema', prob.status === 201, prob);
  confere('atualiza problema', (await api(T, 'PATCH', `/problemas/${prob.dados.id}`, { status: 'ERRO_CONHECIDO', id_tecnico_atribuido: uTec.id })).status === 200);
  confere('problema para solicitante é 403', (await api(S, 'GET', `/problemas/${prob.dados.id}`)).status === 403);
  const mud = await api(G, 'POST', '/mudancas', { titulo: 'Troca do switch', descricao: 'Substituir', justificativa: 'Fim de vida', plano_impacto: 'Rede cai 10 min', plano_testes: 'Ping', plano_retorno: 'Voltar o antigo', tipo_mudanca: 'NORMAL', janela_inicio: new Date(Date.now() + 864e5).toISOString(), janela_fim: new Date(Date.now() + 864e5 + 36e5).toISOString() });
  confere('gestor cria mudança', mud.status === 201, mud);
  confere('lista problemas e mudanças', (await api(T, 'GET', '/problemas')).status === 200 && (await api(T, 'GET', '/mudancas')).status === 200);

  // ---------- notificações, branding, tenant, auditoria ----------
  confere('lista de notificações', (await api(S, 'GET', '/notificacoes')).status === 200);
  confere('contagem de não lidas', typeof (await api(S, 'GET', '/notificacoes/nao-lidas/total')).dados?.total === 'number');
  confere('branding com cor inválida é 400', (await api(A, 'PUT', '/branding', { cor_primaria: 'red; background:url(x)' })).status === 400);
  confere('branding com logo javascript: é 400', (await api(A, 'POST', '/admin/branding', { logo_url: 'javascript:alert(1)' })).status === 400);
  confere('branding válido', (await api(A, 'POST', '/admin/branding', { nome_portal: 'Portal de Teste', cor_primaria: '#112233' })).status < 300);
  confere('tenant atual', (await api(S, 'GET', '/tenants/current')).dados?.branding?.nome_portal === 'Portal de Teste');
  const aud = await api(A, 'GET', '/admin/auditoria?limite=200');
  const acoes = new Set(aud.dados.map((l) => l.acao));
  confere('auditoria registra reabertura', acoes.has('REOPEN_CHAMADO'), [...acoes].slice(0, 20));
  confere('auditoria registra atualização de feriado', acoes.has('UPDATE_HOLIDAY') && acoes.has('DELETE_HOLIDAY'));
  confere('auditoria grava o IP', aud.dados.some((l) => l.endereco_ip));
  const ipForjado = await api(A, 'POST', '/admin/feriados', { nome: 'IP', dia: 2, mes: 2, ano: 2000 + Number(sufixo) % 1000 }, { headers: { 'X-Forwarded-For': '6.6.6.6, 203.0.113.9' } });
  const aud2 = await api(A, 'GET', '/admin/auditoria?acao=CREATE_HOLIDAY&limite=1');
  // Como o nginx: 'forjado, cliente real'. Vale o último endereço não confiável, nunca o primeiro (forjável).
  confere('X-Forwarded-For forjado não vira o IP da auditoria', ipForjado.status === 201 && aud2.dados[0]?.endereco_ip === '203.0.113.9', aud2.dados[0]?.endereco_ip);
  confere('auditoria por dia (fuso de Cuiabá)', (await api(A, 'GET', `/admin/auditoria?data_inicio=${dia}&data_fim=${dia}&limite=5`)).dados.length >= 1);

  // ---------- login em mais de um cliente ----------
  if (process.env.DATABASE_URL) {
    const { createRequire } = await import('node:module');
    const require = createRequire(`${process.cwd()}/package.json`);
    const pg = require('pg');
    const bcrypt = require('bcrypt');
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      const hash = await bcrypt.hash(SENHA, 4);
      const c2 = await db.query(`INSERT INTO clientes (razao_social, nome_fantasia, cnpj) VALUES ('Filial', 'Filial ${sufixo}', $1) RETURNING id`, [`99.${sufixo}/0001-00`.slice(0, 18)]);
      await db.query(`INSERT INTO usuarios (id_cliente, nome, email, senha_hash, cargo, perfil) VALUES ($1, 'Solicitante na Filial', $2, $3, 'Teste', 'SOLICITANTE')`, [c2.rows[0].id, uSol.email, hash]);
      const dupla = await login(uSol.email, SENHA);
      confere('e-mail em dois clientes: 409 com a lista', dupla.status === 409 && dupla.dados.clientes?.length === 2, dupla);
      const escolhido = await login(uSol.email, SENHA, c2.rows[0].id);
      confere('escolhendo o cliente, entra', escolhido.status === 200 && escolhido.dados.user.id_cliente === c2.rows[0].id, escolhido);
      const errada = await login(uSol.email, 'senha-errada-12');
      confere('senha errada não revela os clientes', errada.status === 401 && !errada.dados?.clientes, errada);
    } finally {
      await db.end();
    }
  }

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
