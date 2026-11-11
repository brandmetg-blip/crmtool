// clicks.js (view) — the Clicks tab: LinkTwin clicks per avatar, per day, per
// link. Read only; the numbers come in by themselves every hour.

import { state, forceEmit, byId, can } from '../state.js';
import { el, avatar } from '../ui.js';
import { isLive } from '../lifecycle.js';
import { ruleOf, nicheOf } from '../rules.js';
import {
  ensureClicks, clicksData, syncNow, avatarClicks, lastDays, linkClicksIn, strayLinks, firstDay,
} from '../clicks.js';

const RANGES = [[7, '7 days'], [14, '14 days'], [30, '30 days']];
const fmt = n => n.toLocaleString();
const dayLabel = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });

export function renderClicks(root, u) {
  const spacer = el('span', { class: 'spacer' });
  const data = clicksData();
  const head = el('div', { class: 'page-head' },
    el('div', null,
      el('h1', null, 'Clicks'),
      el('div', { class: 'sub' }, 'From LinkTwin, matched to each avatar by its links. Updates every hour.')),
    spacer);
  import('../app.js').then(({ statusPill }) => head.insertBefore(statusPill(), spacer.nextSibling));
  if (data && !data.error) head.appendChild(syncButton());
  root.appendChild(head);

  ensureClicks();
  if (!data) { root.appendChild(note('Loading clicks…')); return; }
  if (data.error === 'local') { root.appendChild(note('Clicks come from the live database, so they only show on the live tool.')); return; }
  if (data.error === 'setup') { root.appendChild(note('Clicks are not set up yet: run supabase/linktwin.sql in the Supabase SQL Editor.')); return; }
  if (data.error) { root.appendChild(note('Could not load clicks: ' + data.error)); return; }
  if (!data.info.size) {
    root.appendChild(note('No clicks yet. The first update runs at seven past the hour.'));
    return;
  }

  const range = RANGES.some(r => r[0] === state.clkRange) ? state.clkRange : 7;
  const days = lastDays(range);
  const week = lastDays(7);
  const today = week[6];
  const since = firstDay();

  const pages = (state.db.accounts || []).filter(a => !a.onboarding);
  const rows = pages.map(a => ({ a, c: avatarClicks(a, days), w: avatarClicks(a, week) }))
    .filter(r => r.c.links.length);
  const total = rows.reduce((n, r) => n + r.c.total, 0);
  const todayN = rows.reduce((n, r) => n + r.w.perDay[6], 0);
  const yestN = rows.reduce((n, r) => n + r.w.perDay[5], 0);
  const stray = strayLinks();
  const noLinks = pages.filter(a => isLive(a) && !avatarClicks(a, []).links.length);

  // ---- top line
  const stat = (n, label, hint) => el('div', { class: 'card clk-stat' },
    el('b', null, n), el('span', { class: 'hint' }, label), hint ? el('span', { class: 'hint clk-small' }, hint) : null);
  root.appendChild(el('div', { class: 'clk-stats' },
    stat(fmt(total), 'clicks, last ' + range + ' days', since && since > days[0] ? 'Counting since ' + dayLabel(since) : ''),
    stat(fmt(todayN), 'today so far'),
    stat(fmt(yestN), 'yesterday'),
    stat(String(rows.filter(r => r.c.total).length) + ' / ' + rows.length, 'avatars with clicks')));

  // ---- controls
  const search = el('input', {
    class: 'input', style: 'max-width:260px', placeholder: 'Find an avatar…', value: state.clkSearch || '',
    oninput: e => { state.clkSearch = e.target.value; paint(); },
  });
  root.appendChild(el('div', { class: 'row wrap', style: 'gap:10px;margin:18px 0 12px' },
    el('div', { class: 'seg mini' }, RANGES.map(([n, label]) => el('button', {
      class: range === n ? 'on' : '', onclick: () => { state.clkRange = n; forceEmit(); },
    }, label))),
    search));

  const wrap = el('div', { class: 'rule-table-wrap' });
  root.appendChild(wrap);

  const admin = can.seeRules(u);
  function paint() {
    const q = (state.clkSearch || '').trim().toLowerCase();
    const shown = rows.filter(r => !q || (r.a.name || '').toLowerCase().includes(q)
      || ((byId(state.db.products, r.a.productId) || {}).name || '').toLowerCase().includes(q))
      .sort((x, y) => y.c.total - x.c.total || allTime(y.c.links) - allTime(x.c.links) || (x.a.name || '').localeCompare(y.a.name || ''));
    wrap.innerHTML = '';
    const table = el('table', { class: 'rule-table clk-table' },
      el('thead', null, el('tr', null,
        el('th', null, 'Avatar'),
        week.map(d => el('th', { class: 'num' }, d === today ? 'Today' : dayLabel(d))),
        el('th', { class: 'num' }, range + ' days'),
        el('th', { class: 'num' }, 'All time'),
        el('th', null, 'Best link'),
        el('th', null, 'Top countries'))));
    const body = el('tbody');
    shown.forEach(r => {
      const open = state.clkOpen === r.a.id;
      const best = r.c.links.map(l => ({ l, n: linkClicksIn(l.key, days) })).sort((x, y) => y.n - x.n)[0];
      const product = byId(state.db.products, r.a.productId);
      const rule = admin ? ruleOf(r.a) : null;
      body.appendChild(el('tr', { class: 'clk-row' + (open ? ' open' : ''), onclick: () => { state.clkOpen = open ? null : r.a.id; paint(); } },
        el('td', null, el('span', { class: 'row', style: 'gap:9px' }, avatar(r.a, 26),
          el('span', { class: 'col', style: 'gap:1px;min-width:0' },
            el('b', null, r.a.name || 'Untitled'),
            el('span', { class: 'hint' }, [product && product.name, admin && nicheOf(r.a), admin && (rule ? rule.name : 'No rule')].filter(Boolean).join(' · '))))),
        r.w.perDay.map((n, i) => el('td', { class: 'num' + (n ? '' : ' zero') + (i === 6 ? ' today' : '') }, n ? fmt(n) : '–')),
        el('td', { class: 'num' }, el('b', null, fmt(r.c.total))),
        el('td', { class: 'num' }, fmt(allTime(r.c.links))),
        el('td', null, best && best.n ? best.l.label : '–'),
        el('td', null, countries(r.c.links))));
      if (open) {
        body.appendChild(el('tr', { class: 'clk-detail' }, el('td', { colspan: String(12) },
          el('div', { class: 'col', style: 'gap:6px' }, r.c.links.map(l => {
            const info = clicksData().info.get(l.key);
            return el('div', { class: 'row wrap', style: 'gap:12px' },
              el('b', { style: 'min-width:220px' }, l.label),
              el('a', { href: l.url, target: '_blank', rel: 'noopener', class: 'hint', onclick: e => e.stopPropagation() }, l.url),
              el('span', { class: 'spacer' }),
              info
                ? el('span', { class: 'hint' }, fmt(linkClicksIn(l.key, days)) + ' in ' + range + ' days · ' + fmt(info.clicks || 0) + ' all time')
                : el('span', { class: 'hint', style: 'color:#f0c97a' }, 'Not found in LinkTwin. Check the link on the avatar.'));
          })))));
      }
    });
    table.appendChild(body);
    wrap.appendChild(shown.length ? table : el('div', { class: 'hint', style: 'padding:18px' }, 'No avatar matches.'));
  }
  paint();

  // ---- what is not being counted
  if (noLinks.length || stray.length) {
    root.appendChild(el('div', { class: 'card col', style: 'gap:8px;margin-top:18px' },
      el('b', { style: 'font-size:13.5px' }, 'Not counted'),
      noLinks.length ? el('span', { class: 'hint' }, 'Live avatars with no LinkTwin link saved: ' + noLinks.map(a => a.name || 'Untitled').join(', ') + '.') : null,
      stray.length ? el('span', { class: 'hint' }, stray.length + ' LinkTwin link' + (stray.length === 1 ? ' is' : 's are') + ' not on any avatar: '
        + stray.slice().sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).slice(0, 8).map(s => (s.shorturl || s.link) + ' (' + fmt(s.clicks || 0) + ')').join(', ')
        + (stray.length > 8 ? ' and ' + (stray.length - 8) + ' more' : '') + '.') : null));
  }
}

function note(text) {
  return el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' }, text);
}

function syncButton() {
  const b = el('button', { class: 'btn small' }, 'Update now');
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Updating…';
    try { await syncNow(); } catch (e) { alert('The update failed.\n' + (e.message || e)); b.disabled = false; b.textContent = 'Update now'; }
  };
  return b;
}

// The top three countries across an avatar's links. LinkTwin gives each link's
// top countries as name → count, which add up across links.
function countries(links) {
  const sum = {};
  links.forEach(l => {
    const c = (clicksData().info.get(l.key) || {}).countries;
    if (c && typeof c === 'object' && !Array.isArray(c)) Object.entries(c).forEach(([k, v]) => { sum[k] = (sum[k] || 0) + (+v || 0); });
  });
  const top = Object.entries(sum).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return top.length ? top.map(([k, v]) => k + ' ' + fmt(v)).join(' · ') : '–';
}

// Every click the avatar's links have had, including from before the daily record began.
function allTime(links) {
  return links.reduce((n, l) => n + ((clicksData().info.get(l.key) || {}).clicks || 0), 0);
}
