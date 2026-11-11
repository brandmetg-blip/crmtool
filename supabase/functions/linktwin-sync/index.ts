// linktwin-sync — reads every LinkTwin link's click count and keeps a day by day
// record of it, for the Clicks tab.
//
// LinkTwin only reports a running total per link, never clicks per day. So each
// run notes the total, and a day's clicks are the total at its last run minus
// the total when the day began. History starts with the first run.
//
// Runs every hour from pg_cron (see ../../linktwin.sql). Needs the secret
// LINKTWIN_KEY. CLICKS_TZ (optional, default UTC) decides when a day starts.

import { createClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://linktw.in/api';
const KEY = Deno.env.get('LINKTWIN_KEY') || '';
const TZ = Deno.env.get('CLICKS_TZ') || 'UTC';
const DETAIL_PER_RUN = 80;     // links whose countries are refreshed per run
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// The same link can be saved as https://linktw.in/abc, linktw.in/abc/ or with
// www., so links are compared without any of that. The tool does the same.
const norm = (u: string) => String(u || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
const dayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function linktwin(path: string, tries = 3): Promise<any> {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' } });
  if (r.status === 429 && tries > 0) { await sleep(30000); return linktwin(path, tries - 1); }
  const body = await r.json().catch(() => ({}));
  const failed = !r.ok || (body.error !== undefined && String(body.error) !== '0');
  if (failed) throw new Error('LinkTwin ' + r.status + ': ' + (body.message || JSON.stringify(body).slice(0, 200)));
  return body;
}

async function upsert(table: string, rows: unknown[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(table + ': ' + error.message);
  }
}

Deno.serve(async () => {
  try {
    if (!KEY) return json({ ok: false, error: 'The LINKTWIN_KEY secret is not set.' }, 500);

    // every link, a hundred at a time
    const links: any[] = [];
    for (let page = 1; page <= 200; page++) {
      const d = (await linktwin('/urls?limit=100&order=date_asc&page=' + page)).data || {};
      const urls = d.urls || [];
      links.push(...urls);
      if (!urls.length || +d.currentpage >= +d.maxpage) break;
    }

    const day = dayIn(TZ);
    const { data: infoRows, error: e1 } = await sb.from('link_info').select('link, clicks, unique_clicks, detail_clicks');
    if (e1) throw new Error('link_info: ' + e1.message);
    const { data: todayRows, error: e2 } = await sb.from('link_daily').select('link, start_clicks, start_unique').eq('day', day);
    if (e2) throw new Error('link_daily: ' + e2.message);
    const info = new Map((infoRows || []).map(r => [r.link, r]));
    const today = new Map((todayRows || []).map(r => [r.link, r]));

    const now = new Date().toISOString();
    const seen = new Set<string>();
    const daily: any[] = [];
    const infos: any[] = [];
    for (const u of links) {
      const link = norm(u.shorturl);
      if (!link || seen.has(link)) continue;
      seen.add(link);
      const clicks = +u.clicks || 0;
      const unique = +u.uniqueclicks || 0;
      const before = info.get(link);
      const started = today.get(link);
      daily.push({
        link, day,
        // a day begins where the last reading left off; a link never seen
        // before starts from its current total, so old clicks are not
        // counted as today's
        start_clicks: started ? started.start_clicks : (before ? before.clicks : clicks),
        start_unique: started ? started.start_unique : (before ? before.unique_clicks : unique),
        end_clicks: clicks, end_unique: unique, updated_at: now,
      });
      infos.push({
        link, linktwin_id: String(u.id), shorturl: u.shorturl, longurl: u.longurl || '', alias: u.alias || '',
        clicks, unique_clicks: unique, seen_at: now,
      });
    }
    await upsert('link_daily', daily, 'link,day');
    await upsert('link_info', infos, 'link');

    // Where the clicks come from, for the links that moved since last time.
    const stale = infos
      .filter(x => x.clicks > 0 && (!info.get(x.link) || info.get(x.link).detail_clicks !== x.clicks))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, DETAIL_PER_RUN);
    let details = 0;
    for (const x of stale) {
      try {
        const d = (await linktwin('/url/' + x.linktwin_id)).data || {};
        const { error } = await sb.from('link_info').update({
          countries: d.topCountries || null, referrers: d.topReferrers || null, os: d.topOs || null,
          detail_clicks: x.clicks, detail_at: now,
        }).eq('link', x.link);
        if (!error) details++;
      } catch (_) { /* the counts are saved; the breakdown waits for the next run */ }
      await sleep(550);   // LinkTwin allows 120 requests a minute
    }

    return json({ ok: true, day, links: infos.length, details });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 500);
  }
});
