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

// The kinds of video a page can be given.
export const VIDEO_TYPES = ['Growth', 'Product'];

// Statuses that mean "stop working on this page".
const RETIRED = ['Dropped', 'Banned'];

export function isRetired(a) {
  return !!a && RETIRED.includes(a.status || 'Active');
}

export function liveAccounts(list) {
  return (list || []).filter(a => !isRetired(a));
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
// which kinds of video belong at a stage
// ---------------------------------------------------------------------------
// A stage with nothing configured allows everything — a rule you have not
// written yet must never silently block work. Once you do say (for instance)
// that an established page takes Product only, asking for a Growth video there
// is flagged as off-stage. It is a guard rail, not a lock: it can be overridden
// deliberately, never by accident.
export function allowedTypes(stage) {
  if (!stage || !Array.isArray(stage.allows) || !stage.allows.length) return VIDEO_TYPES.slice();
  return VIDEO_TYPES.filter(t => stage.allows.includes(t));
}

export function stageAllows(account, type) {
  const s = stageOf(account);
  if (!s) return true;                       // no stage set: nothing to enforce
  return allowedTypes(s).includes(type);
}

// The type a new video should default to for this page.
export function defaultTypeFor(account) {
  const allowed = allowedTypes(stageOf(account));
  return allowed.includes('Product') && allowed.length === 1 ? 'Product' : allowed[0] || 'Product';
}

// Everything an editor needs to know before touching a page, in one place.
export function pageStanding(a) {
  if (!a) return null;
  if (isRetired(a)) {
    return {
      retired: true,
      label: a.status,
      tone: 'red',
      note: a.status === 'Dropped'
        ? 'This page has been dropped — do not make new videos for it.'
        : 'This page is banned — do not make new videos for it.',
    };
  }
  const s = stageOf(a);
  if (!s) return { retired: false, label: 'No stage set', tone: 'gray', note: '' };
  return { retired: false, label: s.name, tone: null, color: stageColor(s), note: (s.goal || '').trim() };
}
