-- Cole e rode no SQL Editor: https://supabase.com/dashboard/project/qodxybrsuivaqrirozxq/sql
create table if not exists instruments (
  id bigint primary key generated always as identity,
  name text not null
);

insert into instruments (name)
values
  ('violin'),
  ('viola'),
  ('cello');

grant select on public.instruments to anon;

alter table instruments enable row level security;

drop policy if exists "public can read instruments" on public.instruments;
create policy "public can read instruments"
on public.instruments
for select to anon
using (true);
