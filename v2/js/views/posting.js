// posting.js — the posting queue.
//
// Marking a video posted used to mean opening an avatar's sheet, finding the
// row and ticking it there — so you could not see what was outstanding without
// clicking through every avatar, and it got forgotten.
//
// This is the flat list instead: every video that is MADE but not yet posted,
// across all avatars, with a tick and the platforms right there. It can look
// past the selected day, because the ones you forget are exactly the ones that
// are no longer on today's screen.

import {
  state, emit, forceEmit, todayStr, shiftDate, fmtDate, byId, can, builderAccounts, visibleEntries,
} from '../state.js';
import { el, avatar } from '../ui.js';
import { conceptLabel } from '../concepts.js';
import { productChip } from './accounts.js';

const PLATFORMS = [['facebook', 'FB'], ['instagram', 'IG']];
const SCOPES = [['day', 'This day'], ['week', 'Last 7 days'], ['all', 'Everything outstanding']];

// Videos that are made but not posted — the whole point of this view.
export function outstandingCount(u) {
  const accounts = builderAccounts(u, state.db);
  return visibleEntries(u, state.db.dailyEntries, accounts).filter(e => e.done && !e.posted).length;
}

function inScope(e, scope) {
  const on = e.postedDate || e.date;
  if (scope === 'day') return e.date === state.date;
  if (scope === 'week') return on >= shiftDate(todayStr(), -6) && on <= todayStr();
  return true;
}

export function renderPosting(root, u) {
  const accounts = builderAccounts(u, state.db);
  const scope = state.postScope || 'day';
  const showPosted = !!state.postShowPosted;

  const all = visibleEntries(u, state.db.dailyEntries, accounts).filter(e => e.done);
  const scoped = all.filter(e => inScope(e, scope));
  const rows = scoped
    .filter(e => showPosted || !e.posted)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')
      || (nameOf(a) || '').localeCompare(nameOf(b) || ''));

  root.appendChild(controls(scope, showPosted, scoped));

  if (!rows.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:36px' },
      scoped.length
        ? 'Everything made in this range is posted. '
        : 'No finished videos in this range yet — a video shows up here once its editor marks it made.'));
    return;
  }

  root.appendChild(bulkBar(rows.filter(e => !e.posted)));

  // grouped by day, newest first, so a backlog reads as "these days are behind"
  const days = [];
  rows.forEach(e => {
    const d = days.find(x => x.date === e.date);
    if (d) d.rows.push(e); else days.push({ date: e.date, rows: [e] });
  });

  days.forEach(d => {
    const left = d.rows.filter(e => !e.posted).length;
    root.appendChild(el('div', { class: 'group-head', style: 'margin-top:16px' },
      el('span', { class: 'group-dot', style: 'background:' + (left ? 'var(--amber)' : 'var(--green)') }),
      el('b', { style: 'font-size:13px' }, fmtDate(d.date)),
      el('span', { class: 'spacer' }),
      left
        ? el('button', {
          class: 'btn small', onclick: () => markMany(d.rows.filter(e => !e.posted))
        }, 'Mark this day posted (' + left + ')')
        : el('span', { class: 'chip green' }, 'all posted')));
    d.rows.forEach(e => root.appendChild(row(e)));
  });
}

function nameOf(e) {
  const a = byId(state.db.accounts, e.accountId);
  return a ? a.name : '';
}

function controls(scope, showPosted, scoped) {
  const left = scoped.filter(e => !e.posted).length;
  return el('div', { class: 'row wrap', style: 'gap:10px;margin-bottom:16px' },
    el('div', { class: 'seg' }, SCOPES.map(([k, label]) =>
      el('button', {
        class: scope === k ? 'on' : '',
        onclick: () => { state.postScope = k; forceEmit(); }
      }, label))),
    el('span', { class: 'chip ' + (left ? 'amber' : 'green') },
      left ? left + ' still to post' : 'nothing outstanding'),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'btn small' + (showPosted ? ' ok' : ''),
      onclick: () => { state.postShowPosted = !showPosted; forceEmit(); }
    }, showPosted ? 'Hiding nothing' : 'Show already posted'));
}

function bulkBar(unposted) {
  if (!unposted.length) return el('span');
  return el('div', { class: 'card row wrap', style: 'gap:10px;padding:11px 13px;margin-bottom:6px' },
    el('b', { style: 'font-size:12.5px' }, unposted.length + ' video' + (unposted.length === 1 ? '' : 's') + ' ready to post'),
    el('span', { class: 'spacer' }),
    el('span', { class: 'hint' }, 'Mark all as posted on'),
    el('button', { class: 'btn small', onclick: () => markMany(unposted, ['facebook']) }, 'FB'),
    el('button', { class: 'btn small', onclick: () => markMany(unposted, ['instagram']) }, 'IG'),
    el('button', { class: 'btn primary small', onclick: () => markMany(unposted) }, 'Both'));
}

function row(e) {
  const a = byId(state.db.accounts, e.accountId);
  const posted = !!e.posted;
  const plats = e.platforms || [];
  const link = (e.videoLink || '').trim();

  const r = el('div', { class: 'pick-row post-row' + (posted ? ' on' : '') },
    el('button', {
      class: 'check blue' + (posted ? ' on' : ''),
      title: posted ? 'Posted — click to undo' : 'Mark as posted',
      onclick: () => posted ? unpost(e) : markMany([e])
    }, posted ? '✓' : ''),
    avatar(a, 26),
    el('div', { style: 'min-width:0;flex:1' },
      el('b', { style: 'font-size:12.5px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' },
        (a && a.name) || 'Unknown avatar'),
      el('span', { class: 'hint' }, conceptLabel(e.conceptId, e.variationId, e.concept) || e.type || '—')),
    a ? productChip(a) : null);

  PLATFORMS.forEach(([id, label]) => {
    const on = plats.includes(id);
    r.appendChild(el('button', {
      class: 'chip click ' + (on ? 'blue' : 'gray'),
      title: (on ? 'Posted on ' : 'Not on ') + label,
      onclick: async () => {
        const { save } = await import('../app.js');
        const cur = Array.isArray(e.platforms) ? e.platforms : [];
        e.platforms = cur.includes(id) ? cur.filter(x => x !== id) : cur.concat([id]);
        save('dailyEntries', e); emit();
      }
    }, label));
  });

  r.appendChild(link
    ? el('a', { class: 'btn small', href: link, target: '_blank', rel: 'noopener' }, 'Video ↗')
    : el('span', { class: 'hint' }, 'no link'));
  return r;
}

async function markMany(entries, platforms) {
  const { save } = await import('../app.js');
  entries.forEach(e => {
    e.posted = true;
    e.postedAt = Date.now();
    if (!e.postedDate) e.postedDate = todayStr();
    // keep whatever platforms were already ticked; otherwise use the choice made
    if (!(e.platforms || []).length) e.platforms = (platforms || ['facebook', 'instagram']).slice();
    save('dailyEntries', e);
  });
  emit();
}

async function unpost(e) {
  const { save } = await import('../app.js');
  e.posted = false; e.postedAt = null;
  save('dailyEntries', e); emit();
}
