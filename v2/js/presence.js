// ============================================================================
// presence.js — who is here, and who is editing which field right now.
//
// Why this exists: a script row is written as a whole row. If two people type
// into the same field at the same moment, one of them loses their text no
// matter how good the write queue is. Rather than merge characters (a much
// bigger machine), we stop the collision from happening: the moment you focus
// a field you CLAIM it, everyone else sees "Ana is editing" and their copy of
// that field goes read-only until you leave it.
//
// Claims are deliberately soft:
//   - they expire on their own (STALE_MS) so a crashed tab never locks a field
//     forever — nothing can get permanently stuck,
//   - they are advisory; an admin can always take over via takeOver().
//
// In local mode every function is a no-op returning "nobody", so the app runs
// exactly the same with one user and no server.
//
// Field keys are plain strings the views invent, e.g.
//   "script:s_abc:hook"            script-level field
//   "frame:s_abc:f_xyz:videoPrompt"  per-frame field
// ============================================================================

import { MODE, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const STALE_MS = 25000;   // a claim older than this is ignored (dead tab)
const BEAT_MS = 8000;     // re-broadcast our claims this often

class NullPresence {
  start() {}
  stop() {}
  peers() { return []; }
  heldBy() { return null; }
  claim() {}
  release() {}
  takeOver() {}
  onChange() {}
}

class LivePresence {
  constructor(client) {
    this.sb = client;
    this.channel = null;
    this.me = null;
    this.mine = new Set();      // field keys this tab currently holds
    this.remote = new Map();    // fieldKey -> { userId, name, at }
    this.peerList = [];         // [{ userId, name }]
    this.cbs = [];
    this._beat = null;
    this._sig = '';
  }

  onChange(cb) { this.cbs.push(cb); }

  // Only notify when the picture actually changed — presence heartbeats fire
  // constantly and a re-render per beat would fight the user's cursor.
  _notify() {
    const sig = [...this.remote.entries()].map(([k, v]) => k + '=' + v.userId).sort().join('|')
      + '#' + this.peerList.map(p => p.userId).sort().join(',');
    if (sig === this._sig) return;
    this._sig = sig;
    this.cbs.forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
  }

  start(user) {
    if (!user || this.channel) return;
    this.me = { userId: user.id, name: user.name || 'Someone' };

    this.channel = this.sb.channel('presence:workspace', {
      config: { presence: { key: user.id + ':' + Math.random().toString(36).slice(2, 7) } },
    });

    this.channel.on('presence', { event: 'sync' }, () => this._rebuild());
    this.channel.subscribe(status => {
      if (status === 'SUBSCRIBED') this._push();
    });

    // Re-broadcast periodically so our claims never look stale to others, and
    // release everything if the tab goes away.
    this._beat = setInterval(() => this._push(), BEAT_MS);
    window.addEventListener('beforeunload', () => this.stop());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this._push(); });
  }

  stop() {
    clearInterval(this._beat); this._beat = null;
    this.mine.clear();
    try { if (this.channel) { this.channel.untrack(); this.sb.removeChannel(this.channel); } } catch (e) {}
    this.channel = null;
    this.remote.clear(); this.peerList = []; this._sig = '';
  }

  // Our own tab's view of the world, sent to everyone else.
  _push() {
    if (!this.channel) return;
    try {
      this.channel.track({ userId: this.me.userId, name: this.me.name, fields: [...this.mine], at: Date.now() });
    } catch (e) { /* channel not ready yet; the next beat retries */ }
  }

  // Fold every peer's state into "who holds which field" + "who is online".
  _rebuild() {
    if (!this.channel) return;
    const now = Date.now();
    const st = this.channel.presenceState();
    const held = new Map();
    const peers = new Map();

    Object.values(st).forEach(entries => {
      (entries || []).forEach(e => {
        if (!e || !e.userId) return;
        peers.set(e.userId, { userId: e.userId, name: e.name || 'Someone' });
        if (e.userId === this.me.userId) return;            // our own claims aren't locks on us
        if (!e.at || now - e.at > STALE_MS) return;         // dead tab — ignore its claims
        (e.fields || []).forEach(f => held.set(f, { userId: e.userId, name: e.name || 'Someone', at: e.at }));
      });
    });

    this.remote = held;
    this.peerList = [...peers.values()];
    this._notify();
  }

  peers() { return this.peerList; }

  // null = free (or held by you). Otherwise { userId, name }.
  heldBy(fieldKey) {
    const h = this.remote.get(fieldKey);
    if (!h) return null;
    if (Date.now() - h.at > STALE_MS) return null;
    return h;
  }

  claim(fieldKey) {
    if (this.mine.has(fieldKey)) return;
    this.mine.add(fieldKey);
    this._push();
  }

  release(fieldKey) {
    if (!this.mine.delete(fieldKey)) return;
    this._push();
  }

  // Deliberate override: drop the other person's claim locally and take it.
  // They keep typing into their own copy; this is an escape hatch, not a fight.
  takeOver(fieldKey) {
    this.remote.delete(fieldKey);
    this.claim(fieldKey);
    this._sig = ''; this._notify();
  }
}

export const presence = (function () {
  if (MODE !== 'supabase') return new NullPresence();
  if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) return new NullPresence();
  try {
    return new LivePresence(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (e) {
    console.error('[presence] disabled:', e);
    return new NullPresence();
  }
})();
