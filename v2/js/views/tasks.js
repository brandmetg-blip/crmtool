// tasks.js — work handed between the admin and whoever produces it.
//
// The point is not a to-do list; there are plenty of those. The point is that a
// task about this workspace can WATCH ITSELF. "Add bodies for Breaking News on
// these eight pages" does not need anyone to report progress — the tool already
// knows which of those eight have a body link for that concept, so the bar
// fills as the work lands and the task offers to close itself when it is done.
//
// A free-form task is there for everything that cannot be measured that way.
//
// Three columns because two is not enough: something waiting and something
// half-built are different problems, and knowing which is which is most of what
// a board is for.

import { state, emit, forceEmit, uid, byId, can, todayStr, fmtDate } from '../state.js';
import { el, avatar } from '../ui.js';
import { sortedConcepts, conceptById, bodyLinkFor } from '../concepts.js';
import { overlay } from './accounts.js';
import { liveAccounts } from '../stages.js';

const COLUMNS = [
  ['todo', 'To do', 'gray'],
  ['doing', 'In progress', 'amber'],
  ['done', 'Done', 'green'],
];

// Who a task can be handed to: everyone who can see the board.
function assignables() {
  return (state.db.team || [])
    .filter(t => can.seeTasks(t))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// ---------------------------------------------------------------------------
// progress a task can work out for itself
// ---------------------------------------------------------------------------
export function taskProgress(t) {
  if (t.kind !== 'bodies' || !t.conceptId) return null;
  // count against the pages that still exist: a task naming an avatar that has
  // since been deleted would otherwise sit at "3 of 4" forever, with no fourth
  // page to go and do anything about
  const pages = (t.accountIds || []).map(id => byId(state.db.accounts, id)).filter(Boolean);
  if (!pages.length) return null;
  const done = pages.filter(a => bodyLinkFor(a, t.conceptId)).length;
  return { done, total: pages.length, complete: done === pages.length };
}

// Everything still open, not only what is assigned to you. The board is shared
// between two or three people; work sitting on someone else's name is still
// work outstanding, and the admin who handed it out is the one who needs to
// see it has not moved.
export function openTaskCount() {
  return (state.db.tasks || []).filter(t => t.status !== 'done').length;
}

// ---------------------------------------------------------------------------
export function renderTasks(root, u) {
  if (!can.seeTasks(u)) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      'The tasks board is for the admin and the marketing manager.'));
    return;
  }

  const all = (state.db.tasks || []).slice()
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (b.createdAt || 0) - (a.createdAt || 0));
  const mine = state.taskMine ? all.filter(t => t.assigneeId === u.id) : all;

  const head = el('div', { class: 'page-head' },
    el('div', null, el('h1', null, 'Tasks'),
      el('div', { class: 'sub' }, all.filter(t => t.status !== 'done').length + ' open')),
    el('div', { class: 'seg' },
      el('button', { class: state.taskMine ? '' : 'on', onclick: () => { state.taskMine = false; forceEmit(); } }, 'Everyone'),
      el('button', { class: state.taskMine ? 'on' : '', onclick: () => { state.taskMine = true; forceEmit(); } }, 'Mine')),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: () => openTask(null) }, '+ New task'));
  import('../app.js').then(({ statusPill }) => head.insertBefore(statusPill(), head.lastChild));
  root.appendChild(head);

  const board = el('div', { class: 'board' });
  COLUMNS.forEach(([key, label, tone]) => {
    const rows = mine.filter(t => (t.status || 'todo') === key);
    const col = el('div', { class: 'board-col' },
      el('div', { class: 'group-head', style: 'margin-bottom:10px' },
        el('span', { class: 'group-dot', style: 'background:var(--' + (tone === 'gray' ? 'dim' : tone) + ')' }),
        el('b', { style: 'font-size:13px' }, label),
        el('span', { class: 'spacer' }),
        el('span', { class: 'hint' }, String(rows.length))));

    if (!rows.length) {
      col.appendChild(el('div', { class: 'hint', style: 'padding:14px 2px' },
        key === 'done' ? 'Nothing finished yet.' : 'Nothing here.'));
    }
    rows.forEach(t => col.appendChild(card(t, u)));
    board.appendChild(col);
  });
  root.appendChild(board);
}

// ---------------------------------------------------------------------------
function card(t, u) {
  const p = taskProgress(t);
  const who = byId(state.db.team, t.assigneeId);
  const concept = conceptById(t.conceptId);
  const overdue = t.status !== 'done' && t.dueDate && t.dueDate < todayStr();

  const box = el('div', { class: 'card col task', style: 'gap:10px' },
    el('div', { class: 'row', style: 'gap:8px' },
      el('b', { style: 'font-size:13px;flex:1;min-width:0' }, t.title || 'Untitled task'),
      t.kind === 'bodies' ? el('span', { class: 'chip violet' }, 'Bodies') : null),
    concept ? el('span', { class: 'hint' }, 'Concept: ' + concept.name) : null);

  if ((t.detail || '').trim()) {
    box.appendChild(el('div', { class: 'ro-text', style: 'font-size:12px' }, t.detail.trim()));
  }

  // the part that watches itself
  if (p) {
    box.appendChild(el('div', { class: 'col', style: 'gap:5px' },
      el('div', { class: 'bar' },
        el('i', { style: 'width:' + Math.round(p.done / p.total * 100) + '%;background:' + (p.complete ? 'var(--green)' : 'var(--amber)') })),
      el('span', { class: 'hint' },
        p.done + ' of ' + p.total + ' pages have a body for this concept'
        + (p.complete && t.status !== 'done' ? ' — ready to close' : ''))));

    if (p.complete && t.status !== 'done') {
      box.appendChild(el('button', {
        class: 'btn small primary', style: 'align-self:flex-start', onclick: () => setStatus(t, 'done', u)
      }, 'Mark done'));
    }
  }

  box.appendChild(el('div', { class: 'row wrap', style: 'gap:7px' },
    who ? el('div', { class: 'row', style: 'gap:6px' }, avatar(who, 20),
      el('span', { class: 'hint' }, who.name)) : el('span', { class: 'chip gray' }, 'Unassigned'),
    el('span', { class: 'spacer' }),
    t.dueDate ? el('span', { class: 'chip ' + (overdue ? 'red' : 'gray') }, (overdue ? 'due ' : 'by ') + t.dueDate) : null));

  const actions = el('div', { class: 'row wrap', style: 'gap:6px;border-top:1px solid var(--line);padding-top:9px' });
  if (t.status !== 'doing' && t.status !== 'done') {
    actions.appendChild(el('button', { class: 'btn small', onclick: () => setStatus(t, 'doing', u) }, 'Start'));
  }
  if (t.status !== 'done') {
    actions.appendChild(el('button', { class: 'btn small', onclick: () => setStatus(t, 'done', u) }, 'Finish'));
  } else {
    actions.appendChild(el('button', { class: 'btn small', onclick: () => setStatus(t, 'todo', u) }, 'Reopen'));
    if (t.doneBy) actions.appendChild(el('span', { class: 'hint', style: 'align-self:center' }, 'by ' + t.doneBy));
  }
  actions.appendChild(el('span', { class: 'spacer' }));
  actions.appendChild(el('button', { class: 'btn small', onclick: () => openTask(t) }, 'Edit'));
  actions.appendChild(el('button', {
    class: 'iconbtn danger', title: 'Delete task', onclick: async () => {
      if (!confirm('Delete “' + (t.title || 'this task') + '”?')) return;
      const { removeItem } = await import('../app.js');
      removeItem('tasks', t.id); emit();
    }
  }, '✕'));
  box.appendChild(actions);
  return box;
}

async function setStatus(t, status, u) {
  const { save } = await import('../app.js');
  t.status = status;
  if (status === 'done') { t.doneAt = Date.now(); t.doneBy = u.name; }
  else { t.doneAt = null; t.doneBy = ''; }
  save('tasks', t); emit();
}

// ---------------------------------------------------------------------------
// the form
// ---------------------------------------------------------------------------
function closeModal() { state.modal = null; forceEmit(); }

function openTask(existing) {
  const t = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
      id: uid('tk'), kind: 'general', title: '', detail: '',
      conceptId: '', accountIds: [], assigneeId: '', dueDate: '',
      status: 'todo', createdBy: state.user.name, createdAt: Date.now(),
    };
  if (!Array.isArray(t.accountIds)) t.accountIds = [];

  const body = el('div', { class: 'modal-body' });
  const picked = new Set(t.accountIds);

  // kind
  const kindSeg = el('div', { class: 'seg mini' });
  const conceptWrap = el('div', { class: 'col', style: 'gap:9px' });
  const paintKind = () => {
    kindSeg.innerHTML = '';
    [['general', 'Anything'], ['bodies', 'Bodies for a concept']].forEach(([k, label]) =>
      kindSeg.appendChild(el('button', {
        class: t.kind === k ? 'on' : '',
        onclick: () => { t.kind = k; paintKind(); }
      }, label)));

    conceptWrap.innerHTML = '';
    if (t.kind !== 'bodies') return;

    const concepts = sortedConcepts();
    if (!concepts.length) {
      conceptWrap.appendChild(el('div', { class: 'hint' },
        'No concepts defined yet — add them under Avatars → Concepts.'));
      return;
    }
    const sel = el('select', {
      class: 'input', onchange: e => { t.conceptId = e.target.value; paintKind(); }
    }, [el('option', { value: '' }, 'Pick a concept…')]
      .concat(concepts.map(c => el('option', { value: c.id }, c.name))));
    sel.value = t.conceptId || '';
    conceptWrap.appendChild(el('div', { class: 'col', style: 'gap:5px' },
      el('span', { class: 'label' }, 'CONCEPT'), sel));

    // which pages need it — default to those still missing a body for it
    const accounts = liveAccounts(state.db.accounts)
      .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const missing = t.conceptId ? accounts.filter(a => !bodyLinkFor(a, t.conceptId)) : [];

    const list = el('div', { class: 'col', style: 'gap:6px' });
    const paintList = () => {
      list.innerHTML = '';
      list.appendChild(el('div', { class: 'row wrap', style: 'gap:7px' },
        el('span', { class: 'label' }, 'PAGES'),
        el('span', { class: 'hint' }, picked.size + ' of ' + accounts.length + ' selected'),
        el('span', { class: 'spacer' }),
        t.conceptId && missing.length ? el('button', {
          class: 'btn small', onclick: () => { picked.clear(); missing.forEach(a => picked.add(a.id)); paintList(); }
        }, 'Only the ' + missing.length + ' missing it') : null,
        el('button', { class: 'btn small', onclick: () => { accounts.forEach(a => picked.add(a.id)); paintList(); } }, 'All'),
        el('button', { class: 'btn small', onclick: () => { picked.clear(); paintList(); } }, 'Clear')));

      accounts.forEach(a => {
        const on = picked.has(a.id);
        const has = t.conceptId && bodyLinkFor(a, t.conceptId);
        list.appendChild(el('div', {
          class: 'pick-row' + (on ? ' on' : ''),
          onclick: () => { on ? picked.delete(a.id) : picked.add(a.id); paintList(); }
        },
          el('span', { class: 'check' + (on ? ' on' : '') }, on ? '✓' : ''),
          avatar(a, 24),
          el('span', { style: 'flex:1;min-width:0;font-size:12.5px;font-weight:600' }, a.name || 'Untitled'),
          has ? el('span', { class: 'chip green' }, 'has one') : null));
      });
    };
    paintList();
    conceptWrap.appendChild(list);
  };
  paintKind();

  body.appendChild(el('div', { class: 'col', style: 'gap:5px' }, el('span', { class: 'label' }, 'TASK TYPE'), kindSeg,
    el('span', { class: 'hint' },
      'A bodies task tracks itself: the tool already knows which pages have a body for that concept, so it fills in as the work lands.')));

  body.appendChild(el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, 'TITLE'),
    el('input', {
      class: 'input', value: t.title, placeholder: 'e.g. Breaking News bodies for the Moringa pages',
      oninput: e => t.title = e.target.value,
    })));

  body.appendChild(conceptWrap);

  body.appendChild(el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, 'NOTES'),
    el('textarea', { class: 'input', placeholder: 'Anything that helps whoever picks this up…', oninput: e => t.detail = e.target.value }, t.detail || '')));

  const people = assignables();
  const asg = el('select', { class: 'input', onchange: e => t.assigneeId = e.target.value },
    [el('option', { value: '' }, 'Anyone')].concat(people.map(p => el('option', { value: p.id }, p.name))));
  asg.value = t.assigneeId || '';

  body.appendChild(el('div', { class: 'row wrap', style: 'gap:16px;align-items:flex-end' },
    el('div', { class: 'col', style: 'gap:5px;flex:1;min-width:170px' }, el('span', { class: 'label' }, 'ASSIGN TO'), asg),
    el('div', { class: 'col', style: 'gap:5px' }, el('span', { class: 'label' }, 'DUE'),
      el('input', {
        class: 'input', type: 'date', style: 'width:160px', value: t.dueDate || '',
        onchange: e => t.dueDate = e.target.value,
      }))));

  const err = el('div', { class: 'error', style: 'display:none' });
  body.appendChild(err);

  body.appendChild(el('div', { class: 'row', style: 'gap:9px;padding-top:4px' },
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    el('button', {
      class: 'btn primary', onclick: async () => {
        if (!t.title.trim()) { err.textContent = 'Give the task a title.'; err.style.display = ''; return; }
        if (t.kind === 'bodies' && !t.conceptId) { err.textContent = 'Pick which concept the bodies are for.'; err.style.display = ''; return; }
        t.title = t.title.trim();
        t.accountIds = t.kind === 'bodies' ? [...picked] : [];
        const { save } = await import('../app.js');
        save('tasks', t);
        closeModal();
      }
    }, existing ? 'Save task' : 'Add task')));

  state.modal = overlay(existing ? 'Edit task' : 'New task', body);
  forceEmit();
}
