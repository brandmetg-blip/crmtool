// ============================================================================
// captions.js — the caption that goes out with a page's videos.
//
// One per kind of video, because a growth video and a product video are not
// selling the same thing and never share a caption. Both live on the page, so
// whoever posts reads them off the page rather than remembering which caption
// belonged to which avatar.
//
// Kept in its own file rather than inside a view: the posting queue, the
// builder and the sheet all have a reason to read these, and none of them
// should have to import a view to do it.
// ============================================================================

import { VIDEO_TYPES, quotaForAccount } from './stages.js';

export function captionFor(account, type) {
  const c = (account && account.captions) || {};
  return (c[type] || '').trim();
}

export function setCaption(account, type, text) {
  if (!account.captions) account.captions = {};
  account.captions[type] = text;
}

// Which captions a page actually needs: one for each kind of video it makes.
// A product-only page is not missing its growth caption — it will never post a
// growth video. A page with no mix set yet needs both, so that "done" is never
// reached by having decided nothing.
export function captionsNeeded(account) {
  const makes = VIDEO_TYPES.filter(t => quotaForAccount(account, t) > 0);
  return makes.length ? makes : VIDEO_TYPES.slice();
}

export function captionsReady(account) {
  return captionsNeeded(account).every(t => !!captionFor(account, t));
}

// The single free-text caption pages carried before there was one per type.
// Never silently folded into either of the new ones — which of the two it was
// meant to be is not knowable from here, so it is offered back instead.
export function legacyCaption(account) {
  return ((account && account.caption) || '').trim();
}
