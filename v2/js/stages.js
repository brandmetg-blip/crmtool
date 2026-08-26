// ============================================================================
// stages.js — where a page is in its life, and whether it is still in play.
//
// Sixteen live pages only works if everyone can see, without asking, which
// stage each one is at and what that stage requires. So a stage is not a label:
// it carries the instruction for that stage, and every role reads the same one.
//
// Two separate questions, deliberately kept apart:
//
//   STAGE   how far along a page is — warming, growing, monetising…
//           you define these yourself, because the process keeps changing.
//   STATUS  whether it is in play at all. Dropped and Banned are retired:
//           no new videos, hidden from the day's work, and called out as dead
//           wherever an editor might otherwise waste effort on them.
//
// A dropped page keeps its history. Dropping is not deleting.
// ============================================================================

import { state, byId } from './state.js';
import { takesDailyVideos, isDropped, lifecycleOf, lifecycleDef } from './lifecycle.js';

// The kinds of video a page can be given.
export const VIDEO_TYPES = ['Growth', 'Product'];

// Which pages are still taking new videos. The lifecycle owns this decision;
// stages only ask the question.
export { takesDailyVideos as isWorking, isDropped as isRetired } from './lifecycle.js';

export function liveAccounts(list) {
  return (list || []).filter(takesDailyVideos);
}

export function sortedStages() {
  return (state.db.stages || []).slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.name || '').localeCompare(b.name || ''));
}

export function stageOf(a) {
  return a ? byId(state.db.stages, a.stageId) : null;
}

export function stageColor(s) {
  return (s && s.color) || 'var(--mut)';
}

// The one-line answer to "what am I meant to be doing for this page?"
export function stageGoal(a) {
  const s = stageOf(a);
  return s ? (s.goal || '').trim() : '';
}

// ---------------------------------------------------------------------------
// how many videos of each kind a stage wants per day
// ---------------------------------------------------------------------------
// A stage carries a daily target per type — 1 growth and 2 product, say. Zero
// means that type does not belong at this stage at all, so the quota subsumes
// the old allowed/not-allowed rule: nothing wanted is nothing allowed.
//
// This is what stops the guesswork. Nobody has to remember whether a page has
// had its product video today; the target and the count are both on screen.
export function quotaFor(stage, type) {
  if (!stage) return 0;
  const q = stage.quota;
  if (q && typeof q[type] === 'number') return Math.max(0, Math.round(q[type]));
  // stages written before quotas: an allows list meant one a day of each
  if (Array.isArray(stage.allows) && stage.allows.length) return stage.allows.includes(type) ? 1 : 0;
  return 1;
}

export function allowedTypes(stage) {
  const on = VIDEO_TYPES.filter(t => quotaFor(stage, t) > 0);
  return on.length ? on : VIDEO_TYPES.slice();
}

export function stageAllows(account, type) {
  const s = stageOf(account);
  if (!s) return true;                       // no stage set: nothing to enforce
  return quotaFor(s, type) > 0;
}

// What this page still needs of `type` on `date`. need === null means the page
// has no stage, so there is no target to measure against.
export function quotaProgress(account, type, date, entries) {
  const s = stageOf(account);
  const need = s ? quotaFor(s, type) : null;
  const have = (entries || state.db.dailyEntries || [])
    .filter(e => e.date === date && e.accountId === account.id && (e.type || 'Product') === type).length;
  return { need, have, remaining: need == null ? null : Math.max(0, need - have) };
}

// The type a new video should default to for this page.
export function defaultTypeFor(account) {
  const allowed = allowedTypes(stageOf(account));
  return allowed.includes('Product') && allowed.length === 1 ? 'Product' : allowed[0] || 'Product';
}

// Everything an editor needs to know before touching a page, in one place.
export function pageStanding(a) {
  if (!a) return null;
  const def = lifecycleDef(a);
  if (!def.work) {
    return { retired: isDropped(a), label: lifecycleOf(a), tone: def.tone, note: def.note };
  }
  const s = stageOf(a);
  if (!s) return { retired: false, label: 'No stage set', tone: 'gray', note: '' };
  return { retired: false, label: s.name, tone: null, color: stageColor(s), note: (s.goal || '').trim() };
}
