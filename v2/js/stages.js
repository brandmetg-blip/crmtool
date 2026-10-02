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

// How many videos of a type a page already has on a date. Stages no longer
// carry daily targets, so this is just a count to show, never a rule.
export function videosOn(account, type, date, entries) {
  return (entries || state.db.dailyEntries || [])
    .filter(e => e.date === date && e.accountId === account.id && (e.type || 'Product') === type).length;
}

// Everything an editor needs to know before touching a page, in one place.
export function pageStanding(a) {
  if (!a) return null;
  const def = lifecycleDef(a);
  if (!def.work) {
    return { retired: isDropped(a), label: lifecycleDef(a).label, tone: def.tone, note: def.note };
  }
  const s = stageOf(a);
  if (!s) return { retired: false, label: 'No stage set', tone: 'gray', note: '' };
  return { retired: false, label: s.name, tone: null, color: stageColor(s), note: (s.goal || '').trim() };
}
