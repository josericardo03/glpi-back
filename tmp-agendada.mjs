import fs from 'node:fs';
import pg from 'pg';

const base = 'http://127.0.0.1:3000/api';
async function api(token, method, path, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const login = await api(null, 'POST', '/auth/login', {
  email: 'admin@itsm.local',
  password: 'Admin@123456',
});
const token = login.json.access_token;
const adminId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
const mudanca = await api(token, 'POST', '/mudancas', {
  titulo: 'TESTE-AGENDADA',
  descricao: 'Rascunho aprovado vira agendada',
  justificativa: 'Teste de agenda',
  plano_impacto: 'Nenhum impacto',
  plano_testes: 'Teste manual',
  plano_retorno: 'Reverter',
  tipo_mudanca: 'PADRAO',
  janela_inicio: '2026-11-02T12:00:00.000Z',
  janela_fim: '2026-11-02T13:00:00.000Z',
});
const aprovacao = await api(token, 'POST', '/aprovacoes', {
  descricao: 'TESTE-AGENDADA',
  id_aprovador: adminId,
  id_mudanca: mudanca.json.id,
});
const decisao = await api(token, 'POST', `/aprovacoes/${aprovacao.json.id}/decisao`, { status: 'APROVADO' });
const detalhe = await api(token, 'GET', `/mudancas/${mudanca.json.id}`);
const artigo = await api(token, 'GET', '/artigos-kb/1');

const env = fs.readFileSync('.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DELETE FROM requisicoes_aprovacao WHERE id_cliente = 1 AND id = $1', [aprovacao.json.id]);
await client.query('DELETE FROM mudancas WHERE id_cliente = 1 AND id = $1', [mudanca.json.id]);
const restos = await client.query(
  "SELECT 'chamados' AS t, count(*)::int AS n FROM chamados WHERE titulo LIKE 'TESTE-MELHORIA-%' UNION ALL SELECT 'anexos', count(*)::int FROM anexos_artigos_kb WHERE id_artigo = 1",
);
await client.end();

console.log(JSON.stringify({
  mudancaCriada: mudanca.status,
  decisao: decisao.status,
  statusMudanca: detalhe.json?.status,
  anexosArtigo1: { imagens: artigo.json?.imagens?.length, pdfs: artigo.json?.pdfs?.length },
  restos: restos.rows,
}, null, 2));
