// hooks.js — the day's shared hooks.
//
// Unlike everything else in the builder these are not per avatar: the marketing
// manager writes a handful each day that get used across all of them. So a hook
// carries only what a hook needs — the line itself, the reference video and any
// notes. There is nothing to mark made and nothing to mark posted, because a
// hook is not a video.
//
// Visible to the admin and the marketing manager only. This is the one place a
// manager writes rather than reads: making these is their job.

import { state, emit, forceEmit, uid, fmtDate, can } from '../state.js';
import { el, copyText } from '../ui.js';
import { guarded } from '../guard.js';
import { sortedConcepts, conceptById, conceptLabel } from '../concepts.js';

export function hooksForDate(date) {
  return state.db.dailyHooks
    .filter(h => h.date === date)
    .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

export function renderHooks(root, u) {
  const canEdit = can.editHooks(u);
  const rows = hooksForDate(state.date);

  root.appendChild(el('div', { class: 'row wrap', style: 'gap:10px;margin-bottom:16px' },
    el('span', { class: 'chip ' + (rows.length ? 'violet' : 'gray') },
      rows.length ? rows.length + (rows.length === 1 ? ' hook' : ' hooks') + ' for this day' : 'No hooks yet'),
    el('span', { class: 'hint' }, 'Written once and used across every avatar.'),
    el('span', { class: 'spacer' }),
    canEdit && el('button', { class: 'btn primary', onclick: addHook }, '+ Add hook')));

  if (!rows.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:36px' },
      canEdit
        ? 'Nothing for ' + fmtDate(state.date) + ' yet — add the first hook.'
        : 'No hooks written for ' + fmtDate(state.date) + '.'));
    return;
  }

  root.appendChild(el('div', { class: 'col', style: 'gap:12px' },
    rows.map((h, i) => card(h, i + 1, canEdit, rows.length))));
}

async function addHook() {
  const { save } = await import('../app.js');
  const existing = hooksForDate(state.date);
  save('dailyHooks', {
    id: uid('h'), date: state.date, order: existing.length,
    conceptId: '', variationId: '',
    hook: '', refVideo: '', notes: '',
    createdBy: state.user.name, createdAt: Date.now(),
  });
  emit();
}

async function quiet(id, fn) { const { mutateQuiet } = await import('../app.js'); mutateQuiet('dailyHooks', id, fn); }
async function loud(id, fn) { const { mutate } = await import('../app.js'); mutate('dailyHooks', id, fn); }

function card(h, num, canEdit, total) {
  const box = el('div', { class: 'card col', style: 'gap:13px' });

  const top = el('div', { class: 'row wrap' },
    el('span', { class: 'num' }, String(num)),
    labelPicker(h, canEdit),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn small', onclick: e => copyText(h.hook, e.currentTarget) }, 'Copy'));

  if (canEdit) {
    top.appendChild(el('button', {
      class: 'iconbtn', title: 'Move up', onclick: () => move(h, -1, total)
    }, '↑'));
    top.appendChild(el('button', {
      class: 'iconbtn', title: 'Move down', onclick: () => move(h, 1, total)
    }, '↓'));
    top.appendChild(el('button', {
      class: 'iconbtn danger', title: 'Delete hook', onclick: async () => {
        if (!confirm('Delete hook ' + num + '?')) return;
        const { removeItem } = await import('../app.js');
        removeItem('dailyHooks', h.id); emit();
      }
    }, '✕'));
  }
  box.appendChild(top);

  // the hook itself
  box.appendChild(el('span', { class: 'label' }, 'HOOK'));
  const hookRo = () => el('div', { class: 'ro-text', style: 'font-size:13.5px' }, (h.hook || '').trim() || '—');
  box.appendChild(canEdit
    ? guarded('hook:' + h.id + ':hook',
        () => el('textarea', {
          class: 'input', style: 'min-height:70px;font-size:13.5px', placeholder: 'The hook / opening line…',
          oninput: e => quiet(h.id, x => x.hook = e.target.value)
        }, h.hook || ''),
        hookRo)
    : hookRo());

  // reference video
  const ref = (h.refVideo || '').trim();
  const openRef = /^https?:\/\//.test(ref)
    ? el('a', { class: 'btn small', href: ref, target: '_blank', rel: 'noopener' }, 'Open ↗') : null;
  box.appendChild(el('div', { class: 'col', style: 'gap:6px' },
    el('span', { class: 'label' }, 'REFERENCE VIDEO'),
    canEdit
      ? el('div', { class: 'row wrap' },
        guarded('hook:' + h.id + ':refVideo',
          () => el('input', {
            class: 'input', style: 'flex:1;min-width:220px', placeholder: 'Paste the reference video link…',
            value: ref, oninput: e => quiet(h.id, x => x.refVideo = e.target.value)
          }),
          () => el('span', { class: 'ro-text' }, ref || '—')),
        openRef)
      : (openRef || el('span', { class: 'hint' }, 'No reference video'))));

  // notes
  const notesRo = () => el('div', { class: 'ro-text' }, (h.notes || '').trim() || '—');
  box.appendChild(el('div', { class: 'col', style: 'gap:6px' },
    el('span', { class: 'label' }, 'NOTES'),
    canEdit
      ? guarded('hook:' + h.id + ':notes',
          () => el('textarea', {
            class: 'input', style: 'min-height:54px', placeholder: 'Anything worth knowing about this hook…',
            oninput: e => quiet(h.id, x => x.notes = e.target.value)
          }, h.notes || ''),
          notesRo)
      : notesRo()));

  if (h.createdBy) box.appendChild(el('span', { class: 'hint' }, 'Added by ' + h.createdBy));
  return box;
}

// A hook is labelled by the concept it belongs to, picked from the shared list
// rather than typed, so the names match the ones used everywhere else. Where a
// concept has angles, one can be named too.
function labelPicker(h, canEdit) {
  const concepts = sortedConcepts();
  const c = conceptById(h.conceptId);

  if (!canEdit) {
    const label = conceptLabel(h.conceptId, h.variationId);
    return label
      ? el('span', { class: 'chip violet' }, label)
      : el('span', { class: 'hint' }, 'Unlabelled hook');
  }
  if (!concepts.length) {
    return el('span', { class: 'hint' }, 'No concepts yet — add them under Avatars → Concepts to label hooks.');
  }

  const row = el('div', { class: 'row wrap', style: 'gap:7px' });
  const sel = el('select', {
    class: 'input', style: 'width:auto;min-width:160px;height:30px;font-size:12px',
    onchange: e => loud(h.id, x => { x.conceptId = e.target.value; x.variationId = ''; })
  }, [el('option', { value: '' }, 'Unlabelled…')]
    .concat(concepts.map(x => el('option', { value: x.id }, x.name))));
  sel.value = h.conceptId || '';
  row.appendChild(sel);

  const vars = (c && c.variations) || [];
  if (vars.length) {
    const vsel = el('select', {
      class: 'input', style: 'width:auto;min-width:150px;height:30px;font-size:12px',
      onchange: e => loud(h.id, x => x.variationId = e.target.value)
    }, [el('option', { value: '' }, 'No particular angle')]
      .concat(vars.map(v => el('option', { value: v.id }, v.label || 'Untitled angle'))));
    vsel.value = h.variationId || '';
    row.appendChild(vsel);
  }
  return row;
}

// Reordering rewrites the whole day's order so it stays contiguous.
async function move(h, dir, total) {
  const rows = hooksForDate(state.date);
  const i = rows.findIndex(x => x.id === h.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= total) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  for (let k = 0; k < rows.length; k++) await loud(rows[k].id, x => x.order = k);
  forceEmit();
}
