// assets.js — the reference sheet an editor needs while cutting a video: what
// the avatar looks like, what its stage asks for, and where its base images and
// bodies live. Read-only for everyone; it exists to be looked at and copied
// from.
//
// An editor sees only the avatars they have access to — the same set they get
// in the Daily Builder, so the two tabs never disagree about what is theirs.

import { state, builderAccounts, can, byId } from '../state.js';
import { el, avatar, copyText } from '../ui.js';
import { sortedConcepts, bodyLinkFor, bodyRow } from '../concepts.js';
import { pageStanding } from '../stages.js';
import { lifecycleOf, takesDailyVideos } from '../lifecycle.js';
import { stageChip, qualityChip, qualityClass, targetingChip, byProduct, productColor } from './accounts.js';

export function renderAssets(root) {
  const u = state.user;
  const accounts = builderAccounts(u, state.db).slice();

  const head = el('div', { class: 'page-head' },
    el('div', null,
      el('h1', null, 'Assets'),
      el('div', { class: 'sub' }, can.seesAllAccounts(u)
        ? accounts.length + (accounts.length === 1 ? ' avatar' : ' avatars')
        : 'The avatars you work on')),
    el('span', { class: 'spacer' }));
  import('../app.js').then(({ statusPill }) => head.appendChild(statusPill()));
  root.appendChild(head);

  if (!accounts.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      can.seesAllAccounts(u)
        ? 'No avatars yet — add them under Avatars.'
        : 'No avatars assigned to you yet — ask an admin.'));
    return;
  }

  // The products these avatars promote, so an editor can grab the product's
  // photos. Scoped to what THIS person's pages actually use — someone running
  // three avatars on three products sees those three, not the whole catalogue.
  productsSection(root, accounts);

  // Grouped by product, like every other list of avatars. Within a product the
  // pages still taking videos come first — a dropped page keeps its folders,
  // which are worth having to hand, but it should not head the group.
  const groups = byProduct(accounts);
  const heads = groups.some(g => g.product);
  groups.forEach(g => {
    const c = g.product ? productColor(g.product) : 'var(--dim)';
    const n = g.accounts.length;
    if (heads) root.appendChild(el('div', { class: 'group-head' },
      el('span', { class: 'group-dot', style: 'background:' + c }),
      g.product && g.product.imageUrl ? el('img', { class: 'prod-ico', src: g.product.imageUrl, alt: '' }) : null,
      el('b', { style: 'font-size:13.5px;color:' + c }, g.product ? g.product.name : 'No product'),
      el('span', { class: 'hint' }, n + (n === 1 ? ' avatar' : ' avatars'))));

    const ordered = g.accounts.slice()
      .sort((a, b) => (takesDailyVideos(b) ? 1 : 0) - (takesDailyVideos(a) ? 1 : 0));
    root.appendChild(el('div', { class: 'grid', style: 'margin-bottom:22px' }, ordered.map(card)));
  });
}

// The distinct products across the person's avatars, each with a button to its
// photos folder. Distinct by product, in name order — a product used by five of
// their pages still appears once.
function productsSection(root, accounts) {
  const seen = new Map();
  accounts.forEach(a => {
    const p = byId(state.db.products, a.productId);
    if (p) seen.set(p.id, p);
  });
  const products = [...seen.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (!products.length) return;

  root.appendChild(el('div', { class: 'group-head' },
    el('span', { class: 'group-dot', style: 'background:var(--mut)' }),
    el('b', { style: 'font-size:13.5px' }, 'Products'),
    el('span', { class: 'hint' }, products.length + (products.length === 1 ? ' product' : ' products') + ' your pages promote')));

  root.appendChild(el('div', { class: 'grid', style: 'margin-bottom:26px' }, products.map(productAssetCard)));
}

function productAssetCard(p) {
  const c = productColor(p);
  const link = (p.assetsLink || '').trim();
  const isUrl = /^https?:\/\//.test(link);

  return el('div', { class: 'card row', style: 'gap:12px' },
    p.imageUrl
      ? el('img', { src: p.imageUrl, alt: '', style: 'width:46px;height:46px;border-radius:10px;object-fit:contain;background:#0e0e11;border:1px solid var(--line2);flex:0 0 auto' })
      : el('span', { class: 'avatar', style: 'width:46px;height:46px;color:' + c + ';background:' + c + '22', }, (p.name || '?').charAt(0)),
    el('div', { style: 'min-width:0;flex:1' },
      el('b', { style: 'display:block;font-size:13.5px;color:' + c }, p.name || 'Untitled'),
      el('span', { class: 'hint' }, isUrl ? 'Product photos' : 'No photos link set yet')),
    isUrl
      ? el('a', { class: 'btn small primary', href: link, target: '_blank', rel: 'noopener' }, 'Open photos ↗')
      : null);
}

function card(a) {
  const link = (a.baseImageLink || '').trim();
  const isUrl = /^https?:\/\//.test(link);

  const st = pageStanding(a);

  const box = el('div', { class: 'card col' + qualityClass(a) + (st && st.retired ? ' retired' : ''), style: 'gap:14px' },
    el('div', { class: 'row', style: 'gap:13px' },
      avatar(a, 64),
      el('b', { style: 'flex:1;min-width:0;font-size:14.5px' }, a.name || 'Untitled'),
      el('div', { class: 'col', style: 'gap:5px;align-items:flex-end' }, stageChip(a), qualityChip(a), targetingChip(a))));

  // What this page needs right now — the reason stages exist rather than being
  // a colour on a card. A retired page says so loudly instead.
  if (st && st.retired) {
    box.appendChild(el('div', {
      class: lifecycleOf(a) === 'Reposting' ? 'lock' : 'error', style: 'font-size:12px'
    }, st.note));
    // Reposting is a job, not a tombstone: these are the videos to put back out.
    if (lifecycleOf(a) === 'Reposting') box.appendChild(winnersBlock(a));
  } else if (st && !st.note && lifecycleOf(a) !== 'Live') {
    box.appendChild(el('div', { class: 'hint' }, (st.label || '') + ' — not posting right now.'));
  } else if (st && st.note) {
    box.appendChild(el('div', { class: 'col', style: 'gap:5px' },
      el('span', { class: 'label' }, 'AT THIS STAGE'),
      el('div', { class: 'ro-text' }, st.note)));
  }

  const linkCol = el('div', { class: 'col', style: 'gap:6px;border-top:1px solid var(--line);padding-top:12px' },
    el('span', { class: 'label' }, 'BASE IMAGES'));

  if (isUrl) {
    linkCol.appendChild(el('div', { class: 'row wrap', style: 'gap:8px' },
      el('a', { class: 'btn small', href: link, target: '_blank', rel: 'noopener' }, 'Open folder ↗'),
      el('button', { class: 'btn small', onclick: e => copyText(link, e.currentTarget) }, 'Copy link')));
  } else if (link) {
    // Not a URL — still show it, since it may be a path or a note.
    linkCol.appendChild(el('div', { class: 'row wrap', style: 'gap:8px' },
      el('span', { class: 'ro-text', style: 'flex:1;min-width:0' }, link),
      el('button', { class: 'btn small', onclick: e => copyText(link, e.currentTarget) }, 'Copy')));
  } else {
    linkCol.appendChild(el('span', { class: 'hint' }, 'No base image link set yet.'));
  }

  box.appendChild(linkCol);
  box.appendChild(bodiesBlock(a));
  return box;
}

// The pre-made bodies for this avatar: a folder per concept, with an angle
// listed separately only when it has its own folder rather than sharing.
function bodiesBlock(a) {
  const concepts = sortedConcepts().filter(c => bodyLinkFor(a, c.id));

  const col = el('div', { class: 'col', style: 'gap:9px;border-top:1px solid var(--line);padding-top:12px' },
    el('div', { class: 'row' },
      el('span', { class: 'label' }, 'BODIES BY CONCEPT'),
      el('span', { class: 'spacer' }),
      concepts.length ? el('span', { class: 'hint' }, concepts.length + (concepts.length === 1 ? ' concept' : ' concepts')) : null));

  if (!concepts.length) {
    col.appendChild(el('span', { class: 'hint' },
      (a.bodyLinks || []).length
        ? 'Older links on this avatar are waiting to be imported — an admin can do it under Avatars → Concepts.'
        : 'No concepts set up for this avatar yet.'));
    return col;
  }

  concepts.forEach(c => {
    col.appendChild(linkLine(c.name, bodyLinkFor(a, c.id), true));
    const row = bodyRow(a, c.id);
    (c.variations || []).forEach(v => {
      const own = (row && row.varUrls && row.varUrls[v.id]) || '';
      if (!own.trim()) return;                 // shares the concept folder — nothing to add
      col.appendChild(el('div', { style: 'padding-left:14px' },
        linkLine(v.label || 'Untitled angle', own.trim(), false)));
    });
  });
  return col;
}

// The videos starred as winners in the builder — what a reposting page lives on.
function winnersBlock(a) {
  const wins = (state.db.dailyEntries || [])
    .filter(e => e.accountId === a.id && e.win)
    .sort((x, y) => (y.date || '').localeCompare(x.date || ''));

  const col = el('div', { class: 'col', style: 'gap:7px' },
    el('span', { class: 'label' }, 'WINNERS TO REPOST'));

  if (!wins.length) {
    col.appendChild(el('span', { class: 'hint' },
      'No videos were starred as winners on this page — ask an admin which ones to repost.'));
    return col;
  }
  wins.forEach(e => {
    const url = (e.videoLink || '').trim();
    col.appendChild(el('div', { class: 'row wrap', style: 'gap:8px' },
      el('span', { style: 'flex:1;min-width:90px;font-size:11.5px;color:var(--mut)' },
        (e.date || '') + (e.concept ? ' · ' + e.concept : '')),
      /^https?:\/\//.test(url)
        ? el('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Open ↗')
        : el('span', { class: 'hint' }, 'no link')));
  });
  return col;
}

function linkLine(label, url, strong) {
  const isUrl = /^https?:\/\//.test(url);
  return el('div', { class: 'row wrap', style: 'gap:8px' },
    el('span', {
      style: 'flex:1;min-width:90px;font-size:' + (strong ? '12.5px;font-weight:700' : '11.5px;color:var(--mut)')
    }, label),
    isUrl
      ? el('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Open bodies ↗')
      : el('span', { class: 'hint' }, url || 'No link'),
    isUrl ? el('button', { class: 'btn small', onclick: e => copyText(url, e.currentTarget) }, 'Copy') : null);
}
