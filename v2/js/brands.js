// brands.js — who we promote for. A brand holds one or more products; a page
// promotes one product, so it belongs to that product's brand.
//
// The brand list is one workspace setting, which needs no database table. Until
// it is edited, the brands below are used. Products stay in their own table and
// point at a brand with `brandId`.

import { state, byId } from './state.js';
import { getPref, setPref } from './prefs.js';
import { el } from './ui.js';

const IMG = 'img/brands/';
export const DEFAULT_BRANDS = [
  { id: 'b-serene', name: 'Serene Herbs', logoUrl: IMG + 'serene-logo.png', coverUrl: IMG + 'serene-cover.webp' },
  { id: 'b-choice', name: 'Physician’s Choice', logoUrl: IMG + 'choice-logo.png', coverUrl: IMG + 'choice-cover.webp' },
  { id: 'b-jiyu', name: 'JIYU', logoUrl: IMG + 'jiyu-logo.svg', coverUrl: IMG + 'jiyu-cover.webp' },
  { id: 'b-pura', name: 'Pura Vida', logoUrl: IMG + 'pura-logo.png', coverUrl: IMG + 'pura-cover.webp' },
  { id: 'b-rosa', name: 'Rosabella', logoUrl: IMG + 'rosa-logo.png', coverUrl: IMG + 'rosa-cover.webp', coverFit: 'contain' },
];

export function brands() {
  const list = getPref('brands');
  return Array.isArray(list) ? list : DEFAULT_BRANDS;
}
export function saveBrands(list) { return setPref('brands', list); }
export function brandById(id) { return byId(brands(), id); }

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// A product with no brand set yet still finds one when its name contains the
// brand's, so existing products land in the right place without any rework.
export function brandOf(product) {
  if (!product) return null;
  const set = brandById(product.brandId);
  if (set) return set;
  const n = norm(product.name);
  return brands().find(b => norm(b.name) && n.includes(norm(b.name))) || null;
}

export function pageBrand(account) {
  return brandOf(byId(state.db.products, account && account.productId));
}

const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
export function productsOf(brandId) {
  return state.db.products.filter(p => { const b = brandOf(p); return b && b.id === brandId; }).sort(byName);
}
export function looseProducts() {
  return state.db.products.filter(p => !brandOf(p)).sort(byName);
}

// <option>s for a product dropdown, grouped under their brand.
export function productOptions() {
  const groups = brands().map(b => {
    const list = productsOf(b.id);
    return list.length ? el('optgroup', { label: b.name }, list.map(p => el('option', { value: p.id }, p.name))) : null;
  }).filter(Boolean);
  const loose = looseProducts();
  if (loose.length) groups.push(el('optgroup', { label: 'No brand' }, loose.map(p => el('option', { value: p.id }, p.name))));
  return groups;
}

// The brand's picture and logo as a block; the size comes from the caller's class.
export function brandArt(b) {
  return [
    b.coverUrl ? el('img', { class: 'ba-cover' + (b.coverFit === 'contain' ? ' fit' : ''), src: b.coverUrl, alt: '', loading: 'lazy' }) : null,
    el('span', { class: 'ba-wash' }),
    b.logoUrl
      ? el('img', { class: 'ba-logo', src: b.logoUrl, alt: b.name, loading: 'lazy' })
      : el('span', { class: 'ba-name' }, b.name || 'Untitled'),
  ];
}
