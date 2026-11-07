// ============================================================================
// avatarpreview.js — what opens when you click an avatar: who it is and what it
// promotes, to read. Changing anything goes through Edit avatar.
// ============================================================================

import { state, forceEmit, byId, can } from '../state.js';
import { el, avatar } from '../ui.js';
import { brandOf } from '../brands.js';
import { stageOf, rampPhase } from '../stages.js';
import { lifecycleOf, isDropped, pageStats, lineageNote } from '../lifecycle.js';
import { PLATFORMS, social } from '../pagelinks.js';
import { openAccount, lifecycleChip, productColor, qualityOf, targetingOf } from './accounts.js';

const close = () => { state.modal = null; forceEmit(); };
const isLink = v => /^https?:\/\//i.test((v || '').trim());

function promotes(a) {
  const product = byId(state.db.products, a.productId);
  if (!product) {
    return el('div', { class: 'ap-promo' }, el('div', { class: 'ap-promo-text' },
      el('span', { class: 'label' }, 'PROMOTES'), el('b', null, 'No product set')));
  }
  const brand = brandOf(product);
  const art = product.imageUrl || (brand && brand.coverUrl);
  return el('div', { class: 'ap-promo', style: '--product:' + productColor(product) },
    art ? el('img', { class: 'ap-promo-art', src: art, alt: '' }) : null,
    el('div', { class: 'ap-promo-text' },
      el('span', { class: 'label' }, 'PROMOTES'),
      el('b', null, product.name),
      brand ? el('span', { class: 'ap-brand' },
        brand.logoUrl ? el('img', { src: brand.logoUrl, alt: brand.name }) : brand.name) : null));
}

function details(a) {
  const rows = [];
  const target = targetingOf(a);
  const quality = qualityOf(a);
  if (target) rows.push(['Targeting', target[1] + (a.targetingNote ? ' · ' + a.targetingNote : '')]);
  if (quality) rows.push(['Video quality', quality[1]]);
  const editors = (state.db.team || []).filter(t => t.role !== 'poster' && (t.assignments || []).includes(a.id));
  rows.push(['Editor', editors.length ? editors.map(t => t.name).join(', ') : 'Unassigned']);
  if (can.seeStage(state.user)) {
    const s = stageOf(a);
    const r = rampPhase(a);
    if (s) rows.push(['Stage', s.name + (r && r.growing ? ' · ' + r.have + ' of ' + r.need + ' first videos' : '')]);
  }
  return el('div', { class: 'ap-details' }, rows.map(([k, v]) => el('div', null,
    el('span', { class: 'label' }, k.toUpperCase()), el('span', null, v))));
}

function stats(a) {
  const s = pageStats(a);
  const cell = (n, label) => el('div', null, el('b', null, String(n)), el('span', { class: 'hint' }, label));
  return el('div', { class: 'ap-stats' },
    cell(s.days == null ? '–' : s.days, s.days === 1 ? 'day' : 'days'),
    cell(s.posted, 'posted'),
    cell(s.wins, s.wins === 1 ? 'winner' : 'winners'));
}

function profiles(a) {
  const links = PLATFORMS.map(p => {
    const url = social(a, p.id).url || (a.platforms || {})[p.id] || '';
    return isLink(url) ? el('a', { class: 'btn small', href: url.trim(), target: '_blank', rel: 'noopener' }, p.label + ' ↗') : null;
  }).filter(Boolean);
  return links.length ? el('div', { class: 'row wrap', style: 'gap:8px' }, links) : null;
}

// An older page's base image can be a Drive folder, which only opens as a link.
function baseImage(a) {
  const url = (a.baseImageLink || '').trim();
  if (!url) return null;
  const img = el('img', { src: url, alt: 'Base image of ' + (a.name || 'this avatar') });
  const box = el('a', { class: 'ap-base', href: url, target: '_blank', rel: 'noopener', title: 'Open the base image' }, img);
  img.onerror = () => { box.className = 'btn small'; box.innerHTML = ''; box.textContent = 'Base images ↗'; };
  return box;
}

export function openAvatarPreview(a, canEdit) {
  const dropped = isDropped(a) && (a.dropReason || '').trim();
  const lineage = lineageNote(a);
  const notes = (a.notes || '').trim();
  const base = baseImage(a);

  state.modal = el('div', { class: 'overlay', onclick: e => { if (e.target.classList.contains('overlay')) close(); } },
    el('div', { class: 'modal wide ap', role: 'dialog', 'aria-label': a.name || 'Avatar' },
      el('div', { class: 'ap-cover' },
        a.coverUrl ? el('img', { src: a.coverUrl, alt: '' }) : null,
        el('button', { class: 'iconbtn ap-close', type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
      el('div', { class: 'ap-who' },
        avatar(a, 104),
        el('div', { class: 'ap-name' },
          el('h2', null, a.name || 'Untitled'),
          lifecycleChip(a))),
      el('div', { class: 'ap-body' + (base ? ' has-base' : '') },
        el('div', { class: 'col', style: 'gap:16px;min-width:0' },
          promotes(a),
          stats(a),
          details(a),
          profiles(a),
          dropped ? el('div', { class: lifecycleOf(a) === 'Reposting' ? 'lock' : 'error', style: 'font-size:12px' }, a.dropReason.trim()) : null,
          lineage ? el('span', { class: 'chip violet', style: 'align-self:flex-start' }, lineage) : null,
          notes ? el('div', { class: 'ro-text' }, notes) : null),
        base),
      el('div', { class: 'ap-foot' },
        el('button', { class: 'btn', type: 'button', onclick: close }, 'Close'),
        canEdit ? el('button', { class: 'btn primary', type: 'button', onclick: () => openAccount(a) }, 'Edit avatar') : null)));
  forceEmit();
}
