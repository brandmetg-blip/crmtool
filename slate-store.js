/* ============================================================================
 * slate-store.js — persistence adapter for the Slate CRM app
 * ----------------------------------------------------------------------------
 * This is the ONE seam between the app and where its data lives. The app never
 * touches storage or the network directly — it calls a "store" with:
 *
 *   loadData()            -> the whole app database object (db), or null
 *   persist(prevDb, nextDb) -> save a change (row-level when possible)
 *   subscribe(onChange)   -> live updates from other users; returns unsubscribe
 *   loadSession()         -> logged-in user id, or null
 *   saveSession(id)       -> remember / clear the session
 *   signIn(email, pw, db) -> { userId } | { error }
 *   signOut()             -> void
 *
 * Every method MAY return a Promise; the app awaits them. So a synchronous
 * local store and an async server store are interchangeable with ZERO changes
 * to the app.
 *
 * TWO server designs live here:
 *   • SupabaseStore  — MULTI-USER SAFE. One table per collection, row-level
 *                      writes (no clobbering), plus realtime so everyone stays
 *                      in sync live. This is the one to ship. See BACKEND.md §4B
 *                      and GO-LIVE.md for the SQL + setup.
 *   • (The old single-blob "quick path" has been retired in favor of the safe
 *      design above.)
 *
 * TO GO LIVE: set SUPABASE_URL + SUPABASE_ANON_KEY, flip STORE_MODE to
 * 'supabase', uncomment the Supabase <script> in Slate.dc.html. That's it.
 * ==========================================================================*/

(function () {
  'use strict';

  // ---- CONFIG ---------------------------------------------------------------
  const STORE_MODE = 'supabase'; // 'local' (this browser only) | 'supabase' (shared, live)

  const SUPABASE_URL = 'https://rodgpfnlzdkhlbdrxkji.supabase.co';       // e.g. 'https://xxxx.supabase.co'
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvZGdwZm5semRraGxiZHJ4a2ppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MTEwOTcsImV4cCI6MjA5ODQ4NzA5N30.q1GT7uknu_jPMtl6B-AGUhJ95OxTy2M4J4VC1v1U_bE';  // the public anon key from Supabase → Settings → API

  const DB_KEY = 'slate_crm_v2';
  const SESSION_KEY = 'slate_session_v1';

  // Collections that become one row per item (keyed by `id`), one table each.
  // [ appKey, tableName ]
  const ID_COLLECTIONS = [
    ['accounts', 'accounts'],
    ['posts', 'posts'],
    ['concepts', 'concepts'],
    ['products', 'products'],
    ['team', 'team'],
    ['dailyEntries', 'daily_entries'],
  ];
  // dailyMetrics is an object keyed by date -> one row per date.
  const METRICS_TABLE = 'daily_metrics';
  // Everything else (characterMeta, assetLinks, flags…) rides in one meta row.
  const META_TABLE = 'app_meta';
  const META_KEYS_EXCLUDED = new Set(
    ID_COLLECTIONS.map(c => c[0]).concat(['dailyMetrics'])
  );

  // ==========================================================================
  // LocalStore — prototype default. Whole db in this browser. Not shared.
  // ==========================================================================
  class LocalStore {
    loadData() {
      try { const r = localStorage.getItem(DB_KEY); return r ? JSON.parse(r) : null; }
      catch (e) { return { __failed: true }; } // parse error, not "empty" — see SupabaseStore note above
    }
    // Local storage has no concurrency to worry about — just save the whole db.
    // Reports success/failure the same way SupabaseStore does — a full quota
    // error used to be swallowed here too, losing the write with no warning.
    persist(prevDb, nextDb) {
      try { localStorage.setItem(DB_KEY, JSON.stringify(nextDb)); return { ok: true, errors: [] }; }
      catch (e) { console.error('[store] local persist failed', e); return { ok: false, errors: [e] }; }
    }
    subscribe(onChange) { return function () {}; } // no live sync locally
    loadSession() { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
    saveSession(id) {
      try { if (id) localStorage.setItem(SESSION_KEY, id); else localStorage.removeItem(SESSION_KEY); }
      catch (e) {}
    }
    signIn(email, password, db) {
      const e = (email || '').trim().toLowerCase();
      const u = ((db && db.team) || []).find(t => (t.email || '').toLowerCase() === e);
      if (!u) return { error: 'No account found with that email.' };
      if ((u.password || '') !== (password || '')) return { error: 'Incorrect password. Try again.' };
      this.saveSession(u.id);
      return { userId: u.id };
    }
    signOut() { this.saveSession(null); }
  }

  // ==========================================================================
  // SupabaseStore — MULTI-USER SAFE. Row-level writes + realtime.
  // --------------------------------------------------------------------------
  // Schema (each table is just id + a jsonb `data` blob of the item, so there's
  // no column mapping to maintain — see GO-LIVE.md for the exact SQL):
  //   accounts, posts, concepts, products, team, daily_entries : (id text pk, data jsonb, updated_at)
  //   daily_metrics : (date text pk, data jsonb, updated_at)
  //   app_meta      : (id int pk, data jsonb, updated_at)   -- single row, id=1
  //
  // Why this is safe with many people at once:
  //   • Two VAs logging different posts write two DIFFERENT rows — no overwrite.
  //   • Edits are computed as a DIFF of the old vs new db, so only the rows that
  //     actually changed get written.
  //   • Realtime pushes every change to all open clients, so everyone stays live.
  //
  // Requires the Supabase client loaded first:
  //   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  // ==========================================================================
  class SupabaseStore {
    constructor() {
      this.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      this.META_ID = 1;
    }

    // ---- cheap change-check: newest updated_at PER TABLE ---------------------
    // Returns { tableName: updated_at }. This pulls ONE tiny row per table (just
    // the max updated_at) instead of the whole db. Returning it per-table (not
    // collapsed to one max) lets the caller figure out WHICH tables actually
    // changed and refetch only those — see loadTables().
    async latestStamp() {
      try {
        const tables = ID_COLLECTIONS.map(c => c[1]).concat([METRICS_TABLE, META_TABLE]);
        const qs = tables.map(t =>
          this.sb.from(t).select('updated_at').order('updated_at', { ascending: false }).limit(1).maybeSingle()
        );
        const res = await Promise.all(qs);
        const out = {};
        tables.forEach((t, i) => { out[t] = (res[i] && res[i].data && res[i].data.updated_at) || ''; });
        return out;
      } catch (e) { return null; } // null => caller should fall back to a full reload
    }

    // Every table name this store manages (used by callers to mean "everything").
    allTableNames() { return ID_COLLECTIONS.map(c => c[1]).concat([METRICS_TABLE, META_TABLE]); }

    // ---- read: assemble the whole db from the tables ------------------------
    // IMPORTANT: returns { __failed: true } (never null) when the fetch itself
    // errored (network blip, timeout, etc). null is reserved for "confirmed
    // truly empty project". These must never be conflated — a caller that
    // treats a failed fetch as "empty" will reseed demo data and WRITE it over
    // a real, populated database. See loadTables() below.
    async loadData() { return this.loadTables(this.allTableNames()); }

    // ---- read: assemble ONLY the given tables into a partial db object ------
    // This is the key egress fix: a change to daily_entries (small rows, no
    // media) used to trigger a full loadData() for EVERY connected client —
    // re-downloading accounts/concepts/products too, which carry big base64
    // avatar/video blobs. Now a realtime event says which table changed, and
    // we only re-pull that one. Callers merge the partial result over their
    // existing db, leaving untouched collections (and their blobs) alone.
    async loadTables(tableNames) {
      // Cancel any still-in-flight previous load before starting a new one.
      // Retries used to just fire ANOTHER full set of queries on top of ones
      // still running from the last (client-gave-up-early) attempt — that
      // pile-up of concurrent queries against the same tables was what pushed
      // Postgres into hitting its own statement timeout and made "loading"
      // hang even longer the more it retried. Aborting the old request first
      // means each attempt is the only one actually hitting the database.
      if (this._loadAbort) { try { this._loadAbort.abort(); } catch (e) {} }
      const controller = new AbortController();
      this._loadAbort = controller;
      try {
        const want = new Set(tableNames);
        const idKeys = ID_COLLECTIONS.filter(([, table]) => want.has(table));
        const wantMetrics = want.has(METRICS_TABLE);
        const wantMeta = want.has(META_TABLE);

        // Order by id so row order is stable across fetches — the app renders
        // these lists with plain array-index React keys, so if the same table
        // came back in a different order on every refetch (Postgres makes NO
        // ordering guarantee without an ORDER BY), a mid-typing textarea could
        // get silently reassigned to a different row's text on the next reload.
        //
        // Fetched ONE TABLE AT A TIME rather than Promise.all-ing all of them:
        // account rows carry multi-MB base64 avatar images, and firing every
        // query at once multiplies the database's momentary load — that spike
        // is what was tripping the server's own statement timeout. Sequential
        // requests keep each individual query small and reliable; the total
        // wall-clock cost is still well under the client's timeout.
        const db = {};
        for (const [key, table] of idKeys) {
          const r = await this.sb.from(table).select('data').order('id').abortSignal(controller.signal);
          if (r.error) throw r.error;
          db[key] = (r.data || []).map(row => row.data);
        }
        if (wantMetrics) {
          const r = await this.sb.from(METRICS_TABLE).select('date,data').order('date').abortSignal(controller.signal);
          if (r.error) throw r.error;
          db.dailyMetrics = {};
          (r.data || []).forEach(row => { db.dailyMetrics[row.date] = row.data; });
        }
        if (wantMeta) {
          const r = await this.sb.from(META_TABLE).select('data').eq('id', this.META_ID).maybeSingle().abortSignal(controller.signal);
          if (r.error) throw r.error;
          if (r.data && r.data.data) Object.assign(db, r.data.data);
        }

        // Only treat as "nothing exists yet" when this was a full-db fetch AND
        // it truly came back empty — a partial refresh legitimately returns an
        // empty object when e.g. every daily_entries row was deleted.
        const wasFullFetch = want.size >= this.allTableNames().length;
        if (wasFullFetch) {
          const anyRows = idKeys.some(([key]) => (db[key] || []).length);
          if (!anyRows && !Object.keys(db).some(k => !ID_COLLECTIONS.some(c => c[0] === k) && k !== 'dailyMetrics')) return null;
        }
        return db;
      } catch (e) {
        // A newer loadTables() call aborting this one (see top of function) is
        // expected traffic, not a real failure — don't spam the console for it.
        if (e && (e.name === 'AbortError' || /abort/i.test(e.message || ''))) return { __failed: true };
        console.error('[store] loadTables failed', e);
        // NEVER return null here — null means "confirmed empty" to callers,
        // which triggers reseeding + an immediate write of that seed over the
        // real database. A failed fetch must be distinguishable so callers can
        // retry instead of destructively "filling in" what looks like empty.
        return { __failed: true };
      }
    }

    // ---- write: diff old vs new, write only what changed --------------------
    async persist(prevDb, nextDb) {
      const now = new Date().toISOString();
      const ops = [];
      // Supabase can't take hundreds of ids in one .in() (URL too long) — batch everything.
      const CH = 100;
      const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

      // id-keyed collections
      for (const [key, table] of ID_COLLECTIONS) {
        const { upserts, deletes } = diffById((prevDb && prevDb[key]) || [], (nextDb && nextDb[key]) || []);
        for (const grp of chunk(upserts, CH)) ops.push(this.sb.from(table).upsert(grp.map(it => ({ id: it.id, data: it, updated_at: now }))));
        for (const grp of chunk(deletes, CH)) ops.push(this.sb.from(table).delete().in('id', grp));
      }

      // dailyMetrics (keyed by date)
      const mPrev = (prevDb && prevDb.dailyMetrics) || {};
      const mNext = (nextDb && nextDb.dailyMetrics) || {};
      const mUpserts = [], mDeletes = [];
      for (const date of Object.keys(mNext)) {
        if (JSON.stringify(mNext[date]) !== JSON.stringify(mPrev[date])) {
          mUpserts.push({ date, data: mNext[date], updated_at: now });
        }
      }
      for (const date of Object.keys(mPrev)) { if (!(date in mNext)) mDeletes.push(date); }
      for (const grp of chunk(mUpserts, CH)) ops.push(this.sb.from(METRICS_TABLE).upsert(grp));
      for (const grp of chunk(mDeletes, CH)) ops.push(this.sb.from(METRICS_TABLE).delete().in('date', grp));

      // meta (everything else) — one row, written only when it changed
      const metaPrev = pickMeta(prevDb), metaNext = pickMeta(nextDb);
      if (JSON.stringify(metaPrev) !== JSON.stringify(metaNext)) {
        ops.push(this.sb.from(META_TABLE).upsert({ id: this.META_ID, data: metaNext, updated_at: now }));
      }

      // Fire them; log (don't throw) so the optimistic UI never crashes.
      //
      // DATA-LOSS FIX — read this before changing it.
      // supabase-js RESOLVES with { data, error } when a write fails; it does
      // NOT reject. So the old check here (`s.status === 'rejected'` only)
      // never fired for a real database failure: an RLS denial, a statement
      // timeout, a constraint violation all arrive as status 'fulfilled' with
      // an `error` payload. Every one of those was silently discarded — the
      // app believed the save succeeded, and the next realtime/poll refetch
      // pulled the OLDER server row back over the user's work. That is how
      // typed scripts and uploaded images "deleted themselves".
      // A failed write must be detectable by the caller so it can retry and
      // refuse to let the server overwrite unsaved local edits.
      const settled = await Promise.allSettled(ops);
      const errors = [];
      settled.forEach(s => {
        if (s.status === 'rejected') errors.push(s.reason);
        else if (s.value && s.value.error) errors.push(s.value.error); // resolved-but-failed
      });
      errors.forEach(e => console.error('[store] persist op failed', e));
      return { ok: errors.length === 0, errors };
    }

    // ---- realtime: notify the app whenever anyone changes anything ----------
    // A realtime channel can silently die (network blip, tab sleep, server
    // timeout). If it does and we don't rebuild it, live updates stop forever
    // and the user is stuck waiting on the slow poll. So we watch the channel
    // status and auto-reconnect whenever it errors, times out, or closes.
    // onChange(table) — table is the ONE table that changed, so the caller can
    // refetch just that collection instead of the whole db (see loadTables()
    // above). onChange() with no argument means "refresh everything" (used on
    // (re)connect, when we don't know what was missed while offline).
    subscribe(onChange) {
      const tables = ID_COLLECTIONS.map(c => c[1]).concat([METRICS_TABLE, META_TABLE]);
      let channel = null, closed = false, retryT = null;
      const build = () => {
        if (closed) return;
        // Unique name each attempt so a stale channel never blocks the new one.
        channel = this.sb.channel('slate-live-' + Math.random().toString(36).slice(2));
        tables.forEach(table => {
          channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange(table));
        });
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            // Freshly (re)connected — pull once so we don't miss anything that
            // changed while the channel was down.
            onChange();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (closed) return;
            clearTimeout(retryT);
            retryT = setTimeout(() => { try { this.sb.removeChannel(channel); } catch (e) {} build(); }, 1200);
          }
        });
      };
      build();
      return () => { closed = true; clearTimeout(retryT); try { if (channel) this.sb.removeChannel(channel); } catch (e) {} };
    }

    // ---- session / auth -----------------------------------------------------
    loadSession() { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
    saveSession(id) {
      try { if (id) localStorage.setItem(SESSION_KEY, id); else localStorage.removeItem(SESSION_KEY); }
      catch (e) {}
    }
    async signIn(email, password, db) {
      let data, error;
      try {
        const res = await this.sb.auth.signInWithPassword({
          email: (email || '').trim().toLowerCase(), password: password || ''
        });
        data = res.data; error = res.error;
      } catch (e) {
        return { error: 'Could not reach the sign-in server. Check your connection and try again.' };
      }
      if (error) {
        // Never surface a raw/blank/non-string error object to the UI.
        const msg = (typeof error.message === 'string' && error.message.trim()) ? error.message : 'Sign-in failed. Check your email and password and try again.';
        return { error: msg };
      }
      if (!data || !data.user) return { error: 'Sign-in failed. Check your email and password and try again.' };
      const authEmail = (data.user.email || '').toLowerCase();
      const u = ((db && db.team) || []).find(t => (t.email || '').toLowerCase() === authEmail);
      if (!u) return { error: 'Signed in, but no team profile is linked to this email. Add them under Settings first.' };
      this.saveSession(u.id);
      return { userId: u.id };
    }
    async signOut() { try { await this.sb.auth.signOut(); } catch (e) {} this.saveSession(null); }
  }

  // ---- diff helpers ---------------------------------------------------------
  // Compare two arrays of {id} objects; return which rows to upsert (added or
  // changed) and which ids to delete (removed).
  //
  // PERF: this runs on every persist() — i.e. on every debounced keystroke
  // flush, every add/delete row, every toggle — for EVERY collection
  // (accounts, posts, concepts, products, team, dailyEntries), even the ones
  // that didn't change at all. It used to JSON.stringify every single item in
  // every array just to check "did this change", which meant: (a) accounts/
  // concepts carrying big base64 avatar/video blobs got fully re-serialized
  // on every keystroke even though nothing about them changed, and (b) the
  // dailyEntries diff cost grew with the TOTAL number of scripts ever logged
  // (not just today's), since every unchanged entry was still stringified on
  // every save. The app's commit helpers (commit/mutEntry/commitEntry/
  // commitEntries) always clone-on-write and never mutate an item in place,
  // so an untouched item is guaranteed to still be the SAME object reference
  // between prevArr and nextArr — skip the expensive stringify compare (and
  // for a whole untouched collection, skip building the Maps at all) whenever
  // that reference is identical.
  function diffById(prevArr, nextArr) {
    if (prevArr === nextArr) return { upserts: [], deletes: [] };
    const prevMap = new Map(prevArr.map(it => [it.id, it]));
    const nextMap = new Map(nextArr.map(it => [it.id, it]));
    const upserts = [], deletes = [];
    for (const [id, it] of nextMap) {
      const before = prevMap.get(id);
      if (before === it) continue; // unchanged reference — guaranteed unchanged content
      if (!before || JSON.stringify(before) !== JSON.stringify(it)) upserts.push(it);
    }
    for (const id of prevMap.keys()) { if (!nextMap.has(id)) deletes.push(id); }
    return { upserts, deletes };
  }
  // Everything in db that isn't an id-collection or dailyMetrics -> the meta row.
  function pickMeta(db) {
    const out = {};
    if (!db) return out;
    for (const k of Object.keys(db)) { if (!META_KEYS_EXCLUDED.has(k)) out[k] = db[k]; }
    return out;
  }

  // ---- FACTORY --------------------------------------------------------------
  function createStore() {
    if (STORE_MODE === 'supabase') {
      if (!window.supabase) {
        console.error('[store] Supabase client not loaded — falling back to LocalStore. ' +
          'Add the @supabase/supabase-js script tag before slate-store.js.');
        return new LocalStore();
      }
      return new SupabaseStore();
    }
    return new LocalStore();
  }

  window.SlateStore = { create: createStore, LocalStore, SupabaseStore, STORE_MODE };
})();
