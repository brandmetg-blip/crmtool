// clicks.js (view) — the Clicks half of Analytics: LinkTwin clicks per avatar,
// per day, per link and per country. Read only; the numbers come in by
// themselves every hour.

import { state, forceEmit, byId, can } from '../state.js';
import { el, avatar } from '../ui.js';
import { isLive } from '../lifecycle.js';
import { ruleOf, nicheOf } from '../rules.js';
import { flag } from '../flags.js';
import { delta, sparkline, fmtNum } from './analytics.js';
import {
  ensureClicks, clicksData, syncNow, avatarClicks, lastDays, linkClicksIn, strayLinks, firstDay,
} from '../clicks.js';

const RANGES = [[7, '7 days'], [14, '14 days'], [30, '30 days'], [60, '60 days']];
const SORTS = { today: 'Today', range: 'Range', all: 'All time' };
const PALETTE = ['#34e08a', '#4f8cff', '#e879b9', '#f0b341', '#9a7bff', '#5bd5ef', '#f0584e', '#8b8b93'];
const dayShort = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
const dayLong = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!(m >= 0)) return '';
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + (h === 1 ? ' hour ago' : ' hours ago') : Math.round(h / 24) + ' days ago';
}

export function renderClicks(root, u) {
  ensureClicks();
  const data = clicksData();
  if (!data) return root.appendChild(note('Loading clicks…'));
  if (data.error === 'local') return root.appendChild(note('Clicks come from the live database, so they only show on the live tool.'));
  if (data.error === 'setup') return root.appendChild(note('Clicks are not set up yet: run supabase/linktwin.sql in the Supabase SQL Editor.'));
  if (data.error) return root.appendChild(note('Could not load clicks: ' + data.error));
  if (!data.info.size) {
    root.appendChild(controls(7, null));
    return root.appendChild(note('No clicks yet. The first update runs at seven past the hour, or press Update now.'));
  }

  const range = RANGES.some(r => r[0] === state.clkRange) ? state.clkRange : 7;
  const days = lastDays(range);
  const today = days[days.length - 1];
  const since = firstDay();
  // the same stretch just before, but only when the record reaches back that far
  const prevDays = lastDays(range * 2).slice(0, range);
  const hasPrev = since && since <= prevDays[0];

  const pages = (state.db.accounts || []).filter(a => !a.onboarding);
  const rows = pages.map(a => {
    const c = avatarClicks(a, days);
    return { a, c, all: allTime(c.links), prev: hasPrev ? avatarClicks(a, prevDays).total : null, today: c.perDay[c.perDay.length - 1] };
  }).filter(r => r.c.links.length);

  const perDay = days.map((_, i) => rows.reduce((n, r) => n + r.c.perDay[i], 0));
  const total = perDay.reduce((n, x) => n + x, 0);
  const prevTotal = hasPrev ? rows.reduce((n, r) => n + r.prev, 0) : null;
  const allClicks = rows.reduce((n, r) => n + r.all, 0);
  const active = rows.filter(r => r.c.total).length;
  let updated = '';
  data.info.forEach(r => { if (r.seen_at && r.seen_at > updated) updated = r.seen_at; });

  root.appendChild(controls(range, updated));

  // ---- top: clicks per day, then two side cards
  root.appendChild(el('div', { class: 'an-top' },
    el('div', { class: 'an-card col' },
      el('div', { class: 'an-kicker' }, el('span', { class: 'an-title' }, 'Clicks'),
        el('span', { class: 'spacer' }),
        since && since > days[0] ? el('span', { class: 'hint' }, 'Counting since ' + dayShort(since)) : null),
      el('div', { class: 'an-big' }, fmtNum(total), delta(total, prevTotal)),
      el('div', { class: 'an-sub' }, fmtNum(perDay[perDay.length - 1]) + ' today · '
        + fmtNum(perDay[perDay.length - 2] || 0) + ' yesterday · last ' + range + ' days'),
      barChart(days, perDay, today)),
    el('div', { class: 'an-side' },
      sideCard('Avatars with clicks', fmtNum(active) + ' / ' + fmtNum(rows.length),
        rows.length ? Math.round(active / rows.length * 100) + '% of avatars with a link' : '',
        sparkline(days.map((_, i) => rows.filter(r => r.c.perDay[i]).length), 'var(--an-accent)')),
      sideCard('All time', fmtNum(allClicks),
        'every click on these links, including before the record began',
        null))));

  // ---- where they come from
  root.appendChild(el('div', { class: 'an-section' }, 'Where they come from'));
  root.appendChild(el('div', { class: 'an-grid2' },
    countriesCard(rows),
    el('div', { class: 'col', style: 'gap:14px;min-width:0' },
      splitCard('Platform', rows, days, l => l.platform),
      splitCard('Placement', rows, days, l => l.label.split(' · ').slice(1).join(' · ') || l.label))));

  // ---- per avatar
  root.appendChild(el('div', { class: 'an-section' }, 'Avatars'));
  root.appendChild(avatarCard(rows, days, range, can.seeRules(u)));

  // ---- what is not being counted
  const stray = strayLinks();
  const noLinks = pages.filter(a => isLive(a) && !avatarClicks(a, []).links.length);
  if (noLinks.length || stray.length) {
    root.appendChild(el('div', { class: 'an-card col clk-missing' },
      el('div', { class: 'an-kicker' }, el('span', { class: 'an-title' }, 'Not counted')),
      noLinks.length ? el('div', { class: 'col', style: 'gap:6px' },
        el('span', { class: 'hint' }, 'Live avatars with no LinkTwin link saved'),
        el('div', { class: 'row wrap', style: 'gap:6px' }, noLinks.map(a => el('span', { class: 'clk-pill' }, avatar(a, 18), a.name || 'Untitled')))) : null,
      stray.length ? el('div', { class: 'col', style: 'gap:6px' },
        el('span', { class: 'hint' }, stray.length + ' LinkTwin link' + (stray.length === 1 ? ' is' : 's are') + ' not on any avatar'),
        el('div', { class: 'row wrap', style: 'gap:6px' },
          stray.slice().sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).slice(0, 12)
            .map(s => el('span', { class: 'clk-pill mono' }, (s.shorturl || s.link).replace(/^https?:\/\//, ''), el('b', null, fmtNum(s.clicks || 0)))),
          stray.length > 12 ? el('span', { class: 'hint' }, '+ ' + (stray.length - 12) + ' more') : null)) : null));
  }
}

function note(text) {
  return el('div', { class: 'an-card an-empty', style: 'padding:44px' }, text);
}

function controls(range, updated) {
  const b = el('button', { class: 'btn small' }, 'Update now');
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Updating…';
    try { await syncNow(); } catch (e) { alert('The update failed.\n' + (e.message || e)); b.disabled = false; b.textContent = 'Update now'; }
  };
  return el('div', { class: 'an-controls' },
    el('div', { class: 'seg' }, RANGES.map(([n, label]) => el('button', {
      class: range === n ? 'on' : '', onclick: () => { state.clkRange = n; forceEmit(); },
    }, label))),
    el('span', { class: 'spacer' }),
    updated ? el('span', { class: 'hint' }, 'Updated ' + ago(updated)) : null,
    b);
}

function sideCard(title, value, sub, spark) {
  return el('div', { class: 'an-card col' },
    el('div', { class: 'an-kicker' }, el('span', { class: 'an-title' }, title)),
    el('div', { class: 'an-mid' }, value),
    sub ? el('div', { class: 'an-sub' }, sub) : null,
    spark ? el('div', { class: 'an-spark', html: spark }) : null);
}

// Clicks per day as bars, today in full colour.
function barChart(days, perDay, today) {
  const max = Math.max(1, ...perDay);
  const every = days.length > 30 ? 7 : days.length > 14 ? 3 : 1;
  return el('div', { class: 'clk-bars' + (days.length > 30 ? ' dense' : '') },
    days.map((d, i) => el('div', { class: 'clk-bar' + (d === today ? ' today' : ''), title: dayLong(d) + ': ' + fmtNum(perDay[i]) + ' clicks' },
      el('span', { class: 'v' }, perDay[i] ? fmtNum(perDay[i]) : ''),
      el('i', { style: 'height:' + Math.max(perDay[i] ? 4 : 2, Math.round(perDay[i] / max * 100)) + '%' }),
      el('span', { class: 'd' }, (days.length - 1 - i) % every === 0 ? (d === today ? 'Today' : dayShort(d)) : ''))));
}

// Countries add up across links: LinkTwin gives each link's top countries,
// all time, as name → count.
function countriesOf(links) {
  const sum = {};
  links.forEach(l => {
    const c = (clicksData().info.get(l.key) || {}).countries;
    if (c && typeof c === 'object' && !Array.isArray(c)) Object.entries(c).forEach(([k, v]) => { sum[k] = (sum[k] || 0) + (+v || 0); });
  });
  return Object.entries(sum).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}

function countryList(list, limit) {
  const total = list.reduce((n, [, v]) => n + v, 0) || 1;
  const max = list.length ? list[0][1] : 1;
  return el('div', { class: 'clk-countries' }, list.slice(0, limit).map(([name, n]) => el('div', { class: 'clk-country' },
    flag(name),
    el('span', { class: 'name' }, name),
    el('span', { class: 'bar' }, el('i', { style: 'width:' + Math.max(2, Math.round(n / max * 100)) + '%' })),
    el('b', null, fmtNum(n)),
    el('span', { class: 'p' }, Math.round(n / total * 100) + '%'))));
}

function countriesCard(rows) {
  const list = countriesOf(rows.flatMap(r => r.c.links));
  return el('div', { class: 'an-card col' },
    el('div', { class: 'an-kicker' }, el('span', { class: 'an-title' }, 'Countries'),
      el('span', { class: 'spacer' }), el('span', { class: 'hint' }, list.length ? list.length + ' countries · all time' : 'all time')),
    list.length ? countryList(list, 10) : el('div', { class: 'an-empty' }, 'Countries arrive with the next update.'));
}

// One stacked bar and its legend, from the clicks in range on each kind of link.
function splitCard(title, rows, days, keyOf) {
  const sum = new Map();
  rows.forEach(r => r.c.links.forEach(l => {
    const k = keyOf(l);
    sum.set(k, (sum.get(k) || 0) + linkClicksIn(l.key, days));
  }));
  const parts = [...sum.entries()].sort((a, b) => b[1] - a[1]);
  const total = parts.reduce((n, [, v]) => n + v, 0);
  return el('div', { class: 'an-card col' },
    el('div', { class: 'an-kicker' }, el('span', { class: 'an-title' }, title)),
    total ? el('div', { class: 'an-stack' }, parts.filter(([, v]) => v).map(([k, v], i) =>
      el('i', { title: k + ': ' + fmtNum(v), style: 'width:' + (v / total * 100) + '%;background:' + PALETTE[i % PALETTE.length] }))) : el('div', { class: 'an-stack' }),
    parts.map(([k, v], i) => el('div', { class: 'an-split' },
      el('span', { class: 'dot', style: 'background:' + PALETTE[i % PALETTE.length] }),
      el('span', null, k),
      el('span', { class: 'n' }, fmtNum(v)),
      el('span', { class: 'p' }, total ? Math.round(v / total * 100) + '%' : '–'))));
}

function avatarCard(rows, days, range, admin) {
  const card = el('div', { class: 'an-card col', style: 'margin-bottom:26px' });
  const search = el('input', {
    class: 'input', style: 'max-width:240px;height:32px;font-size:12.5px', placeholder: 'Find an avatar…', value: state.clkSearch || '',
    oninput: e => { state.clkSearch = e.target.value; paint(); },
  });
  const sort = SORTS[state.clkSort] ? state.clkSort : 'range';
  card.appendChild(el('div', { class: 'an-kicker' },
    el('span', { class: 'an-title' }, rows.length + ' avatars with links'),
    el('span', { class: 'spacer' }),
    search));
  const wrap = el('div', { class: 'clk-scroll' });
  card.appendChild(wrap);

  const value = r => sort === 'today' ? r.today : sort === 'all' ? r.all : r.c.total;
  const head = (key, label) => el('th', {
    class: 'sortable' + (sort === key ? ' on' : ''), onclick: () => { state.clkSort = key; forceEmit(); },
  }, label + (sort === key ? ' ↓' : ''));

  function paint() {
    const q = (state.clkSearch || '').trim().toLowerCase();
    const shown = rows.filter(r => !q || (r.a.name || '').toLowerCase().includes(q)
      || ((byId(state.db.products, r.a.productId) || {}).name || '').toLowerCase().includes(q))
      .sort((x, y) => value(y) - value(x) || y.all - x.all || (x.a.name || '').localeCompare(y.a.name || ''));
    const max = Math.max(1, ...shown.map(value));
    wrap.innerHTML = '';
    if (!shown.length) { wrap.appendChild(el('div', { class: 'an-empty' }, 'No avatar matches.')); return; }
    wrap.appendChild(el('table', { class: 'an-table clk-table' },
      el('thead', null, el('tr', null,
        el('th', null, 'AVATAR'),
        el('th', null, 'TREND'),
        head('today', 'TODAY'),
        head('range', range + ' DAYS'),
        head('all', 'ALL TIME'),
        el('th', null, ''),
        el('th', { class: 'left' }, 'TOP COUNTRIES'))),
      el('tbody', null, shown.flatMap(r => {
        const open = state.clkOpen === r.a.id;
        const product = byId(state.db.products, r.a.productId);
        const rule = admin ? ruleOf(r.a) : null;
        const top = countriesOf(r.c.links);
        const line = el('tr', { class: 'clk-row' + (open ? ' open' : ''), onclick: () => { state.clkOpen = open ? null : r.a.id; paint(); } },
          el('td', null, el('div', { class: 'who' }, avatar(r.a, 30),
            el('div', { class: 'col', style: 'gap:1px;min-width:0' },
              el('b', null, r.a.name || 'Untitled'),
              el('span', { class: 'clk-meta' }, [product && product.name, admin && nicheOf(r.a), admin && (rule ? rule.name : 'No rule')].filter(Boolean).join(' · '))))),
          el('td', { class: 'clk-trend', html: r.c.total ? sparkline(r.c.perDay, 'var(--an-accent)') : '' }),
          el('td', { class: r.today ? 'clk-today' : 'zero' }, r.today ? '+' + fmtNum(r.today) : '–'),
          el('td', { class: r.c.total ? '' : 'zero' }, el('b', null, fmtNum(r.c.total))),
          el('td', { style: 'color:var(--mut)' }, fmtNum(r.all)),
          el('td', { style: 'width:80px' }, el('span', { class: 'meter' }, el('i', { style: 'width:' + Math.round(value(r) / max * 100) + '%' }))),
          el('td', { class: 'left' }, top.length ? el('div', { class: 'clk-flags' }, top.slice(0, 3).map(([name, n]) =>
            el('span', { class: 'clk-flag', title: name + ': ' + fmtNum(n) }, flag(name), el('span', null, fmtNum(n))))) : el('span', { class: 'zero' }, '–')));
        return open ? [line, detailRow(r, days, range, top)] : [line];
      }))));
  }
  paint();
  return card;
}

function detailRow(r, days, range, top) {
  const info = clicksData().info;
  const best = Math.max(1, ...r.c.links.map(l => linkClicksIn(l.key, days)));
  return el('tr', { class: 'clk-detail' }, el('td', { colspan: '7' },
    el('div', { class: 'clk-detail-grid' },
      el('div', { class: 'col', style: 'gap:8px;min-width:0' },
        el('span', { class: 'an-title' }, 'Links'),
        r.c.links.map(l => {
          const i = info.get(l.key);
          const n = linkClicksIn(l.key, days);
          return el('div', { class: 'clk-link' },
            el('div', { class: 'row', style: 'gap:8px;min-width:0' },
              el('b', null, l.label),
              el('a', { href: l.url, target: '_blank', rel: 'noopener', class: 'hint', onclick: e => e.stopPropagation() }, l.url.replace(/^https?:\/\//, '')),
              el('span', { class: 'spacer' }),
              i ? el('span', { class: 'hint' }, el('b', { style: 'color:var(--text)' }, fmtNum(n)), ' in ' + range + ' days · ' + fmtNum(i.clicks || 0) + ' all time')
                : el('span', { class: 'hint', style: 'color:var(--amber)' }, 'Not found in LinkTwin. Check the link on the avatar.')),
            el('span', { class: 'bar' }, el('i', { style: 'width:' + Math.round(n / best * 100) + '%' })));
        })),
      el('div', { class: 'col', style: 'gap:8px;min-width:0' },
        el('span', { class: 'an-title' }, 'Countries · all time'),
        top.length ? countryList(top, 8) : el('span', { class: 'hint' }, 'None yet.')))));
}

// Every click the avatar's links have had, including from before the daily record began.
function allTime(links) {
  return links.reduce((n, l) => n + ((clicksData().info.get(l.key) || {}).clicks || 0), 0);
}
