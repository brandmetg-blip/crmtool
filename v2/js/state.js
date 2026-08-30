// ============================================================================
// state.js — one shared app state + tiny pub/sub. No framework.
// Text inputs intentionally do NOT trigger re-renders (they write straight to
// state + the store), so typing is always instant and the cursor never jumps.
// ============================================================================

export const state = {
  ready: false,
  user: null,                 // logged-in team member
  db: { team: [], accounts: [], profiles: [], products: [], concepts: [], stages: [], settings: [], tasks: [], scripts: [], entries: [], dailyEntries: [], dailyHooks: [] },
  taskMine: false,            // tasks board: only mine
  route: 'builder',           // builder | accounts | team | login | setup
  date: todayStr(),           // selected day in the builder
  builderMode: 'videos',      // videos (per-avatar cards) | posting | scripts
  postScope: 'day',           // posting queue range: day | week | all
  postShowPosted: false,      // include already-posted rows
  builderAvatar: null,        // account id whose video sheet is open
  builderEditor: 'all',       // filter the avatar cards to one editor's avatars
  builderProduct: 'all',      // ...and/or to one product ('none' = no product set)
  openScript: null,           // script id open in detail view
  acctView: 'live',           // avatars tab: live | building | archive
  acctLayout: 'cards',        // avatars tab: cards | sheet
  acctProfile: 'all',
  acctProduct: 'all',
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

// Extra permissions granted to one person on top of their role. The role is
// the sensible default; a grant is how you say "this one also does X" without
// promoting them to admin.
//
// Managing the team and changing settings are deliberately NOT here. Those two
// hand over the keys — anyone with them could grant themselves everything else
// — so they stay with the admin.
export const PERMISSIONS = [
  ['editAccounts', 'Manage pages', 'Create and edit avatars, products, concepts and profiles.'],
  ['editVideos', 'Write the daily brief', 'Add and mass add videos, assign editors, edit a video’s brief.'],
  ['markPosted', 'Mark videos posted', 'Use the posting queue and tick posted with platforms.'],
  ['editScripts', 'Write main scripts', 'Create and edit main scripts and their frames.'],
  ['editHooks', 'Write the day’s hooks', 'Add and edit the hooks shared across every page.'],
  ['seesAllAccounts', 'See every page', 'See all pages and the analytics, not only the ones assigned to them.'],
  ['tasks', 'See and set tasks', 'Open the Tasks board, take work on it and hand work out.'],
];

const granted = (u, key) => !!(u && u.perms && u.perms[key]);

export const can = {
  editScripts: u => isAdmin(u) || granted(u, 'editScripts'),
  editAccounts: u => isAdmin(u) || granted(u, 'editAccounts'),
  manageTeam: isAdmin,
  manageSettings: isAdmin,
  seesAllAccounts: u => isAdmin(u) || isManager(u) || granted(u, 'seesAllAccounts'),
  // daily builder
  editVideos: u => isAdmin(u) || granted(u, 'editVideos'),   // write the brief, assign editors
  logCompletion: u => isAdmin(u) || isEditor(u),             // main-script completion
  markPosted: u => isAdmin(u) || granted(u, 'markPosted'),   // tick "posted" + platforms
  // The day's shared hooks: a marketing manager's job by default, and
  // grantable to anyone else who writes them.
  seeHooks: u => isAdmin(u) || isManager(u) || granted(u, 'editHooks'),
  editHooks: u => isAdmin(u) || isManager(u) || granted(u, 'editHooks'),
  // The tasks board: work handed between the admin and whoever produces. Both
  // sides need to add as well as finish, so seeing it and setting it are one
  // permission.
  seeTasks: u => isAdmin(u) || isManager(u) || granted(u, 'tasks'),
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
// Tabs follow what a person can actually do, not their role — otherwise
// granting someone a permission would leave the tab it applies to hidden.
export function tabsFor(u) {
  if (!u) return [];
  const tabs = ['builder'];
  if (can.editAccounts(u) || can.seesAllAccounts(u)) tabs.push('accounts');
  tabs.push('assets');
  if (can.seeTasks(u)) tabs.push('tasks');
  if (can.seesAllAccounts(u)) tabs.push('analytics');
  if (can.manageTeam(u)) tabs.push('team');
  if (can.manageSettings(u)) tabs.push('settings');
  return tabs;
}
export function myAccounts(u, db) {
  if (can.seesAllAccounts(u)) return db.accounts;
  const ids = (u && u.assignments) || [];
  return db.accounts.filter(a => ids.includes(a.id));
}
