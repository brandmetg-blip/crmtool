// sheet.js — every avatar as one row, the way a spreadsheet would show it.
//
// The cards answer "how is this page doing today". This answers a different
// question: across the whole roster, what exists and what is still missing —
// is the page made, does it have a body script for each concept, is the link
// created, is it added.
//
// The concept columns build themselves from the concept library, and each cell
// reads the body-script link already stored on that avatar. Nothing is entered
// twice: fill it in on the avatar and it shows here, tick it here and it is on
// the avatar. Some avatars use concepts others do not, which is exactly why the
// columns are generated rather than fixed.
//
// Extra columns can be defined in Settings for anything this does not cover.

import { state, forceEmit } from '../state.js';
import { el, avatar } from '../ui.js';
import { sortedConcepts, bodyLinkFor } from '../concepts.js';
import { getPref } from '../prefs.js';
import { lifecycleChip, stageOnlyChip, productChip, qualityBadge } from './accounts.js';

// Fixed columns, in the order they read best: identity first, then state.
const HEAD = [
  { id: 'num', label: '#', w: 44 },
  { id: 'pageCreated', label: 'Page created', type: 'check', w: 92 },
  { id: 'product', label: 'Product', w: 138 },
  { id: 'pfp', label: 'PFP', w: 50 },
  { id: 'name', label: 'Name', w: 180 },
  { id: 'lifecycle', label: 'Status', w: 96 },
  { id: 'stage', label: 'Stage', w: 118 },
];
const TAIL = [
  { id: 'caption', label: 'Caption', type: 'text', w: 160 },
  { id: 'linkCreated', label: 'Link created', type: 'check', w: 92 },
  { id: 'linkAdded', label: 'Link added', type: 'check', w: 90 },
];

export function renderSheet(root, accounts, canEdit) {
  const concepts = sortedConcepts();
  const custom = getPref('sheetColumns') || [];

  if (!accounts.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      'No pages in this view.'));
    return;
  }

  const table = el('table', { class: 'sheet' });
  const thead = el('thead');
  const hrow = el('tr');

  HEAD.forEach(c => hrow.appendChild(el('th', { class: colClass(c.id), style: 'min-width:' + c.w + 'px' }, c.label)));
  concepts.forEach(c => hrow.appendChild(el('th', { class: 'concept', style: 'min-width:150px', title: 'Body script for ' + c.name }, c.name)));
  TAIL.forEach(c => hrow.appendChild(el('th', { style: 'min-width:' + c.w + 'px' }, c.label)));
  custom.forEach(c => hrow.appendChild(el('th', { style: 'min-width:120px' }, c.label || 'Untitled')));
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el('tbody');
  accounts.forEach((a, i) => tbody.appendChild(row(a, i + 1, concepts, custom, canEdit)));
  table.appendChild(tbody);

  root.appendChild(el('div', { class: 'sheet-wrap' }, table));
  root.appendChild(el('div', { class: 'hint', style: 'margin-top:10px' },
    concepts.length
      ? 'One column per concept, showing this avatar’s body script for it. Filled in here or on the avatar — it is the same field.'
      : 'Add concepts under Avatars → Concepts and each one gets a column here.'));
}

function colClass(id) {
  // the identifying columns stay put while the rest scrolls sideways
  return ['num', 'pageCreated', 'product', 'pfp', 'name'].includes(id) ? 'stick s-' + id : '';
}

function row(a, n, concepts, custom, canEdit) {
  const tr = el('tr');

  tr.appendChild(el('td', { class: colClass('num') }, el('span', { class: 'rownum' }, '#' + n)));
  tr.appendChild(el('td', { class: colClass('pageCreated') }, check(a, 'pageCreated', canEdit)));
  tr.appendChild(el('td', { class: colClass('product') }, productChip(a) || el('span', { class: 'hint' }, '—')));
  tr.appendChild(el('td', { class: colClass('pfp') }, avatar(a, 30)));
  tr.appendChild(el('td', { class: colClass('name') },
    el('div', { class: 'row', style: 'gap:6px' },
      el('b', { style: 'font-size:12.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, a.name || 'Untitled'),
      qualityBadge(a)),
    el('span', { class: 'hint' }, a.character || 'No character')));
  tr.appendChild(el('td', null, lifecycleChip(a)));
  tr.appendChild(el('td', null, stageOnlyChip(a)));

  // one cell per concept: has a body script, and a way straight to it
  concepts.forEach(c => {
    const url = bodyLinkFor(a, c.id);
    tr.appendChild(el('td', null, url
      ? el('div', { class: 'row', style: 'gap:6px' },
        el('span', { class: 'tick on' }, '✓'),
        el('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Open ↗'))
      : el('span', { class: 'tick' }, '')));
  });

  tr.appendChild(el('td', null, text(a, 'caption', canEdit, 'Caption…')));
  tr.appendChild(el('td', null, check(a, 'linkCreated', canEdit)));
  tr.appendChild(el('td', null, check(a, 'linkAdded', canEdit)));

  custom.forEach(c => tr.appendChild(el('td', null, customCell(a, c, canEdit))));
  return tr;
}

// ---- cells -----------------------------------------------------------------
function check(a, key, canEdit) {
  const on = !!a[key];
  return el('button', {
    class: 'tick' + (on ? ' on' : ''), disabled: !canEdit,
    title: canEdit ? 'Toggle' : 'Read-only',
    onclick: canEdit ? async () => {
      const { save } = await import('../app.js');
      a[key] = !a[key];
      save('accounts', a);
      forceEmit();
    } : null,
  }, on ? '✓' : '');
}

function text(a, key, canEdit, ph) {
  if (!canEdit) return el('span', { class: 'ro-text', style: 'font-size:11.5px' }, (a[key] || '').trim() || '—');
  return el('input', {
    class: 'input cell', value: a[key] || '', placeholder: ph,
    oninput: async e => {
      const { save } = await import('../app.js');
      a[key] = e.target.value;
      save('accounts', a);          // quiet: no re-render while typing
    },
  });
}

function customCell(a, c, canEdit) {
  const extra = a.extra || {};
  const set = async v => {
    const { save } = await import('../app.js');
    if (!a.extra) a.extra = {};
    a.extra[c.id] = v;
    save('accounts', a);
  };

  if (c.type === 'check') {
    const on = !!extra[c.id];
    return el('button', {
      class: 'tick' + (on ? ' on' : ''), disabled: !canEdit,
      onclick: canEdit ? async () => { await set(!on); forceEmit(); } : null,
    }, on ? '✓' : '');
  }
  if (c.type === 'link') {
    const url = (extra[c.id] || '').trim();
    if (!canEdit) {
      return /^https?:\/\//.test(url)
        ? el('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Open ↗')
        : el('span', { class: 'hint' }, '—');
    }
    return el('div', { class: 'row', style: 'gap:5px' },
      el('input', { class: 'input cell', value: url, placeholder: 'Link…', oninput: e => set(e.target.value) }),
      /^https?:\/\//.test(url) ? el('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, '↗') : null);
  }
  if (!canEdit) return el('span', { class: 'ro-text', style: 'font-size:11.5px' }, (extra[c.id] || '').trim() || '—');
  return el('input', {
    class: 'input cell', value: extra[c.id] || '', placeholder: c.label || 'Value…',
    oninput: e => set(e.target.value),
  });
}
