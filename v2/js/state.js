// ============================================================================
// state.js — one shared app state + tiny pub/sub. No framework.
// Text inputs intentionally do NOT trigger re-renders (they write straight to
// state + the store), so typing is always instant and the cursor never jumps.
// ============================================================================

export const state = {
  ready: false,
  user: null,                 // logged-in team member
  db: { team: [], accounts: [], profiles: [], scripts: [], entries: [], dailyEntries: [] },
  route: 'builder',           // builder | accounts | team | login | setup
  date: todayStr(),           // selected day in the builder
  builderMode: 'videos',      // videos (per-avatar cards) | scripts (main scripts)
  builderAvatar: null,        // account id whose video sheet is open
  openScript: null,           // script id open in detail view
  acctStatus: 'all',
  acctProfile: 'all',
  modal: null,                // { type, ... } | null
  loginError: null,
  authEmail: null,            // cloud mode: the signed-in Supabase Auth email
  anFrom: null, anTo: null,   // analytics date range (defaults to last 30 days)
  anGroup: 'day',             // day | week | month
};

const subs = [];
export function onChange(fn) { subs.push(fn); }
export function emit() {
  // Don't yank the DOM out from under someone mid-typing: if a text field is
  // focused, hold the re-render briefly and coalesce.
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && ae.type !== 'checkbox' && ae.type !== 'file') {
    clearTimeout(emit._t); emit._t = setTimeout(emit, 1200); return;
  }
  clearTimeout(emit._t);
  subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
}
export function forceEmit() { clearTimeout(emit._t); subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

export function uid(p) {
  return (p || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export function todayStr() {
  const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function shiftDate(s, days) {
  const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function fmtDate(s) {
  return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
export function byId(list, id) { return (list || []).find(x => x.id === id) || null; }

// ---- roles -----------------------------------------------------------------
// The admin is not in this list on purpose — there is exactly one, set in
// config.js, and it cannot be handed out from inside the app.
export const ROLES = [
  ['manager', 'Marketing Manager'],
  ['editor', 'Video Editor'],
];
export const ALL_ROLES = [['admin', 'Admin']].concat(ROLES);
export function roleLabel(r) { const f = ALL_ROLES.find(x => x[0] === r); return f ? f[1] : r; }

// A video editor can read everything they are given, copy any of it, and log
// that their video is made (with the link). They cannot change a single field
// of the brief. Admin and manager write everything.
const writes = u => !!u && (u.role === 'admin' || u.role === 'manager');
export const can = {
  editScripts: writes,
  editAccounts: writes,
  manageTeam: u => !!u && u.role === 'admin',
  logCompletion: u => !!u,
  seesAllAccounts: writes,
  // daily builder
  editVideos: writes,                  // write the brief, assign editors
  makeVideo: u => !!u,                 // tick "made" + paste the finished link
  markPosted: writes,                  // tick "posted" + platforms
};

// Which daily-builder videos a person may see. An assigned video belongs to
// that editor alone; an unassigned one falls back to avatar access, so nothing
// silently disappears when no one has been assigned yet.
export function visibleEntries(u, list, accounts) {
  if (can.seesAllAccounts(u)) return list;
  const mine = new Set((accounts || []).map(a => a.id));
  return (list || []).filter(e => e.assignedEditorId ? e.assignedEditorId === u.id : mine.has(e.accountId));
}

// Avatars an editor should see in the builder: the ones assigned to them, plus
// any they have been given a video on directly.
export function builderAccounts(u, db) {
  if (can.seesAllAccounts(u)) return db.accounts;
  const ids = new Set((u && u.assignments) || []);
  (db.dailyEntries || []).forEach(e => { if (e.assignedEditorId === u.id) ids.add(e.accountId); });
  return db.accounts.filter(a => ids.has(a.id));
}
export function tabsFor(u) {
  if (!u) return [];
  if (u.role === 'admin') return ['builder', 'accounts', 'assets', 'analytics', 'team'];
  if (u.role === 'manager') return ['builder', 'accounts', 'assets', 'analytics'];
  return ['builder', 'assets'];   // video editor
}
export function myAccounts(u, db) {
  if (can.seesAllAccounts(u)) return db.accounts;
  const ids = (u && u.assignments) || [];
  return db.accounts.filter(a => ids.includes(a.id));
}
