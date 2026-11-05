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
import { getPref } from './prefs.js';

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

// ---------------------------------------------------------------------------
// the new-page rule
// ---------------------------------------------------------------------------
// A page created under this rule (it carries `ramp: true`) makes its first
// growth videos, one a day, and then only CTA videos. Pages from before the
// rule have no flag, so nothing changes for them.
//
// The count is read off the page's videos rather than stored, so deleting a
// video can never leave the number wrong.
export function rampPhase(a) {
  const need = Math.max(0, Math.round(+getPref('rampCount') || 0));
  if (!a || !a.ramp || !need) return null;
  const have = (state.db.dailyEntries || [])
    .filter(e => e.accountId === a.id && (e.type || 'Product') === 'Growth').length;
  return { have, need, growing: have < need };
}

// Why this page cannot take a video of `type` on `date`, or '' if it can.
export function rampBlock(a, type, date) {
  const p = rampPhase(a);
  if (!p) return '';
  if (!p.growing) return type === 'Growth' ? 'Past growth, CTA only' : '';
  if (type !== 'Growth') return 'In growth, ' + p.have + ' of ' + p.need;
  return videosOn(a, 'Growth', date) ? 'Growth already that day' : '';
}

// Moves the page between the two chosen stages when it crosses the line, and
// back if a deleted video takes it under again. A stage picked by hand for any
// other reason is left alone. Returns true if the page changed.
export function syncRampStage(a) {
  const p = rampPhase(a);
  if (!p) return false;
  const stage = key => { const id = getPref(key); return byId(state.db.stages, id) ? id : ''; };
  const growth = stage('rampGrowthStage'), cta = stage('rampCtaStage');
  if (!p.growing && cta && a.stageId !== cta && (!a.stageId || a.stageId === growth)) { a.stageId = cta; return true; }
  if (p.growing && growth && a.stageId === cta) { a.stageId = growth; return true; }
  return false;
}

// What a brand-new page starts with.
export function rampSeed() {
  return { ramp: true, stageId: byId(state.db.stages, getPref('rampGrowthStage')) ? getPref('rampGrowthStage') : '' };
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
