import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qodxybrsuivaqrirozxq.supabase.co',
  'sb_publishable_XZoF_eOYPh4FhdgN9cyvTQ_hACSlO-J',
);

const names = [
  'departamentos',
  'departamento',
  'users',
  'user',
  'usuarios',
  'usuario',
  'tickets',
  'ticket',
  'chamados',
  'chamado',
  'categorias',
  'categoria',
  'grupos',
  'grupo',
  'sla',
  'slas',
  'ativos',
  'ativo',
  'assets',
  'notifications',
  'notificacoes',
  'aprovacoes',
  'approvals',
  'artigos',
  'knowledge',
  'base_conhecimento',
  'profiles',
  'profile',
  'integracoes',
  'audit',
  'auditoria',
  'logs',
  'instruments',
  'roles',
  'permissoes',
  'empresas',
  'company',
  'filiais',
  'prioridades',
  'status',
  'comments',
  'comentarios',
  'followups',
  'anexos',
  'attachments',
];

const found = [];
const hints = new Set();

for (const name of names) {
  const { error, data } = await supabase.from(name).select('*').limit(1);
  if (!error) {
    found.push({ name, sample: data });
    continue;
  }
  const hint = error.hint ?? '';
  const match = hint.match(/'public\.([^']+)'/g);
  if (match) {
    for (const m of match) {
      hints.add(m.slice("'public.".length, -1));
    }
  }
  if (!error.message?.includes('Could not find the table') && !error.message?.includes('schema cache')) {
    found.push({ name, otherError: error.message, hint: error.hint, code: error.code });
  }
}

console.log(JSON.stringify({ found, extraHints: [...hints] }, null, 2));
