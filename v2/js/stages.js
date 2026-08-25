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
