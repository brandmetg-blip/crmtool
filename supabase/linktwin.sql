-- LinkTwin clicks. Run once in Supabase → SQL Editor, after deploying the
-- linktwin-sync function. Safe to run again.

-- One row per link: its running totals and where its clicks come from.
create table if not exists link_info (
  link          text primary key,      -- the short link, lowercased, no https:// or trailing /
  linktwin_id   text,
  shorturl      text,
  longurl       text,
  alias         text,
  clicks        integer not null default 0,
  unique_clicks integer not null default 0,
  countries     jsonb,
  referrers     jsonb,
  os            jsonb,
  detail_clicks integer,               -- the total when countries were last read
  detail_at     timestamptz,
  seen_at       timestamptz
);

-- One row per link per day. That day's clicks are end_clicks - start_clicks.
create table if not exists link_daily (
  link         text not null,
  day          date not null,
  start_clicks integer not null default 0,
  end_clicks   integer not null default 0,
  start_unique integer not null default 0,
  end_unique   integer not null default 0,
  updated_at   timestamptz default now(),
  primary key (link, day)
);
create index if not exists link_daily_day on link_daily (day);

-- Signed-in users can read. Only the function writes (it uses the service role).
alter table link_info  enable row level security;
alter table link_daily enable row level security;
drop policy if exists "signed in read" on link_info;
drop policy if exists "signed in read" on link_daily;
create policy "signed in read" on link_info  for select to authenticated using (true);
create policy "signed in read" on link_daily for select to authenticated using (true);

-- Every hour, at seven past.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('linktwin-sync') where exists (select 1 from cron.job where jobname = 'linktwin-sync');
select cron.schedule('linktwin-sync', '7 * * * *', $$
  select net.http_post(
    url     := 'https://tcurzcgjfukrjrdfhgej.supabase.co/functions/v1/linktwin-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjdXJ6Y2dqZnVrcmpyZGZoZ2VqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTY0MTEsImV4cCI6MjEwMjEzMjQxMX0.lCKKQWsaAAiNJ-ouTVng3U8-FaIbybd2P6aPe7XxKmw"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
$$);
