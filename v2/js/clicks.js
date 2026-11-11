// clicks.js — LinkTwin clicks, tied to the avatars whose links they are.
//
// The linktwin-sync function (supabase/functions) reads LinkTwin every hour into
// two tables: link_info (each link's totals and top countries) and link_daily
// (each link's clicks per day). Every avatar already has its LinkTwin links saved
// on it, per platform and placement, so a click is matched to its avatar by link.
//
// Loaded when needed rather than with everything else, and kept for a few
// minutes, since it changes once an hour.

import { state, forceEmit } from './state.js';
import { PLATFORMS, placementLink } from './pagelinks.js';

const KEEP_MS = 5 * 60 * 1000;
const DAYS = 60;

let data = null;          // { at, info: Map, daily: Map link -> Map day -> clicks, error }
let loading = null;

export const normLink = u => String(u || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');

export function clicksData() { return data; }

// Starts a load if there is nothing recent, and redraws when it lands.
export function ensureClicks(force) {
  if (loading) return loading;
  if (!force && data && Date.now() - data.at < KEEP_MS) return Promise.resolve(data);
  loading = load().then(d => { data = d; loading = null; forceEmit(); return d; });
  return loading;
}

async function load() {
  const { store } = await import('./app.js');
  const sb = store && store.sb;
  if (!sb) return { at: Date.now(), info: new Map(), daily: new Map(), error: 'local' };
  try {
    const from = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
    const info = new Map();
    const daily = new Map();
    const page = async (q, each) => {
      for (let i = 0; ; i += 1000) {
        const r = await q().range(i, i + 999);
        if (r.error) throw r.error;
        (r.data || []).forEach(each);
        if (!r.data || r.data.length < 1000) break;
      }
    };
    await page(() => sb.from('link_info').select('link, shorturl, clicks, unique_clicks, countries, seen_at').order('link'),
      r => info.set(r.link, r));
    await page(() => sb.from('link_daily').select('link, day, start_clicks, end_clicks').gte('day', from).order('day').order('link'),
      r => {
        if (!daily.has(r.link)) daily.set(r.link, new Map());
        daily.get(r.link).set(r.day, Math.max(0, (r.end_clicks || 0) - (r.start_clicks || 0)));
      });
    return { at: Date.now(), info, daily, error: '' };
  } catch (e) {
    const missing = /link_info|link_daily|schema cache|does not exist|PGRST205|42P01/i.test((e && (e.message || e.code)) || '');
    return { at: Date.now(), info: new Map(), daily: new Map(), error: missing ? 'setup' : (e.message || String(e)) };
  }
}

// Asks the function to read LinkTwin now instead of waiting for the hour.
export async function syncNow() {
  const { store } = await import('./app.js');
  const r = await store.sb.functions.invoke('linktwin-sync', { body: {} });
  if (r.error) throw r.error;
  if (r.data && r.data.ok === false) throw new Error(r.data.error || 'The update failed.');
  await ensureClicks(true);
  return r.data;
}

// ---------------------------------------------------------------------------
// reading it
// ---------------------------------------------------------------------------
// Every LinkTwin link saved on an avatar, with where it sits.
export function avatarLinks(a) {
  const out = [];
  PLATFORMS.forEach(p => p.placements.forEach(([id, label]) => {
    const url = placementLink(a, p.id, id, 'linktwin');
    if ((url || '').trim()) out.push({ platform: p.label, placement: id, label: p.label + ' · ' + label, url, key: normLink(url) });
  }));
  return out;
}

// The days from `days` ago up to today, as YYYY-MM-DD, oldest first.
export function lastDays(days) {
  const out = [];
  const d = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
    out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'));
  }
  return out;
}

export function linkClicksOn(key, day) {
  const m = data && data.daily.get(key);
  return (m && m.get(day)) || 0;
}

export function linkClicksIn(key, days) {
  return days.reduce((n, d) => n + linkClicksOn(key, d), 0);
}

// An avatar's clicks over the days, all its links together.
export function avatarClicks(a, days) {
  const links = avatarLinks(a);
  const perDay = days.map(d => links.reduce((n, l) => n + linkClicksOn(l.key, d), 0));
  return { links, perDay, total: perDay.reduce((n, x) => n + x, 0) };
}

// Links in LinkTwin that are on no avatar, so their clicks go unseen otherwise.
export function strayLinks() {
  if (!data) return [];
  const known = new Set();
  (state.db.accounts || []).forEach(a => avatarLinks(a).forEach(l => known.add(l.key)));
  return [...data.info.values()].filter(r => !known.has(r.link));
}

// The first day there is a record for, so a range can say where it really starts.
export function firstDay() {
  let first = '';
  if (data) data.daily.forEach(m => m.forEach((_, d) => { if (!first || d < first) first = d; }));
  return first;
}
