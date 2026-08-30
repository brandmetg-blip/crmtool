// ============================================================================
// lifecycle.js — the roster of live pages, and how pages enter and leave it.
//
// The organising idea is a ROSTER WITH SLOTS. You run a fixed number of live
// pages — say ten. A live page occupies a slot. Dropping one frees a slot, and
// a free slot is a job to do, not a fact to notice. Everything else follows:
//
//   Building   being set up, not posting yet — the pipeline that fills slots
//   Live       posting on the daily schedule — this is what occupies a slot
//   Paused     temporarily halted, expected back
//   Reposting  left the roster having had hits — old winners get reposted,
//              no new videos are made for it
//   Stopped    left the roster with no traction — dropped
//   Banned     the platform ended it
//
// Reposting and Stopped are the two ways a page is dropped, kept apart because
// they mean different work: one still earns, the other is done.
//
// Nothing here deletes. A dropped page keeps its videos, its numbers and its
// place in the chain of what replaced what.
// ============================================================================

import { state, byId } from './state.js';

// `roster` means this page counts toward the number you run. A page still
// being set up is already one of them — the slot is spoken for — it just is not
// posting yet. `work` is the narrower question of whether it takes videos today.
//
// The stored id is kept as it was written so existing pages keep working; the
// label is what anyone reads.
export const LIFECYCLE = [
  { id: 'Live', label: 'Live', tone: 'green', roster: true, work: true, note: 'Created and posting on the daily schedule.' },
  { id: 'Building', label: 'Setting up', tone: 'amber', roster: true, work: false, note: 'One of your pages — the page itself still needs creating.' },
  { id: 'Paused', label: 'Paused', tone: 'gray', roster: false, work: false, note: 'Temporarily not posting.' },
  { id: 'Reposting', label: 'Reposting', tone: 'violet', roster: false, work: false, note: 'Out of the roster — repost its old winners, no new videos.' },
  { id: 'Stopped', label: 'Stopped', tone: 'red', roster: false, work: false, note: 'Dropped for lack of traction. No new videos.' },
  { id: 'Banned', label: 'Banned', tone: 'red', roster: false, work: false, note: 'Ended by the platform. No new videos.' },
];

// Pages written before this existed carry the old words.
const LEGACY = { Active: 'Live', Warming: 'Building', Dropped: 'Stopped' };

export function lifecycleOf(a) {
  const raw = (a && a.status) || 'Live';
  const id = LEGACY[raw] || raw;
  return LIFECYCLE.some(l => l.id === id) ? id : 'Live';
}

export function lifecycleDef(a) {
  const id = lifecycleOf(a);
  return LIFECYCLE.find(l => l.id === id) || LIFECYCLE[0];
}

// What anyone reads, as opposed to what is stored.
export function lifecycleLabel(a) {
  return lifecycleDef(a).label;
}

export const isLive = a => lifecycleDef(a).work;          // created and posting
export const inRoster = a => lifecycleDef(a).roster;      // counts toward the number you run
export const takesDailyVideos = a => lifecycleDef(a).work;
export const isDropped = a => ['Reposting', 'Stopped', 'Banned'].includes(lifecycleOf(a));
export const isBuilding = a => lifecycleOf(a) === 'Building';

// ---------------------------------------------------------------------------
// the roster
// ---------------------------------------------------------------------------
// A slot is taken by any page in the roster, whether it is posting yet or not.
// Ten live and four being set up is fourteen of the fourteen you run — the work
// left is creating four pages, not finding four more.
export function roster(accounts, target) {
  const live = (accounts || []).filter(isLive);
  const building = (accounts || []).filter(isBuilding);
  const t = Math.max(0, Math.round(target || 0));
  const filled = live.length + building.length;
  return {
    target: t,
    live: live.length,
    building: building.length,
    filled,
    open: Math.max(0, t - filled),      // slots with no page against them at all
    over: Math.max(0, filled - t),
    liveAccounts: live,
    buildingAccounts: building,
  };
}

// ---------------------------------------------------------------------------
// how a page is actually doing
// ---------------------------------------------------------------------------
// The numbers that turn "this one feels dead" into something you can act on:
// how long it has been running, how much has actually gone out, and whether any
// of it landed. A winner is a video someone starred in the builder.
export function pageStats(a) {
  const mine = (state.db.dailyEntries || []).filter(e => e.accountId === a.id);
  const posted = mine.filter(e => e.posted);
  const wins = mine.filter(e => e.win).length;
  const since = a.wentLiveAt || a.createdAt || null;
  const days = since ? Math.max(0, Math.floor((Date.now() - since) / 86400000)) : null;
  const lastPost = posted
    .map(e => e.postedDate || e.date)
    .sort()
    .pop() || null;
  return { posted: posted.length, made: mine.length, wins, days, lastPost };
}

// A live page that has had its runway and produced no winner is worth a
// decision. It is a prompt, never an automatic drop.
export function needsReview(a, afterDays) {
  if (!isLive(a)) return false;
  const s = pageStats(a);
  if (s.days == null) return false;
  return s.days >= Math.max(1, afterDays) && s.wins === 0;
}

// ---------------------------------------------------------------------------
// replacement chain
// ---------------------------------------------------------------------------
export function replacedPage(a) {
  return a && a.replacesId ? byId(state.db.accounts, a.replacesId) : null;
}

export function replacementFor(a) {
  if (!a) return null;
  return (state.db.accounts || []).find(x => x.replacesId === a.id) || null;
}

// Dropped pages with nothing standing in for them yet — the actual backlog.
export function unreplaced(accounts) {
  return (accounts || []).filter(a => isDropped(a) && !replacementFor(a));
}
