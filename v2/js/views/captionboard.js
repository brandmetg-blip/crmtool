// ============================================================================
// captionboard.js — every live page's captions in one place, to copy and post.
//
// The posting job is repetitive: open a page, copy its caption, post, next
// page. This is that list — every live page, grouped by product, with the full
// growth and product caption ready to copy in one tap. Nothing is edited here;
// captions are set on the product template and the page. This is the reading
// end of that, built for someone posting on a phone.
// ============================================================================

import { state, can } from '../state.js';
import { el, avatar, copyText } from '../ui.js';
import { isLive, lifecycleOf } from '../lifecycle.js';
import { captionFor, captionsNeeded, hasPlaceholder } from '../captions.js';
import {
  byProduct, productColor, qualityChip, targetingChip, lifecycleChip,
} from './accounts.js';

// Pages a poster posts for: live, plus reposting pages (old winners still go
// out). Everything else is not being posted, so it is not here.
function postingPages() {
  return (state.db.accounts || [])
    .filter(a => !a.onboarding && (isLive(a) || lifecycleOf(a) === 'Reposting'));
}

export function renderCaptionBoard(root, u) {
  if (!can.seeCaptions(u)) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      'The caption board is for the admin, the marketing manager and posters.'));
    return;
  }

  const all = postingPages();

  const spacer = el('span', { class: 'spacer' });
  const head = el('div', { class: 'page-head' },
    el('div', null,
      el('h1', null, 'Captions'),
      el('div', { class: 'sub' }, all.length + (all.length === 1 ? ' page posting' : ' pages posting'))),
    spacer);
  import('../app.js').then(({ statusPill }) => head.insertBefore(statusPill(), spacer.nextSibling));
  root.appendChild(head);

  if (!all.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:36px' },
      'No live pages yet. Pages show here once they are posting.'));
    return;
  }

  // a search box, because at fifty pages scrolling for one is the slow part
  const list = el('div', { class: 'col', style: 'gap:20px' });
  const search = el('input', {
    class: 'input', style: 'max-width:280px', placeholder: 'Find a page…', value: state.capSearch || '',
    oninput: e => { state.capSearch = e.target.value; paint(); },
  });
  root.appendChild(el('div', { class: 'row wrap', style: 'gap:10px;margin-bottom:16px' }, search));
  root.appendChild(list);

  function paint() {
    list.innerHTML = '';
    const q = (state.capSearch || '').trim().toLowerCase();
    const shown = q
      ? all.filter(a => (a.name || '').toLowerCase().includes(q)
        || ((state.db.products.find(p => p.id === a.productId) || {}).name || '').toLowerCase().includes(q))
      : all;

    if (!shown.length) {
      list.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:26px' },
        'No page matches “' + state.capSearch + '”.'));
      return;
    }

    byProduct(shown).forEach(g => {
      const c = g.product ? productColor(g.product) : 'var(--dim)';
      list.appendChild(el('div', null,
        el('div', { class: 'group-head' },
          el('span', { class: 'group-dot', style: 'background:' + c }),
          g.product && g.product.imageUrl ? el('img', { class: 'prod-ico', src: g.product.imageUrl, alt: '' }) : null,
          el('b', { style: 'font-size:13.5px;color:' + c }, g.product ? g.product.name : 'No product'),
          el('span', { class: 'hint' }, g.accounts.length + (g.accounts.length === 1 ? ' page' : ' pages'))),
        el('div', { class: 'grid' }, g.accounts.map(pageCard))));
    });
  }

  paint();
}

function pageCard(a) {
  const card = el('div', { class: 'card col', style: 'gap:12px' });

  card.appendChild(el('div', { class: 'row', style: 'gap:11px' },
    avatar(a, 38),
    el('div', { style: 'min-width:0;flex:1' },
      el('b', { style: 'display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, a.name || 'Untitled'),
      el('div', { class: 'row wrap', style: 'gap:5px;margin-top:3px' }, qualityChip(a), targetingChip(a))),
    lifecycleChip(a)));

  captionsNeeded(a).forEach(t => card.appendChild(captionBlock(a, t)));
  return card;
}

// One caption, ready to copy. The caption is shown so the poster can see what
// they are about to post; the Copy button is the whole point. A caption still
// carrying [caption link] cannot be posted as-is, so it says so and the copy is
// held back rather than handing over a placeholder.
function captionBlock(a, type) {
  const text = captionFor(a, type);
  const pending = hasPlaceholder(text);
  const empty = !text.trim();

  const head = el('div', { class: 'row', style: 'gap:8px' },
    el('span', { class: 'label' }, type.toUpperCase() + ' CAPTION'),
    el('span', { class: 'spacer' }),
    (empty || pending)
      ? null
      : el('button', { class: 'btn small primary', onclick: e => copyText(text, e.currentTarget) }, 'Copy'));

  const bodyEl = empty
    ? el('div', { class: 'hint' }, 'No ' + type.toLowerCase() + ' caption set — add it on the product or the page.')
    : pending
      ? el('div', { class: 'hint', style: 'color:#f0c97a' }, 'This page has no caption link yet, so its caption is not ready to post.')
      : el('div', { class: 'cap-text' }, text);

  return el('div', { class: 'col cap-block', style: 'gap:6px' }, head, bodyEl);
}
