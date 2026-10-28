import fs from 'node:fs';
import pg from 'pg';

const base = 'http://127.0.0.1:3000/api';
const stamp = Date.now().toString().slice(-6);
const relatorio = [];

function ok(nome, cond, extra) {
  relatorio.push({ nome, ok: Boolean(cond), extra });
}

async function api(token, method, path, body, form) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text.slice(0, 180);
  }
  return { status: res.status, json };
}

const login = await api(null, 'POST', '/auth/login', {
  email: 'admin@itsm.local',
  password: 'Admin@123456',
});
ok('login', login.status === 200 || login.status === 201, login.status);
const token = login.json?.access_token;
const adminId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;

const gestor = await api(token, 'POST', '/usuarios', {
  nome: `Gestor Teste ${stamp}`,
  email: `gestor.teste.${stamp}@itsm.local`,
  password: 'Gestor@123456',
  cargo: 'Gestor',
  perfil: 'GESTOR',
});
ok('criar gestor', gestor.status === 201, gestor.status);
const gestorId = gestor.json?.id;

const chamado = await api(token, 'POST', '/chamados', {
  titulo: `TESTE-MELHORIA-${stamp}`,
  descricao: 'Chamado de baixa sem politica exata',
  id_categoria: 1,
  tipo: 'REQUISICAO',
  prioridade: 'BAIXA',
});
ok('sla fallback baixa', chamado.status === 201 && chamado.json?.data_previsao_resolucao, chamado.status);
const chamadoId = chamado.json?.id;

const atribuido = await api(token, 'PATCH', `/chamados/${chamadoId}`, {
  id_tecnico_atribuido: adminId,
});
ok('atribuir tecnico', atribuido.status === 200 && atribuido.json?.id_tecnico_atribuido === adminId, atribuido.status);

const limpo = await api(token, 'PATCH', `/chamados/${chamadoId}`, { id_tecnico_atribuido: null });
ok('limpar tecnico', limpo.status === 200 && limpo.json?.id_tecnico_atribuido === null, limpo.status);

const mudanca = await api(token, 'POST', '/mudancas', {
  titulo: `TESTE-MELHORIA-${stamp}`,
  descricao: 'Mudanca ja em implementacao',
  justificativa: 'Teste de decisao',
  plano_impacto: 'Nenhum impacto',
  plano_testes: 'Teste manual',
  plano_retorno: 'Reverter',
  tipo_mudanca: 'NORMAL',
  janela_inicio: '2026-11-01T12:00:00.000Z',
  janela_fim: '2026-11-01T14:00:00.000Z',
});
ok('criar mudanca', mudanca.status === 201, mudanca.status);
const mudancaId = mudanca.json?.id;

const avancada = await api(token, 'PATCH', `/mudancas/${mudancaId}`, { status: 'EM_IMPLEMENTACAO' });
ok('avancar mudanca', avancada.status === 200, avancada.status);

const aprovacao = await api(token, 'POST', '/aprovacoes', {
  descricao: `TESTE-MELHORIA-${stamp}`,
  id_aprovador: gestorId,
  id_mudanca: mudancaId,
});
ok('criar aprovacao', aprovacao.status === 201, aprovacao.status);
const aprovacaoId = aprovacao.json?.id;

const negada = await api(token, 'POST', `/aprovacoes/${aprovacaoId}/decisao`, {
  status: 'REJEITADO',
  justificativa_aprovador: 'Admin nao e o aprovador',
});
ok('admin nao decide', negada.status === 403, negada.status);

const loginGestor = await api(null, 'POST', '/auth/login', {
  email: `gestor.teste.${stamp}@itsm.local`,
  password: 'Gestor@123456',
});
const tokenGestor = loginGestor.json?.access_token;
const decisao = await api(tokenGestor, 'POST', `/aprovacoes/${aprovacaoId}/decisao`, {
  status: 'REJEITADO',
  justificativa_aprovador: 'Rejeitada no teste',
});
ok('aprovador decide', decisao.status === 200 || decisao.status === 201, decisao.status);
ok('aprovador preservado', decisao.json?.id_aprovador === gestorId, decisao.json?.id_aprovador);

const detalhe = await api(token, 'GET', `/mudancas/${mudancaId}`);
ok('mudanca nao cancelada', detalhe.json?.status === 'EM_IMPLEMENTACAO', detalhe.json?.status);

const categoria = await api(token, 'POST', '/categorias', {
  nome: `TESTE-MELHORIA-${stamp}`,
  tipo_aplicacao: 'AMBOS',
});
const categoriaId = categoria.json?.id;
const categoriaPatch = await api(token, 'PATCH', `/categorias/${categoriaId}`, {
  nome: `TESTE-MELHORIA-EDIT-${stamp}`,
  status: 'INATIVO',
});
ok('patch categoria', categoriaPatch.status === 200 && categoriaPatch.json?.status === 'INATIVO', categoriaPatch.status);
const ciclo = await api(token, 'PATCH', `/categorias/${categoriaId}`, { id_categoria_pai: categoriaId });
ok('categoria sem auto pai', ciclo.status === 400, ciclo.status);

const departamento = await api(token, 'POST', '/departamentos', {
  codigo_sigla: `T${stamp.slice(-4)}`,
  nome: `TESTE-MELHORIA-${stamp}`,
});
const departamentoId = departamento.json?.id;
const departamentoPatch = await api(token, 'PATCH', `/departamentos/${departamentoId}`, {
  nome: `TESTE-MELHORIA-EDIT-${stamp}`,
  id_responsavel: null,
  status: 'INATIVO',
});
ok('patch departamento', departamentoPatch.status === 200 && departamentoPatch.json?.status === 'INATIVO', departamentoPatch.status);

const grupo = await api(token, 'POST', '/grupos-suporte', {
  nome: `TESTE-MELHORIA-${stamp}`,
  descricao: 'temporario',
});
const grupoId = grupo.json?.id;
const grupoPatch = await api(token, 'PATCH', `/grupos-suporte/${grupoId}`, {
  descricao: null,
  status: 'INATIVO',
});
ok('patch grupo', grupoPatch.status === 200 && grupoPatch.json?.descricao === null, grupoPatch.status);

const ativo = await api(token, 'POST', '/ativos', {
  codigo_patrimonio: `PAT-${stamp}`,
  nome: `TESTE-MELHORIA-${stamp}`,
  tipo_ativo: 'OUTRO',
});
const ativoId = ativo.json?.id;
const ativoPatch = await api(token, 'PATCH', `/ativos/${ativoId}`, {
  id_usuario_atribuido: adminId,
  status: 'EM_ESTOQUE',
});
ok('patch ativo', ativoPatch.status === 200 && ativoPatch.json?.status === 'EM_ESTOQUE', ativoPatch.status);
const ativoLimpo = await api(token, 'PATCH', `/ativos/${ativoId}`, { id_usuario_atribuido: null });
ok('limpar usuario do ativo', ativoLimpo.status === 200 && ativoLimpo.json?.id_usuario_atribuido === null, ativoLimpo.status);

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const form = new FormData();
form.append('arquivo', new Blob([png], { type: 'image/png' }), 'teste.png');
const anexo = await api(token, 'POST', '/artigos-kb/1/anexos', undefined, form);
ok('upload anexo', anexo.status === 201, anexo.status);
const anexoId = anexo.json?.id;
const download = await fetch(`${base}/artigos-kb/1/anexos/${anexoId}`, {
  headers: { Authorization: `Bearer ${token}` },
});
ok('download anexo', download.status === 200 && download.headers.get('content-type')?.includes('image/png'), download.status);
const removido = await api(token, 'DELETE', `/artigos-kb/1/anexos/${anexoId}`);
ok('delete anexo', removido.status === 200, removido.status);

const form2 = new FormData();
form2.append('arquivo', new Blob([png], { type: 'image/png' }), 'teste.png');
const imagem = await api(token, 'POST', '/artigos-kb/1/imagens', undefined, form2);
ok('upload imagem antiga', imagem.status === 201, imagem.status);
const imagemId = imagem.json?.id;
const removida = await api(token, 'DELETE', `/artigos-kb/1/imagens/${imagemId}`);
ok('delete imagem antiga', removida.status === 200, removida.status);

console.log(JSON.stringify({ relatorio, ids: { chamadoId, mudancaId, aprovacaoId, categoriaId, departamentoId, grupoId, ativoId, gestorId } }, null, 2));

const env = fs.readFileSync('.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
const client = new pg.Client({ connectionString: url });
await client.connect();
const limpeza = [];
async function apagar(sql, params) {
  const r = await client.query(sql, params);
  limpeza.push(r.rowCount);
}
if (aprovacaoId) await apagar('DELETE FROM requisicoes_aprovacao WHERE id_cliente = 1 AND id = $1', [aprovacaoId]);
if (chamadoId) await apagar('DELETE FROM chamados WHERE id_cliente = 1 AND id = $1', [chamadoId]);
if (mudancaId) await apagar('DELETE FROM mudancas WHERE id_cliente = 1 AND id = $1', [mudancaId]);
if (ativoId) await apagar('DELETE FROM ativos_cmdb WHERE id_cliente = 1 AND id = $1', [ativoId]);
if (grupoId) await apagar('DELETE FROM grupos_suporte WHERE id_cliente = 1 AND id = $1', [grupoId]);
if (departamentoId) await apagar('DELETE FROM departamentos WHERE id_cliente = 1 AND id = $1', [departamentoId]);
if (categoriaId) await apagar('DELETE FROM categorias_chamados WHERE id_cliente = 1 AND id = $1', [categoriaId]);
await client.query(
  "UPDATE usuarios SET status = 'DESATIVADO' WHERE id_cliente = 1 AND email LIKE 'gestor.teste.%@itsm.local'",
);
await client.end();
if (gestorId) {
  const desativado = await api(token, 'PATCH', `/usuarios/${gestorId}`, { status: 'DESATIVADO' });
  limpeza.push(desativado.status);
}
console.log(JSON.stringify({ limpeza }));
