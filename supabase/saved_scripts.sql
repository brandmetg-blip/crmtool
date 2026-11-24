-- Saved for later: scripts and reference videos the admin keeps for another day.
-- Run once in Supabase → SQL Editor. Safe to run again.
--
-- Unlike the other tables, only the admin's login can read or change these rows,
-- so nobody else on the team sees them, even by looking at the database.
-- The email must match ADMIN_EMAIL in v2/js/config.js.

create table if not exists saved_scripts (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

alter table saved_scripts enable row level security;
drop policy if exists "admin only" on saved_scripts;
create policy "admin only" on saved_scripts for all to authenticated
  using      (lower(auth.jwt() ->> 'email') = 'dusanreljin@gmail.com')
  with check (lower(auth.jwt() ->> 'email') = 'dusanreljin@gmail.com');

-- live updates, like the other tables
do $$ begin
  alter publication supabase_realtime add table saved_scripts;
exception when duplicate_object then null; end $$;
