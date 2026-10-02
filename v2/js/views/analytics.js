// analytics.js — an overview of the video pipeline: what was planned, made,
// posted and won, over any range.
//
// Each count is dated by the day the thing happened:
//   planned  the day the video was planned for (its date)
//   made     the day it was ticked made (doneAt), else its planned day
//   posted   the day it went out (postedDate), else its planned day
//   winner   the day it was starred (wonAt), else its planned day
// so an older entry that predates one of those fields still lands somewhere
// sensible. The pipeline row is the exception: it follows the videos PLANNED
// in the range through each step, so its percentages are real conversions.

import { state, forceEmit, todayStr, shiftDate, fmtDate, byId, can, builderAccounts, assignableMembers } from '../state.js';
import { el, avatar } from '../ui.js';
import { productColor } from './accounts.js';

const GROUPS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ICONS = {
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="3"/><path d="M7 3v18M17 3v18M2 12h20M2 7.5h5M2 16.5h5M17 7.5h5M17 16.5h5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>',
};

// local YYYY-MM-DD for a timestamp
function dayOf(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const madeOn = e => (e.doneAt ? dayOf(e.doneAt) : e.date);
const postedOn = e => e.postedDate || e.date;
const wonOn = e => (e.wonAt ? dayOf(e.wonAt) : e.date);
const inRange = (d, f, t) => d && d >= f && d <= t;
const daysBetween = (f, t) => Math.max(1, Math.round((new Date(t + 'T00:00:00') - new Date(f + 'T00:00:00')) / 86400000) + 1);

export function renderAnalytics(root) {
  const u = state.user;
  if (!can.seeAnalytics(u)) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      'Analytics is for admins, marketing managers and posters.'));
    return;
  }

  // Which pages this person's analytics covers: the whole roster for the admin
  // and manager, only their assigned pages for a poster. Entries on a page
  // outside that set — or one that no longer exists — are dropped here, once,
  // so every number on the page counts the same videos.
  const scope = can.seesAllAccounts(u) ? state.db.accounts : builderAccounts(u, state.db);
  const live = new Set(scope.map(a => a.id));
  const entries = (state.db.dailyEntries || []).filter(e => live.has(e.accountId));

  const T = todayStr();
  const earliest = entries.reduce((m, e) => (e.date && e.date < m ? e.date : m), T);
  if (!state.anFrom) { state.anFrom = shiftDate(T, -29); state.anTo = T; }
  if (state.anAll) { state.anFrom = earliest; state.anTo = T; }
  const from = state.anFrom, to = state.anTo, group = state.anGroup || 'day';

  // the same-length window just before this one, for the deltas
  const span = daysBetween(from, to);
  const prev = state.anAll ? null : { from: shiftDate(from, -span), to: shiftDate(from, -1) };

  const count = (f, t) => ({
    planned: entries.filter(e => inRange(e.date, f, t)),
    made: entries.filter(e => e.done && inRange(madeOn(e), f, t)),
    posted: entries.filter(e => e.posted && inRange(postedOn(e), f, t)),
    won: entries.filter(e => e.win && inRange(wonOn(e), f, t)),
  });
  const cur = count(from, to);
  const before = prev ? count(prev.from, prev.to) : null;

  const wrap = el('div', { class: 'an' });
  wrap.appendChild(head(scope.length));
  wrap.appendChild(controls(from, to, group, earliest));

  if (!entries.length) {
    wrap.appendChild(el('div', { class: 'an-card an-empty', style: 'padding:44px' },
      'No videos yet. Plan some in the Daily Builder and they show up here.'));
    root.appendChild(wrap);
    return;
  }

  // ---- series for the chart and the sparklines
  const buckets = buildBuckets(from, to, group);
  const index = {};
  buckets.forEach(b => { b.posted = 0; b.made = 0; b.won = 0; index[b.key] = b; });
  const tally = (list, dateOf, field) => list.forEach(e => { const b = index[bucketKey(dateOf(e), group)]; if (b) b[field]++; });
  tally(cur.posted, postedOn, 'posted');
  tally(cur.made, madeOn, 'made');
  tally(cur.won, wonOn, 'won');

  wrap.appendChild(el('div', { class: 'an-top' },
    heroCard(cur, before, buckets, group),
    el('div', { class: 'an-side' },
      sideCard('Videos made', ICONS.film, cur.made.length, before && before.made.length,
        cur.planned.length ? Math.round(cur.made.length / Math.max(1, cur.planned.length) * 100) + '% of planned' : 'nothing planned in range',
        buckets.map(b => b.made), 'var(--an-accent)'),
      sideCard('Winners', ICONS.star, cur.won.length, before && before.won.length,
        cur.posted.length ? (cur.won.length / cur.posted.length * 100).toFixed(1) + '% hit rate on posts' : 'no posts in range',
        buckets.map(b => b.won), 'var(--an-win)'))));

  wrap.appendChild(el('div', { class: 'an-section' }, 'Pipeline'));
  wrap.appendChild(el('div', { class: 'an-card', style: 'margin-bottom:26px' }, funnel(cur.planned)));

  wrap.appendChild(el('div', { class: 'an-section' }, 'Breakdown'));
  const posts = cur.posted;
  wrap.appendChild(el('div', { class: 'an-grid3' },
    splitCard('Video type', 'posted', posts, [
      ['Product', '#34e08a', e => (e.type || 'Product') === 'Product'],
      ['Growth', '#4f8cff', e => e.type === 'Growth'],
    ]),
    splitCard('Production', 'posted', posts, [
      ['Assembly', '#9a7bff', e => (e.prod || 'Assembly') === 'Assembly'],
      ['Scratch', '#5bd5ef', e => e.prod === 'Scratch'],
      ['Repost', '#f0b341', e => e.prod === 'Repost'],
    ]),
    splitCard('Platform', 'tagged', posts, [
      ['Facebook', '#4f8cff', e => (e.platforms || []).includes('facebook')],
      ['Instagram', '#e879b9', e => (e.platforms || []).includes('instagram')],
    ], true)));

  wrap.appendChild(el('div', { class: 'an-grid2' },
    avatarTable(cur, scope.length),
    el('div', { class: 'col', style: 'gap:14px;min-width:0' },
      productCard(posts),
      can.seesAllAccounts(u) ? editorCard(cur.made) : null)));

  root.appendChild(wrap);
}

function head(n) {
  const wrap = el('div', { class: 'page-head' },
    el('div', null, el('h1', null, 'Analytics'),
      el('div', { class: 'sub' }, 'Planned, made, posted and won across ' + n + (n === 1 ? ' page' : ' pages'))),
    el('span', { class: 'spacer' }));
  import('../app.js').then(({ statusPill }) => wrap.appendChild(statusPill()));
  return wrap;
}

// ---- range + grouping -------------------------------------------------------
function controls(from, to, group, earliest) {
  const T = todayStr();
  const set = (f, t, all) => { state.anFrom = f; state.anTo = t; state.anAll = !!all; forceEmit(); };

  const presets = [
    ['Today', T, T],
    ['7 days', shiftDate(T, -6), T],
    ['30 days', shiftDate(T, -29), T],
    ['90 days', shiftDate(T, -89), T],
  ];
  const seg = el('div', { class: 'seg' }, presets.map(([label, f, t]) =>
    el('button', { class: !state.anAll && from === f && to === t ? 'on' : '', onclick: () => set(f, t) }, label)));
  seg.appendChild(el('button', { class: state.anAll ? 'on' : '', onclick: () => set(earliest, T, true) }, 'All time'));

  return el('div', { class: 'an-controls' },
    seg,
    el('div', { class: 'an-range' },
      el('input', {
        class: 'input', type: 'date', value: from, max: to,
        onchange: e => e.target.value && set(e.target.value, to)
      }),
      '→',
      el('input', {
        class: 'input', type: 'date', value: to, min: from,
        onchange: e => e.target.value && set(from, e.target.value)
      })),
    el('span', { class: 'spacer' }),
    el('div', { class: 'seg mini' }, GROUPS.map(([k, label]) =>
      el('button', { class: group === k ? 'on' : '', onclick: () => { state.anGroup = k; forceEmit(); } }, label))));
}

// ---- headline: posts over time ---------------------------------------------
function heroCard(cur, before, buckets, group) {
  const card = el('div', { class: 'an-card col' });
  card.appendChild(el('div', { class: 'an-kicker' },
    el('span', { class: 'an-icon', html: ICONS.send }),
    el('span', { class: 'an-title' }, 'Posted'),
    el('div', { class: 'an-legend' },
      el('span', null, el('i', { style: 'background:var(--an-accent)' }), 'Posted'),
      el('span', null, el('i', { style: 'background:var(--an-made)' }), 'Made'))));
  card.appendChild(el('div', { class: 'an-big' }, fmtNum(cur.posted.length), delta(cur.posted.length, before && before.posted.length)));

  const pages = new Set(cur.posted.map(e => e.accountId)).size;
  card.appendChild(el('div', { class: 'an-sub' },
    fmtNum(cur.made.length) + ' made · ' + fmtNum(cur.planned.length) + ' planned · '
    + pages + (pages === 1 ? ' page' : ' pages') + ' posting'));

  card.appendChild(areaChart(buckets, group));
  return card;
}

function sideCard(title, icon, value, prevValue, sub, series, colour) {
  return el('div', { class: 'an-card col' },
    el('div', { class: 'an-kicker' },
      el('span', { class: 'an-title' }, title),
      el('span', { class: 'spacer' }),
      el('span', { class: 'an-icon', html: icon })),
    el('div', { class: 'an-mid' }, fmtNum(value), delta(value, prevValue)),
    el('div', { class: 'an-sub' }, sub),
    el('div', { class: 'an-spark', html: sparkline(series, colour) }));
}

// Change against the previous window of the same length. Nothing is shown
// for "all time", which has no window before it.
function delta(now, then) {
  if (then == null) return null;
  if (!then && !now) return el('span', { class: 'an-delta flat' }, '—');
  if (!then) return el('span', { class: 'an-delta up', title: 'None in the previous period' }, 'new');
  const pct = Math.round((now - then) / then * 100);
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return el('span', { class: 'an-delta ' + cls, title: 'vs ' + fmtNum(then) + ' in the previous period' },
    (pct > 0 ? '↑ ' : pct < 0 ? '↓ ' : '') + Math.abs(pct) + '%');
}

// ---- the area chart ---------------------------------------------------------
// Drawn on a stretched viewBox so it fills whatever width it gets; strokes are
// non-scaling, and the hover dot and labels are HTML so they never distort.
const CH = 220;

function areaChart(buckets, group) {
  const W = 1000;
  const n = buckets.length;
  const max = niceMax(Math.max(1, ...buckets.map(b => Math.max(b.posted, b.made))));
  const x = i => (n === 1 ? W / 2 : i / (n - 1) * W);
  const y = v => CH - 8 - v / max * (CH - 24);

  const ptsPosted = buckets.map((b, i) => [x(i), y(b.posted)]);
  const ptsMade = buckets.map((b, i) => [x(i), y(b.made)]);
  const line = pts => (n === 1 ? 'M0,' + pts[0][1] + ' L' + W + ',' + pts[0][1] : smoothPath(pts));
  const postedLine = line(ptsPosted);
  const area = postedLine + ' L' + (n === 1 ? W : x(n - 1)) + ',' + CH + ' L0,' + CH + ' Z';

  const grid = [0.25, 0.5, 0.75].map(f =>
    '<line x1="0" x2="' + W + '" y1="' + y(max * f) + '" y2="' + y(max * f) + '" stroke="rgba(255,255,255,0.05)" vector-effect="non-scaling-stroke"/>').join('');

  const box = el('div', { class: 'an-chart' });
  box.appendChild(el('div', {
    html: '<svg viewBox="0 0 ' + W + ' ' + CH + '" preserveAspectRatio="none" style="height:' + CH + 'px">'
      + '<defs><linearGradient id="anFill" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="#4f8cff" stop-opacity="0.32"/>'
      + '<stop offset="100%" stop-color="#4f8cff" stop-opacity="0"/></linearGradient></defs>'
      + grid
      + '<path d="' + area + '" fill="url(#anFill)"/>'
      + '<path d="' + line(ptsMade) + '" fill="none" stroke="#8b8b93" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>'
      + '<path d="' + postedLine + '" fill="none" stroke="#4f8cff" stroke-width="2.5" vector-effect="non-scaling-stroke"/>'
      + '<line class="an-cross" x1="0" x2="0" y1="0" y2="' + CH + '" stroke="rgba(255,255,255,0.35)" vector-effect="non-scaling-stroke" style="display:none"/>'
      + '</svg>',
  }));

  // y-axis max, quietly, top left
  box.appendChild(el('div', { style: 'position:absolute;top:-2px;left:0;font-size:10px;color:var(--dim)' }, String(max)));

  const dot = el('div', { style: 'position:absolute;width:9px;height:9px;border-radius:50%;background:#fff;border:2px solid #4f8cff;transform:translate(-50%,-50%);display:none;pointer-events:none' });
  const tip = el('div', { class: 'an-tip' });
  box.appendChild(dot);
  box.appendChild(tip);

  // x-axis: about seven evenly spaced labels, whatever the range
  const axis = el('div', { style: 'position:relative;height:18px;margin-top:8px;font-size:10.5px;color:var(--dim)' });
  const want = Math.min(n, 7);
  const seen = new Set();
  for (let k = 0; k < want; k++) {
    const i = want === 1 ? 0 : Math.round(k / (want - 1) * (n - 1));
    if (seen.has(i)) continue;
    seen.add(i);
    const pct = n === 1 ? 50 : i / (n - 1) * 100;
    const align = pct < 3 ? 'translateX(0)' : pct > 97 ? 'translateX(-100%)' : 'translateX(-50%)';
    axis.appendChild(el('span', { style: 'position:absolute;left:' + pct + '%;transform:' + align + ';white-space:nowrap' }, buckets[i].label));
  }

  // hover: snap to the nearest bucket
  const svgHost = box.firstChild;
  svgHost.style.cursor = 'crosshair';
  svgHost.onmousemove = ev => {
    const r = svgHost.getBoundingClientRect();
    const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((ev.clientX - r.left) / r.width * (n - 1))));
    const b = buckets[i];
    const px = n === 1 ? r.width / 2 : i / (n - 1) * r.width;
    const py = y(b.posted) / CH * r.height;
    const cross = svgHost.querySelector('.an-cross');
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.display = '';
    dot.style.left = px + 'px'; dot.style.top = py + 'px'; dot.style.display = 'block';
    tip.innerHTML = '';
    tip.appendChild(el('b', null, b.full));
    tip.appendChild(el('span', { style: 'color:#7fb0ff' }, 'Posted: ' + b.posted));
    tip.appendChild(el('span', { style: 'color:var(--mut)' }, 'Made: ' + b.made));
    if (b.won) tip.appendChild(el('span', { style: 'color:var(--amber)' }, '★ Winners: ' + b.won));
    tip.style.display = 'block';
    // flip to the left side near the right edge
    const flip = px > r.width - 150;
    tip.style.left = px + 'px';
    tip.style.top = Math.max(30, py) + 'px';
    tip.style.transform = flip ? 'translate(calc(-100% - 10px), -50%)' : 'translate(10px, -50%)';
  };
  svgHost.onmouseleave = () => {
    svgHost.querySelector('.an-cross').style.display = 'none';
    dot.style.display = 'none';
    tip.style.display = 'none';
  };

  return el('div', null, box, axis);
}

// Monotone cubic (Fritsch–Carlson): smooth, but never overshoots a point — so
// a run of zeros stays on the floor instead of dipping below it.
function smoothPath(pts) {
  const n = pts.length;
  if (n < 2) return '';
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = 'M' + pts[0][0] + ',' + pts[0][1];
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ' C' + (pts[i][0] + h) + ',' + (pts[i][1] + t[i] * h) + ' '
      + (pts[i + 1][0] - h) + ',' + (pts[i + 1][1] - t[i + 1] * h) + ' '
      + pts[i + 1][0] + ',' + pts[i + 1][1];
  }
  return d;
}

function sparkline(series, colour) {
  const W = 300, H = 46, n = series.length;
  const max = Math.max(1, ...series);
  const pts = series.map((v, i) => [n === 1 ? W / 2 : i / (n - 1) * W, H - 4 - v / max * (H - 10)]);
  const d = n === 1 ? 'M0,' + pts[0][1] + ' L' + W + ',' + pts[0][1] : smoothPath(pts);
  const id = 'sp' + Math.random().toString(36).slice(2, 8);
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'
    + '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="' + cssColour(colour) + '" stop-opacity="0.25"/>'
    + '<stop offset="100%" stop-color="' + cssColour(colour) + '" stop-opacity="0"/></linearGradient></defs>'
    + '<path d="' + d + ' L' + W + ',' + H + ' L0,' + H + ' Z" fill="url(#' + id + ')"/>'
    + '<path d="' + d + '" fill="none" stroke="' + cssColour(colour) + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/>'
    + '</svg>';
}
// SVG stop-color can't read the card's custom properties in every browser,
// so resolve the two we use to literals.
function cssColour(c) {
  if (c === 'var(--an-accent)') return '#4f8cff';
  if (c === 'var(--an-win)') return '#f0b341';
  return c;
}

function niceMax(v) {
  if (v <= 5) return Math.max(1, Math.ceil(v));
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

// ---- pipeline: the videos planned in range, step by step --------------------
function funnel(planned) {
  const made = planned.filter(e => e.done);
  const posted = planned.filter(e => e.posted);
  const won = planned.filter(e => e.win);
  const steps = [
    ['Planned', ICONS.plan, planned.length, null],
    ['Made', ICONS.film, made.length, 'var(--text)'],
    ['Posted', ICONS.send, posted.length, '#7fb0ff'],
    ['Winners', ICONS.star, won.length, 'var(--amber)'],
  ];
  const row = el('div', { class: 'an-funnel' });
  steps.forEach(([label, icon, v, colour], i) => {
    if (i) {
      const prevV = steps[i - 1][2];
      const pct = prevV ? Math.round(v / prevV * 100) : 0;
      // winners are a hit rate, not a drop-off — a low number there is normal
      const tone = i === 3 ? 'var(--amber)' : pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
      row.appendChild(el('div', { class: 'an-arrow' },
        el('span', { class: 'ar' }, '→'),
        el('span', { style: 'color:' + (prevV ? tone : 'var(--dim)') }, prevV ? pct + '%' : '—')));
    }
    row.appendChild(el('div', { class: 'an-stage' },
      el('div', { class: 'an-title' }, el('span', { html: icon, style: 'display:inline-flex' }), label),
      el('div', { class: 'v', style: colour ? 'color:' + colour : '' }, fmtNum(v))));
  });
  return el('div', null,
    row,
    el('div', { class: 'hint', style: 'margin-top:10px' },
      'Follows the ' + fmtNum(planned.length) + ' videos planned in this range through each step. '
      + 'Percentages are the share that made it from the step before.'));
}

// ---- one split card: a stacked bar and a row per part ----------------------
// `overlap` marks a split where one video can be in several parts (a post can
// go to both platforms), so shares are of all posts rather than of the sum.
function splitCard(title, noun, posts, parts, overlap) {
  const counts = parts.map(([label, colour, test]) => ({ label, colour, n: posts.filter(test).length }));
  const base = overlap ? posts.length : counts.reduce((s, c) => s + c.n, 0);
  const sum = counts.reduce((s, c) => s + c.n, 0);

  const card = el('div', { class: 'an-card col' },
    el('div', { class: 'an-kicker' },
      el('span', { class: 'an-title' }, title),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint' }, fmtNum(posts.length) + ' ' + (posts.length === 1 ? 'post' : 'posts'))));

  if (!posts.length) {
    card.appendChild(el('div', { class: 'an-empty' }, 'No posts in this range.'));
    return card;
  }
  card.appendChild(el('div', { class: 'an-stack' }, counts.filter(c => c.n).map(c =>
    el('i', { style: 'flex:' + c.n + ' 1 0;background:' + c.colour, title: c.label + ': ' + c.n }))));
  counts.forEach(c => card.appendChild(el('div', { class: 'an-split' },
    el('span', { class: 'dot', style: 'background:' + c.colour }),
    el('span', null, c.label),
    el('span', { class: 'n' }, fmtNum(c.n)),
    el('span', { class: 'p' }, base ? Math.round(c.n / base * 100) + '%' : '—'))));
  if (overlap) {
    const none = posts.filter(e => !(e.platforms || []).length).length;
    if (none) card.appendChild(el('div', { class: 'hint', style: 'margin-top:4px' }, none + ' posted with no platform ' + noun + '.'));
  } else if (!sum) {
    card.appendChild(el('div', { class: 'hint' }, 'Nothing ' + noun + '.'));
  }
  return card;
}

// ---- per avatar --------------------------------------------------------------
function avatarTable(cur, totalAvatars) {
  const rows = {};
  const row = id => rows[id] || (rows[id] = { id, posted: 0, made: 0, won: 0 });
  cur.posted.forEach(e => row(e.accountId).posted++);
  cur.made.forEach(e => row(e.accountId).made++);
  cur.won.forEach(e => row(e.accountId).won++);

  const list = Object.values(rows)
    .map(r => Object.assign(r, { acct: byId(state.db.accounts, r.id) }))
    .filter(r => r.acct)
    .sort((a, b) => b.posted - a.posted || b.made - a.made || b.won - a.won);
  const active = list.filter(r => r.posted).length;
  const top = list.slice(0, 12);
  const max = Math.max(1, ...top.map(r => r.posted));

  const card = el('div', { class: 'an-card col' },
    el('div', { class: 'an-kicker' },
      el('span', { class: 'an-title' }, 'Top pages'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint' }, active + ' of ' + totalAvatars + ' posted')));

  if (!top.length) {
    card.appendChild(el('div', { class: 'an-empty' }, 'No activity in this range.'));
    return card;
  }
  card.appendChild(el('table', { class: 'an-table' },
    el('thead', null, el('tr', null,
      el('th', null, 'PAGE'), el('th', null, 'MADE'), el('th', null, 'POSTED'), el('th', null, '★'), el('th', null, ''))),
    el('tbody', null, top.map(r => el('tr', null,
      el('td', null, el('div', { class: 'who' }, avatar(r.acct, 24), el('b', null, r.acct.name || 'Untitled'))),
      el('td', { style: 'color:var(--mut)' }, fmtNum(r.made)),
      el('td', { style: 'font-weight:800' }, fmtNum(r.posted)),
      el('td', { style: 'color:' + (r.won ? 'var(--amber)' : 'var(--dim)') }, r.won ? String(r.won) : '·'),
      el('td', { style: 'width:80px' }, el('span', { class: 'meter' }, el('i', { style: 'width:' + Math.round(r.posted / max * 100) + '%' }))))))));
  if (list.length > top.length) {
    card.appendChild(el('div', { class: 'hint', style: 'margin-top:8px' }, '+ ' + (list.length - top.length) + ' more'));
  }
  return card;
}

// ---- per product -------------------------------------------------------------
function productCard(posts) {
  const by = {};
  posts.forEach(e => {
    const a = byId(state.db.accounts, e.accountId);
    const pid = (a && a.productId && byId(state.db.products, a.productId)) ? a.productId : '__none';
    by[pid] = (by[pid] || 0) + 1;
  });
  const list = Object.entries(by)
    .map(([pid, n]) => {
      const p = pid === '__none' ? null : byId(state.db.products, pid);
      return { name: p ? p.name : 'No product', colour: p ? productColor(p) : 'var(--dim)', n };
    })
    .sort((a, b) => b.n - a.n);

  const card = el('div', { class: 'an-card col' },
    el('div', { class: 'an-kicker' }, el('span', { class: 'an-title' }, 'Posts by product')));
  if (!list.length) {
    card.appendChild(el('div', { class: 'an-empty' }, 'No posts in this range.'));
    return card;
  }
  const total = posts.length;
  card.appendChild(el('div', { class: 'an-stack' }, list.map(r =>
    el('i', { style: 'flex:' + r.n + ' 1 0;background:' + r.colour, title: r.name + ': ' + r.n }))));
  list.forEach(r => card.appendChild(el('div', { class: 'an-split' },
    el('span', { class: 'dot', style: 'background:' + r.colour }),
    el('span', { style: 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r.name),
    el('span', { class: 'n' }, fmtNum(r.n)),
    el('span', { class: 'p' }, Math.round(r.n / total * 100) + '%'))));
  return card;
}

// ---- per editor: who made what -----------------------------------------------
function editorCard(made) {
  const by = {};
  made.forEach(e => { const k = e.assignedEditorId || '__none'; by[k] = (by[k] || 0) + 1; });
  const members = assignableMembers(state.db);
  const list = Object.entries(by)
    .map(([id, n]) => ({ m: id === '__none' ? null : (byId(state.db.team, id) || members.find(t => t.id === id)), n }))
    .sort((a, b) => b.n - a.n);

  const card = el('div', { class: 'an-card col' },
    el('div', { class: 'an-kicker' }, el('span', { class: 'an-title' }, 'Made by editor')));
  if (!list.length) {
    card.appendChild(el('div', { class: 'an-empty' }, 'Nothing made in this range.'));
    return card;
  }
  const max = list[0].n;
  list.forEach(r => card.appendChild(el('div', { class: 'an-split' },
    r.m ? avatar(r.m, 20) : el('span', { class: 'dot', style: 'background:var(--dim)' }),
    el('span', { style: 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (r.m ? '' : 'color:var(--dim)') },
      r.m ? (r.m.name || 'Unnamed') : 'Unassigned'),
    el('span', { class: 'spacer' }),
    el('span', { class: 'meter', style: 'width:70px;height:5px;border-radius:999px;background:rgba(255,255,255,0.06);overflow:hidden;display:inline-block' },
      el('i', { style: 'display:block;height:100%;background:#4f8cff;width:' + Math.round(r.n / max * 100) + '%' })),
    el('span', { style: 'font-weight:800;min-width:32px;text-align:right;font-variant-numeric:tabular-nums' }, fmtNum(r.n)))));
  return card;
}

// ---- buckets -------------------------------------------------------------------
function bucketKey(date, group) {
  if (!date) return '';
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
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 4000) {
    const key = bucketKey(cur, group);
    if (!seen.has(key)) {
      seen.add(key);
      let label, full;
      if (group === 'month') {
        label = MON[+key.slice(5, 7) - 1] + (key.slice(0, 4) !== to.slice(0, 4) ? ' ’' + key.slice(2, 4) : '');
        full = MON[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4);
      } else if (group === 'week') {
        const end = shiftDate(key, 6);
        label = MON[+key.slice(5, 7) - 1] + ' ' + (+key.slice(8));
        full = 'Week of ' + label + ' – ' + MON[+end.slice(5, 7) - 1] + ' ' + (+end.slice(8));
      } else {
        label = MON[+key.slice(5, 7) - 1] + ' ' + (+key.slice(8));
        full = fmtDate(key);
      }
      out.push({ key, label, full });
    }
    cur = shiftDate(cur, 1);
  }
  return out;
}

function fmtNum(n) { return (n || 0).toLocaleString(); }
