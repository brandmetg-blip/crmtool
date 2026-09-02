// roster.js — the state of the roster, and what to do about it.
//
// Three questions, answered in order, above the avatar list:
//   1. Are the slots full?           how many live vs the target
//   2. Which pages need a decision?  runway spent, nothing landed
//   3. What is owed a replacement?   dropped, nothing standing in yet
//
// Each answer comes with the action next to it, because a dashboard nobody can
// act on just becomes another thing to ignore.

import { state, forceEmit, byId } from '../state.js';
import { el, avatar } from '../ui.js';
import { getPref } from '../prefs.js';
import {
  roster, pageStats, needsReview, unreplaced, lifecycleOf, isLive, replacementFor, replacedPage,
} from '../lifecycle.js';

// `pipeline` is the pages still in onboarding. They are not shown on this tab,
// but they hold a slot — the whole point of the roster model is that a page
// being built is already one of the ones you run. Counting them here and
// naming where they are keeps the number honest without putting half-built
// pages in the account centre.
export function renderRoster(root, accounts, canEdit, onReplace, pipeline) {
  const target = getPref('rosterTarget');
  const inPipeline = pipeline || [];
  const r = roster(accounts.concat(inPipeline), target);
  const reviewDays = getPref('reviewAfterDays');

  root.appendChild(slotBar(r, reviewDays, inPipeline.length));

  if (canEdit) {
    const due = accounts.filter(a => needsReview(a, reviewDays));
    if (due.length) root.appendChild(reviewQueue(due, reviewDays));

    const owed = unreplaced(accounts);
    if (owed.length) root.appendChild(replaceQueue(owed, onReplace));
  }
}

// ---- 1. are the slots full? ------------------------------------------------
function slotBar(r, reviewDays, inPipeline) {
  const tone = r.open === 0 ? 'green' : (r.open === 1 ? 'amber' : 'red');

  // one square per slot: filled and posting, filled but not created yet, empty
  const pips = el('div', { class: 'slots' });
  for (let i = 0; i < Math.max(r.target, r.filled); i++) {
    const live = i < r.live;
    const building = !live && i < r.filled;
    pips.appendChild(el('span', {
      class: 'slot' + (live ? ' on' : building ? ' building' : ''),
      title: live ? 'Live and posting' : building ? 'Setting up — page not created yet' : 'Empty slot, no page against it',
    }));
  }

  const line = r.open
    ? r.open + ' slot' + (r.open === 1 ? '' : 's') + ' with no page against ' + (r.open === 1 ? 'it' : 'them') + ' yet.'
    : r.over
      ? r.over + ' more than the target of ' + r.target + '.'
      : 'Every slot has a page against it.';

  return el('div', { class: 'card col', style: 'gap:11px;margin-bottom:16px' },
    el('div', { class: 'row wrap', style: 'gap:10px' },
      // the roster is everything you run, posting or not
      el('span', { style: 'font-size:22px;font-weight:800' }, r.filled + ' / ' + r.target),
      el('span', { class: 'label', style: 'align-self:center' }, 'PAGES'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'chip green' }, r.live + ' live'),
      r.building ? el('span', { class: 'chip amber' }, r.building + ' setting up') : null,
      r.open ? el('span', { class: 'chip ' + tone }, r.open + ' empty') : null),
    pips,
    el('span', { class: 'hint' }, line
      + ' A live page with no winner after ' + reviewDays + ' days comes up for review.'),
    // said out loud, because these count above but are not in the list below
    inPipeline ? el('span', { class: 'hint' },
      inPipeline + (inPipeline === 1 ? ' page is' : ' pages are')
      + ' still in Onboarding — counted here, and shown here once submitted.') : null);
}

// ---- 2. which pages need a decision? ---------------------------------------
function reviewQueue(due, reviewDays) {
  const col = el('div', { class: 'card col', style: 'gap:10px;margin-bottom:16px;border-color:rgba(240,179,65,0.4)' },
    el('div', { class: 'row wrap' },
      el('b', { style: 'font-size:13px;color:#f0c97a' },
        due.length + ' page' + (due.length === 1 ? '' : 's') + ' up for review'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint' }, 'live ' + reviewDays + '+ days, no winning video yet')));

  due.forEach(a => {
    const s = pageStats(a);
    col.appendChild(el('div', { class: 'pick-row', style: 'cursor:default' },
      avatar(a, 26),
      el('div', { style: 'min-width:0;flex:1' },
        el('b', { style: 'font-size:12.5px;display:block' }, a.name || 'Untitled'),
        el('span', { class: 'hint' },
          s.days + ' days live · ' + s.posted + ' posted · no winners'
          + (s.lastPost ? ' · last post ' + s.lastPost : ''))),
      el('button', { class: 'btn small', onclick: () => setLifecycle(a, 'Live', true) }, 'Keep'),
      el('button', { class: 'btn small', onclick: () => setLifecycle(a, 'Reposting') }, 'Repost'),
      el('button', { class: 'btn small danger', onclick: () => setLifecycle(a, 'Stopped') }, 'Stop')));
  });
  return col;
}

// "Keep" resets the clock rather than doing nothing, so the same page does not
// reappear tomorrow and get ignored into meaninglessness.
async function setLifecycle(a, status, resetClock) {
  if (status !== 'Live' && !confirm(
    (status === 'Reposting'
      ? 'Move ' + (a.name || 'this page') + ' to Reposting? It leaves the roster and stops getting new videos, but its winners can still be reposted.'
      : 'Stop ' + (a.name || 'this page') + '? It leaves the roster and stops getting new videos. Nothing is deleted.'))) return;

  const { save } = await import('../app.js');
  a.status = status;
  if (resetClock) a.wentLiveAt = Date.now();
  else { a.droppedAt = Date.now(); a.dropKind = status; }
  save('accounts', a);
  forceEmit();
}

// ---- 3. what is owed a replacement? ----------------------------------------
function replaceQueue(owed, onReplace) {
  const col = el('div', { class: 'card col', style: 'gap:10px;margin-bottom:16px' },
    el('div', { class: 'row wrap' },
      el('b', { style: 'font-size:13px' },
        owed.length + ' dropped page' + (owed.length === 1 ? '' : 's') + ' with no replacement'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint' }, 'starting one links the two, so the history stays readable')));

  owed.forEach(a => {
    const s = pageStats(a);
    col.appendChild(el('div', { class: 'pick-row', style: 'cursor:default' },
      avatar(a, 26),
      el('div', { style: 'min-width:0;flex:1' },
        el('b', { style: 'font-size:12.5px;display:block' }, a.name || 'Untitled'),
        el('span', { class: 'hint' },
          lifecycleOf(a) + (s.posted ? ' · ' + s.posted + ' posted' : '')
          + (s.wins ? ' · ' + s.wins + ' winner' + (s.wins === 1 ? '' : 's') : ''))),
      el('button', { class: 'btn small primary', onclick: () => onReplace(a) }, 'Start a replacement')));
  });
  return col;
}

// A short line for an avatar card: what it replaced, or what replaced it.
export function lineageNote(a) {
  const was = replacedPage(a);
  if (was) return 'Replaced ' + (was.name || 'a dropped page');
  const now = replacementFor(a);
  if (now) return 'Replaced by ' + (now.name || 'a new page');
  return '';
}
