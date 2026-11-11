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

import { state, byId, can, uid } from './state.js';
import { takesDailyVideos, isDropped, lifecycleOf, lifecycleDef } from './lifecycle.js';
import { getPref } from './prefs.js';
import { ruleOf } from './rules.js';

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
  if (!can.seeStage(state.user)) return '';
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
// the page's rule (see rules.js)
// ---------------------------------------------------------------------------
// A page's first videos are growth, one a day, as many as its rule says. A video
// counts the moment it is added, made or not. After those, the rule says what
// it takes: any video, one CTA and one growth a day, or CTA only.
//
// The count is read off the page's videos rather than stored, so deleting a
// video can never leave the number wrong. A CTA someone added over the rule is not
// one of the first videos, so the page still gets its growth ones.
export function rampPhase(a) {
  const rule = ruleOf(a);
  if (!rule) return null;
  const need = Math.max(0, Math.round(+rule.first || 0));
  const videos = (state.db.dailyEntries || []).filter(e => e.accountId === a.id && !(e.ruleOverride && e.type !== 'Growth'))
    .sort((x, y) => (x.date || '').localeCompare(y.date || '') || (x.createdAt || 0) - (y.createdAt || 0));
  return { rule, have: Math.min(videos.length, need), need, growing: videos.length < need, first: videos.slice(0, need) };
}

const kind = t => (t === 'Growth' ? 'growth' : 'CTA');

// Why this page cannot take a video of `type` on `date`, or '' if it can.
// `skipId` is a video being changed, so it does not count against itself.
export function rampBlock(a, type, date, skipId) {
  const p = rampPhase(a);
  if (!p) return '';
  const inFirst = !!skipId && p.first.some(v => v.id === skipId);
  if (p.growing || inFirst) {
    if (type !== 'Growth') return 'Its first ' + p.need + ' videos are growth' + (p.growing ? ', ' + p.have + ' of ' + p.need + ' so far' : '');
    if (p.first.some(v => v.date === date && v.id !== skipId)) return 'Already has a video that day';
    return '';
  }
  // those days belong to the first videos. Pages that started before the rule
  // never ran it this way, so they are left alone.
  if (p.need) {
    const ranIt = p.first.every(v => v.type === 'Growth') && new Set(p.first.map(v => v.date)).size === p.need;
    if (ranIt && date <= p.first[p.need - 1].date && !inFirst) return 'Still on its first ' + p.need + ' days';
  }
  const then = p.rule.then;
  if (then === 'cta' && type === 'Growth') return 'Takes CTA videos only';
  if (then === 'mix') {
    const same = (state.db.dailyEntries || []).filter(e => e.accountId === a.id && e.date === date
      && e.id !== skipId && (e.type || 'Product') === type).length;
    if (same) return 'Already has its ' + kind(type) + ' video that day';
  }
  return '';
}

// The type a new video on this page should start as.
export function ruleType(a, date) {
  const p = rampPhase(a);
  if (!p) return 'Product';
  if (p.growing) return 'Growth';
  return ['Product', 'Growth'].find(t => !rampBlock(a, t, date)) || 'Product';
}

// What a page still needs on `date`, by its rule: some of 'Growth', 'Product', or
// 'Any' for a page whose rule lets it take either. A type it already has a video
// of that day, or that its rule holds back, is not needed.
export function dayNeeds(a, date) {
  const have = { Growth: 0, Product: 0 };
  (state.db.dailyEntries || []).forEach(e => {
    if (e.accountId === a.id && e.date === date) have[e.type === 'Growth' ? 'Growth' : 'Product']++;
  });
  const p = rampPhase(a);
  const then = p ? (p.growing ? 'first' : p.rule.then) : 'any';
  const open = t => !have[t] && !rampBlock(a, t, date);
  if (then === 'first') return !have.Growth && !have.Product && open('Growth') ? ['Growth'] : [];
  if (then === 'cta') return open('Product') ? ['Product'] : [];
  if (then === 'mix') return ['Product', 'Growth'].filter(open);
  // any: one video a day, whichever type
  return have.Growth || have.Product || (p && rampBlock(a, 'Product', date) && rampBlock(a, 'Growth', date)) ? [] : ['Any'];
}

// A page starts in the first stage and moves to the second once it has its
// growth videos, and back if a deleted video takes it under again. Nobody picks
// this: Settings can name other stages for the two, otherwise it is the first
// two on the list. A stage the admin set by hand for any other reason is left
// alone. Returns true if the page changed.
function startStage() {
  const id = getPref('rampGrowthStage');
  if (byId(state.db.stages, id)) return id;
  const first = sortedStages()[0];
  return first ? first.id : '';
}

function nextStage() {
  const id = getPref('rampCtaStage');
  if (byId(state.db.stages, id)) return id;
  const second = sortedStages()[1];
  return second ? second.id : '';
}

export function syncRampStage(a) {
  if (!a || !a.ramp) return false;   // pages that began before this existed
  const rule = ruleOf(a);
  if (!rule) return false;
  const need = Math.max(0, Math.round(+rule.first || 0));
  const growth = (state.db.dailyEntries || []).filter(e => e.accountId === a.id && e.type === 'Growth').length;
  const start = startStage(), next = nextStage();
  const want = growth >= need ? next : start;
  if (!want || a.stageId === want) return false;
  if (a.stageId && a.stageId !== start && a.stageId !== next) return false;
  a.stageId = want;
  return true;
}

// What a brand-new page starts with.
export function rampSeed() {
  return { ramp: true, stageId: startStage() };
}

// The automatic move needs two stages to move between, so it adds whatever is
// missing. They can be renamed under Settings.
export async function ensureRampStages() {
  const { save } = await import('./app.js');
  for (let n = sortedStages().length + 1; n <= 2; n++) {
    save('stages', { id: uid('st'), name: 'Stage ' + n, goal: '', color: n === 1 ? '#5b8def' : '#34e08a', order: n - 1, createdAt: Date.now() });
  }
}

// Everything an editor needs to know before touching a page, in one place.
export function pageStanding(a) {
  if (!a) return null;
  const def = lifecycleDef(a);
  if (!def.work) {
    return { retired: isDropped(a), label: lifecycleDef(a).label, tone: def.tone, note: def.note };
  }
  if (!can.seeStage(state.user)) return { retired: false, label: def.label, tone: def.tone, note: '' };
  const s = stageOf(a);
  if (!s) return { retired: false, label: 'No stage set', tone: 'gray', note: '' };
  return { retired: false, label: s.name, tone: null, color: stageColor(s), note: (s.goal || '').trim() };
}
