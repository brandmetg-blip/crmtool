// analytics.js — how much actually went out. Everything here counts one thing:
// a video whose "Posted" box is ticked. Nothing else is inferred.
//
// A post is dated by its postedDate (the day it actually went out); if that was
// never set we fall back to the day it was planned for, so an older entry that
// predates the posted-date field still lands somewhere sensible.

import { state, forceEmit, todayStr, shiftDate, fmtDate, byId, can } from '../state.js';
import { el, avatar } from '../ui.js';

const GROUPS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
const PLATFORMS = [['facebook', 'Facebook', 'var(--blue)'], ['instagram', 'Instagram', 'var(--pink)']];

export function renderAnalytics(root) {
  const u = state.user;
  if (!can.seesAllAccounts(u)) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      'Analytics is for admins and marketing managers.'));
    return;
  }

  if (!state.anFrom) { state.anFrom = shiftDate(todayStr(), -29); state.anTo = todayStr(); }
  const from = state.anFrom, to = state.anTo, group = state.anGroup || 'day';

  const posts = state.db.dailyEntries
    .filter(e => e.posted)
    .map(e => ({ ...e, on: e.postedDate || e.date }))
    .filter(e => e.on >= from && e.on <= to);

  root.appendChild(head());
  root.appendChild(controls(from, to, group));
  root.appendChild(tiles(posts, from, to));

  if (!posts.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:40px' },
      'No posts marked in this range. A video counts here once its ', el('b', null, 'Posted'), ' box is ticked in the Daily Builder.'));
    return;
  }

  root.appendChild(timeChart(posts, from, to, group));
  root.appendChild(byAccount(posts));
}

function head() {
  const wrap = el('div', { class: 'page-head' },
    el('div', null, el('h1', null, 'Analytics'), el('div', { class: 'sub' }, 'Posts that have gone out')),
    el('span', { class: 'spacer' }));
  import('../app.js').then(({ statusPill }) => wrap.appendChild(statusPill()));
  return wrap;
}

// ---- filters: one row above the charts -------------------------------------
function controls(from, to, group) {
  const set = (f, t) => { state.anFrom = f; state.anTo = t; forceEmit(); };
  const T = todayStr();
  const monthStart = T.slice(0, 8) + '01';

  const presets = [
    ['7 days', shiftDate(T, -6), T],
    ['30 days', shiftDate(T, -29), T],
    ['This month', monthStart, T],
    ['90 days', shiftDate(T, -89), T],
  ];

  return el('div', { class: 'row wrap', style: 'gap:10px;margin-bottom:18px' },
    el('div', { class: 'seg' }, presets.map(([label, f, t]) =>
      el('button', { class: from === f && to === t ? 'on' : '', onclick: () => set(f, t) }, label))),

    el('div', { class: 'row', style: 'gap:6px' },
      el('span', { class: 'label' }, 'FROM'),
      el('input', {
        class: 'input', type: 'date', style: 'width:150px', value: from,
        onchange: e => e.target.value && set(e.target.value, to)
      }),
      el('span', { class: 'label' }, 'TO'),
      el('input', {
        class: 'input', type: 'date', style: 'width:150px', value: to,
        onchange: e => e.target.value && set(from, e.target.value)
      })),

    el('span', { class: 'spacer' }),
    el('div', { class: 'seg blue' }, GROUPS.map(([k, label]) =>
      el('button', {
        class: group === k ? 'on' : '',
        onclick: () => { state.anGroup = k; forceEmit(); }
      }, label))));
}

// ---- headline numbers ------------------------------------------------------
function tiles(posts, from, to) {
  const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
  const perDay = posts.length / days;

  const byDay = {};
  posts.forEach(p => byDay[p.on] = (byDay[p.on] || 0) + 1);
  const best = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  const avatarsUsed = new Set(posts.map(p => p.accountId)).size;

  const tile = (value, label, sub) => el('div', { class: 'card col', style: 'gap:3px;min-width:132px;flex:1' },
    el('span', { style: 'font-size:26px;font-weight:800;line-height:1.1' }, value),
    el('span', { class: 'label' }, label),
    sub ? el('span', { class: 'hint' }, sub) : null);

  const row = el('div', { class: 'row wrap', style: 'gap:12px;margin-bottom:18px' },
    tile(String(posts.length), 'POSTS', days + (days === 1 ? ' day' : ' days') + ' in range'),
    tile(perDay.toFixed(1), 'PER DAY', 'average across the range'),
    tile(best ? String(best[1]) : '0', 'BEST DAY', best ? fmtDate(best[0]) : '—'),
    tile(String(avatarsUsed), 'AVATARS POSTING', 'had at least one post'));

  // Platform split stays a pair of counts, not a two-colour chart — the number
  // is the point, and each is named rather than identified by colour alone.
  PLATFORMS.forEach(([id, name, colour]) => {
    const n = posts.filter(p => (p.platforms || []).includes(id)).length;
    row.appendChild(el('div', { class: 'card col', style: 'gap:3px;min-width:116px;flex:1' },
      el('span', { style: 'font-size:26px;font-weight:800;line-height:1.1;color:' + colour }, String(n)),
      el('span', { class: 'label' }, name.toUpperCase()),
      el('span', { class: 'hint' }, 'posts tagged ' + name)));
  });
  return row;
}

// ---- posts over time -------------------------------------------------------
function timeChart(posts, from, to, group) {
  const buckets = buildBuckets(from, to, group);
  const index = {};
  buckets.forEach(b => index[b.key] = b);
  posts.forEach(p => { const b = index[bucketKey(p.on, group)]; if (b) b.n++; });

  const max = Math.max(1, ...buckets.map(b => b.n));
  const peak = buckets.reduce((a, b) => (b.n > a.n ? b : a), buckets[0]);

  // Keep the x-axis readable when the range is long: label every Nth bucket.
  const step = Math.ceil(buckets.length / 14);

  const plot = el('div', { class: 'chart-plot' }, buckets.map(b => {
    const col = el('div', {
      class: 'chart-col',
      title: b.full + ' — ' + b.n + (b.n === 1 ? ' post' : ' posts'),
    }, el('div', { class: 'chart-bar', style: 'height:' + Math.round(b.n / max * 100) + '%' }));
    // one direct label, on the peak — not a number on every bar
    if (b.n && b === peak) col.appendChild(el('div', { class: 'chart-val' }, String(b.n)));
    return col;
  }));

  const axis = el('div', { class: 'chart-x' }, buckets.map((b, i) =>
    el('span', null, (i % step === 0 || b === peak) ? b.label : '')));

  return el('div', { class: 'card col', style: 'gap:0;margin-bottom:18px' },
    el('div', { class: 'row', style: 'margin-bottom:14px' },
      el('span', { class: 'label' }, 'POSTS PER ' + group.toUpperCase()),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint' }, 'peak ' + max + ' · hover a bar for the exact day')),
    plot, axis);
}

function bucketKey(date, group) {
  if (group === 'month') return date.slice(0, 7);
  if (group === 'week') {
    const d = new Date(date + 'T00:00:00');
    return shiftDate(date, -d.getDay());     // week starts Sunday, same as the builder
  }
  return date;
}

function buildBuckets(from, to, group) {
  const out = [];
  const seen = new Set();
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 2000) {
    const key = bucketKey(cur, group);
    if (!seen.has(key)) {
      seen.add(key);
      let label, full;
      if (group === 'month') {
        label = MON[+key.slice(5, 7) - 1];
        full = MON[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4);
      } else if (group === 'week') {
        const end = shiftDate(key, 6);
        label = MON[+key.slice(5, 7) - 1] + ' ' + (+key.slice(8));
        full = 'Week of ' + label + ' – ' + MON[+end.slice(5, 7) - 1] + ' ' + (+end.slice(8));
      } else {
        label = String(+key.slice(8));
        full = fmtDate(key);
      }
      out.push({ key, label, full, n: 0 });
    }
    cur = shiftDate(cur, 1);
  }
  return out;
}

// ---- posts per avatar ------------------------------------------------------
function byAccount(posts) {
  const counts = {};
  posts.forEach(p => counts[p.accountId] = (counts[p.accountId] || 0) + 1);

  const rows = Object.entries(counts)
    .map(([id, n]) => ({ acct: byId(state.db.accounts, id), n }))
    .filter(r => r.acct)
    .sort((a, b) => b.n - a.n);

  if (!rows.length) return el('span');
  const max = rows[0].n;
  const total = rows.reduce((s, r) => s + r.n, 0);

  return el('div', { class: 'card col', style: 'gap:11px' },
    el('div', { class: 'row' },
      el('span', { class: 'label' }, 'POSTS PER AVATAR'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint' }, rows.length + ' of ' + state.db.accounts.length + ' avatars posted')),
    rows.map(r => el('div', { class: 'row', style: 'gap:11px' },
      avatar(r.acct, 28),
      el('div', { style: 'min-width:120px;flex:0 0 auto' },
        el('b', { style: 'font-size:12.5px' }, r.acct.name || 'Untitled')),
      el('div', { class: 'bar', style: 'flex:1;min-width:60px' },
        el('i', { style: 'width:' + Math.round(r.n / max * 100) + '%;background:var(--green)' })),
      el('span', { style: 'font-size:12.5px;font-weight:800;min-width:30px;text-align:right' }, String(r.n)),
      el('span', { class: 'hint', style: 'min-width:38px;text-align:right' }, Math.round(r.n / total * 100) + '%'))));
}
