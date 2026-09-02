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

import { state, forceEmit, uid } from '../state.js';
import { el, avatar } from '../ui.js';
import { sortedConcepts, bodyLinkFor, accountAcceptsConcept } from '../concepts.js';
import { getPref, setPref } from '../prefs.js';
import { lifecycleChip, stageOnlyChip, qualityBadge, targetingChip, overlay, byProduct, productColor } from './accounts.js';

// Fixed columns, in the order they read best: identity first, then state.
// No Product column: the rows are grouped under the product already, and
// repeating it on every row only ate frozen width you have to scroll past.
const HEAD = [
  { id: 'num', label: '#', w: 44 },
  { id: 'pageCreated', label: 'Page created', type: 'check', w: 92 },
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

  // One block per product, in the same order as the cards. Row numbers run
  // straight through, because they number the sheet and not the group.
  const cols = HEAD.length + concepts.length + TAIL.length + custom.length;
  const groups = byProduct(accounts);
  // a lone "No product" heading over the whole sheet says nothing worth a row
  const heads = groups.some(g => g.product);
  const tbody = el('tbody');
  let n = 0;
  groups.forEach(g => {
    if (heads) tbody.appendChild(groupRow(g, cols));
    g.accounts.forEach(a => tbody.appendChild(row(a, ++n, concepts, custom, canEdit)));
  });
  table.appendChild(tbody);

  // data-keepscroll: the shell remembers how far this was dragged sideways and
  // puts it back after a re-render. Without it a wide sheet snaps to the first
  // column every time anything changes.
  root.appendChild(el('div', { class: 'sheet-wrap', 'data-keepscroll': 'avatar-sheet' }, table));

  root.appendChild(el('div', { class: 'hint', style: 'margin-top:10px' },
    concepts.length
      ? 'One column per concept, showing this avatar’s body script for it. Filled in here or on the avatar — it is the same field.'
      : 'Add concepts under Avatars → Concepts and each one gets a column here.'));
}

// ---------------------------------------------------------------------------
// the extra columns
// ---------------------------------------------------------------------------
// Opened from the sheet itself, which is the only place they are ever seen.
// The built-in columns and the per-concept ones are not editable here: the
// first are what every page has, and the second come from the concept library,
// so adding a concept already adds its column.
export function openColumns() {
  const cols = (getPref('sheetColumns') || []).slice();
  const body = el('div', { class: 'modal-body' });

  body.appendChild(el('div', { class: 'hint' },
    'The sheet already has the page tick, product, name, status, stage, caption and both link ticks, ' +
    'plus a column per concept. Add anything else you track.'));

  const save = async next => { await setPref('sheetColumns', next); forceEmit(); openColumns(); };

  const list = el('div', { class: 'col', style: 'gap:9px' });
  cols.forEach((c, i) => {
    list.appendChild(el('div', { class: 'card row wrap', style: 'padding:10px 11px;gap:9px' },
      el('input', {
        class: 'input', style: 'flex:1;min-width:150px;height:31px;font-size:12.5px',
        value: c.label || '', placeholder: 'Column name…',
        // onchange, not oninput: renaming should not rebuild the list mid-word
        onchange: e => save(cols.map((x, j) => j === i ? Object.assign({}, x, { label: e.target.value }) : x)),
      }),
      el('div', { class: 'seg mini' }, [['check', 'Tick'], ['text', 'Text'], ['link', 'Link']].map(([k, label]) =>
        el('button', {
          class: (c.type || 'check') === k ? 'on' : '',
          onclick: () => save(cols.map((x, j) => j === i ? Object.assign({}, x, { type: k }) : x)),
        }, label))),
      el('button', {
        class: 'iconbtn', title: 'Move left', disabled: i === 0,
        onclick: () => { const n = cols.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; save(n); }
      }, '←'),
      el('button', {
        class: 'iconbtn', title: 'Move right', disabled: i === cols.length - 1,
        onclick: () => { const n = cols.slice(); [n[i + 1], n[i]] = [n[i], n[i + 1]]; save(n); }
      }, '→'),
      el('button', {
        class: 'iconbtn danger', title: 'Delete column', onclick: () => {
          if (!confirm('Delete the “' + (c.label || 'Untitled') + '” column?\n\nWhat was filled in stays on each page but stops being shown.')) return;
          save(cols.filter((_, j) => j !== i));
        }
      }, '✕')));
  });
  if (!cols.length) {
    list.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:22px;font-size:12px' },
      'No extra columns yet.'));
  }

  list.appendChild(el('button', {
    class: 'add-row', onclick: () => {
      const label = prompt('Name of the new column:');
      if (!label || !label.trim()) return;
      save(cols.concat([{ id: uid('col'), label: label.trim(), type: 'check' }]));
    }
  }, '+  Add column'));

  body.appendChild(list);
  body.appendChild(el('div', { class: 'row', style: 'padding-top:4px' },
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'btn primary', onclick: () => { state.modal = null; forceEmit(); }
    }, 'Done')));

  state.modal = overlay('Sheet columns', body, { wide: true });
  forceEmit();
}

function colClass(id) {
  // the identifying columns stay put while the rest scrolls sideways
  return ['num', 'pageCreated', 'pfp', 'name'].includes(id) ? 'stick s-' + id : '';
}

// A product's heading, spanning the whole table. The label itself is stuck to
// the left edge, so it stays readable however far out you have scrolled.
function groupRow(g, cols) {
  const p = g.product;
  const c = p ? productColor(p) : 'var(--dim)';
  const n = g.accounts.length;
  return el('tr', { class: 'grp' },
    el('td', { colspan: String(cols) },
      el('div', { class: 'grp-label' },
        el('span', { class: 'group-dot', style: 'background:' + c }),
        p && p.imageUrl ? el('img', { class: 'prod-ico', src: p.imageUrl, alt: '' }) : null,
        el('b', { style: 'color:' + c }, p ? p.name : 'No product'),
        el('span', { class: 'hint' }, n + (n === 1 ? ' avatar' : ' avatars')))));
}

function row(a, n, concepts, custom, canEdit) {
  const tr = el('tr');

  tr.appendChild(el('td', { class: colClass('num') }, el('span', { class: 'rownum' }, '#' + n)));
  tr.appendChild(el('td', { class: colClass('pageCreated') }, check(a, 'pageCreated', canEdit)));
  tr.appendChild(el('td', { class: colClass('pfp') }, avatar(a, 30)));
  tr.appendChild(el('td', { class: colClass('name') },
    el('div', { class: 'row', style: 'gap:6px' },
      el('b', { style: 'font-size:12.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, a.name || 'Untitled'),
      qualityBadge(a))));
  tr.appendChild(el('td', null, lifecycleChip(a)));
  tr.appendChild(el('td', null, el('div', { class: 'row wrap', style: 'gap:5px' }, stageOnlyChip(a), targetingChip(a))));

  // one cell per concept: has a body script, and a way straight to it. A
  // concept the page's product does not take is struck through rather than
  // shown as an empty box waiting to be filled.
  concepts.forEach(c => {
    if (!accountAcceptsConcept(a, c.id)) {
      tr.appendChild(el('td', { class: 'na', title: 'Not used for this product' }, '—'));
      return;
    }
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
// A tick repaints itself instead of asking the app to re-render. Nothing else
// on screen depends on these boxes, and rebuilding the table to change one of
// them was what threw away the sideways scroll on every single click.
function tickButton(isOn, canEdit, apply) {
  const btn = el('button', {
    class: 'tick' + (isOn() ? ' on' : ''), disabled: !canEdit,
    title: canEdit ? 'Toggle' : 'Read-only',
    onclick: canEdit ? async () => {
      const next = !isOn();
      btn.classList.toggle('on', next);      // paint first: no wait, no jump
      btn.textContent = next ? '✓' : '';
      await apply(next);
    } : null,
  }, isOn() ? '✓' : '');
  return btn;
}

function check(a, key, canEdit) {
  return tickButton(() => !!a[key], canEdit, async next => {
    const { save } = await import('../app.js');
    a[key] = next;
    save('accounts', a);
  });
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
    return tickButton(() => !!(a.extra || {})[c.id], canEdit, set);
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
