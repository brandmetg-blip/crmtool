// ============================================================================
// app.js — boot, auth, nav shell, routing, and the data-write helpers every
// view uses. Data flow is one-way and dead simple:
//   change something -> save(table, item) -> state updated + store queued
//   store confirms in background; status pill shows Saved / Saving / Retrying.
// ============================================================================

import { createStore } from './store.js';
import { presence } from './presence.js';
import { state, onChange, emit, forceEmit, uid, roleLabel, tabsFor, can, todayStr } from './state.js';
import { el, avatar } from './ui.js';
import { renderLogin } from './views/login.js';
import { renderBuilder } from './views/builder.js';
import { renderAccounts } from './views/accounts.js';
import { renderTeam } from './views/team.js';
import { renderAnalytics } from './views/analytics.js';
import { renderAssets } from './views/assets.js';
import { renderSettings } from './views/settings.js';
import { renderTasks, openTaskCount } from './views/tasks.js';
import { renderOnboarding, onboardingCount } from './views/onboarding.js';
import { renderCaptionBoard } from './views/captionboard.js';

export const store = createStore();

// ---- write helpers (single source of truth for mutations) -------------------
export function save(table, item) {
  const list = state.db[table];
  const i = list.findIndex(x => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
  store.upsert(table, item);
}
export function saveQuiet(table, item) { // same, but no re-render (text typing)
  save(table, item);
}
export function removeItem(table, id) {
  state.db[table] = state.db[table].filter(x => x.id !== id);
  store.remove(table, id);
}
export function mutate(table, id, fn) { // load→change→save→re-render
  const item = state.db[table].find(x => x.id === id); if (!item) return;
  fn(item); save(table, item); emit();
}
export function mutateQuiet(table, id, fn) { // for keystrokes: save, no re-render
  const item = state.db[table].find(x => x.id === id); if (!item) return;
  fn(item); save(table, item);
}

// ---- boot -------------------------------------------------------------------
async function boot() {
  // The store decides how much can be read before someone signs in — in cloud
  // mode the answer is "nothing", so it establishes the auth session first.
  const b = await store.bootstrap();
  if (!b) { renderShell('loaderror'); return; }
  state.db = b.db; state.ready = true;
  state.user = b.user;
  state.authEmail = b.authEmail;

  // There is no sign-up. You are either the admin from config.js, or someone
  // the admin added under Team. Anyone else lands on the sign-in screen.
  if (state.user) state.route = 'builder';
  else {
    state.route = 'login';
    if (b.authEmail) state.loginError = 'Signed in, but you are not on the team yet. Ask the admin to add you.';
  }

  // live sync: merge rows one at a time, never over an unsaved local edit
  store.subscribe((table, row) => {
    if (!row || !row.id) return;
    if (store.hasPending(table, row.id)) return;      // our newer edit wins
    const list = state.db[table]; if (!list) return;
    const i = list.findIndex(x => x.id === row.id);
    if (row.__deleted) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list[i] = row; else list.push(row);
    emit();
  });

  // presence: announce ourselves, and re-render when who-holds-what changes
  // (presence.onChange only fires on a real change, not on every heartbeat).
  if (state.user) presence.start(state.user);
  presence.onChange(() => emit());

  store.onStatus(s => {
    const pill = document.getElementById('save-status');
    if (pill) {
      pill.className = s;
      pill.lastChild.textContent = ({ saved: 'Saved', saving: 'Saving…', retrying: 'Retrying…', offline: 'Offline — will retry' })[s] || s;
    }
  });

  forceEmit();
}

// ---- shell + router -----------------------------------------------------------
const NAV = [
  ['builder', 'Daily Builder', 'M3 4.5h18M3 12h18M3 19.5h12'],
  ['accounts', 'Avatars', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
  ['onboarding', 'Onboarding', 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
  ['assets', 'Assets', 'M21 15l-5-5L5 21M3 5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5zM8.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3'],
  ['captions', 'Captions', 'M8 7h12M8 12h12M8 17h8M3.5 7h.01M3.5 12h.01M3.5 17h.01'],
  ['tasks', 'Tasks', 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  ['analytics', 'Analytics', 'M3 3v18h18M7 15l4-4 3 3 5-6'],
  ['team', 'Team', 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'],
  ['settings', 'Settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1'],
];
const icon = d => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

function renderShell(mode) {
  const root = document.getElementById('app');
  // Anything marked data-keepscroll gets put back where it was. The whole shell
  // is rebuilt on every change, and a pane scrolled sideways — the avatar sheet
  // — would otherwise snap to its first column each time, so ticking a box out
  // at the far right meant scrolling all the way back for the next one.
  const scrolls = keepScroll(root);
  root.innerHTML = '';
  root.dataset.booted = '1';   // index.html's early error screen stands down

  if (mode === 'loaderror') {
    root.appendChild(el('div', { class: 'login-wrap' }, el('div', { class: 'card login-card col' },
      el('b', null, 'Could not load your workspace'),
      el('div', { class: 'hint' }, 'The server did not respond. Nothing was changed — check your connection and retry.'),
      el('button', { class: 'btn primary', onclick: () => location.reload() }, 'Retry'))));
    return;
  }
  if (!state.user) { root.appendChild(renderLogin()); return; }

  presence.start(state.user);   // no-op if already running (e.g. after login)

  const tabs = tabsFor(state.user);
  if (!tabs.includes(state.route)) state.route = tabs[0];

  const nav = NAV.filter(([k]) => tabs.includes(k)).map(([k, label, d]) => {
    // open work worth noticing without opening the tab
    const n = k === 'tasks' ? openTaskCount(state.user)
      : k === 'onboarding' ? onboardingCount() : 0;
    return el('button', {
      class: 'nav-item' + (state.route === k ? ' on' : ''),
      onclick: () => { state.route = k; state.openScript = null; forceEmit(); }
    },
      el('span', { html: icon(d) }), label,
      n ? el('span', { class: 'nav-count' }, String(n)) : null);
  });

  const side = el('div', { class: 'sidebar' },
    brandMark(),
    el('div', { class: 'nav' }, nav),
    onlineRow(),
    el('div', { class: 'side-foot' },
      avatar(state.user, 32),
      el('div', { class: 'who' }, el('b', null, state.user.name), el('span', null, roleLabel(state.user.role))),
      el('button', { class: 'iconbtn', title: 'Sign out', onclick: () => { presence.stop(); store.signOut(); signOutState(); forceEmit(); } },
        el('span', { html: icon('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9') }))));

  const main = el('div', { class: 'main' });
  if (state.route === 'builder') renderBuilder(main);
  else if (state.route === 'accounts') renderAccounts(main);
  else if (state.route === 'onboarding') renderOnboarding(main, state.user);
  else if (state.route === 'assets') renderAssets(main);
  else if (state.route === 'captions') renderCaptionBoard(main, state.user);
  else if (state.route === 'tasks') renderTasks(main, state.user);
  else if (state.route === 'analytics') renderAnalytics(main);
  else if (state.route === 'team') renderTeam(main);
  else if (state.route === 'settings') renderSettings(main, state.user);

  root.appendChild(side);
  root.appendChild(main);

  if (state.modal) root.appendChild(state.modal);

  restoreScroll(root, scrolls);
}

// Read the scroll offsets of every marked pane before the shell is torn down,
// and put them back on the panes that come back with the same key.
function keepScroll(root) {
  const out = {};
  root.querySelectorAll('[data-keepscroll]').forEach(n => {
    if (n.scrollLeft || n.scrollTop) out[n.dataset.keepscroll] = [n.scrollLeft, n.scrollTop];
  });
  return out;
}

function restoreScroll(root, scrolls) {
  for (const key in scrolls) {
    const n = root.querySelector('[data-keepscroll="' + key + '"]');
    if (!n) continue;
    n.scrollLeft = scrolls[key][0];
    n.scrollTop = scrolls[key][1];
  }
}

// The company mark: logo tile + name, in one rounded panel. Exported so the
// sign-in screen shows exactly the same thing.
export function brandMark(size) {
  const s = size || 30;
  return el('div', { class: 'brand' },
    el('img', { class: 'brand-logo', src: './logo.png', alt: '', style: `width:${s}px;height:${s}px` }),
    el('div', { class: 'brand-text' },
      el('b', null, 'Remote Commerce'),
      el('small', null, 'CONTENT OPS')));
}

// Signing out must clear where you were, not just who you are — otherwise the
// next person to sign in on this machine lands inside the previous person's
// open avatar or script, which their role may not even permit.
function signOutState() {
  state.user = null;
  state.route = 'login';
  state.builderMode = 'videos';
  state.builderAvatar = null;
  state.builderEditor = 'all';
  state.builderProduct = 'all';
  state.openScript = null;
  state.modal = null;
  state.loginError = null;
  state.authEmail = null;
  state.acctView = 'roster';
  state.acctLayout = 'cards';
  state.taskMine = false;
  state.acctProfile = 'all';
  state.acctProduct = 'all';
  state.onboardAvatar = null;
  state.capSearch = '';
  state.postScope = 'day';
  state.postShowPosted = false;
  state.postMonth = null;
  state.anFrom = null; state.anTo = null; state.anGroup = 'day';
  state.date = todayStr();
}

// Who else is in the workspace right now. Hidden when you're alone (and always
// in local mode, where presence is a no-op).
function onlineRow() {
  const others = presence.peers().filter(p => p.userId !== state.user.id);
  if (!others.length) return null;
  const firstName = p => (p.name || '').trim().split(/\s+/)[0] || 'Someone';
  return el('div', { class: 'peers-wrap', style: 'margin-top:auto;padding:10px 10px 4px' },
    el('div', { class: 'label', style: 'margin-bottom:6px' }, 'ONLINE NOW'),
    el('div', { class: 'col', style: 'gap:5px' },
      others.slice(0, 6).map(p => el('div', { class: 'peer', title: p.name },
        avatar(p, 22), el('span', null, firstName(p)))),
      others.length > 6 && el('span', { class: 'hint' }, '+' + (others.length - 6) + ' more')));
}

// save-status pill used by every page head
export function statusPill() {
  return el('span', { id: 'save-status', class: 'saved' }, el('span', { class: 'dot' }), el('span', null, 'Saved'));
}

onChange(() => renderShell());
boot();
