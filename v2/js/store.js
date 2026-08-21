// ============================================================================
// store.js — ALL persistence lives here. Two interchangeable stores:
//
//   LocalStore — this browser only (localStorage). For dev / trying it out.
//   CloudStore — Supabase. One database row PER ITEM, so two people editing
//                different things can never overwrite each other.
//
// Reliability rules (the reason v2 exists):
//   1. Every change is queued per-row and RETRIED until the server confirms.
//      A failed save is never dropped silently.
//   2. The pending queue is mirrored to localStorage, so closing the tab
//      mid-save loses nothing — it drains on next boot.
//   3. Live updates from other users are merged row-by-row and NEVER replace
//      a row you have an unsaved change on ("dirty" rows are skipped).
//   4. Images are uploaded to file storage; the database only holds a URL.
//
// Interface (identical for both stores):
//   await store.load()                  -> { team, accounts, profiles, scripts, entries } | null on failure
//   store.upsert(table, item)           -> queued write (item must have .id)
//   store.remove(table, id)             -> queued delete
//   store.hasPending(table, id)         -> row has an unconfirmed local write
//   store.onStatus(cb)                  -> cb('saved'|'saving'|'retrying'|'offline')
//   store.subscribe(cb)                 -> cb(table, row|{id,__deleted}) live rows
//   await store.uploadImage(file)       -> url string
//   await store.signIn(email, pw, db)   -> { user } | { error }
//   store.signOut()
// ============================================================================

import { MODE, SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_NAME, LOCAL_ADMIN_PASSWORD } from './config.js';

// The one admin. Built from config, never stored in the database and never
// creatable from inside the app.
const ADMIN_ID = 'admin';
export function adminUser() {
  return { id: ADMIN_ID, name: ADMIN_NAME || 'Admin', email: (ADMIN_EMAIL || '').toLowerCase(), role: 'admin', assignments: [] };
}
export function isAdminEmail(e) {
  return !!ADMIN_EMAIL && (e || '').trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

export const TABLES = {
  team: 'team',
  accounts: 'accounts',
  profiles: 'profiles',
  products: 'products',
  concepts: 'concepts',
  scripts: 'scripts',
  entries: 'script_entries',
  dailyEntries: 'daily_entries',
};
const KEYS = Object.keys(TABLES); // app-side collection names

function emptyDb() { const o = {}; KEYS.forEach(k => o[k] = []); return o; }

// PostgREST reports an unknown table as PGRST205 (not in the schema cache) or
// Postgres 42P01 (undefined_table), depending on where it is caught.
function isMissingTable(err) {
  const code = (err && err.code) || '';
  const msg = ((err && err.message) || '').toLowerCase();
  return code === 'PGRST205' || code === '42P01'
    || (msg.includes('could not find the table') || msg.includes('does not exist'));
}

const DB_KEY = 'slate2_db';
const SESSION_KEY = 'slate2_session';
const QUEUE_KEY = 'slate2_pending';

// ---------------------------------------------------------------------------
// LocalStore
// ---------------------------------------------------------------------------
class LocalStore {
  constructor() { this._status = 'saved'; this._statusCbs = []; }
  _read() {
    try { const r = localStorage.getItem(DB_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  _write(db) { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { console.error('[store] local write failed', e); } }
  async load() {
    const db = this._read() || {};
    const out = {}; KEYS.forEach(k => { out[k] = Array.isArray(db[k]) ? db[k] : []; });
    return out;
  }
  upsert(key, item) {
    const db = this._read() || {}; if (!Array.isArray(db[key])) db[key] = [];
    const i = db[key].findIndex(x => x.id === item.id);
    if (i >= 0) db[key][i] = item; else db[key].push(item);
    this._write(db);
  }
  remove(key, id) {
    const db = this._read() || {}; if (!Array.isArray(db[key])) return;
    db[key] = db[key].filter(x => x.id !== id); this._write(db);
  }
  hasPending() { return false; }
  onStatus(cb) { this._statusCbs.push(cb); cb('saved'); }
  subscribe() { return () => {}; }
  async uploadImage(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
  // Establish who is signed in and hand back the data they may see. Local mode
  // can read first and ask questions later; the cloud store cannot (see there).
  async bootstrap() {
    const db = await this.load();
    const sid = this.loadSession();
    const user = sid === ADMIN_ID ? adminUser()
      : sid ? (db.team || []).find(t => t.id === sid) || null : null;
    return { db, user, authEmail: null, authRequired: false };
  }
  async signIn(email, password) {
    const e = (email || '').trim().toLowerCase();
    const db = await this.load();
    if (isAdminEmail(e)) {
      if ((password || '') !== LOCAL_ADMIN_PASSWORD) return { error: 'Wrong password.' };
      this.saveSession(ADMIN_ID); return { user: adminUser(), db };
    }
    const u = (db.team || []).find(t => (t.email || '').toLowerCase() === e);
    if (!u) return { error: 'No user with that email.' };
    if ((u.password || '') !== (password || '')) return { error: 'Wrong password.' };
    this.saveSession(u.id); return { user: u, db };
  }
  signOut() { this.saveSession(null); }
  loadSession() { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
  saveSession(id) { try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch (e) {} }
}

// ---------------------------------------------------------------------------
// CloudStore (Supabase)
// ---------------------------------------------------------------------------
class CloudStore {
  constructor() {
    this.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    this._statusCbs = [];
    this._status = 'saved';
    this._queue = new Map();      // "key:id" -> { op, key, id, item }
    this._retry = 0;
    this._flushT = null;
    this._restoreQueue();         // drain anything left from a previous session
    window.addEventListener('online', () => this._flushSoon(0));
  }

  // ---- status ---------------------------------------------------------------
  onStatus(cb) { this._statusCbs.push(cb); cb(this._status); }
  _setStatus(s) { if (this._status !== s) { this._status = s; this._statusCbs.forEach(cb => { try { cb(s); } catch (e) {} }); } }

  // ---- queue (the never-lose-a-write machinery) -------------------------------
  _qkey(key, id) { return key + ':' + id; }
  hasPending(key, id) { return this._queue.has(this._qkey(key, id)); }
  _persistQueue() {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify([...this._queue.values()])); } catch (e) {}
  }
  _restoreQueue() {
    try {
      const r = localStorage.getItem(QUEUE_KEY); if (!r) return;
      JSON.parse(r).forEach(w => this._queue.set(this._qkey(w.key, w.id), w));
      if (this._queue.size) this._flushSoon(500);
    } catch (e) {}
  }
  upsert(key, item) {
    this._queue.set(this._qkey(key, item.id), { op: 'upsert', key, id: item.id, item });
    this._persistQueue(); this._flushSoon(300);
  }
  remove(key, id) {
    this._queue.set(this._qkey(key, id), { op: 'delete', key, id });
    this._persistQueue(); this._flushSoon(300);
  }
  _flushSoon(ms) { clearTimeout(this._flushT); this._flushT = setTimeout(() => this._flush(), ms); }
  async _flush() {
    if (this._flushing) { this._flushSoon(250); return; }
    if (!this._queue.size) { this._setStatus('saved'); return; }
    this._flushing = true;
    this._setStatus(this._retry > 0 ? 'retrying' : 'saving');
    let failed = false;
    // snapshot: writes queued DURING the flush stay queued for the next pass
    for (const [qk, w] of [...this._queue.entries()]) {
      try {
        const table = TABLES[w.key];
        let r;
        if (w.op === 'upsert') r = await this.sb.from(table).upsert({ id: w.id, data: w.item, updated_at: new Date().toISOString() });
        else r = await this.sb.from(table).delete().eq('id', w.id);
        if (r.error) throw r.error;
        // confirmed — remove ONLY if a newer write for this row didn't arrive meanwhile
        if (this._queue.get(qk) === w) this._queue.delete(qk);
      } catch (e) {
        console.error('[store] write failed, will retry', w.key, w.id, e);
        failed = true;
      }
    }
    this._persistQueue();
    this._flushing = false;
    if (failed || this._queue.size) {
      this._retry = Math.min((this._retry || 0) + 1, 8);
      this._setStatus(navigator.onLine === false ? 'offline' : 'retrying');
      this._flushSoon(Math.min(1500 * this._retry, 15000));
    } else {
      this._retry = 0;
      this._setStatus('saved');
    }
  }

  // ---- read -------------------------------------------------------------------
  async load() {
    try {
      const out = {};
      for (const k of KEYS) {
        const r = await this.sb.from(TABLES[k]).select('data').order('id');
        if (r.error) {
          // A table that doesn't exist yet is treated as empty, not as a
          // failure. That way shipping a feature before its SQL has been run
          // degrades to "this collection is empty" instead of taking the whole
          // workspace down — and the app recovers by itself once the table
          // appears. Any other error is real and still fails the load.
          if (isMissingTable(r.error)) {
            console.warn('[store] table "' + TABLES[k] + '" not found — treating as empty. Run the SQL in SETUP.md.');
            out[k] = [];
            continue;
          }
          throw r.error;
        }
        out[k] = (r.data || []).map(row => row.data);
      }
      return out;
    } catch (e) { console.error('[store] load failed', e); return null; }
  }

  // ---- realtime — row-level, self-healing channel ------------------------------
  subscribe(onRow) {
    let channel = null, closed = false, retryT = null;
    const build = () => {
      if (closed) return;
      channel = this.sb.channel('slate2-' + Math.random().toString(36).slice(2));
      for (const k of KEYS) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table: TABLES[k] }, payload => {
          if (payload.eventType === 'DELETE') onRow(k, { id: payload.old && payload.old.id, __deleted: true });
          else if (payload.new && payload.new.data) onRow(k, payload.new.data);
        });
      }
      channel.subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (closed) return;
          clearTimeout(retryT);
          retryT = setTimeout(() => { try { this.sb.removeChannel(channel); } catch (e) {} build(); }, 1500);
        }
      });
    };
    build();
    return () => { closed = true; clearTimeout(retryT); try { if (channel) this.sb.removeChannel(channel); } catch (e) {} };
  }

  // ---- media ------------------------------------------------------------------
  async uploadImage(file) {
    const ext = (file.name || 'img').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const r = await this.sb.storage.from('media').upload(path, file, { cacheControl: '31536000', upsert: false });
    if (r.error) throw r.error;
    return this.sb.storage.from('media').getPublicUrl(path).data.publicUrl;
  }

  // ---- auth ---------------------------------------------------------------------
  // The tables are readable only by signed-in users (that's what stops the
  // public anon key from being a skeleton key), so we must establish the auth
  // session BEFORE loading. Loading first would just return empty arrays and
  // make a logged-out visitor look like an empty workspace.
  async bootstrap() {
    let session = null;
    try {
      const { data } = await this.sb.auth.getSession();
      session = data && data.session;
    } catch (e) { return null; }
    if (!session) return { db: emptyDb(), user: null, authEmail: null, authRequired: true };

    const db = await this.load();
    if (db === null) return null;
    const authEmail = ((session.user && session.user.email) || '').toLowerCase();
    const user = isAdminEmail(authEmail)
      ? adminUser()
      : (db.team || []).find(t => (t.email || '').toLowerCase() === authEmail) || null;
    return { db, user, authEmail };
  }

  async signIn(email, password) {
    let data, error;
    try {
      ({ data, error } = await this.sb.auth.signInWithPassword({ email: (email || '').trim().toLowerCase(), password: password || '' }));
    } catch (e) { return { error: 'Could not reach the sign-in server.' }; }
    if (error) return { error: error.message || 'Sign-in failed.' };

    // Only now can we read anything.
    const db = await this.load();
    if (db === null) return { error: 'Signed in, but the workspace could not be loaded. Try again.' };
    const authEmail = ((data.user && data.user.email) || '').toLowerCase();
    const user = isAdminEmail(authEmail)
      ? adminUser()
      : (db.team || []).find(t => (t.email || '').toLowerCase() === authEmail) || null;
    if (!user) return { error: 'Signed in, but you are not on the team yet. Ask the admin to add you.' };
    this.saveSession(user.id);
    return { user, db };
  }
  signOut() { try { this.sb.auth.signOut(); } catch (e) {} this.saveSession(null); }
  loadSession() { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
  saveSession(id) { try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch (e) {} }
}

export function createStore() {
  if (MODE === 'supabase') {
    if (!window.supabase) { console.error('[store] Supabase script missing — falling back to local'); return new LocalStore(); }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error('[store] SUPABASE_URL/KEY not set in config.js — falling back to local'); return new LocalStore(); }
    return new CloudStore();
  }
  return new LocalStore();
}
