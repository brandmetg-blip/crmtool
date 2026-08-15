// ============================================================================
// state.js — one shared app state + tiny pub/sub. No framework.
// Text inputs intentionally do NOT trigger re-renders (they write straight to
// state + the store), so typing is always instant and the cursor never jumps.
// ============================================================================

export const state = {
  ready: false,
  user: null,                 // logged-in team member
  db: { team: [], accounts: [], profiles: [], products: [], scripts: [], entries: [], dailyEntries: [] },
  route: 'builder',           // builder | accounts | team | login | setup
  date: todayStr(),           // selected day in the builder
  builderMode: 'videos',      // videos (per-avatar cards) | scripts (main scripts)
  builderAvatar: null,        // account id whose video sheet is open
  builderEditor: 'all',       // filter the avatar cards to one editor's avatars
  builderProduct: 'all',      // ...and/or to one product ('none' = no product set)
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

// Only the admin changes anything.
//
// A marketing manager sees the whole workspace — every avatar, every video,
// the analytics — and can change none of it. No adding, no editing, no ticking.
// A video editor sees only what is assigned to them, can copy any of it, and
// the single thing they may change is marking their own video made and pasting
// the finished link.
const isAdmin = u => !!u && u.role === 'admin';
const isManager = u => !!u && u.role === 'manager';
const isEditor = u => !!u && u.role === 'editor';

export const can = {
  editScripts: isAdmin,
  editAccounts: isAdmin,
  manageTeam: isAdmin,
  seesAllAccounts: u => isAdmin(u) || isManager(u),   // viewing, not writing
  // daily builder
  editVideos: isAdmin,                                // write the brief, assign editors
  logCompletion: u => isAdmin(u) || isEditor(u),      // main-script completion
  markPosted: isAdmin,                                // tick "posted" + platforms
};

// Who may tick "video made" and paste the finished link on THIS video.
// It is a per-video question, not a per-role one: a manager is view-only
// everywhere except the videos actually assigned to them.
export function canMakeThis(u, entry) {
  if (!u || !entry) return false;
  if (u.role === 'admin') return true;
  if (entry.assignedEditorId) return entry.assignedEditorId === u.id;
  // Unassigned: an editor may still do it (they only ever see their own
  // avatars' videos). A manager may not — they see everything, so falling
  // through here would hand them the whole workspace.
  return u.role === 'editor';
}

// Anyone a video can be handed to: video editors, and marketing managers who
// also take work. Sorted so the list reads the same everywhere.
export function assignableMembers(db) {
  return (db.team || [])
    .filter(t => t.role === 'editor' || t.role === 'manager')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

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
