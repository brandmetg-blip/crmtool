// ============================================================================
// captions.js — the caption that goes out with a page's videos, and where it
// comes from.
//
// A page does not usually write its own caption. The caption is a property of
// the PRODUCT: every Rosabella Moringa page posts the same words, give or take
// the one link that is theirs. So the product carries a template per video
// type, with a [caption link] placeholder, and each page fills that placeholder
// with its own caption link. Change the template once and every page on that
// product follows — which is the whole point of running a hundred pages off one
// system.
//
// A page can still override its caption when it genuinely differs; that stored
// caption wins over the template. Nothing on either → empty.
//
// Kept out of any view: the posting queue, the builder, the sheet and both
// editors all read these, and none of them should have to import a view to do
// it.
// ============================================================================

import { VIDEO_TYPES, quotaForAccount } from './stages.js';
import { productOf } from './concepts.js';

// ---------------------------------------------------------------------------
// the four LinkTwin links a page carries
// ---------------------------------------------------------------------------
// The caption link is the one captions are built around; the other three live
// here so a page keeps all four of its LinkTwin links in one place.
export const LINKTWIN_LINKS = [
  ['bio', 'Link in bio'],
  ['caption', 'Caption link'],
  ['manychatGrowth', 'ManyChat growth'],
  ['manychatProduct', 'ManyChat product'],
];

export function linktwinLink(account, key) {
  const l = (account && account.linktwin) || {};
  return (l[key] || '').trim();
}

export function setLinktwinLink(account, key, url) {
  if (!account.linktwin) account.linktwin = {};
  account.linktwin[key] = url;
}

export function linktwinComplete(account) {
  return LINKTWIN_LINKS.every(([k]) => !!linktwinLink(account, k));
}

// ---------------------------------------------------------------------------
// product templates, and resolving them for a page
// ---------------------------------------------------------------------------
export function captionTemplate(product, type) {
  const t = (product && product.captionTemplates) || {};
  return t[type] || '';
}

export function productHasTemplate(product, type) {
  return !!captionTemplate(product, type).trim();
}

// The placeholder a template leaves for the page's own caption link. Written
// [caption link] in the examples, matched loosely so [CAPTION LINK] and odd
// spacing resolve too. Global for replace; NEVER call .test() on this one — a
// global regex keeps state between calls — use `hasPlaceholder` instead.
const PLACEHOLDER_G = /\[\s*caption\s*link\s*\]/ig;
export function hasPlaceholder(text) { return /\[\s*caption\s*link\s*\]/i.test(text || ''); }

// Fill the placeholder with this page's caption link. If the link is not set
// yet the literal [caption link] is left in place, so it is visible that the
// caption is waiting on it rather than silently posting a gap.
export function resolveTemplate(template, account) {
  const link = linktwinLink(account, 'caption');
  if (!link) return template || '';
  return (template || '').replace(PLACEHOLDER_G, link);
}

// ---------------------------------------------------------------------------
// the caption a page will actually post
// ---------------------------------------------------------------------------
// Override first, then the product template, then nothing.
export function captionFor(account, type) {
  const own = captionOverride(account, type);
  if (own.trim()) return own.trim();
  const tpl = captionTemplate(productOf(account), type);
  return tpl ? resolveTemplate(tpl, account).trim() : '';
}

// The caption stored ON the page, if any — as opposed to captionFor, which
// falls through to the template. The editors need the difference to know
// whether a page is following its product or has diverged.
export function captionOverride(account, type) {
  return (((account && account.captions) || {})[type] || '');
}
export function hasOwnCaption(account, type) {
  return !!captionOverride(account, type).trim();
}

export function setCaption(account, type, text) {
  if (!account.captions) account.captions = {};
  account.captions[type] = text;
}
export function clearCaption(account, type) {
  if (account.captions) delete account.captions[type];
}

// ---------------------------------------------------------------------------
// which captions a page needs, and whether it has them
// ---------------------------------------------------------------------------
// One for each kind of video it makes. A product-only page is not missing its
// growth caption — it will never post a growth video. A page with no mix set
// yet needs both, so "done" is never reached by having decided nothing.
export function captionsNeeded(account) {
  const makes = VIDEO_TYPES.filter(t => quotaForAccount(account, t) > 0);
  return makes.length ? makes : VIDEO_TYPES.slice();
}

// Ready when every needed caption resolves to something real — non-empty and
// with no [caption link] still waiting to be filled. A template whose page has
// no caption link yet is deliberately NOT ready: it would post the placeholder.
export function captionsReady(account) {
  return captionsNeeded(account).every(t => {
    const c = captionFor(account, t);
    return !!c.trim() && !hasPlaceholder(c);
  });
}

// The single free-text caption pages carried before there was one per type.
// Never silently folded into either of the new ones — which of the two it was
// meant to be is not knowable from here, so it is offered back instead.
export function legacyCaption(account) {
  return ((account && account.caption) || '').trim();
}
