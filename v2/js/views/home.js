// home.js — the first screen for whoever runs everything: today at a glance.
// What was planned, made and posted today, which pages are behind, what still
// needs doing, and how the links are clicking. Everything here is read from the
// rest of the tool; clicking a row goes where the work is.

import { state, forceEmit, todayStr, shiftDate, byId, can } from '../state.js';
import { el, avatar } from '../ui.js';
import { isLive, isBuilding } from '../lifecycle.js';
import { pageStanding, dayNeeds } from '../stages.js';
import { nicheOf } from '../rules.js';
import { ensureClicks, clicksData, avatarClicks, lastDays, strayLinks } from '../clicks.js';
import { fmtNum, sparkline } from './analytics.js';

const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const dayShort = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
const dayLong = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function go(route, extra) {
  Object.assign(state, { route, openScript: null }, extra || {});
  forceEmit();
}
const openAvatar = a => go('builder', { builderMode: 'videos', date: todayStr(), builderAvatar: a.id });

export function renderHome(root, u) {
  const T = todayStr();
  const clicksOn = can.seeClicks(u);
  if (clicksOn) ensureClicks();
  const clicks = clicksOn && clicksData() && !clicksData().error && clicksData().info.size ? clicksData() : null;

  const pages = (state.db.accounts || []).filter(a => !a.onboarding);
  const live = pages.filter(isLive);
  const liveIds = new Set(live.map(a => a.id));
  const all = (state.db.dailyEntries || []).filter(e => liveIds.has(e.accountId) || byId(pages, e.accountId));
  const today = all.filter(e => e.date === T);
  const made = today.filter(e => e.done).length;
  const posted = today.filter(e => e.posted).length;
  const wins = all.filter(e => e.win);
  const needs = can.seeRules(u) ? live.map(a => ({ a, n: dayNeeds(a, T) })).filter(x => x.n.length) : [];
  const scriptsNeeded = needs.reduce((n, x) => n + x.n.length, 0);
  const week = lastDays(7);
  const clicksToday = clicks ? live.reduce((n, a) => n + avatarClicks(a, [T]).total, 0) : null;

  // ---- greeting + headline numbers
  const kpi = (label, value, unit, onclick) => el('button', { class: 'dash-kpi', onclick },
    el('span', null, label), el('b', null, value, unit ? el('small', null, unit) : null));
  root.appendChild(el('div', { class: 'dash-hello' },
    el('div', null,
      el('div', { class: 'dash-greet' }, greeting()),
      el('h1', null, 'Welcome back, ' + ((u && u.name) || '').split(' ')[0]),
      el('div', { class: 'dash-date' }, dayLong(T))),
    el('div', { class: 'dash-kpis' },
      kpi('Posted today', fmtNum(posted), '/' + today.length, () => go('builder', { builderMode: 'posting', date: T })),
      kpi('Live avatars', fmtNum(live.length), 'live', () => go('accounts')),
      can.seeRules(u) ? kpi('Still to add', fmtNum(scriptsNeeded), scriptsNeeded === 1 ? 'script' : 'scripts', () => go('builder', { builderMode: 'videos', date: T, builderAvatar: null })) : null,
      clicks ? kpi('Clicks today', fmtNum(clicksToday), 'clicks', () => go('analytics', { anTab: 'clicks' })) : null)));

  // ---- row 1: today ring, activity chart, focus
  root.appendChild(el('div', { class: 'dash-row1' },
    todayCard(T, today, made, posted),
    activityCard(all, clicks, live),
    focusCard(live, today)));

  // ---- row 2: every live page today, and what needs attention
  root.appendChild(el('div', { class: 'dash-row2' },
    pagesCard(live, today),
    attentionCard(u, T, live, today, needs, clicks)));

  // ---- row 3: clicks leaders and latest winners
  root.appendChild(el('div', { class: 'dash-row3' },
    clicks ? topClicksCard(live, week) : null,
    winnersCard(wins)));
}

// ---------------------------------------------------------------------------
function card(title, sub, right, ...body) {
  return el('div', { class: 'dash-card' },
    el('div', { class: 'dash-head' },
      el('div', null, el('b', null, title), sub ? el('span', null, sub) : null),
      right || null),
    ...body);
}

function ring(pct, size, stroke) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  const dot = p > 0 ? (() => { const a = -Math.PI / 2 + p * 2 * Math.PI; return '<circle cx="' + (size / 2 + r * Math.cos(a)) + '" cy="' + (size / 2 + r * Math.sin(a)) + '" r="' + (stroke * 0.75) + '" fill="#34e08a"/>'; })() : '';
  return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">'
    + '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="' + stroke + '"/>'
    + '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#34e08a" stroke-width="' + stroke + '" stroke-linecap="round"'
    + ' stroke-dasharray="' + (c * p) + ' ' + c + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' + dot + '</svg>';
}

function todayCard(T, today, made, posted) {
  const pct = today.length ? posted / today.length : 0;
  const line = (colour, label, n) => el('div', { class: 'dash-legend' }, el('i', { style: 'background:' + colour }), el('span', null, label), el('b', null, fmtNum(n)));
  return card('Posting today', null, el('span', { class: 'dash-muted' }, dayShort(T)),
    el('div', { class: 'dash-ring' },
      el('div', { html: ring(pct, 150, 12) }),
      el('div', { class: 'dash-ring-n' }, el('b', null, Math.round(pct * 100) + '%'), el('span', null, 'posted'))),
    el('div', { class: 'col', style: 'gap:9px' },
      line('#34e08a', 'Posted', posted),
      line('#4f8cff', 'Made, waiting to post', made - posted),
      line('#5e5e66', 'Planned, not made', today.length - made),
      line('#f0b341', 'Winners today', today.filter(e => e.win).length)));
}

function activityCard(all, clicks, live) {
  const days = lastDays(14);
  const mode = clicks && state.dashChart === 'clicks' ? 'clicks' : 'videos';
  const seg = clicks ? el('div', { class: 'seg mini dash-seg' }, [['videos', 'Videos'], ['clicks', 'Clicks']].map(([k, label]) =>
    el('button', { class: mode === k ? 'on' : '', onclick: () => { state.dashChart = k; forceEmit(); } }, label))) : null;
  let bars, big, sub;
  if (mode === 'clicks') {
    const per = days.map(d => live.reduce((n, a) => n + avatarClicks(a, [d]).total, 0));
    const max = Math.max(1, ...per);
    bars = days.map((d, i) => ({ d, h: per[i] / max, ghost: 0, tip: fmtNum(per[i]) + ' clicks', v: per[i] }));
    big = fmtNum(per[per.length - 1]) + ' today';
    sub = 'Clicks per day · last 14 days';
  } else {
    const planned = days.map(d => all.filter(e => e.date === d).length);
    const out = days.map(d => all.filter(e => e.posted && (e.postedDate || e.date) === d).length);
    const max = Math.max(1, ...planned, ...out);
    bars = days.map((d, i) => ({ d, h: out[i] / max, ghost: planned[i] / max, tip: out[i] + ' posted of ' + planned[i] + ' planned', v: out[i] }));
    big = fmtNum(out[out.length - 1]) + ' today';
    sub = 'Posted per day, planned behind · last 14 days';
  }
  const T = days[days.length - 1];
  return card('Posting activity', null, seg,
    el('div', { class: 'dash-big' }, big),
    el('div', { class: 'dash-muted', style: 'margin-top:2px' }, sub),
    el('div', { class: 'dash-bars' }, bars.map((b, i) => el('div', { class: 'dash-bar' + (b.d === T ? ' today' : ''), title: dayShort(b.d) + ': ' + b.tip },
      el('div', { class: 'track' },
        b.ghost ? el('i', { class: 'ghost', style: 'height:' + Math.round(b.ghost * 100) + '%' }) : null,
        el('i', { class: 'fill', style: 'height:' + Math.max(b.v ? 3 : 0, Math.round(b.h * 100)) + '%' })),
      el('span', null, b.d === T ? 'Today' : i % 2 === (days.length - 1) % 2 ? dayShort(b.d).replace(/^\w+ /, '') : '')))));
}

// The live pages furthest from done today.
function progressOf(a, today) {
  const es = today.filter(e => e.accountId === a.id);
  return { a, total: es.length, made: es.filter(e => e.done).length, posted: es.filter(e => e.posted).length };
}

function miniRing(n, d) {
  return el('span', { class: 'dash-mini' }, el('span', { html: ring(d ? n / d : 0, 40, 4) }), el('b', null, n + '/' + d));
}

function sub(a) {
  const p = byId(state.db.products, a.productId);
  return [p && p.name, nicheOf(a)].filter(Boolean).join(' · ');
}

function focusCard(live, today) {
  const list = live.map(a => progressOf(a, today)).filter(x => x.total && x.posted < x.total)
    .sort((x, y) => (y.total - y.posted) - (x.total - x.posted) || x.posted / x.total - y.posted / y.total).slice(0, 4);
  return card("Today's focus", 'Furthest from posted', null,
    list.length ? el('div', { class: 'col', style: 'gap:8px' }, list.map(x => el('button', { class: 'dash-item', onclick: () => openAvatar(x.a) },
      avatar(x.a, 36),
      el('div', { class: 'col', style: 'gap:1px;min-width:0' }, el('b', null, x.a.name || 'Untitled'), el('span', null, sub(x.a))),
      el('span', { class: 'spacer' }),
      miniRing(x.posted, x.total))))
      : el('div', { class: 'dash-empty' }, live.some(a => today.some(e => e.accountId === a.id)) ? 'Everything planned today is posted.' : 'Nothing planned today yet.'));
}

function pagesCard(live, today) {
  const rows = live.map(a => progressOf(a, today))
    .sort((x, y) => (x.total ? x.posted / x.total : 2) - (y.total ? y.posted / y.total : 2) || (x.a.name || '').localeCompare(y.a.name || ''));
  const posted = rows.reduce((n, r) => n + r.posted, 0);
  const total = rows.reduce((n, r) => n + r.total, 0);
  return card("Today's posting", live.length + ' live avatars', el('span', { class: 'dash-count' }, posted + '/' + total + ' posted'),
    el('div', { class: 'dash-list' }, rows.map(r => {
      const st = pageStanding(r.a) || {};
      const state_ = !r.total ? ['Nothing planned', 'gray'] : r.posted === r.total ? ['Posted', 'green'] : r.made === r.total ? ['Ready to post', 'blue'] : r.made ? ['In progress', 'amber'] : ['Not started', 'red'];
      return el('button', { class: 'dash-page', onclick: () => openAvatar(r.a) },
        avatar(r.a, 32),
        el('div', { class: 'col', style: 'gap:1px;min-width:0' }, el('b', null, r.a.name || 'Untitled'), el('span', null, sub(r.a))),
        st.label && st.label !== 'No stage set' ? el('span', { class: 'dash-stage', style: st.color ? 'color:' + st.color + ';border-color:' + st.color + '55' : '' }, st.label) : el('span'),
        el('span', { class: 'dash-progress' },
          el('i', { class: 'made', style: 'width:' + (r.total ? r.made / r.total * 100 : 0) + '%' }),
          el('i', { class: 'posted', style: 'width:' + (r.total ? r.posted / r.total * 100 : 0) + '%' })),
        el('b', { class: 'dash-frac' }, r.posted + '/' + r.total),
        el('span', { class: 'dash-chip ' + state_[1] }, state_[0]));
    })));
}

function attentionCard(u, T, live, today, needs, clicks) {
  const items = [];
  const add = (tone, title, detail, onclick, who) => items.push({ tone, title, detail, onclick, who });

  const none = live.filter(a => !today.some(e => e.accountId === a.id));
  if (none.length) add('red', none.length + ' live avatar' + (none.length === 1 ? ' has' : 's have') + ' nothing planned today',
    names(none), () => go('builder', { builderMode: 'videos', date: T, builderAvatar: null }), none);
  if (needs.length) {
    const n = needs.reduce((s, x) => s + x.n.length, 0);
    add('amber', n + ' script' + (n === 1 ? '' : 's') + ' still to add from the rules', 'See the list in Daily Builder → Videos',
      () => go('builder', { builderMode: 'videos', date: T, builderAvatar: null }), needs.map(x => x.a));
  }
  const unassigned = today.filter(e => !e.done && !e.assignedEditorId);
  if (unassigned.length) add('amber', unassigned.length + ' video' + (unassigned.length === 1 ? '' : 's') + ' today with no editor',
    'Assign them in Daily Builder', () => go('builder', { builderMode: 'videos', date: T, builderAvatar: null }));
  const waiting = today.filter(e => e.done && !e.posted);
  if (waiting.length) add('blue', waiting.length + ' made video' + (waiting.length === 1 ? '' : 's') + ' waiting to be posted',
    'Open Posting', () => go('builder', { builderMode: 'posting', date: T }));
  const tomorrow = shiftDate(T, 1);
  const tmr = live.filter(a => !(state.db.dailyEntries || []).some(e => e.accountId === a.id && e.date === tomorrow));
  if (tmr.length && tmr.length === live.length) add('gray', 'Nothing planned for tomorrow yet', 'Plan ahead in Daily Builder',
    () => go('builder', { builderMode: 'videos', date: tomorrow, builderAvatar: null }));
  const onboarding = (state.db.accounts || []).filter(a => a.onboarding);
  if (onboarding.length && can.seeOnboarding(u)) add('violet', onboarding.length + ' page' + (onboarding.length === 1 ? '' : 's') + ' in onboarding',
    names(onboarding), () => go('onboarding'), onboarding);
  const building = (state.db.accounts || []).filter(a => !a.onboarding && isBuilding(a));
  if (building.length) add('violet', building.length + ' page' + (building.length === 1 ? '' : 's') + ' still being set up', names(building), () => go('accounts'), building);
  if (clicks) {
    const noLink = live.filter(a => !avatarClicks(a, []).links.length);
    if (noLink.length) add('gray', noLink.length + ' live avatar' + (noLink.length === 1 ? ' has' : 's have') + ' no LinkTwin link', names(noLink), () => go('analytics', { anTab: 'clicks' }), noLink);
    const stray = strayLinks();
    if (stray.length) add('gray', stray.length + ' LinkTwin link' + (stray.length === 1 ? ' is' : 's are') + ' on no avatar', 'Their clicks are not counted', () => go('analytics', { anTab: 'clicks' }));
  }

  return card('Needs attention', items.length ? items.length + ' thing' + (items.length === 1 ? '' : 's') + ' to look at' : 'All clear', null,
    items.length ? el('div', { class: 'col', style: 'gap:8px' }, items.map(x => el('button', { class: 'dash-alert ' + x.tone, onclick: x.onclick },
      el('i'),
      el('div', { class: 'col', style: 'gap:2px;min-width:0' }, el('b', null, x.title), x.detail ? el('span', null, x.detail) : null),
      el('span', { class: 'spacer' }),
      x.who && x.who.length ? el('span', { class: 'dash-faces' }, x.who.slice(0, 3).map(a => avatar(a, 22))) : null,
      el('span', { class: 'dash-arrow' }, '→'))))
      : el('div', { class: 'dash-empty' }, 'Nothing needs you right now.'));
}

const names = list => {
  const n = list.map(a => a.name || 'Untitled');
  return n.slice(0, 3).join(', ') + (n.length > 3 ? ' and ' + (n.length - 3) + ' more' : '');
};

function topClicksCard(live, week) {
  const rows = live.map(a => ({ a, c: avatarClicks(a, week) })).filter(r => r.c.total).sort((x, y) => y.c.total - x.c.total).slice(0, 5);
  const max = Math.max(1, ...rows.map(r => r.c.total));
  return card('Top clicks', 'Last 7 days', el('button', { class: 'dash-link', onclick: () => go('analytics', { anTab: 'clicks' }) }, 'All clicks →'),
    rows.length ? el('div', { class: 'col', style: 'gap:6px' }, rows.map((r, i) => el('div', { class: 'dash-rank' },
      el('span', { class: 'n' }, String(i + 1)),
      avatar(r.a, 28),
      el('div', { class: 'col', style: 'gap:4px;min-width:0;flex:1' },
        el('div', { class: 'row', style: 'gap:8px' }, el('b', null, r.a.name || 'Untitled'), el('span', { class: 'spacer' }), el('b', { class: 'v' }, fmtNum(r.c.total))),
        el('span', { class: 'dash-meter' }, el('i', { style: 'width:' + Math.round(r.c.total / max * 100) + '%' }))),
      el('span', { class: 'dash-spark', html: sparkline(r.c.perDay, 'var(--an-accent)') }))))
      : el('div', { class: 'dash-empty' }, 'No clicks in the last 7 days.'));
}

function winnersCard(wins) {
  const list = wins.slice().sort((x, y) => (y.wonAt || 0) - (x.wonAt || 0) || (y.date || '').localeCompare(x.date || '')).slice(0, 5);
  return card('Latest winners', fmtNum(wins.length) + ' all time', null,
    list.length ? el('div', { class: 'col', style: 'gap:6px' }, list.map(e => {
      const a = byId(state.db.accounts, e.accountId);
      return el('button', { class: 'dash-win', onclick: () => a && go('builder', { builderMode: 'videos', date: e.date, builderAvatar: a.id }) },
        el('span', { class: 'star' }, '★'),
        a ? avatar(a, 28) : null,
        el('div', { class: 'col', style: 'gap:1px;min-width:0' },
          el('b', null, ((byId(state.db.scripts || [], e.scriptId) || {}).title || (e.concept || '').trim() || (e.type === 'Growth' ? 'Growth video' : 'CTA video')).slice(0, 80)),
          el('span', null, (a ? a.name + ' · ' : '') + dayShort(e.date))),
        el('span', { class: 'spacer' }),
        el('span', { class: 'dash-chip ' + (e.type === 'Growth' ? 'blue' : 'green') }, e.type === 'Growth' ? 'Growth' : 'CTA'));
    }))
      : el('div', { class: 'dash-empty' }, 'Star a video in Daily Builder and it shows here.'));
}
