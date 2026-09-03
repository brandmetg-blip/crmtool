// accounts.js — the avatars. Every account is one avatar/persona posting on
// Facebook + Instagram. Admins and managers create and edit them; everyone
// else sees the ones assigned to them, read-only.
//
// Profiles (the named FB/IG identities an avatar posts from) are managed here
// too, because they only ever exist to be attached to an avatar.

import { state, emit, forceEmit, uid, byId, can, myAccounts } from '../state.js';
import { el, avatar, nameColor } from '../ui.js';
import {
  sortedConcepts, conceptsForAccount, discoverLegacyConcepts, productOf,
  bodyRow, setConceptLink, setVariationLink, pruneBodyLinks,
} from '../concepts.js';
import { sortedStages, stageOf, stageColor, VIDEO_TYPES, quotaForAccount, quotaSummaryFor } from '../stages.js';
import {
  captionFor, captionOverride, hasOwnCaption, setCaption, clearCaption,
  captionsNeeded, legacyCaption, captionTemplate, hasPlaceholder,
  LINKTWIN_LINKS, linktwinLink, setLinktwinLink, linktwinComplete,
} from '../captions.js';
import { LIFECYCLE, lifecycleOf, lifecycleLabel, lifecycleDef, isLive, inRoster, isDropped, pageStats } from '../lifecycle.js';
import { renderRoster, lineageNote } from './roster.js';
import { renderSheet, openColumns } from './sheet.js';
import { onboardingPages, startNewPage } from './onboarding.js';

// [stored id, tone, what a person reads]
const STATUSES = LIFECYCLE.map(l => [l.id, l.tone, l.label]);

// What kind of video a page makes. Not a judgement — a production type, so
// everyone knows what they are making before they open anything.
export const QUALITY = [
  ['high', 'High quality', '#34e08a'],
  ['low', 'Low quality', '#f0b341'],
];

export function qualityOf(a) {
  return QUALITY.find(q => q[0] === (a && a.quality)) || null;
}

// The tint goes on the card; the chip says it in words, so the meaning never
// rests on colour alone.
export function qualityClass(a) {
  const q = qualityOf(a);
  return q ? ' q-' + q[0] : '';
}

// A compact mark for use beside a name, where a full chip would crowd the row
// and a background wash would collide with what the card's surface means.
export function qualityBadge(a) {
  const q = qualityOf(a);
  if (!q) return null;
  return el('span', {
    class: 'qbadge', title: q[1] + ' videos',
    style: 'color:' + q[2] + ';background:' + q[2] + '22;box-shadow:inset 0 0 0 1px ' + q[2] + '66',
  }, q[1].charAt(0));
}

export function qualityChip(a) {
  const q = qualityOf(a);
  if (!q) return null;
  return el('span', {
    class: 'chip', title: q[1] + ' videos',
    style: 'color:' + q[2] + ';background:' + q[2] + '1f;border-color:' + q[2] + '55',
  }, q[1]);
}

// Who the page's audience is set to. Broad is muted rather than absent: a page
// deliberately set to Broad reads differently from one nobody has decided on
// yet, and the person who chose it wants to see the choice land. The narrower
// two are loud, because those are the ones a video can get wrong.
export const TARGETING = [
  ['broad', 'Broad', '#8b8b93'],
  ['us', 'US only', '#5bd5ef'],
  ['restricted', 'Restricted', '#f0958e'],
];

export function targetingOf(a) {
  return TARGETING.find(t => t[0] === (a && a.targeting)) || null;
}

// Shown for any page whose targeting has been decided — including Broad. Only a
// page still left unset (no choice made) gets no chip.
export function targetingChip(a) {
  const t = targetingOf(a);
  if (!t) return null;
  const note = (a.targetingNote || '').trim();
  return el('span', {
    class: 'chip', title: note || t[1],
    style: 'color:' + t[2] + ';background:' + t[2] + '1f;border-color:' + t[2] + '55',
  }, t[1]);
}

// ---------------------------------------------------------------------------
// caption fields — one UI, used in the avatar editor and the onboarding step
// ---------------------------------------------------------------------------
// A page usually follows its product's caption template; where it does, the
// caption is shown resolved and read-only, with one click to break away and
// write its own. Where it has broken away, or its product has no template, it
// is a plain editable field with a way back to the product default.
//
// `onMutate(fn)` applies fn to the account and persists it however the caller
// persists (the editor mutates a copy and saves on Save; onboarding writes
// live). Rebuilding the block on structural changes is handled here, so a
// caller only has to say how to store a change.
export function captionFieldsInto(container, account, onMutate) {
  container.innerHTML = '';
  const rebuild = () => captionFieldsInto(container, account, onMutate);
  const needed = captionsNeeded(account);
  const product = productOf(account);

  VIDEO_TYPES.forEach(t => {
    const wanted = needed.includes(t);
    const tpl = captionTemplate(product, t);
    const col = el('div', { class: 'col', style: 'gap:4px' });
    col.appendChild(el('div', { class: 'row wrap', style: 'gap:7px' },
      el('span', { class: 'label' }, t.toUpperCase() + ' VIDEO CAPTION'),
      wanted ? null : el('span', { class: 'hint' }, 'not needed — this page makes none')));

    if (tpl.trim() && !hasOwnCaption(account, t)) {
      // following the product template — a live, read-only preview
      const resolved = captionFor(account, t);
      const pending = hasPlaceholder(resolved);
      col.appendChild(el('div', {
        class: 'ro-text', style: 'white-space:pre-wrap;font-size:12px;line-height:1.5'
      }, resolved || '—'));
      col.appendChild(el('div', { class: 'row wrap', style: 'gap:8px' },
        el('span', { class: 'hint', style: 'flex:1;min-width:150px' },
          pending
            ? 'Add the caption link above and this fills itself.'
            : 'From the ' + (product ? product.name : 'product') + ' template — edit it under Products to change every page.'),
        el('button', {
          class: 'btn small',
          onclick: () => { onMutate(x => setCaption(x, t, resolved)); rebuild(); }
        }, 'Customise for this page')));
    } else {
      // its own caption, or a product with no template for this type
      col.appendChild(el('textarea', {
        class: 'input', style: 'min-height:52px;font-size:12.5px',
        placeholder: 'The caption posted with this page’s ' + t.toLowerCase() + ' videos…',
        oninput: e => onMutate(x => setCaption(x, t, e.target.value)),
      }, captionOverride(account, t)));
      if (tpl.trim()) {
        col.appendChild(el('div', { class: 'row wrap', style: 'gap:8px' },
          el('span', { class: 'hint', style: 'flex:1;min-width:150px' }, 'Customised — not following the product.'),
          el('button', {
            class: 'btn small',
            onclick: () => { onMutate(x => clearCaption(x, t)); rebuild(); }
          }, 'Use ' + (product ? product.name : 'product') + ' default')));
      }
    }
    container.appendChild(col);
  });

  // the single caption pages carried before there was one per type — offered
  // back rather than guessed at, and only where nothing else has filled in
  const old = legacyCaption(account);
  if (old && !hasOwnCaption(account, 'Product') && !hasOwnCaption(account, 'Growth')
    && !captionTemplate(product, 'Product').trim() && !captionTemplate(product, 'Growth').trim()) {
    container.appendChild(el('div', { class: 'row wrap', style: 'gap:8px' },
      el('span', { class: 'hint', style: 'flex:1;min-width:150px' }, 'Earlier caption on this page: “' + old + '”'),
      VIDEO_TYPES.map(t => el('button', {
        class: 'btn small',
        onclick: () => { onMutate(x => setCaption(x, t, old)); rebuild(); }
      }, 'Use as ' + t.toLowerCase()))));
  }
}

// The four LinkTwin links, as an editable block. Same onMutate contract.
// `afterCaptionLink` fires when the caption link changes, so a caller can
// refresh the captions that are built around it.
export function linktwinFieldsInto(container, account, onMutate, afterCaptionLink) {
  container.innerHTML = '';
  LINKTWIN_LINKS.forEach(([k, label]) => {
    container.appendChild(el('div', { class: 'col', style: 'gap:3px' },
      el('span', { class: 'label' }, label.toUpperCase()),
      el('input', {
        class: 'input', style: 'height:30px;font-size:12px',
        value: linktwinLink(account, k), placeholder: label + ' URL…',
        oninput: e => {
          onMutate(x => {
            setLinktwinLink(x, k, e.target.value);
            // the sheet's "Link created" tick means exactly "the LinkTwin links
            // exist", so keep it in step with the four fields
            x.linkCreated = linktwinComplete(x);
          });
          if (k === 'caption' && afterCaptionLink) afterCaptionLink();
        },
      })));
  });
}

export function renderAccounts(root) {
  const u = state.user;
  const canEdit = can.editAccounts(u);
  // This is the account centre: finished pages only. A page still working
  // through its setup checklist lives in Onboarding until it is submitted, so
  // nothing half-built ever turns up here looking ready.
  const all = myAccounts(u, state.db).filter(a => !a.onboarding);

  // Two buckets. The pages you run — posting or still being created — belong
  // together, because that is the number you manage against. Everything out of
  // play is one click away and never deleted.
  const buckets = {
    roster: all.filter(inRoster),
    archive: all.filter(a => !inRoster(a)),
  };
  // old saved values from when live and setting up were separate tabs
  const view = buckets[state.acctView] ? state.acctView : 'roster';

  const asSheet = state.acctLayout === 'sheet';

  const liveCount = buckets.roster.filter(isLive).length;
  root.appendChild(head(canEdit, liveCount, buckets.roster.length - liveCount));
  if (view === 'roster' && !asSheet) {
    renderRoster(root, all, canEdit, startReplacement, onboardingPages(state.db));
  }
  root.appendChild(filters(all, buckets, view, asSheet, canEdit));

  const shown = buckets[view]
    .filter(a => state.acctProfile === 'all' || a.facebookProfileId === state.acctProfile)
    .filter(a => matchesProduct(a, state.acctProduct))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (!shown.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      buckets[view].length ? 'No pages match these filters.' : emptyFor(view, canEdit)));
    return;
  }
  if (asSheet) renderSheet(root, shown, canEdit);
  else root.appendChild(view === 'archive' ? archiveCards(shown, canEdit) : groupedCards(shown, canEdit));
}

function emptyFor(view, canEdit) {
  if (view === 'archive') return 'Nothing archived yet. Pages you pause or drop are kept here.';
  return canEdit ? 'No pages yet — add the first one.' : 'No pages assigned to you yet — ask an admin.';
}

// ---------------------------------------------------------------------------
// the archive — every page that is no longer running, and why
// ---------------------------------------------------------------------------
// Dropping a page never deletes it. This is the record: what it was, how it
// did, when it was dropped and why, and what took its place.
function archiveCards(shown, canEdit) {
  const order = ['Reposting', 'Paused', 'Stopped', 'Banned'];
  const wrap = el('div', { class: 'col', style: 'gap:22px' });

  order.forEach(key => {
    const mine = shown.filter(a => lifecycleOf(a) === key);
    if (!mine.length) return;
    const def = LIFECYCLE.find(l => l.id === key);
    wrap.appendChild(el('div', null,
      el('div', { class: 'group-head' },
        el('span', { class: 'group-dot', style: 'background:var(--' + (def.tone === 'gray' ? 'dim' : def.tone === 'red' ? 'red' : def.tone === 'violet' ? 'violet' : 'amber') + ')' }),
        el('b', { style: 'font-size:13.5px' }, def.label),
        el('span', { class: 'hint' }, mine.length + (mine.length === 1 ? ' page' : ' pages')),
        el('span', { class: 'spacer' }),
        el('span', { class: 'hint' }, def.note)),
      // headed by why the page left, but still ordered product by product
      el('div', { class: 'grid' },
        byProduct(mine).flatMap(g => g.accounts).map(a => archiveCard(a, canEdit)))));
  });
  return wrap;
}

function archiveCard(a, canEdit) {
  const s = pageStats(a);
  const dropped = a.droppedAt ? new Date(a.droppedAt).toISOString().slice(0, 10) : null;
  const line = [
    s.days != null ? s.days + ' days' : null,
    s.posted + ' posted',
    s.wins ? s.wins + ' winner' + (s.wins === 1 ? '' : 's') : 'no winners',
  ].filter(Boolean).join(' · ');

  const box = el('div', {
    class: 'card col retired', style: 'gap:10px' + (canEdit ? ';cursor:pointer' : ''),
    onclick: canEdit ? () => openAccount(a) : null,
  },
    el('div', { class: 'row' },
      avatar(a, 40),
      el('b', { style: 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, a.name || 'Untitled'),
      lifecycleChip(a)),
    el('div', { class: 'hint' }, line + (dropped ? ' · dropped ' + dropped : '')));

  if ((a.dropReason || '').trim()) {
    box.appendChild(el('div', { class: 'ro-text', style: 'font-size:12px' }, a.dropReason.trim()));
  }
  const lineage = lineageNote(a);
  if (lineage) box.appendChild(el('span', { class: 'chip violet', style: 'align-self:flex-start' }, lineage));
  box.appendChild(el('div', { class: 'row wrap', style: 'gap:6px' }, productChip(a), stageOnlyChip(a)));
  return box;
}

// Laid out under a heading per product by default, so which pages belong to
// which product is obvious without touching a filter. Falls back to one plain
// grid when no products exist, rather than a lone "No product" heading.
function groupedCards(shown, canEdit) {
  const grid = list => el('div', { class: 'grid' }, list.map(a => card(a, canEdit)));
  const groups = byProduct(shown);
  if (!groups.some(g => g.product)) return grid(shown);

  return el('div', { class: 'col', style: 'gap:22px' }, groups.map(g => {
    const c = g.product ? productColor(g.product) : 'var(--dim)';
    const n = g.accounts.length;
    // read through the lifecycle, never a raw status string — a page saved as
    // "Live" is not the literal "Active" this used to compare against, so the
    // chip read "0 active" for a group where every page was posting
    const posting = g.accounts.filter(isLive).length;
    return el('div', null,
      el('div', { class: 'group-head' },
        el('span', { class: 'group-dot', style: 'background:' + c }),
        el('b', { style: 'font-size:13.5px;color:' + c }, g.product ? g.product.name : 'No product'),
        el('span', { class: 'hint' }, n + (n === 1 ? ' avatar' : ' avatars')),
        el('span', { class: 'spacer' }),
        posting < n ? el('span', { class: 'chip gray' }, posting + ' of ' + n + ' posting') : null),
      grid(g.accounts));
  }));
}

function head(canEdit, liveCount, buildingCount) {
  const spacer = el('span', { class: 'spacer' });
  // the roster is both together — a page being set up is already one of yours
  const total = liveCount + buildingCount;
  const wrap = el('div', { class: 'page-head' },
    el('div', null, el('h1', null, 'Avatars'),
      el('div', { class: 'sub' }, total + (total === 1 ? ' page' : ' pages') + ' — '
        + liveCount + ' live' + (buildingCount ? ', ' + buildingCount + ' setting up' : ''))),
    spacer);
  // async so it lands after the buttons below are appended — anchor on the
  // spacer so the pill sits to their left either way
  import('../app.js').then(({ statusPill }) => wrap.insertBefore(statusPill(), spacer.nextSibling));
  if (canEdit) {
    wrap.appendChild(el('button', { class: 'btn', onclick: openConcepts }, 'Concepts'));
    wrap.appendChild(el('button', { class: 'btn', onclick: openProducts }, 'Products'));
    wrap.appendChild(el('button', { class: 'btn', onclick: openProfiles }, 'Profiles'));
    // A new page starts in the pipeline, not here — this tab is the finished
    // ones. For anyone without the onboarding tab, the old direct-add stands.
    wrap.appendChild(can.seeOnboarding(state.user)
      ? el('button', { class: 'btn primary', onclick: () => startNewPage() }, '+ New page')
      : el('button', { class: 'btn primary', onclick: () => openAccount(null) }, '+ New avatar'));
  }
  return wrap;
}

// 'all' | 'none' (no product, or one since deleted) | a product id
function matchesProduct(a, pid) {
  if (!pid || pid === 'all') return true;
  if (pid === 'none') return !byId(state.db.products, a.productId);
  return a.productId === pid;
}

// The counts here describe the bucket you are looking at, not the whole
// workspace: "Moringa (4)" beside a Pages view that then shows two of them is
// a number nobody can act on.
function filters(all, buckets, view, asSheet, canEdit) {
  const inView = buckets[view];
  const fbProfiles = state.db.profiles.filter(p => p.platform === 'facebook');
  const products = state.db.products.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const row = el('div', { class: 'row wrap', style: 'margin-bottom:16px' },
    el('div', { class: 'seg' }, [['roster', 'Pages'], ['archive', 'Archive']].map(([k, label]) =>
      el('button', {
        class: view === k ? 'on' : '',
        onclick: () => { state.acctView = k; forceEmit(); }
      }, label, buckets[k].length ? el('span', { class: 'seg-count' }, String(buckets[k].length)) : null))));

  if (products.length) {
    const noneCount = inView.filter(a => !byId(state.db.products, a.productId)).length;
    const sel = el('select', {
      class: 'input', style: 'width:auto;min-width:170px',
      onchange: e => { state.acctProduct = e.target.value; forceEmit(); }
    },
      [el('option', { value: 'all' }, 'Any product (' + inView.length + ')')]
        .concat(products.map(p => {
          const n = inView.filter(a => a.productId === p.id).length;
          return el('option', { value: p.id }, p.name + ' (' + n + ')');
        }))
        .concat(noneCount ? [el('option', { value: 'none' }, 'No product (' + noneCount + ')')] : []));
    sel.value = state.acctProduct || 'all';
    row.appendChild(sel);
  }

  if (fbProfiles.length) {
    const sel = el('select', {
      class: 'input', style: 'width:auto;min-width:190px',
      onchange: e => { state.acctProfile = e.target.value; forceEmit(); }
    },
      [el('option', { value: 'all' }, 'All Facebook profiles')].concat(fbProfiles.map(p => {
        const n = inView.filter(a => a.facebookProfileId === p.id).length;
        return el('option', { value: p.id }, p.name + ' (' + n + ')');
      })));
    sel.value = state.acctProfile;
    row.appendChild(sel);
  }

  // cards to work from, sheet to see everything at once
  row.appendChild(el('span', { class: 'spacer' }));
  // the columns belong next to the thing they are columns of
  if (asSheet && canEdit) {
    row.appendChild(el('button', { class: 'btn small', onclick: openColumns }, 'Columns'));
  }
  row.appendChild(el('div', { class: 'seg blue' }, [['cards', 'Cards'], ['sheet', 'Sheet']].map(([k, label]) =>
    el('button', {
      class: (asSheet ? 'sheet' : 'cards') === k ? 'on' : '',
      onclick: () => { state.acctLayout = k; forceEmit(); }
    }, label))));

  const filtered = (state.acctProduct && state.acctProduct !== 'all') || state.acctProfile !== 'all';
  if (filtered) {
    row.appendChild(el('button', {
      class: 'btn small',
      onclick: () => { state.acctProduct = 'all'; state.acctProfile = 'all'; forceEmit(); }
    }, 'Clear filters'));
  }
  return row;
}

function card(a, canEdit) {
  // Read through lifecycleOf, never a raw lookup: a page still carrying a
  // legacy status ("Active") is not in this list and would fall through to the
  // first entry, labelling every live page as Building.
  const st = [lifecycleLabel(a), lifecycleDef(a).tone];
  const fb = byId(state.db.profiles, a.facebookProfileId);
  const ig = byId(state.db.profiles, a.instagramProfileId);

  const c = el('div', {
    class: 'card col' + qualityClass(a) + (canEdit ? ' click' : ''), style: 'gap:12px',
    onclick: canEdit ? () => openAccount(a) : null,
  },
    el('div', { class: 'row' },
      avatar(a, 44),
      el('b', { style: 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, a.name || 'Untitled'),
      lifecycleChip(a)),

    // no product chip here — the group heading above already says it
    el('div', { class: 'row wrap', style: 'gap:6px' },
      stageOnlyChip(a),
      qualityChip(a),
      targetingChip(a),
      handleChip('facebook', a.platforms && a.platforms.facebook, fb),
      handleChip('instagram', a.platforms && a.platforms.instagram, ig)));

  if ((a.notes || '').trim()) {
    c.appendChild(el('div', { class: 'hint', style: 'white-space:pre-wrap;border-top:1px solid var(--line);padding-top:9px' },
      a.notes.trim().slice(0, 140) + (a.notes.trim().length > 140 ? '…' : '')));
  }
  return c;
}

// Colours a product can wear. Fixed set rather than a free colour picker:
// every one of these is legible on the dark surface, and the label always
// carries the product NAME too, so identity never rests on colour alone.
export const PRODUCT_COLORS = [
  '#34e08a', '#5b8def', '#9a7bff', '#f0b341', '#e879b9',
  '#5bd5ef', '#f97b5a', '#6ee7b7', '#f0584e', '#8b8b93',
];

export function productColor(p) {
  if (!p) return '';
  return p.color || nameColor(p.name || '');   // deterministic default until one is picked
}

// Whether the page is in play: Live, Building, Paused, Reposting, Stopped,
// Banned. Always shown on the Avatars tab, because "is this page running" is a
// different question from "how far along is it" and both need answering.
export function lifecycleChip(a) {
  const def = lifecycleDef(a);
  return el('span', { class: 'chip ' + def.tone, title: def.note }, lifecycleLabel(a));
}

// A small marker on the stage chip for a page whose mix is pinned rather than
// inherited — the one visual cue that this page is not doing what its stage
// says every other page at that stage does. Its own tooltip carries the
// numbers, so the stage chip's tooltip can stay the stage's goal text.
function mixDot(a) {
  if (!a.quotaOverride) return null;
  return el('span', {
    class: 'mix-dot',
    title: 'Pinned for this page: ' + quotaSummaryFor(a) + ' — overrides its stage.',
  });
}

// The stage alone, never standing in for the lifecycle — used where a
// lifecycle chip sits beside it.
export function stageOnlyChip(a) {
  const s = stageOf(a);
  if (!s) {
    return a.quotaOverride
      ? el('span', { class: 'chip violet' }, 'Custom mix', mixDot(a))
      : el('span', { class: 'chip gray' }, 'No stage');
  }
  const c = stageColor(s);
  return el('span', {
    class: 'chip', title: (s.goal || '').trim() || s.name,
    style: 'color:' + c + ';background:' + c + '1f;border-color:' + c + '55',
  }, s.name, mixDot(a));
}

// The stage a page is at, in the stage's own colour. Where a page is not
// working, this says so instead — used where only one chip is shown.
export function stageChip(a) {
  // Anything not taking new videos says so instead — where a page sits in the
  // funnel stops mattering once it is out of the roster.
  const def = lifecycleDef(a);
  if (!def.work) return el('span', { class: 'chip ' + def.tone }, lifecycleLabel(a));
  const s = stageOf(a);
  if (!s) {
    return a.quotaOverride
      ? el('span', { class: 'chip violet' }, 'Custom mix', mixDot(a))
      : el('span', { class: 'chip gray' }, 'No stage');
  }
  const c = stageColor(s);
  return el('span', {
    class: 'chip', title: (s.goal || '').trim() || s.name,
    style: 'color:' + c + ';background:' + c + '1f;border-color:' + c + '55',
  }, s.name, mixDot(a));
}

// ---------------------------------------------------------------------------
// Avatars grouped by what they promote: products A-Z, avatars A-Z inside each,
// and anything with no product — or one that has since been deleted — last.
//
// Every list of avatars in the app orders itself through this, so the roster
// reads the same way wherever you meet it. A flat A-Z list makes you hold the
// products in your head; grouped, the shape of the roster is just visible.
export function byProduct(list) {
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
  const all = (list || []).slice();
  const groups = [];

  state.db.products.slice().sort(byName).forEach(p => {
    const mine = all.filter(a => a.productId === p.id).sort(byName);
    if (mine.length) groups.push({ product: p, accounts: mine });
  });

  const orphans = all.filter(a => !byId(state.db.products, a.productId)).sort(byName);
  if (orphans.length) groups.push({ product: null, accounts: orphans });

  return groups;
}

export function productChip(a) {
  const p = byId(state.db.products, a && a.productId);
  if (!p) return null;
  const c = productColor(p);
  return el('span', {
    class: 'chip', title: 'Promotes ' + p.name,
    style: 'color:' + c + ';background:' + c + '1f;border-color:' + c + '55',
  }, p.imageUrl ? el('img', { class: 'prod-ico', src: p.imageUrl, alt: '' }) : null, p.name);
}

function handleChip(platform, handle, profile) {
  if (!handle && !profile) return null;
  const label = handle ? '@' + String(handle).replace(/^@/, '') : profile.name;
  return el('span', {
    class: 'chip ' + (platform === 'facebook' ? 'blue' : 'pink'),
    title: profile ? profile.name : '',
  }, platform === 'facebook' ? 'FB' : 'IG', label);
}

// ---------------------------------------------------------------------------
// account editor
// ---------------------------------------------------------------------------
function closeModal() { state.modal = null; forceEmit(); }

// Starting a replacement carries over what the new page inherits from the old —
// the product it promotes and the stage it starts at — and records the link, so
// the roster reads as a chain rather than a pile of unrelated pages.
function startReplacement(old) {
  const seed = {
    replacesId: old.id,
    productId: old.productId || '',
    stageId: (sortedStages()[0] || {}).id || '',
    status: 'Building',
  };
  // a replacement is a new page like any other: it goes through the pipeline
  if (can.seeOnboarding(state.user)) startNewPage(seed);
  else openAccount(null, seed);
}

export function openAccount(existing, seed) {
  // Edit a COPY. Nothing is written until Save, so an abandoned modal can't
  // half-write a record, and a live update from someone else can't be
  // scribbled over by a form the user never submitted.
  const a = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
      // 'Live' is what this status is called now; writing the old 'Active'
      // relied on the legacy map to translate it back on every read
      id: uid('a'), name: '', status: 'Live', phase: 'P1',
      productId: '',
      platforms: { facebook: '', instagram: '' },
      facebookProfileId: '', instagramProfileId: '',
      stageId: '', quality: '', quotaOverride: null, targeting: '', targetingNote: '',
      replacesId: '', wentLiveAt: null, droppedAt: null, dropReason: '',
      metaBusinessSuiteUrl: '', avatarUrl: '', coverUrl: '', baseImageLink: '', bodyLinks: [],
      linktwin: {}, captions: {}, notes: '', createdAt: Date.now(),
    };
  if (seed) Object.assign(a, seed);
  if (!a.platforms) a.platforms = { facebook: '', instagram: '' };
  if (!a.linktwin) a.linktwin = {};                    // added with the LinkTwin links
  if (!a.captions) a.captions = {};
  if (!Array.isArray(a.bodyLinks)) a.bodyLinks = [];   // added after the first avatars existed

  const body = el('div', { class: 'modal-body' });

  // avatar + name
  const pic = el('div', { class: 'row', style: 'gap:14px' });
  const picHolder = el('div', null, avatar(a, 60));
  const fileIn = el('input', {
    type: 'file', accept: 'image/*', style: 'display:none',
    onchange: async e => {
      const file = e.target.files && e.target.files[0]; if (!file) return;
      const btn = pic.querySelector('.upl');
      if (btn) btn.textContent = 'Uploading…';
      try {
        const { store } = await import('../app.js');
        a.avatarUrl = await store.uploadImage(file);
        picHolder.innerHTML = ''; picHolder.appendChild(avatar(a, 60));
      } catch (err) {
        alert('Image upload failed — try again.\n' + (err.message || ''));
      }
      if (btn) btn.textContent = 'Upload photo';
    }
  });
  pic.appendChild(picHolder);
  pic.appendChild(el('div', { class: 'col', style: 'gap:6px;flex:1' },
    el('label', { class: 'btn small upl', style: 'cursor:pointer;align-self:flex-start' }, 'Upload photo', fileIn),
    a.avatarUrl && el('button', {
      class: 'btn small danger', style: 'align-self:flex-start',
      onclick: () => { a.avatarUrl = ''; picHolder.innerHTML = ''; picHolder.appendChild(avatar(a, 60)); }
    }, 'Remove photo')));
  body.appendChild(pic);

  body.appendChild(field('NAME', el('input', {
    class: 'input', value: a.name, placeholder: 'e.g. Sarah — Wellness',
    oninput: e => a.name = e.target.value
  })));

  // the banner across the top of the page — set during onboarding, editable
  // here for as long as the page runs
  const coverBox = el('div', { class: 'ob-cover' });
  const paintCover = () => {
    coverBox.innerHTML = '';
    coverBox.appendChild(a.coverUrl
      ? el('img', { src: a.coverUrl, alt: '' })
      : el('span', { class: 'hint', style: 'font-size:9.5px' }, 'none yet'));
  };
  paintCover();
  const coverIn = el('input', {
    type: 'file', accept: 'image/*', style: 'display:none',
    onchange: async e => {
      const file = e.target.files && e.target.files[0]; if (!file) return;
      try {
        const { store } = await import('../app.js');
        a.coverUrl = await store.uploadImage(file);
        paintCover();
      } catch (err) { alert('Image upload failed — try again.\n' + (err.message || '')); }
      e.target.value = '';
    }
  });
  body.appendChild(el('div', { class: 'col', style: 'gap:6px' },
    el('span', { class: 'label' }, 'COVER PHOTO'),
    el('div', { class: 'row wrap', style: 'gap:10px' },
      coverBox,
      el('label', { class: 'btn small', style: 'cursor:pointer' }, 'Upload', coverIn),
      a.coverUrl ? el('button', {
        class: 'btn small danger', onclick: () => { a.coverUrl = ''; paintCover(); }
      }, 'Remove') : null)));

  // what kind of video this page makes — tints its card so it reads at a glance
  body.appendChild(el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, 'VIDEO QUALITY'),
    select([['', 'Not set']].concat(QUALITY.map(q => [q[0], q[1]])), a.quality || '', v => a.quality = v),
    el('span', { class: 'hint' },
      'Tints this page’s card so you and the editors can tell at a glance what kind of videos it makes.')));

  // who the page is set to reach — quiet by default, since most pages are
  // broad; it only needs saying where it is not
  const targetNoteRow = el('div', { class: 'col', style: 'gap:5px' });
  const paintTargetNote = () => {
    targetNoteRow.innerHTML = '';
    // Broad has nothing to restrict, and unset has nothing decided — the note
    // only belongs to the two that narrow the audience.
    if (a.targeting !== 'us' && a.targeting !== 'restricted') return;
    targetNoteRow.appendChild(el('span', { class: 'label' },
      a.targeting === 'us' ? 'NOTE (OPTIONAL)' : 'WHAT IS RESTRICTED'));
    targetNoteRow.appendChild(el('input', {
      class: 'input', value: a.targetingNote || '',
      placeholder: a.targeting === 'us' ? 'e.g. English captions only' : 'e.g. no EU, no UK',
      oninput: e => a.targetingNote = e.target.value,
    }));
  };
  body.appendChild(el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, 'TARGETING'),
    // Broad is an explicit choice, not the absence of one — otherwise a page
    // nobody has thought about looks identical to one deliberately left open,
    // and onboarding could never tell whether the question had been answered.
    select([['', 'Not set']].concat(TARGETING.map(t => [t[0], t[1]])), a.targeting || '',
      v => { a.targeting = v; paintTargetNote(); }),
    el('span', { class: 'hint' }, 'Every choice shows as a chip wherever this page is listed — Broad quietly, the narrower two loudly.')));
  body.appendChild(targetNoteRow);
  paintTargetNote();

  // what this avatar promotes
  body.appendChild(el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, 'PRODUCT'),
    productSelect(a.productId, v => a.productId = v),
    el('span', { class: 'hint' }, 'Shown beside the avatar when mass adding, so you can tell at a glance what each one is promoting.')));

  // where the page is in its life, and whether it is still in play
  const stageNote = el('div', { class: 'hint' });
  const paintStageNote = () => {
    const s = byId(state.db.stages, a.stageId);
    stageNote.textContent = s && (s.goal || '').trim()
      ? 'At this stage: ' + s.goal.trim()
      : (s ? 'This stage has no instructions yet — add them under Settings.' : '');
  };

  // How many videos of each type THIS page makes a day. Every page at a stage
  // shares that stage's mix by default — that is the point of stages — but a
  // real roster is not that uniform: one page tests product-only while the
  // rest of "Growing" still gets both. Pinning a mix here is the exception,
  // scoped to this one page; the stage itself, and every other page at it,
  // is untouched.
  const mixWrap = el('div', { class: 'col', style: 'gap:8px' });
  const paintMix = () => {
    mixWrap.innerHTML = '';
    const custom = !!a.quotaOverride;
    mixWrap.appendChild(el('div', { class: 'row wrap', style: 'gap:9px' },
      el('span', { class: 'label' }, 'VIDEOS PER DAY'),
      el('div', { class: 'seg mini' }, [['stage', 'Stage default'], ['custom', 'Custom for this page']].map(([k, label]) =>
        el('button', {
          class: (custom ? 'custom' : 'stage') === k ? 'on' : '',
          onclick: () => {
            if (k === 'custom' && !a.quotaOverride) {
              // start from what this page currently gets, not from zero —
              // switching the toggle should not itself change any behaviour
              const seed = {};
              VIDEO_TYPES.forEach(t => seed[t] = quotaForAccount(a, t));
              a.quotaOverride = seed;
            } else if (k === 'stage') {
              a.quotaOverride = null;
            }
            paintMix();
          }
        }, label)))));

    if (!custom) {
      mixWrap.appendChild(el('span', { class: 'hint' },
        a.stageId
          ? 'Follows ' + ((byId(state.db.stages, a.stageId) || {}).name || 'its stage') + ': ' + quotaSummaryFor(a) + '.'
          : 'No stage set, so nothing is planned for this page yet — pick a stage above, or pin a mix below.'));
      return;
    }

    mixWrap.appendChild(el('div', { class: 'row wrap', style: 'gap:14px' }, VIDEO_TYPES.map(t => {
      const n = a.quotaOverride[t] || 0;
      const bump = by => { a.quotaOverride[t] = Math.max(0, Math.min(20, (a.quotaOverride[t] || 0) + by)); paintMix(); };
      return el('div', { class: 'row', style: 'gap:7px' },
        el('span', {
          style: 'font-size:12.5px;font-weight:700;min-width:62px;color:'
            + (n ? (t === 'Growth' ? 'var(--blue)' : 'var(--green)') : 'var(--dim)')
        }, t),
        el('button', { class: 'iconbtn', title: 'One fewer', onclick: () => bump(-1) }, '−'),
        el('input', {
          class: 'input', type: 'number', min: '0', max: '20', value: String(n),
          style: 'width:62px;height:30px;text-align:center;font-weight:800',
          onchange: e => { a.quotaOverride[t] = Math.max(0, Math.min(20, Math.round(+e.target.value || 0))); paintMix(); }
        }),
        el('button', { class: 'iconbtn', title: 'One more', onclick: () => bump(1) }, '+'));
    })));
    mixWrap.appendChild(el('span', { class: 'hint' },
      quotaSummaryFor(a) + ' — pinned to this page, overriding '
      + (a.stageId ? ((byId(state.db.stages, a.stageId) || {}).name || 'its stage') : 'no stage') + '.'));
  };

  const stageSel = sortedStages().length
    ? select([['', 'No stage set']].concat(sortedStages().map(s => [s.id, s.name])), a.stageId || '',
        v => { a.stageId = v; paintStageNote(); paintMix(); })
    : el('span', { class: 'hint' }, 'No stages defined yet — add them under Settings.');
  paintStageNote();
  paintMix();

  const lifeNote = el('div', { class: 'hint' });
  const reasonWrap = el('div', { class: 'col', style: 'gap:5px' });
  const paintLife = () => {
    const def = lifecycleDef(a);
    lifeNote.textContent = def.note;
    reasonWrap.innerHTML = '';
    if (isDropped(a)) {
      reasonWrap.appendChild(el('span', { class: 'label' }, 'WHY IT WAS DROPPED'));
      reasonWrap.appendChild(el('input', {
        class: 'input', value: a.dropReason || '',
        placeholder: 'e.g. 6 weeks, nothing over 2k views',
        oninput: e => a.dropReason = e.target.value,
      }));
      const s = pageStats(a);
      reasonWrap.appendChild(el('span', { class: 'hint' },
        'Kept on record: ' + (s.days != null ? s.days + ' days live · ' : '')
        + s.posted + ' posted · ' + s.wins + ' winner' + (s.wins === 1 ? '' : 's') + '.'));
    }
  };

  body.appendChild(el('div', { class: 'row wrap', style: 'gap:16px;align-items:flex-end' },
    field('LIFECYCLE', select(STATUSES.map(s => [s[0], s[2]]), lifecycleOf(a),
      v => {
        // starting to post is when the clock for reviews should begin
        if (v === 'Live' && !isLive(a) && !a.wentLiveAt) a.wentLiveAt = Date.now();
        if (['Reposting', 'Stopped', 'Banned'].includes(v) && !isDropped(a)) {
          a.droppedAt = Date.now(); a.dropKind = v;
        }
        a.status = v; paintLife();
      })),
    field('STAGE', stageSel)));
  body.appendChild(lifeNote);
  paintLife();
  body.appendChild(reasonWrap);
  body.appendChild(stageNote);
  body.appendChild(mixWrap);

  // What goes out with this page's videos, following its product by default.
  // Declared before the links so the caption-link field can refresh it.
  const capWrap = el('div', { class: 'col', style: 'gap:9px' });
  const repaintCaps = () => captionFieldsInto(capWrap, a, fn => fn(a));

  // The four LinkTwin links. The caption link among them is what every caption
  // is built around, so it stays editable here after the page has graduated.
  body.appendChild(el('span', { class: 'label' }, 'LINKTWIN LINKS'));
  const ltWrap = el('div', { class: 'col', style: 'gap:8px' });
  linktwinFieldsInto(ltWrap, a, fn => fn(a), repaintCaps);
  body.appendChild(ltWrap);

  body.appendChild(el('span', { class: 'label' }, 'CAPTIONS'));
  repaintCaps();
  body.appendChild(capWrap);

  // what this page replaced, or what replaced it
  const lineage = lineageNote(a);
  if (lineage) body.appendChild(el('span', { class: 'chip violet', style: 'align-self:flex-start' }, lineage));

  // platforms
  body.appendChild(el('span', { class: 'label' }, 'FACEBOOK'));
  body.appendChild(el('div', { class: 'row wrap', style: 'gap:10px' },
    el('input', {
      class: 'input', style: 'flex:1;min-width:150px', value: a.platforms.facebook || '', placeholder: 'Page handle',
      oninput: e => a.platforms.facebook = e.target.value
    }),
    profileSelect('facebook', a.facebookProfileId, v => a.facebookProfileId = v)));

  body.appendChild(el('span', { class: 'label' }, 'INSTAGRAM'));
  body.appendChild(el('div', { class: 'row wrap', style: 'gap:10px' },
    el('input', {
      class: 'input', style: 'flex:1;min-width:150px', value: a.platforms.instagram || '', placeholder: 'Account handle',
      oninput: e => a.platforms.instagram = e.target.value
    }),
    profileSelect('instagram', a.instagramProfileId, v => a.instagramProfileId = v)));

  body.appendChild(field('META BUSINESS SUITE URL', el('input', {
    class: 'input', value: a.metaBusinessSuiteUrl || '', placeholder: 'https://business.facebook.com/…',
    oninput: e => a.metaBusinessSuiteUrl = e.target.value
  })));

  // Where this avatar's base images live. Editors see it on the Assets tab.
  body.appendChild(el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, 'BASE IMAGE LINK'),
    el('input', {
      class: 'input', value: a.baseImageLink || '', placeholder: 'Drive folder with this avatar’s base images…',
      oninput: e => a.baseImageLink = e.target.value
    }),
    el('span', { class: 'hint' }, 'Shown to the video editors assigned to this avatar, under Assets.')));

  // ---- pre-made bodies, one folder per concept --------------------------------
  // The concept list is shared, so nothing is typed here — you just say where
  // this avatar's bodies live. Variations normally share the concept's
  // folder; expand one only when a single angle has its own.
  const bodies = el('div', { class: 'col', style: 'gap:8px' });
  const openConcept = {};   // which concepts are expanded in this modal

  function paintBodies() {
    bodies.innerHTML = '';
    bodies.appendChild(el('span', { class: 'label' }, 'BODIES BY CONCEPT'));

    // only the concepts this avatar's product will take — offering the rest
    // just invites folders nobody will use
    const concepts = conceptsForAccount(a);
    const excluded = sortedConcepts().length - concepts.length;
    if (!concepts.length) {
      bodies.appendChild(el('div', { class: 'hint' },
        sortedConcepts().length
          ? 'No concepts are accepted for this product — set them under Avatars → Products.'
          : 'No concepts defined yet. Add them under Avatars → Concepts, then set this avatar’s folders for each.'));
      return;
    }
    // Name the avatar explicitly: these folders belong to this one avatar and
    // nothing here is shared with any other.
    bodies.appendChild(el('span', { class: 'hint' },
      'Folders belonging to ' + ((a.name || '').trim() || 'this avatar') + ' alone — every avatar has its own. '
      + 'Each angle can have its own folder; leave one blank and it falls back to the concept’s main folder.'
      + (excluded ? ' ' + excluded + ' concept' + (excluded === 1 ? ' is' : 's are') + ' not used for this product.' : '')));

    const countFor = c => {
      const row = bodyRow(a, c.id);
      return ((row && row.url) || '').trim() ? 1 : 0
        + ((c.variations || []).filter(v => ((row && row.varUrls && row.varUrls[v.id]) || '').trim()).length);
    };
    // On an avatar with nothing set yet everything opens, so a new avatar never
    // looks like an empty section with nowhere to type. Once it has some
    // folders, the concepts it doesn't use tuck themselves away.
    const blankAvatar = !concepts.some(c => countFor(c) > 0);

    concepts.forEach(c => {
      const row = bodyRow(a, c.id);
      const url = (row && row.url) || '';
      const vars = c.variations || [];
      const setCount = (url.trim() ? 1 : 0)
        + vars.filter(v => ((row && row.varUrls && row.varUrls[v.id]) || '').trim()).length;
      const expanded = openConcept[c.id] === undefined
        ? (blankAvatar || setCount > 0)
        : !!openConcept[c.id];

      const block = el('div', { class: 'concept-block' + (expanded ? ' open' : '') });

      block.appendChild(el('div', {
        class: 'concept-head',
        onclick: () => { openConcept[c.id] = !expanded; paintBodies(); }
      },
        el('span', { class: 'twisty' }, expanded ? '▾' : '▸'),
        el('b', { style: 'font-size:12.5px;flex:1;min-width:0' }, c.name),
        // "no folders yet", not "not used" — this list already holds only the
        // concepts the page's product takes, so "not used" would read as the
        // opposite of what is true
        el('span', { class: 'hint' }, setCount
          ? setCount + ' folder' + (setCount === 1 ? '' : 's') + ' set'
          : 'no folders yet')));

      if (expanded) {
        const fields = el('div', { class: 'concept-fields' });

        const line = (label, value, onInput, muted) => el('div', { class: 'row wrap', style: 'gap:8px' },
          el('span', {
            style: 'flex:0 0 104px;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
              + (muted ? 'color:var(--mut)' : 'font-weight:700')
          }, label),
          el('input', {
            class: 'input', style: 'flex:1;min-width:160px;height:30px;font-size:11.5px',
            value, placeholder: muted ? (url ? 'Falls back to the main folder' : 'Drive folder link…') : 'Drive folder link…',
            oninput: e => onInput(e.target.value)
          }));

        fields.appendChild(line(vars.length ? 'Main folder' : 'Folder', url,
          v => setConceptLink(a, c.id, v), false));

        vars.forEach(v => fields.appendChild(line(
          v.label || 'Untitled angle',
          (row && row.varUrls && row.varUrls[v.id]) || '',
          val => setVariationLink(a, c.id, v.id, val),
          true)));

        block.appendChild(fields);
      }
      bodies.appendChild(block);
    });
  }
  paintBodies();
  body.appendChild(bodies);

  body.appendChild(field('NOTES', el('textarea', {
    class: 'input', placeholder: 'Anything the team should know about this avatar…',
    oninput: e => a.notes = e.target.value
  }, a.notes || '')));

  const err = el('div', { class: 'error', style: 'display:none' });
  body.appendChild(err);

  body.appendChild(el('div', { class: 'row', style: 'gap:9px;padding-top:4px' },
    existing && el('button', {
      class: 'btn danger', onclick: async () => {
        const n = state.db.entries.filter(e => e.accountId === a.id).length;
        if (!confirm('Delete "' + (a.name || 'this avatar') + '"?' + (n ? '\n\n' + n + ' logged video(s) for this avatar will also be removed.' : ''))) return;
        const { removeItem } = await import('../app.js');
        state.db.entries.filter(e => e.accountId === a.id).forEach(e => removeItem('entries', e.id));
        removeItem('accounts', a.id);
        closeModal();
      }
    }, 'Delete'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    el('button', {
      class: 'btn primary', onclick: async () => {
        if (!a.name.trim()) { err.textContent = 'Give the avatar a name.'; err.style.display = ''; return; }
        a.name = a.name.trim();
        pruneBodyLinks(a);   // drop concepts left blank for this avatar
        const { save } = await import('../app.js');
        save('accounts', a);
        closeModal();
      }
    }, existing ? 'Save changes' : 'Create avatar')));

  state.modal = overlay(existing ? 'Edit avatar' : 'New avatar', body);
  forceEmit();
}

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------
function openProfiles() {
  const body = el('div', { class: 'modal-body' });
  body.appendChild(el('div', { class: 'hint' },
    'The identities your avatars post from. One Facebook profile usually creates many pages; an Instagram profile is one account.'));

  ['facebook', 'instagram'].forEach(platform => {
    const list = state.db.profiles.filter(p => p.platform === platform);
    const col = el('div', { class: 'col', style: 'gap:7px' },
      el('span', { class: 'label' }, platform === 'facebook' ? 'FACEBOOK PROFILES' : 'INSTAGRAM PROFILES'));

    list.forEach(p => {
      const used = state.db.accounts.filter(a =>
        (platform === 'facebook' ? a.facebookProfileId : a.instagramProfileId) === p.id).length;
      col.appendChild(el('div', { class: 'card row', style: 'padding:8px 11px;gap:9px' },
        el('input', {
          class: 'input', style: 'height:30px;font-size:12.5px;flex:1', value: p.name,
          oninput: async e => {
            const { mutateQuiet } = await import('../app.js');
            mutateQuiet('profiles', p.id, x => x.name = e.target.value);
          }
        }),
        el('span', { class: 'hint', style: 'white-space:nowrap' }, used + (used === 1 ? ' avatar' : ' avatars')),
        el('button', {
          class: 'iconbtn danger', title: 'Delete profile', onclick: async () => {
            if (used && !confirm('This profile is attached to ' + used + ' avatar(s). Delete it anyway? They will simply have no profile set.')) return;
            const { removeItem, save } = await import('../app.js');
            const key = platform === 'facebook' ? 'facebookProfileId' : 'instagramProfileId';
            state.db.accounts.filter(a => a[key] === p.id).forEach(a => { a[key] = ''; save('accounts', a); });
            removeItem('profiles', p.id);
            openProfiles();
          }
        }, '✕')));
    });
    if (!list.length) col.appendChild(el('div', { class: 'hint', style: 'padding:2px 2px 4px' }, 'None yet.'));

    col.appendChild(el('button', {
      class: 'btn small', style: 'align-self:flex-start', onclick: async () => {
        const name = prompt('Name of the new ' + platform + ' profile:');
        if (!name || !name.trim()) return;
        const { save } = await import('../app.js');
        save('profiles', { id: uid('p'), name: name.trim(), platform, createdAt: Date.now() });
        openProfiles();
      }
    }, '+ Add ' + platform + ' profile'));

    body.appendChild(col);
  });

  body.appendChild(el('div', { class: 'row', style: 'padding-top:4px' },
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: closeModal }, 'Done')));

  state.modal = overlay('Profiles', body);
  forceEmit();
}

// Products are a shared list, so several avatars promoting the same thing stay
// in step and a rename updates everywhere. New ones can be created inline.
function productSelect(current, onset) {
  const list = state.db.products.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const sel = el('select', {
    class: 'input',
    onchange: async e => {
      if (e.target.value === '__new') {
        const name = prompt('Name of the new product:');
        if (!name || !name.trim()) { sel.value = current || ''; return; }
        const { save } = await import('../app.js');
        const p = { id: uid('pr'), name: name.trim(), createdAt: Date.now() };
        save('products', p);
        sel.insertBefore(el('option', { value: p.id }, p.name), sel.lastChild);
        sel.value = p.id; current = p.id; onset(p.id);
        return;
      }
      current = e.target.value; onset(e.target.value);
    }
  },
    [el('option', { value: '' }, 'No product')]
      .concat(list.map(p => el('option', { value: p.id }, p.name)))
      .concat([el('option', { value: '__new' }, '+ New product…')]));
  sel.value = current || '';
  return sel;
}

// ---------------------------------------------------------------------------
// concepts + their variations
// ---------------------------------------------------------------------------
function openConcepts() {
  const body = el('div', { class: 'modal-body' });
  body.appendChild(el('div', { class: 'hint' },
    'Concepts are defined once here and picked everywhere else. Variations are the different angles you target — they live inside a concept, so a new angle never means a new concept.'));

  const legacy = discoverLegacyConcepts();
  if (legacy.length) {
    body.appendChild(el('div', { class: 'card col', style: 'gap:9px;border-color:rgba(240,179,65,0.35)' },
      el('b', { style: 'font-size:12.5px;color:#f0c97a' }, 'Import existing concepts'),
      el('div', { class: 'hint' },
        legacy.length + ' concept name' + (legacy.length === 1 ? '' : 's') + ' still stored as plain text: '
        + legacy.map(l => '“' + l.name + '”').join(', ')
        + '. Importing creates them here and repoints the avatars and videos already using them.'),
      el('button', {
        class: 'btn small', style: 'align-self:flex-start', onclick: () => runImport(legacy)
      }, 'Import ' + legacy.length + ' concept' + (legacy.length === 1 ? '' : 's'))));
  }

  const list = sortedConcepts();
  const col = el('div', { class: 'col', style: 'gap:9px' });

  list.forEach(c => {
    const used = state.db.accounts.filter(a => (a.bodyLinks || []).some(r => r.conceptId === c.id)).length;
    const vars = c.variations || [];

    const card = el('div', { class: 'card col', style: 'padding:11px 12px;gap:9px' },
      el('div', { class: 'row', style: 'gap:9px' },
        el('input', {
          class: 'input', style: 'height:31px;font-size:13px;font-weight:700;flex:1', value: c.name,
          oninput: async e => {
            const { mutateQuiet } = await import('../app.js');
            mutateQuiet('concepts', c.id, x => x.name = e.target.value);
          }
        }),
        el('span', { class: 'hint', style: 'white-space:nowrap' }, used + (used === 1 ? ' avatar' : ' avatars')),
        el('button', {
          class: 'iconbtn danger', title: 'Delete concept', onclick: async () => {
            const vids = state.db.dailyEntries.filter(e => e.conceptId === c.id).length;
            if (!confirm('Delete “' + c.name + '”' + (vars.length ? ' and its ' + vars.length + ' variation(s)' : '') + '?'
              + (used || vids ? '\n\n' + used + ' avatar link(s) and ' + vids + ' video(s) reference it and will lose the connection.' : ''))) return;
            const { removeItem, save } = await import('../app.js');
            // Take it out of every product's accepted list too. A stale id left
            // behind counts toward "takes all N concepts" while ticking none of
            // them, so the product would quietly start refusing work.
            state.db.products.forEach(p => {
              if (!Array.isArray(p.conceptIds) || !p.conceptIds.includes(c.id)) return;
              p.conceptIds = p.conceptIds.filter(x => x !== c.id);
              save('products', p);
            });
            removeItem('concepts', c.id);
            openConcepts();
          }
        }, '✕')));

    // variations
    const vwrap = el('div', { class: 'col', style: 'gap:6px;padding-left:11px;border-left:2px solid var(--line2)' });
    vars.forEach(v => {
      vwrap.appendChild(el('div', { class: 'row', style: 'gap:7px' },
        el('input', {
          class: 'input', style: 'height:28px;font-size:12px;flex:1', value: v.label, placeholder: 'Angle…',
          oninput: async e => {
            const { mutateQuiet } = await import('../app.js');
            mutateQuiet('concepts', c.id, x => {
              const t = (x.variations || []).find(y => y.id === v.id); if (t) t.label = e.target.value;
            });
          }
        }),
        el('button', {
          class: 'iconbtn danger', title: 'Remove variation', onclick: async () => {
            const { mutate } = await import('../app.js');
            mutate('concepts', c.id, x => { x.variations = (x.variations || []).filter(y => y.id !== v.id); });
            openConcepts();
          }
        }, '✕')));
    });
    if (!vars.length) vwrap.appendChild(el('span', { class: 'hint' }, 'No variations — this concept is used on its own.'));
    vwrap.appendChild(el('button', {
      class: 'btn small', style: 'align-self:flex-start', onclick: async () => {
        const { mutate } = await import('../app.js');
        mutate('concepts', c.id, x => {
          if (!Array.isArray(x.variations)) x.variations = [];
          x.variations.push({ id: uid('cv'), label: '', note: '' });
        });
        openConcepts();
      }
    }, '+ Add variation'));

    card.appendChild(vwrap);
    col.appendChild(card);
  });

  if (!list.length) col.appendChild(el('div', { class: 'hint' }, 'No concepts yet.'));
  col.appendChild(el('button', {
    class: 'btn small', style: 'align-self:flex-start', onclick: async () => {
      const name = prompt('Name of the new concept:');
      if (!name || !name.trim()) return;
      const { save } = await import('../app.js');
      save('concepts', { id: uid('c'), name: name.trim(), variations: [], createdAt: Date.now() });
      openConcepts();
    }
  }, '+ Add concept'));

  body.appendChild(col);
  body.appendChild(el('div', { class: 'row', style: 'padding-top:4px' },
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: closeModal }, 'Done')));

  state.modal = overlay('Concepts', body);
  forceEmit();
}

// Turn the free-text names into real concepts and repoint everything at them.
async function runImport(legacy) {
  if (!confirm('Create ' + legacy.length + ' concept(s) and repoint the avatars and videos using them?')) return;
  const { save } = await import('../app.js');
  const made = {};

  legacy.forEach(l => {
    const c = { id: uid('c'), name: l.name, variations: [], createdAt: Date.now() };
    made[l.name.trim().toLowerCase()] = c;
    save('concepts', c);
  });
  const find = txt => made[(txt || '').trim().toLowerCase()];

  state.db.accounts.forEach(a => {
    let touched = false;
    (a.bodyLinks || []).forEach(r => {
      if (r.conceptId) return;
      const c = find(r.concept);
      if (c) { r.conceptId = c.id; if (!r.varUrls) r.varUrls = {}; touched = true; }
    });
    if (touched) save('accounts', a);
  });

  state.db.dailyEntries.forEach(e => {
    if (e.conceptId) return;
    const c = find(e.bodyConcept) || find(e.concept);
    if (c) { e.conceptId = c.id; save('dailyEntries', e); }
  });

  openConcepts();
}

function openProducts() {
  const body = el('div', { class: 'modal-body' });
  body.appendChild(el('div', { class: 'hint' },
    'What your avatars promote. A product carries its picture, its colour and the concepts it takes — ' +
    'change it here and every avatar on it follows.'));

  const list = state.db.products.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const col = el('div', { class: 'col', style: 'gap:10px' });
  const concepts = sortedConcepts();

  list.forEach(p => col.appendChild(productCard(p, concepts)));

  if (!list.length) {
    col.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:26px;font-size:12px' },
      'No products yet. Add the first one below.'));
  }

  col.appendChild(el('button', {
    class: 'add-row', onclick: async () => {
      const name = prompt('Name of the new product:');
      if (!name || !name.trim()) return;
      const { save } = await import('../app.js');
      save('products', { id: uid('pr'), name: name.trim(), createdAt: Date.now() });
      openProducts();
    }
  }, '+  Add product'));

  body.appendChild(col);
  body.appendChild(el('div', { class: 'row', style: 'padding-top:4px' },
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: closeModal }, 'Done')));

  state.modal = overlay('Products', body, { wide: true });
  forceEmit();
}

// One product, laid out as a card: picture and name on top, then the two
// things that actually differ between products — its colour and the concepts
// it takes. The colour is repeated as a rail down the left edge so a long list
// stays scannable without reading a single word.
function productCard(p, concepts) {
  const used = state.db.accounts.filter(a => a.productId === p.id).length;
  const card = el('div', { class: 'card col prod-card' });

  // ---- colour ----
  const preview = el('span', { class: 'chip' }, p.name || 'Untitled');
  const paintColor = c => {
    card.style.setProperty('--pc', c);
    preview.style.cssText = 'color:' + c + ';background:' + c + '1f;border-color:' + c + '55';
  };
  paintColor(productColor(p));

  const swatches = el('div', { class: 'row wrap', style: 'gap:7px' }, PRODUCT_COLORS.map(c =>
    el('button', {
      class: 'swatch' + (c.toLowerCase() === productColor(p).toLowerCase() ? ' on' : ''),
      style: 'background:' + c, title: c,
      // capture the button BEFORE awaiting — currentTarget is nulled once the
      // handler yields, which silently killed the repaint below
      onclick: async e => {
        const btn = e.currentTarget;
        const { mutate } = await import('../app.js');
        mutate('products', p.id, x => x.color = c);
        p.color = c;
        swatches.querySelectorAll('.swatch').forEach(s => s.classList.remove('on'));
        btn.classList.add('on');
        paintColor(c);
      }
    })));

  // ---- picture ----
  const shot = el('div', { class: 'prod-shot' });
  const paintShot = () => {
    shot.innerHTML = '';
    shot.appendChild(p.imageUrl
      ? el('img', { src: p.imageUrl, alt: '' })
      : el('span', { class: 'shot-empty' }, 'add\nphoto'));
    shot.appendChild(el('span', { class: 'shot-hover' }, p.imageUrl ? 'Change' : 'Upload'));
  };
  paintShot();
  const fileIn = el('input', {
    type: 'file', accept: 'image/*', style: 'display:none',
    onchange: async e => {
      const file = e.target.files && e.target.files[0]; if (!file) return;
      try {
        const { store, mutate } = await import('../app.js');
        const url = await store.uploadImage(file);
        mutate('products', p.id, x => x.imageUrl = url);
        p.imageUrl = url; paintShot();
      } catch (err) { alert('Image upload failed — try again.\n' + (err.message || '')); }
      e.target.value = '';                       // let the same file be picked again
    }
  });

  // ---- concepts it takes ----
  // No list at all means it takes everything, so a product nobody has
  // configured never blocks work. A list is exact.
  const accepted = Array.isArray(p.conceptIds) && p.conceptIds.length ? p.conceptIds.slice() : [];
  const boxes = el('div', { class: 'row wrap', style: 'gap:7px' });
  const summary = el('span', { class: 'hint' });

  const paintConcepts = () => {
    boxes.innerHTML = '';
    if (!concepts.length) {
      boxes.appendChild(el('span', { class: 'hint' }, 'No concepts defined yet — add them under Avatars → Concepts.'));
      summary.textContent = '';
      return;
    }
    let off = 0;
    concepts.forEach(c => {
      const on = !accepted.length || accepted.includes(c.id);
      if (!on) off++;                  // counted from what is drawn, so an id
                                       // left over from a deleted concept can
                                       // never skew the line below
      boxes.appendChild(el('button', {
        class: 'cbox' + (on ? ' on' : ''),
        title: on ? c.name + ' is used for this product' : c.name + ' is not used for this product',
        onclick: () => toggleConcept(c),
      }, el('span', { class: 'bx' }, on ? '✓' : ''), c.name));
    });
    summary.textContent = off
      ? off + ' of ' + concepts.length + ' not used for this product'
      : 'Takes all ' + concepts.length + ' concepts';
  };

  const toggleConcept = async c => {
    // the first click turns the implicit "all of them" into an explicit list;
    // ids of concepts that no longer exist are dropped on the way through
    const real = new Set(concepts.map(x => x.id));
    let next = accepted.length ? accepted.filter(id => real.has(id)) : concepts.map(x => x.id);
    next = next.includes(c.id) ? next.filter(x => x !== c.id) : next.concat([c.id]);
    if (!next.length) {
      summary.textContent = 'A product has to take at least one concept.';
      return;
    }
    accepted.length = 0; accepted.push(...next);
    const { mutate } = await import('../app.js');
    // storing the full list as [] keeps "all of them" a single meaning
    const stored = next.length === concepts.length ? [] : next;
    mutate('products', p.id, x => { x.conceptIds = stored; });
    p.conceptIds = stored;
    paintConcepts();
  };
  paintConcepts();

  card.appendChild(el('div', { class: 'row', style: 'gap:12px;align-items:flex-start' },
    el('label', { class: 'prod-shot-wrap', title: 'Product photo' }, shot, fileIn),
    el('div', { class: 'col', style: 'gap:6px;flex:1;min-width:0' },
      el('input', {
        class: 'input prod-name', value: p.name, placeholder: 'Product name',
        oninput: async e => {
          const { mutateQuiet } = await import('../app.js');
          mutateQuiet('products', p.id, x => x.name = e.target.value);
          preview.textContent = e.target.value || 'Untitled';
        }
      }),
      el('div', { class: 'row', style: 'gap:7px' },
        el('span', { class: 'prod-count' }, used ? used + (used === 1 ? ' avatar' : ' avatars') : 'unused'),
        el('span', { class: 'hint' }, 'shows as'), preview)),
    el('button', {
      class: 'iconbtn danger', title: 'Delete product', onclick: async () => {
        if (used && !confirm('This product is set on ' + used + ' avatar(s). Delete it anyway? They will simply have no product set.')) return;
        const { removeItem, save } = await import('../app.js');
        state.db.accounts.filter(a => a.productId === p.id).forEach(a => { a.productId = ''; save('accounts', a); });
        removeItem('products', p.id);
        openProducts();
      }
    }, '✕')));

  card.appendChild(el('div', { class: 'prod-sec' },
    el('span', { class: 'label' }, 'COLOUR'), swatches));

  // Where this product's photos live. Editors see this on Assets — but only for
  // the products their own pages promote — so they can grab the product shots.
  card.appendChild(el('div', { class: 'prod-sec' },
    el('span', { class: 'label' }, 'PRODUCT PHOTOS LINK'),
    el('input', {
      class: 'input', style: 'height:32px;font-size:12.5px', value: p.assetsLink || '',
      placeholder: 'Drive folder with this product’s photos…',
      oninput: async e => {
        const { mutateQuiet } = await import('../app.js');
        mutateQuiet('products', p.id, x => x.assetsLink = e.target.value);
      }
    })));

  card.appendChild(el('div', { class: 'prod-sec' },
    el('div', { class: 'row', style: 'gap:9px' },
      el('span', { class: 'label' }, 'CONCEPTS IT TAKES'), summary),
    boxes));

  // The captions every page on this product posts. Written once here, with a
  // [caption link] placeholder each page fills with its own caption link — so a
  // hundred pages share one caption and a change here reaches all of them.
  const tplSec = el('div', { class: 'prod-sec' },
    el('div', { class: 'row wrap', style: 'gap:9px' },
      el('span', { class: 'label' }, 'CAPTION TEMPLATES'),
      el('span', { class: 'hint' }, 'Use [caption link] where each page’s link should go.')));
  VIDEO_TYPES.forEach(t => {
    const val = (p.captionTemplates || {})[t] || '';
    tplSec.appendChild(el('div', { class: 'col', style: 'gap:3px' },
      el('span', { class: 'label' }, t.toUpperCase() + ' VIDEO'),
      el('textarea', {
        class: 'input', style: 'min-height:70px;font-size:12px;line-height:1.5',
        placeholder: 'Caption for ' + t.toLowerCase() + ' videos… include [caption link]',
        oninput: async e => {
          const { mutateQuiet } = await import('../app.js');
          mutateQuiet('products', p.id, x => {
            if (!x.captionTemplates) x.captionTemplates = {};
            x.captionTemplates[t] = e.target.value;
          });
        }
      }, val)));
  });
  card.appendChild(tplSec);

  return card;
}

function profileSelect(platform, current, onset) {
  const list = state.db.profiles.filter(p => p.platform === platform);
  const sel = el('select', {
    class: 'input', style: 'width:auto;min-width:170px',
    onchange: async e => {
      if (e.target.value === '__new') {
        const name = prompt('Name of the new ' + platform + ' profile:');
        if (!name || !name.trim()) { sel.value = current || ''; return; }
        const { save } = await import('../app.js');
        const p = { id: uid('p'), name: name.trim(), platform, createdAt: Date.now() };
        save('profiles', p);
        sel.appendChild(el('option', { value: p.id }, p.name));
        sel.value = p.id; current = p.id; onset(p.id);
        return;
      }
      current = e.target.value; onset(e.target.value);
    }
  },
    [el('option', { value: '' }, 'No profile')]
      .concat(list.map(p => el('option', { value: p.id }, p.name)))
      .concat([el('option', { value: '__new' }, '+ New profile…')]));
  sel.value = current || '';
  return sel;
}

// ---------------------------------------------------------------------------
// small shared bits
// ---------------------------------------------------------------------------
function field(label, control) {
  return el('div', { class: 'col', style: 'gap:5px;flex:1;min-width:140px' }, el('span', { class: 'label' }, label), control);
}

function select(pairs, current, onset) {
  const sel = el('select', { class: 'input', style: 'width:auto;min-width:120px', onchange: e => onset(e.target.value) },
    pairs.map(([v, label]) => el('option', { value: v }, label)));
  sel.value = current;
  return sel;
}

export function overlay(title, body, opts) {
  const ov = el('div', {
    class: 'overlay',
    onclick: e => { if (e.target === ov) closeModal(); }
  },
    el('div', { class: 'modal' + (opts && opts.wide ? ' wide' : '') },
      el('div', { class: 'modal-head' }, title,
        el('button', { class: 'iconbtn', onclick: closeModal }, '✕')),
      body));
  return ov;
}
