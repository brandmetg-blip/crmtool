// ============================================================================
// lifecycle.js — whether a page is running, and how it enters and leaves that.
//
//   Building   being set up, not posting yet
//   Live       posting on the daily schedule
//   Paused     temporarily halted, expected back
//   Reposting  stopped running having had hits — old winners get reposted,
//              no new videos are made for it
//   Stopped    stopped running with no traction — dropped
//   Banned     the platform ended it
//
// Reposting and Stopped are the two ways a page is dropped, kept apart because
// they mean different work: one still earns, the other is done.
//
// Nothing here deletes. A dropped page keeps its videos, its numbers and its
// place in the chain of what replaced what.
// ============================================================================

import { state, byId } from './state.js';

// `roster` means the page is one you are running, even if it is still being set
// up, so it is listed under Pages rather than Archive. `work` is the narrower question of whether it takes videos today.
//
// The stored id is kept as it was written so existing pages keep working; the
// label is what anyone reads.
export const LIFECYCLE = [
  { id: 'Live', label: 'Live', tone: 'green', roster: true, work: true, note: 'Created and posting on the daily schedule.' },
  { id: 'Building', label: 'Setting up', tone: 'amber', roster: true, work: false, note: 'One of your pages — the page itself still needs creating.' },
  { id: 'Paused', label: 'Paused', tone: 'gray', roster: false, work: false, note: 'Temporarily not posting.' },
  { id: 'Reposting', label: 'Reposting', tone: 'violet', roster: false, work: false, note: 'No longer running — repost its old winners, no new videos.' },
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
export const inRoster = a => lifecycleDef(a).roster;      // running, or being set up to
export const takesDailyVideos = a => lifecycleDef(a).work;
export const isDropped = a => ['Reposting', 'Stopped', 'Banned'].includes(lifecycleOf(a));
export const isBuilding = a => lifecycleOf(a) === 'Building';

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

// A short line for a page: what it replaced, or what replaced it.
export function lineageNote(a) {
  const was = replacedPage(a);
  if (was) return 'Replaced ' + (was.name || 'a dropped page');
  const now = replacementFor(a);
  if (now) return 'Replaced by ' + (now.name || 'a new page');
  return '';
}
