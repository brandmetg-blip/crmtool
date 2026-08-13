// builder.js — the daily workflow, in two modes.
//
//   VIDEOS  — one card per avatar showing how many of that day's videos are
//             made. Open a card to get that avatar's sheet: a row per video
//             with the brief (concept/hook/body/reference/notes), what kind it
//             is (Growth or Product), how it's produced (Assembly, Scratch or
//             Repost), which video editor it belongs to, whether it's made
//             (+ the finished link), and whether it's posted (+ platforms).
//
//   SCRIPTS — the day's Main Scripts: frames with 9:16 stills and AI prompts,
//             copied by editors and ticked off per avatar.
//
// Who can do what:
//   admin / manager  write the brief and assign editors
//   editor           read-only brief, ticks "made" and pastes the link, and
//                    only ever sees videos assigned to them
//   poster           read-only brief, ticks "posted" and the platforms

import {
  state, emit, forceEmit, uid, todayStr, shiftDate, fmtDate, byId, can,
  myAccounts, visibleEntries, builderAccounts,
} from '../state.js';
import { el, copyText, avatar } from '../ui.js';
import { presence } from '../presence.js';
import { overlay } from './accounts.js';

const TOOLS = [['grok', 'Grok'], ['veo', 'Veo'], ['omniflash', 'Omni Flash']];
const TYPES = ['Growth', 'Product'];
const PROD = ['Assembly', 'Scratch', 'Repost'];
const PLATFORMS = [['facebook', 'FB', 'blue'], ['instagram', 'IG', 'pink']];

// ---- pre-made bodies -------------------------------------------------------
// Assembly means the body already exists: each avatar keeps its own Drive
// folder per concept (set under Avatars, shown under Assets). An entry stores
// the CONCEPT NAME, not the URL, and the link is resolved from the avatar every
// time it is shown — so fixing a moved folder once fixes every video using it.
//
// Concept labels are free text, so match them the way a person would: trimmed
// and case-insensitive.
const normConcept = s => (s || '').trim().toLowerCase();

function bodyLinkFor(account, conceptLabel) {
  const want = normConcept(conceptLabel);
  if (!want || !account) return '';
  const hit = (account.bodyLinks || []).find(b => normConcept(b.concept) === want);
  return hit ? (hit.url || '').trim() : '';
}

// Every concept label across the given avatars, de-duped case-insensitively.
// Where spellings differ ("Transformation" vs "transformation") show the most
// common one, preferring a capitalised spelling on a tie — matching stays
// case-insensitive either way, this is only what the human reads.
function conceptsAcross(accounts) {
  const tally = new Map();   // normalised -> Map(spelling -> count)
  accounts.forEach(a => (a.bodyLinks || []).forEach(b => {
    const k = normConcept(b.concept);
    if (!k) return;
    const spellings = tally.get(k) || new Map();
    const s = (b.concept || '').trim();
    spellings.set(s, (spellings.get(s) || 0) + 1);
    tally.set(k, spellings);
  }));

  const best = spellings => [...spellings.entries()].sort((x, y) =>
    (y[1] - x[1]) || (/^[A-Z]/.test(y[0]) - /^[A-Z]/.test(x[0])) || x[0].localeCompare(y[0]))[0][0];

  return [...tally.values()].map(best).sort((x, y) => x.localeCompare(y));
}

// A script/brief field two people could type into at once. Focusing it claims
// it; everyone else sees it read-only with who has it, until they move away.
// Claims expire on their own, so nothing can get permanently stuck.
function guarded(fieldKey, buildEditor, readOnly) {
  const held = presence.heldBy(fieldKey);
  if (!held) {
    const node = buildEditor();
    node.addEventListener('focus', () => presence.claim(fieldKey));
    node.addEventListener('blur', () => presence.release(fieldKey));
    return node;
  }
  return el('div', { class: 'col', style: 'gap:6px' },
    el('div', { class: 'lock' },
      held.name + ' is editing this',
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn small', title: 'Edit it anyway — their text stays in their own copy until they save',
        onclick: () => { presence.takeOver(fieldKey); forceEmit(); }
      }, 'Take over')),
    readOnly());
}

// ---------------------------------------------------------------------------
export function renderBuilder(root) {
  const u = state.user;
  root.appendChild(head(u));
  root.appendChild(dayStrip(u));
  if (state.builderMode === 'scripts') scriptsMode(root, u);
  else videosMode(root, u);
}

function head(u) {
  const scriptsOn = state.builderMode === 'scripts';
  const wrap = el('div', { class: 'page-head' },
    el('div', null, el('h1', null, 'Daily Builder'), el('div', { class: 'sub' }, fmtDate(state.date))),
    el('div', { class: 'seg' },
      el('button', { onclick: () => go(shiftDate(state.date, -1)) }, '‹'),
      el('button', { onclick: () => go(todayStr()) }, 'Today'),
      el('button', { onclick: () => go(shiftDate(state.date, 1)) }, '›')),
    el('input', {
      class: 'input', type: 'date', style: 'width:150px', value: state.date,
      onchange: e => { if (e.target.value) go(e.target.value); }
    }),
    el('div', { class: 'seg blue' },
      el('button', {
        class: scriptsOn ? '' : 'on',
        onclick: () => { state.builderMode = 'videos'; state.openScript = null; forceEmit(); }
      }, 'Videos'),
      el('button', {
        class: scriptsOn ? 'on' : '',
        onclick: () => { state.builderMode = 'scripts'; state.builderAvatar = null; forceEmit(); }
      }, 'Main Scripts')),
    el('span', { class: 'spacer' }));

  import('../app.js').then(({ statusPill }) => wrap.appendChild(statusPill()));

  if (scriptsOn && can.editScripts(u) && !state.openScript) {
    wrap.appendChild(el('button', { class: 'btn violet', onclick: addScript }, '+ Add script'));
  }
  // Write the brief once, drop it on as many avatars as you like.
  if (!scriptsOn && can.editVideos(u) && !state.builderAvatar) {
    wrap.appendChild(el('button', { class: 'btn violet', onclick: () => openMassAdd(u) }, '+ Mass add script'));
  }
  return wrap;
}

function go(date) {
  state.date = date; state.openScript = null; state.builderAvatar = null; forceEmit();
}

function dayStrip(u) {
  const dow = new Date(state.date + 'T00:00:00').getDay();
  const start = shiftDate(state.date, -dow);
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const T = todayStr();
  const accts = builderAccounts(u, state.db);
  const scriptsOn = state.builderMode === 'scripts';

  return el('div', { class: 'days' }, DOW.map((dw, i) => {
    const ds = shiftDate(start, i);
    let caption = '';
    if (scriptsOn) {
      const n = state.db.scripts.filter(s => s.date === ds).length;
      caption = n ? n + (n === 1 ? ' script' : ' scripts') : '';
    } else {
      const es = visibleEntries(u, state.db.dailyEntries.filter(e => e.date === ds), accts);
      caption = es.length ? es.filter(e => e.done).length + '/' + es.length : '';
    }
    return el('div', {
      class: 'day' + (ds === state.date ? ' sel' : '') + (ds === T ? ' today' : ''),
      onclick: () => go(ds)
    },
      el('div', { class: 'dw' }, dw),
      el('div', { class: 'dn' }, String(+ds.slice(8))),
      el('div', { class: 'ct' }, caption));
  }));
}

// ===========================================================================
// VIDEOS MODE
// ===========================================================================
function videosMode(root, u) {
  const all = builderAccounts(u, state.db);
  const dayAll = state.db.dailyEntries.filter(e => e.date === state.date);
  const day = visibleEntries(u, dayAll, all);

  if (state.builderAvatar) {
    const acct = byId(all, state.builderAvatar);
    if (acct) { root.appendChild(sheet(acct, day.filter(e => e.accountId === acct.id), u)); return; }
    state.builderAvatar = null;   // avatar vanished (deleted, or access changed)
  }

  if (!all.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      can.seesAllAccounts(u) ? 'No avatars yet — add them under Avatars.' : 'No avatars assigned to you yet — ask an admin.'));
    return;
  }

  // narrow to one editor's avatars, if a filter is set
  const accounts = filterByEditor(all);

  const main = el('div', { style: 'flex:1;min-width:0' });
  // narrowing the view is reading, not writing — managers get it too
  if (can.seesAllAccounts(u)) main.appendChild(editorFilter(all));
  main.appendChild(summary(day.filter(e => accounts.some(a => a.id === e.accountId)), u));

  if (!accounts.length) {
    main.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      'That editor has no avatars assigned yet.'));
  } else {
    main.appendChild(el('div', { class: 'grid' },
      accounts.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(a => avatarCard(a, day.filter(e => e.accountId === a.id), u))));
  }

  // The admin gets a standing overview of what each editor still owes.
  if (u.role === 'admin') {
    root.appendChild(el('div', { class: 'with-aside' }, main, outstandingPanel(dayAll, all)));
  } else {
    root.appendChild(main);
  }
}

// Which avatars a given editor can work on — the same rule the editor's own
// session uses, so the filter shows exactly what they would see.
function accountsForEditor(editor, all) {
  const ids = new Set(editor.assignments || []);
  state.db.dailyEntries.forEach(e => { if (e.assignedEditorId === editor.id) ids.add(e.accountId); });
  return all.filter(a => ids.has(a.id));
}

function filterByEditor(all) {
  const id = state.builderEditor;
  if (!id || id === 'all') return all;
  const ed = byId(state.db.team, id);
  if (!ed) { state.builderEditor = 'all'; return all; }
  return accountsForEditor(ed, all);
}

function editorFilter(all) {
  const editors = state.db.team.filter(t => t.role === 'editor');
  if (!editors.length) return el('span');

  const sel = el('select', {
    class: 'input', style: 'width:auto;min-width:200px',
    onchange: e => { state.builderEditor = e.target.value; forceEmit(); }
  }, [el('option', { value: 'all' }, 'All avatars')].concat(editors.map(t => {
    const n = accountsForEditor(t, all).length;
    return el('option', { value: t.id }, t.name + ' (' + n + ')');
  })));
  sel.value = state.builderEditor || 'all';

  const row = el('div', { class: 'row wrap', style: 'gap:9px;margin-bottom:14px' },
    el('span', { class: 'label' }, 'SHOW'), sel);
  if (state.builderEditor && state.builderEditor !== 'all') {
    row.appendChild(el('button', {
      class: 'btn small', onclick: () => { state.builderEditor = 'all'; forceEmit(); }
    }, 'Clear filter'));
  }
  return row;
}

// ---- admin-only: what each editor still has open ----------------------------
function outstandingPanel(dayAll, all) {
  const editors = state.db.team.filter(t => t.role === 'editor');
  const aside = el('div', { class: 'aside' },
    el('div', { class: 'row', style: 'margin-bottom:10px' },
      el('span', { class: 'label' }, 'STILL TO FINISH'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint' }, fmtDate(state.date).split(',')[0])));

  const open = dayAll.filter(e => !e.done);
  if (!open.length) {
    aside.appendChild(el('div', { class: 'card', style: 'padding:14px;text-align:center;color:var(--dim);font-size:12px' },
      dayAll.length ? 'Everything for this day is made.' : 'Nothing planned for this day.'));
    return aside;
  }

  const block = (title, entries, tone) => {
    if (!entries.length) return null;
    // one line per avatar, however many videos are open on it
    const perAcct = new Map();
    entries.forEach(e => perAcct.set(e.accountId, (perAcct.get(e.accountId) || 0) + 1));

    const card = el('div', { class: 'card col', style: 'gap:8px;padding:12px 13px' },
      el('div', { class: 'row' },
        el('b', { style: 'font-size:12.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, title),
        el('span', { class: 'spacer' }),
        el('span', { class: 'chip ' + tone }, String(entries.length))));

    [...perAcct.entries()].forEach(([id, n]) => {
      const a = byId(all, id) || byId(state.db.accounts, id);
      if (!a) return;
      card.appendChild(el('div', {
        class: 'row', style: 'gap:8px;cursor:pointer',
        onclick: () => { state.builderAvatar = a.id; forceEmit(); }
      },
        avatar(a, 22),
        el('span', { style: 'flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, a.name || 'Untitled'),
        n > 1 ? el('span', { class: 'hint' }, '×' + n) : null));
    });
    return card;
  };

  editors.forEach(t => {
    const mine = open.filter(e => e.assignedEditorId === t.id);
    const c = block(t.name, mine, 'amber');
    if (c) aside.appendChild(c);
  });

  const unassigned = open.filter(e => !e.assignedEditorId);
  const uc = block('Unassigned', unassigned, 'gray');
  if (uc) aside.appendChild(uc);

  // an editor with nothing open is worth seeing too — it means they are clear
  const clear = editors.filter(t => !open.some(e => e.assignedEditorId === t.id));
  if (clear.length) {
    aside.appendChild(el('div', { class: 'hint', style: 'padding:2px 2px' },
      'All done: ' + clear.map(t => (t.name || '').split(/\s+/)[0]).join(', ')));
  }
  return aside;
}

function summary(day, u) {
  const done = day.filter(e => e.done).length;
  const left = day.length - done;
  const posted = day.filter(e => e.posted).length;
  const bar = el('div', { class: 'row wrap', style: 'margin-bottom:16px;gap:10px' });

  if (!day.length) {
    bar.appendChild(el('span', { class: 'chip gray' }, 'No videos planned for this day'));
  } else if (left === 0) {
    bar.appendChild(el('span', { class: 'chip green' }, 'All ' + day.length + ' videos made'));
  } else {
    bar.appendChild(el('span', { class: 'chip amber' }, left + (left === 1 ? ' video' : ' videos') + ' still to make'));
    bar.appendChild(el('span', { class: 'chip gray' }, done + ' / ' + day.length + ' done'));
  }
  if (can.seesAllAccounts(u) && day.length) bar.appendChild(el('span', { class: 'chip blue' }, posted + ' posted'));
  return bar;
}

function avatarCard(a, entries, u) {
  const done = entries.filter(e => e.done).length;
  const posted = entries.filter(e => e.posted).length;
  const paused = (a.status || 'Active') === 'Paused';
  const pct = entries.length ? Math.round(done / entries.length * 100) : 0;
  const allDone = entries.length > 0 && done === entries.length;
  const col = allDone ? 'var(--green)' : (entries.length ? 'var(--amber)' : 'var(--dim)');

  const status = !entries.length ? 'No videos yet'
    : allDone ? 'All done'
      : (entries.length - done) + ((entries.length - done) === 1 ? ' video to make' : ' videos to make');

  const card = el('div', {
    class: 'card col av-card' + (paused ? ' paused' : ' click'), style: 'gap:12px',
    onclick: paused ? null : () => { state.builderAvatar = a.id; forceEmit(); },
  },
    el('div', { class: 'row' },
      avatar(a, 42),
      el('div', { style: 'min-width:0;flex:1' },
        el('b', { style: 'display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, a.name || 'Untitled'),
        el('span', { class: 'hint' }, a.character || 'No character')),
      el('span', { style: 'font-size:15px;font-weight:800;color:' + col }, done + '/' + entries.length)),
    el('div', { class: 'bar' }, el('i', { style: 'width:' + pct + '%;background:' + col })),
    el('div', { class: 'row' },
      el('span', { style: 'font-size:11.5px;font-weight:700;color:' + col }, status),
      el('span', { class: 'spacer' }),
      can.seesAllAccounts(u) && entries.length ? el('span', { class: 'hint' }, posted + ' posted') : null));

  if (paused) card.appendChild(el('span', { class: 'chip gray', style: 'align-self:flex-start' }, 'Paused'));
  return card;
}

// ---------------------------------------------------------------------------
function sheet(a, entries, u) {
  const canEdit = can.editVideos(u);
  const done = entries.filter(e => e.done).length;
  const wrap = el('div', { class: 'col', style: 'gap:14px' });

  wrap.appendChild(el('div', { class: 'row wrap' },
    el('button', { class: 'btn small', onclick: () => { state.builderAvatar = null; forceEmit(); } }, '‹ All avatars'),
    avatar(a, 36),
    el('div', null,
      el('b', { style: 'font-size:15px' }, a.name || 'Untitled'),
      el('div', { class: 'hint' }, a.character || 'No character')),
    el('span', { class: 'spacer' }),
    el('span', { class: 'chip ' + (entries.length && done === entries.length ? 'green' : 'gray') },
      done + ' / ' + entries.length + ' made'),
    canEdit && el('button', { class: 'btn primary', onclick: () => addEntry(a) }, '+ Add video')));

  if (!entries.length) {
    wrap.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:30px' },
      canEdit ? 'No videos for this avatar today — add the first one.' : 'Nothing assigned to you for this avatar today.'));
    return wrap;
  }

  entries.slice().sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0))
    .forEach((en, i) => wrap.appendChild(entryRow(en, a, i + 1, u)));
  return wrap;
}

async function addEntry(a) {
  const { save } = await import('../app.js');
  save('dailyEntries', {
    id: uid('de'), date: state.date, accountId: a.id,
    type: 'Product', prod: 'Assembly', assignedEditorId: '',
    concept: '', hook: '', hookKind: 'text', hookLink: '',
    body: '', bodyKind: 'text', bodyLink: '',
    refVideo: '', notes: '',
    done: false, doneAt: null, doneBy: '', videoLink: '',
    posted: false, postedAt: null, postedDate: '', platforms: [],
    win: false, createdBy: state.user.name, createdAt: Date.now(),
  });
  emit();
}

// ---------------------------------------------------------------------------
// Mass add — write the brief once, create one video per selected avatar.
// ---------------------------------------------------------------------------
function openMassAdd(u) {
  const accounts = builderAccounts(u, state.db)
    .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const editors = state.db.team.filter(t => t.role === 'editor');

  // Start with every avatar that isn't paused — the usual case is "all of them".
  const picked = new Set(accounts.filter(a => (a.status || 'Active') !== 'Paused').map(a => a.id));

  const draft = {
    date: state.date, type: 'Product', prod: 'Assembly', assign: 'auto',
    concept: '', hook: '', hookKind: 'text', hookLink: '',
    body: '', bodyKind: 'text', bodyLink: '', bodyConcept: '',
    refVideo: '', notes: '',
  };

  const body = el('div', { class: 'modal-body' });
  const blurb = el('div', { class: 'hint' });
  body.appendChild(blurb);

  // ---- which day these land on (defaults to the day you're looking at)
  const dayCount = el('span', { class: 'hint' });
  body.appendChild(el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, 'DATE'),
    el('div', { class: 'row wrap', style: 'gap:9px' },
      el('input', {
        class: 'input', type: 'date', style: 'width:170px', value: draft.date,
        onchange: e => { if (e.target.value) { draft.date = e.target.value; refreshDate(); } }
      }),
      el('button', { class: 'btn small', onclick: () => setDate(todayStr()) }, 'Today'),
      el('button', { class: 'btn small', onclick: () => setDate(shiftDate(todayStr(), 1)) }, 'Tomorrow'),
      dayCount)));

  function setDate(d) {
    draft.date = d;
    const inp = body.querySelector('input[type=date]');
    if (inp) inp.value = d;
    refreshDate();
  }
  function refreshDate() {
    blurb.textContent = 'Fill this in once. Every avatar you tick gets its own copy in their Daily Builder for '
      + fmtDate(draft.date) + ', which they can then complete independently.';
    const n = state.db.dailyEntries.filter(e => e.date === draft.date).length;
    dayCount.textContent = n ? n + (n === 1 ? ' video already on this day' : ' videos already on this day') : 'Nothing on this day yet';
    if (typeof refresh === 'function') refresh();
  }

  // ---- the brief
  body.appendChild(el('div', { class: 'row wrap', style: 'gap:16px;align-items:flex-end' },
    el('div', { class: 'col', style: 'gap:5px' }, el('span', { class: 'label' }, 'TYPE'),
      el('div', { class: 'seg mini' }, TYPES.map(t => {
        const b = el('button', { class: draft.type === t ? 'on' : '', onclick: () => { draft.type = t; repaintSegs(); } }, t);
        b.dataset.seg = 'type'; b.dataset.val = t; return b;
      }))),
    el('div', { class: 'col', style: 'gap:5px' }, el('span', { class: 'label' }, 'PRODUCTION'),
      el('div', { class: 'seg mini' }, PROD.map(p => {
        const b = el('button', {
          class: draft.prod === p ? 'on' : '',
          onclick: () => {
            draft.prod = p;
            // Assembly means the body is already made, so reach for the
            // pre-made folders by default — unless something was typed.
            if (p === 'Assembly' && draft.bodyKind === 'text' && !draft.body) {
              draft.bodyKind = 'concept';
              bodyField.repaint();
            }
            repaintSegs(); refresh();
          }
        }, p);
        b.dataset.seg = 'prod'; b.dataset.val = p; return b;
      })))));

  function repaintSegs() {
    body.querySelectorAll('[data-seg]').forEach(b => {
      b.classList.toggle('on', draft[b.dataset.seg] === b.dataset.val);
    });
  }

  const field = (key, label, ph, tag) => el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, label),
    el(tag || 'input', { class: 'input', placeholder: ph, oninput: e => draft[key] = e.target.value }));

  const conceptField = field('concept', 'CONCEPT', 'e.g. Transformation, Villain…');
  body.appendChild(conceptField);
  body.appendChild(draftSource(draft, 'hook', 'HOOK', 'The hook / opening line…'));

  const coverage = el('div');
  const bodyField = draftSource(draft, 'body', 'BODY', 'The body / script…', {
    concepts: () => conceptsAcross(accounts),
    coverage: () => coverage,
    onKind: () => refresh(),
    onConcept: () => {
      // picking a concept also names the video, so the builder shows it
      draft.concept = draft.bodyConcept;
      const inp = conceptField.querySelector('input');
      if (inp) inp.value = draft.bodyConcept;
      refresh();
    },
  });
  body.appendChild(bodyField);
  body.appendChild(field('refVideo', 'REFERENCE VIDEO', 'Paste the reference video link…'));
  body.appendChild(field('notes', 'NOTES', 'Anything the editors should know…', 'textarea'));

  // ---- who edits it
  const assignSel = el('select', { class: 'input', onchange: e => draft.assign = e.target.value },
    [el('option', { value: 'auto' }, 'Each avatar’s own editor (recommended)'),
     el('option', { value: '' }, 'Anyone')]
      .concat(editors.map(t => el('option', { value: t.id }, t.name))));
  assignSel.value = 'auto';
  body.appendChild(el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, 'ASSIGN TO'), assignSel,
    el('span', { class: 'hint' }, '“Each avatar’s own editor” uses the assignments you set under Team. An avatar with no editor, or more than one, is left unassigned.')));

  // ---- avatar picker
  const pickWrap = el('div', { class: 'col', style: 'gap:7px' });
  const countLabel = el('span', { class: 'hint' });
  const addBtn = el('button', { class: 'btn primary' });

  function refresh() {
    // ---- how many of the avatars actually have this concept set up
    const useConcept = draft.bodyKind === 'concept' && !!draft.bodyConcept;
    coverage.innerHTML = '';
    if (useConcept) {
      const covered = accounts.filter(a => bodyLinkFor(a, draft.bodyConcept));
      const missing = accounts.filter(a => !bodyLinkFor(a, draft.bodyConcept));
      coverage.appendChild(el('div', { class: 'row wrap', style: 'gap:8px' },
        el('span', { class: 'chip ' + (missing.length ? 'amber' : 'green') },
          covered.length + ' of ' + accounts.length + ' avatars have bodies for this'),
        missing.length && covered.length
          ? el('button', {
            class: 'btn small',
            onclick: () => { picked.clear(); covered.forEach(a => picked.add(a.id)); refresh(); }
          }, 'Select only those')
          : null));
      if (missing.length) {
        coverage.appendChild(el('span', { class: 'hint' },
          'No link yet: ' + missing.map(a => a.name || 'Untitled').join(', ')
          + ' — they still get the video, just with an empty body.'));
      }
    }

    countLabel.textContent = picked.size + ' of ' + accounts.length + ' selected';
    addBtn.textContent = picked.size
      ? 'Add to ' + picked.size + (picked.size === 1 ? ' avatar' : ' avatars')
      : 'Pick at least one avatar';
    addBtn.disabled = !picked.size;
    addBtn.style.opacity = picked.size ? '' : '.5';
    pickWrap.querySelectorAll('[data-acct]').forEach(row => {
      const id = row.dataset.acct;
      const on = picked.has(id);
      row.style.borderColor = on ? 'rgba(52,224,138,0.35)' : '';
      const c = row.querySelector('.check');
      c.classList.toggle('on', on);
      c.textContent = on ? '✓' : '';
      // how many that avatar already has on the CHOSEN day, not today
      const n = state.db.dailyEntries.filter(e => e.date === draft.date && e.accountId === id).length;
      row.querySelector('.already').textContent = n ? n + ' already' : '';

      // whether this avatar has the picked concept's bodies
      const cover = row.querySelector('.cover');
      const acct = accounts.find(a => a.id === id);
      cover.textContent = '';
      cover.className = 'chip cover';
      if (useConcept && acct) {
        const has = !!bodyLinkFor(acct, draft.bodyConcept);
        cover.textContent = has ? '✓ bodies' : 'no bodies';
        cover.className = 'chip cover ' + (has ? 'green' : 'gray');
      }
    });
  }

  pickWrap.appendChild(el('div', { class: 'row wrap', style: 'gap:7px' },
    el('span', { class: 'label' }, 'AVATARS'), countLabel,
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn small', onclick: () => { accounts.forEach(a => picked.add(a.id)); refresh(); } }, 'Select all'),
    el('button', { class: 'btn small', onclick: () => { picked.clear(); refresh(); } }, 'Clear')));

  accounts.forEach(a => {
    const paused = (a.status || 'Active') === 'Paused';
    pickWrap.appendChild(el('div', {
      class: 'card row', style: 'padding:8px 11px;gap:10px;cursor:pointer', 'data-acct': a.id,
      onclick: () => { picked.has(a.id) ? picked.delete(a.id) : picked.add(a.id); refresh(); }
    },
      el('span', { class: 'check' }),
      avatar(a, 28),
      el('div', { style: 'min-width:0;flex:1' },
        el('b', { style: 'font-size:12.5px;display:block' }, a.name || 'Untitled'),
        el('span', { class: 'hint' }, a.character || 'No character')),
      paused && el('span', { class: 'chip gray' }, 'Paused'),
      el('span', { class: 'chip cover' }),
      el('span', { class: 'hint already' })));
  });
  body.appendChild(pickWrap);

  // ---- footer
  addBtn.onclick = async () => {
    const { save } = await import('../app.js');
    const chosen = accounts.filter(a => picked.has(a.id));
    chosen.forEach(a => {
      save('dailyEntries', {
        id: uid('de'), date: draft.date, accountId: a.id,
        type: draft.type, prod: draft.prod,
        assignedEditorId: editorFor(a, draft.assign, editors),
        concept: draft.concept,
        hook: draft.hook, hookKind: draft.hookKind, hookLink: draft.hookLink,
        body: draft.body, bodyKind: draft.bodyKind, bodyLink: draft.bodyLink,
        bodyConcept: draft.bodyConcept,   // resolved against the avatar when shown
        refVideo: draft.refVideo, notes: draft.notes,
        done: false, doneAt: null, doneBy: '', videoLink: '',
        posted: false, postedAt: null, postedDate: '', platforms: [],
        win: false, createdBy: state.user.name, createdAt: Date.now(),
      });
    });
    state.modal = null;
    state.date = draft.date;        // jump to the day you just filled, so you see it
    state.builderAvatar = null;
    forceEmit();
  };

  body.appendChild(el('div', { class: 'row', style: 'gap:9px;padding-top:4px' },
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: () => { state.modal = null; forceEmit(); } }, 'Cancel'),
    addBtn));

  refreshDate();   // fills the blurb, the day count and the per-avatar counts
  state.modal = overlay('Mass add script', body);
  forceEmit();
}

// Hook/body in the mass-add form, with the same Text/Link choice the manual
// row has — so a brief that lives in a Google Doc can be linked, not pasted.
// The body gets a third choice, "From concept": pick a concept once and every
// avatar receives its OWN pre-made bodies folder for it.
function draftSource(draft, key, label, ph, opts) {
  opts = opts || {};
  const kindKey = key + 'Kind', linkKey = key + 'Link';
  const kinds = opts.concepts
    ? [['text', 'Text'], ['link', 'Link'], ['concept', 'From concept']]
    : [['text', 'Text'], ['link', 'Link']];

  const seg = el('div', { class: 'seg mini' });
  const slot = el('div', { class: 'col', style: 'gap:6px' });

  const paint = () => {
    seg.innerHTML = '';
    kinds.forEach(([k, l]) => seg.appendChild(el('button', {
      class: draft[kindKey] === k ? 'on' : '',
      onclick: () => { draft[kindKey] = k; paint(); if (opts.onKind) opts.onKind(); }
    }, l)));

    slot.innerHTML = '';
    if (draft[kindKey] === 'concept') {
      const list = opts.concepts();
      if (!list.length) {
        slot.appendChild(el('div', { class: 'hint' },
          'No avatar has any pre-made bodies set up yet. Add them under Avatars → Bodies by concept.'));
        return;
      }
      const sel = el('select', {
        class: 'input',
        onchange: e => { draft.bodyConcept = e.target.value; if (opts.onConcept) opts.onConcept(); }
      }, [el('option', { value: '' }, 'Pick a concept…')]
        .concat(list.map(c => el('option', { value: c }, c))));
      sel.value = draft.bodyConcept || '';
      slot.appendChild(sel);
      slot.appendChild(el('div', { class: 'hint' },
        'Each avatar gets its own bodies folder for this concept. The video stores the concept, not the link, so fixing a folder later fixes every video using it.'));
      if (opts.coverage) slot.appendChild(opts.coverage());
      return;
    }

    slot.appendChild(draft[kindKey] === 'link'
      ? el('input', {
        class: 'input', placeholder: 'Paste the ' + label.toLowerCase() + ' link…', value: draft[linkKey],
        oninput: e => draft[linkKey] = e.target.value
      })
      : el('textarea', { class: 'input', placeholder: ph, oninput: e => draft[key] = e.target.value }, draft[key]));
  };
  paint();
  const wrap = el('div', { class: 'col', style: 'gap:6px' },
    el('div', { class: 'row' }, el('span', { class: 'label' }, label), el('span', { class: 'spacer' }), seg),
    slot);
  wrap.repaint = paint;
  return wrap;
}

// 'auto' = the editor this avatar belongs to, but only when it is unambiguous.
function editorFor(account, mode, editors) {
  if (mode !== 'auto') return mode;
  const owners = editors.filter(t => (t.assignments || []).includes(account.id));
  return owners.length === 1 ? owners[0].id : '';
}

async function eQuiet(id, fn) { const { mutateQuiet } = await import('../app.js'); mutateQuiet('dailyEntries', id, fn); }
async function eLoud(id, fn) { const { mutate } = await import('../app.js'); mutate('dailyEntries', id, fn); }

function entryRow(en, a, num, u) {
  const canEdit = can.editVideos(u);
  const canMake = can.makeVideo(u);
  const canPost = can.markPosted(u);
  const done = !!en.done;

  const card = el('div', {
    class: 'card col entry' + (en.win ? ' win' : done ? ' done' : ''), style: 'gap:13px',
  });

  // ---- top row: number, type, production, win, delete
  const top = el('div', { class: 'row wrap' },
    el('span', { class: 'num' }, String(num)),
    seg(TYPES, en.type || 'Product', canEdit, v => eLoud(en.id, x => x.type = v), en.type === 'Growth' ? 'blue' : 'green'),
    seg(PROD, en.prod || 'Assembly', canEdit, v => eLoud(en.id, x => x.prod = v), 'violet'),
    el('span', { class: 'spacer' }));

  if (canEdit) {
    top.appendChild(el('button', {
      class: 'iconbtn' + (en.win ? ' win-on' : ''), title: en.win ? 'Winning video — click to unmark' : 'Mark as a winning video',
      onclick: () => eLoud(en.id, x => { x.win = !x.win; x.wonAt = x.win ? Date.now() : null; })
    }, '★'));
    top.appendChild(el('button', {
      class: 'iconbtn danger', title: 'Delete this video',
      onclick: async () => {
        if (!confirm('Delete video ' + num + ' for ' + (a.name || 'this avatar') + '?')) return;
        const { removeItem } = await import('../app.js');
        removeItem('dailyEntries', en.id); emit();
      }
    }, '✕'));
  } else if (en.win) {
    top.appendChild(el('span', { class: 'chip amber' }, '★ Winner'));
  }
  card.appendChild(top);

  // ---- assigned editor
  card.appendChild(editorRow(en, u, canEdit));

  // ---- the brief
  card.appendChild(el('div', { class: 'col', style: 'gap:5px;flex:1;min-width:180px' },
    el('span', { class: 'label' }, 'CONCEPT'),
    canEdit
      ? guarded('de:' + en.id + ':concept',
          () => el('input', { class: 'input', value: en.concept || '', placeholder: 'e.g. Transformation, Villain…', oninput: e => eQuiet(en.id, x => x.concept = e.target.value) }),
          () => el('span', { class: 'ro-text' }, (en.concept || '').trim() || '—'))
      : el('span', { class: 'ro-text' }, (en.concept || '').trim() || '—')));

  card.appendChild(sourceBlock(en, 'hook', 'HOOK', 'The hook / opening line…', canEdit, a));
  card.appendChild(sourceBlock(en, 'body', 'BODY', 'The body / script…', canEdit, a));

  card.appendChild(linkBlock(en, 'refVideo', 'REFERENCE VIDEO', 'Paste the reference video link…', canEdit));

  card.appendChild(el('div', { class: 'col', style: 'gap:6px' },
    el('span', { class: 'label' }, 'NOTES'),
    canEdit
      ? guarded('de:' + en.id + ':notes',
          () => el('textarea', { class: 'input', style: 'min-height:56px', placeholder: 'Anything the editor should know…', oninput: e => eQuiet(en.id, x => x.notes = e.target.value) }, en.notes || ''),
          () => el('div', { class: 'ro-text' }, (en.notes || '').trim() || '—'))
      : el('div', { class: 'ro-text' }, (en.notes || '').trim() || '—')));

  // ---- status: made + link
  const made = el('div', { class: 'row wrap', style: 'gap:10px;border-top:1px solid var(--line);padding-top:12px' },
    el('button', {
      class: 'check' + (done ? ' on' : ''), disabled: !canMake, title: canMake ? 'Mark the video as made' : 'Only the video makers tick this',
      onclick: () => canMake && eLoud(en.id, x => {
        x.done = !x.done;
        x.doneAt = x.done ? Date.now() : null;
        x.doneBy = x.done ? state.user.name : x.doneBy;
      })
    }, done ? '✓' : ''),
    el('span', { style: 'font-size:11.5px;font-weight:700;min-width:78px;color:' + (done ? '#9affc9' : 'var(--mut)') },
      done ? 'Video made' : 'Not made'));

  if (canMake) {
    made.appendChild(el('input', {
      class: 'input', style: 'flex:1;min-width:200px;height:32px;font-size:12px',
      placeholder: 'Finished video link…', value: en.videoLink || '',
      oninput: e => eQuiet(en.id, x => x.videoLink = e.target.value)
    }));
  } else if (/^https?:\/\//.test(en.videoLink || '')) {
    made.appendChild(el('a', { class: 'btn small', href: en.videoLink, target: '_blank' }, 'Video ↗'));
  } else {
    made.appendChild(el('span', { class: 'hint' }, 'No video link yet'));
  }
  if (done && en.doneBy) made.appendChild(el('span', { class: 'hint' }, 'by ' + en.doneBy));
  card.appendChild(made);

  // ---- status: posted + platforms. The admin ticks it; a manager always sees
  // it (read-only); an editor only sees it once it has actually been posted.
  if (canPost || en.posted || can.seesAllAccounts(u)) card.appendChild(postedRow(en, canPost));
  return card;
}

function editorRow(en, u, canEdit) {
  const editors = state.db.team.filter(t => t.role === 'editor');
  const assigned = byId(state.db.team, en.assignedEditorId);

  if (!canEdit) {
    return el('div', { class: 'row' },
      el('span', { class: 'label' }, 'EDITOR'),
      el('span', { class: 'chip violet' }, assigned ? assigned.name : 'Anyone'));
  }
  const sel = el('select', {
    class: 'input', style: 'width:auto;min-width:170px;height:32px',
    onchange: e => eLoud(en.id, x => x.assignedEditorId = e.target.value)
  },
    [el('option', { value: '' }, 'Anyone')].concat(editors.map(t => el('option', { value: t.id }, t.name))));
  sel.value = en.assignedEditorId || '';

  const row = el('div', { class: 'row wrap', style: 'gap:9px' },
    el('span', { class: 'label' }, 'EDITOR'), sel);
  if (!editors.length) row.appendChild(el('span', { class: 'hint' }, 'No video editors on the team yet — add them under Team.'));
  return row;
}

// Hook and body can each be typed in, or given as a link to somewhere else.
function sourceBlock(en, key, label, ph, canEdit, acct) {
  const kindKey = key + 'Kind', linkKey = key + 'Link';
  const isLink = (en[kindKey] || 'text') === 'link';
  const value = isLink ? (en[linkKey] || '') : (en[key] || '');

  // The body can point at the avatar's own pre-made bodies for a concept. The
  // entry holds the concept name; the link is resolved from the avatar here, so
  // it is always current.
  const kind = en[kindKey] || 'text';
  if (key === 'body' && kind === 'concept') return conceptBody(en, acct, canEdit);

  const head = el('div', { class: 'row' }, el('span', { class: 'label' }, label));
  if (canEdit) {
    const kinds = key === 'body'
      ? [['text', 'Text'], ['link', 'Link'], ['concept', 'From concept']]
      : [['text', 'Text'], ['link', 'Link']];
    head.appendChild(el('div', { class: 'seg mini' }, kinds.map(([k, l]) =>
      el('button', { class: kind === k ? 'on' : '', onclick: () => eLoud(en.id, x => x[kindKey] = k) }, l))));
  }
  head.appendChild(el('span', { class: 'spacer' }));
  head.appendChild(el('button', { class: 'btn small', onclick: e => copyText(value, e.currentTarget) }, 'Copy'));

  const ro = () => isLink
    ? (/^https?:\/\//.test(value)
      ? el('a', { class: 'btn small', href: value, target: '_blank', style: 'align-self:flex-start' }, 'Open ' + label.toLowerCase() + ' ↗')
      : el('span', { class: 'hint' }, 'No link yet'))
    : el('div', { class: 'ro-text' }, value.trim() || '—');

  const body = canEdit
    ? guarded('de:' + en.id + ':' + key,
        () => isLink
          ? el('input', { class: 'input', placeholder: 'Paste the ' + label.toLowerCase() + ' link…', value, oninput: e => eQuiet(en.id, x => x[linkKey] = e.target.value) })
          : el('textarea', { class: 'input', placeholder: ph, oninput: e => eQuiet(en.id, x => x[key] = e.target.value) }, value),
        ro)
    : ro();

  return el('div', { class: 'col', style: 'gap:6px' }, head, body);
}

// Body = "this avatar's pre-made bodies for concept X". The link is looked up
// on the avatar every render, never copied into the entry.
function conceptBody(en, acct, canEdit) {
  const label = (en.bodyConcept || '').trim();
  const url = bodyLinkFor(acct, label);
  const head = el('div', { class: 'row' }, el('span', { class: 'label' }, 'BODY'));

  if (canEdit) {
    head.appendChild(el('div', { class: 'seg mini' }, [['text', 'Text'], ['link', 'Link'], ['concept', 'From concept']].map(([k, l]) =>
      el('button', { class: k === 'concept' ? 'on' : '', onclick: () => eLoud(en.id, x => x.bodyKind = k) }, l))));
  }
  head.appendChild(el('span', { class: 'spacer' }));
  if (url) head.appendChild(el('button', { class: 'btn small', onclick: e => copyText(url, e.currentTarget) }, 'Copy'));

  const row = el('div', { class: 'row wrap', style: 'gap:8px' });

  if (canEdit) {
    // only this avatar's own concepts can be picked
    const mine = (acct.bodyLinks || []).map(b => (b.concept || '').trim()).filter(Boolean);
    const opts = mine.slice();
    if (label && !mine.some(c => normConcept(c) === normConcept(label))) opts.unshift(label);
    const sel = el('select', {
      class: 'input', style: 'width:auto;min-width:170px;height:32px',
      onchange: e => eLoud(en.id, x => x.bodyConcept = e.target.value)
    }, [el('option', { value: '' }, 'Pick a concept…')].concat(opts.map(c => el('option', { value: c }, c))));
    sel.value = label;
    row.appendChild(sel);
  } else {
    row.appendChild(el('span', { class: 'chip violet' }, label || 'No concept'));
  }

  if (url) {
    row.appendChild(el('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Open bodies ↗'));
  } else {
    row.appendChild(el('span', { class: 'hint' }, label
      ? 'No bodies link set for “' + label + '” on this avatar — add it under Avatars.'
      : 'Pick which concept’s bodies to use.'));
  }

  return el('div', { class: 'col', style: 'gap:6px' }, head, row);
}

function linkBlock(en, key, label, ph, canEdit) {
  const value = en[key] || '';
  const open = /^https?:\/\//.test(value)
    ? el('a', { class: 'btn small', href: value, target: '_blank' }, 'Open ↗') : null;
  const body = canEdit
    ? el('div', { class: 'row wrap' },
      guarded('de:' + en.id + ':' + key,
        () => el('input', { class: 'input', style: 'flex:1;min-width:220px', placeholder: ph, value, oninput: e => eQuiet(en.id, x => x[key] = e.target.value) }),
        () => el('span', { class: 'ro-text' }, value.trim() || '—')),
      open)
    : (open || el('span', { class: 'hint' }, 'No reference video'));
  return el('div', { class: 'col', style: 'gap:6px' }, el('span', { class: 'label' }, label), body);
}

function postedRow(en, canPost) {
  const posted = !!en.posted;
  const plats = en.platforms || [];
  const row = el('div', { class: 'row wrap', style: 'gap:10px;border-top:1px solid var(--line);padding-top:12px' },
    el('button', {
      class: 'check blue' + (posted ? ' on' : ''), disabled: !canPost,
      onclick: () => canPost && eLoud(en.id, x => {
        x.posted = !x.posted;
        x.postedAt = x.posted ? Date.now() : null;
        if (x.posted) {
          if (!x.postedDate) x.postedDate = todayStr();
          if (!(x.platforms || []).length) x.platforms = ['facebook'];
        }
      })
    }, posted ? '✓' : ''),
    el('span', { style: 'font-size:11.5px;font-weight:700;min-width:78px;color:' + (posted ? '#a9c6f7' : 'var(--mut)') },
      posted ? 'Posted' : 'Not posted'));

  PLATFORMS.forEach(([id, label, colour]) => {
    const on = plats.includes(id);
    if (!canPost && !on) return;
    row.appendChild(el('button', {
      class: 'chip ' + (on ? colour : 'gray') + (canPost ? ' click' : ''),
      style: canPost ? '' : 'cursor:default',
      onclick: () => canPost && eLoud(en.id, x => {
        const cur = Array.isArray(x.platforms) ? x.platforms : [];
        x.platforms = cur.includes(id) ? cur.filter(y => y !== id) : cur.concat([id]);
      })
    }, label));
  });

  if (posted && canPost) {
    row.appendChild(el('input', {
      class: 'input', type: 'date', style: 'width:145px;height:30px;font-size:11.5px',
      value: en.postedDate || todayStr(),
      onchange: e => e.target.value && eLoud(en.id, x => x.postedDate = e.target.value)
    }));
  } else if (posted && en.postedDate) {
    row.appendChild(el('span', { class: 'hint' }, 'on ' + en.postedDate));
  }
  return row;
}

// A small segmented control that renders as static chips when read-only.
function seg(options, current, canEdit, onset, colour) {
  if (!canEdit) return el('span', { class: 'chip ' + colour }, current);
  return el('div', { class: 'seg mini' }, options.map(o =>
    el('button', { class: o === current ? 'on' : '', onclick: () => onset(o) }, o)));
}

// ===========================================================================
// MAIN SCRIPTS MODE
// ===========================================================================
function scriptsMode(root, u) {
  const canEdit = can.editScripts(u);
  const scripts = state.db.scripts.filter(s => s.date === state.date).sort((a, b) => (a.order || 0) - (b.order || 0));
  const open = state.openScript ? scripts.find(s => s.id === state.openScript) : null;
  if (open) root.appendChild(detail(open, canEdit, u));
  else root.appendChild(list(scripts, canEdit));
}

async function addScript() {
  const { save } = await import('../app.js');
  const existing = state.db.scripts.filter(s => s.date === state.date);
  const s = {
    id: uid('s'), date: state.date, order: existing.length, title: 'Script ' + (existing.length + 1),
    type: 'Product', concept: '', hook: '', body: '', notes: '', referenceVideo: '',
    frames: [], createdBy: state.user.name, createdAt: Date.now(),
  };
  save('scripts', s);
  state.openScript = s.id;
  forceEmit();
}

function list(scripts, canEdit) {
  if (!scripts.length) {
    return el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      canEdit ? 'No scripts for this day yet — add one to start.' : 'No scripts posted for this day yet.');
  }
  const entriesFor = id => state.db.entries.filter(e => e.scriptId === id);
  const total = myAccounts(state.user, state.db).length;
  return el('div', { class: 'grid' }, scripts.map((s, i) => {
    const done = entriesFor(s.id).filter(e => e.done).length;
    return el('div', { class: 'card click col', onclick: () => { state.openScript = s.id; forceEmit(); } },
      el('div', { class: 'row' },
        el('span', { class: 'chip violet' }, String(i + 1)),
        el('b', { style: 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, s.title || 'Untitled'),
        el('span', { class: 'chip ' + (s.type === 'Growth' ? 'blue' : 'green') }, s.type || 'Product')),
      el('div', { class: 'row hint' },
        (s.frames || []).length + ' frames', '·', done + ' / ' + Math.max(total, done) + ' videos done'));
  }));
}

function detail(s, canEdit, u) {
  const wrap = el('div', { class: 'col', style: 'gap:18px' });

  wrap.appendChild(el('div', { class: 'row wrap' },
    el('button', { class: 'btn small', onclick: () => { state.openScript = null; forceEmit(); } }, '‹ All scripts'),
    canEdit
      ? guarded('script:' + s.id + ':title',
          () => el('input', { class: 'input', style: 'width:280px;font-weight:800', value: s.title || '', placeholder: 'Script title…', oninput: e => quiet(s.id, x => x.title = e.target.value) }),
          () => el('b', { style: 'font-size:16px' }, s.title || 'Untitled'))
      : el('b', { style: 'font-size:16px' }, s.title || 'Untitled'),
    el('span', { class: 'spacer' }),
    canEdit && el('button', {
      class: 'btn small danger', onclick: async () => {
        if (!confirm('Delete this script, its frames and completion marks?')) return;
        const { removeItem } = await import('../app.js');
        state.db.entries.filter(e => e.scriptId === s.id).forEach(e => removeItem('entries', e.id));
        removeItem('scripts', s.id);
        state.openScript = null; forceEmit();
      }
    }, 'Delete script')));

  wrap.appendChild(framesRow(s, canEdit));
  wrap.appendChild(detailsBlock(s, canEdit));
  wrap.appendChild(completion(s, u));
  return wrap;
}

async function quiet(id, fn) { const { mutateQuiet } = await import('../app.js'); mutateQuiet('scripts', id, fn); }
async function loud(id, fn) { const { mutate } = await import('../app.js'); mutate('scripts', id, fn); }

function framesRow(s, canEdit) {
  const frames = (s.frames || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const col = el('div', { class: 'col', style: 'gap:8px' }, el('span', { class: 'label' }, 'FRAMES'));
  const row = el('div', { class: 'frames' });

  frames.forEach((f, i) => row.appendChild(frameCard(s, f, i, frames.length, canEdit)));
  if (canEdit) row.appendChild(el('div', {
    class: 'add-tile', onclick: () => loud(s.id, x => {
      if (!Array.isArray(x.frames)) x.frames = [];
      x.frames.push({ id: uid('f'), imagePrompt: '', videoPrompt: '', tool: 'grok', imageUrl: '', order: x.frames.length });
    })
  }, '+', 'Add frame'));
  if (!frames.length && !canEdit) row.appendChild(el('div', { class: 'hint', style: 'padding:12px' }, 'No frames yet.'));

  col.appendChild(row);
  return col;
}

function frameCard(s, f, i, count, canEdit) {
  const card = el('div', { class: 'card frame' });

  card.appendChild(el('div', { class: 'row' },
    el('span', { class: 'chip violet' }, 'Frame ' + (i + 1)),
    el('span', { class: 'spacer' }),
    canEdit && el('button', { class: 'iconbtn', title: 'Move left', onclick: () => moveFrame(s, f.id, -1) }, '‹'),
    canEdit && el('button', { class: 'iconbtn', title: 'Move right', onclick: () => moveFrame(s, f.id, 1) }, '›'),
    canEdit && el('button', { class: 'iconbtn danger', title: 'Delete frame', onclick: () => loud(s.id, x => { x.frames = x.frames.filter(y => y.id !== f.id); x.frames.forEach((y, k) => y.order = k); }) }, '✕')));

  if (f.imageUrl) {
    card.appendChild(el('img', { class: 'frame-img', src: f.imageUrl }));
    if (canEdit) card.appendChild(el('div', { class: 'row', style: 'justify-content:center' },
      uploadBtn(s, f.id, 'Replace'),
      el('button', { class: 'btn small danger', onclick: () => loud(s.id, x => { const fr = x.frames.find(y => y.id === f.id); if (fr) fr.imageUrl = ''; }) }, 'Remove')));
  } else if (canEdit) {
    card.appendChild(uploadDrop(s, f.id));
  }

  card.appendChild(promptBox(s, f, 'imagePrompt', 'IMAGE PROMPT', 'Describe the image to generate…', canEdit));

  const toolRow = el('div', { class: 'row' }, el('span', { class: 'label' }, 'TOOL'));
  if (canEdit) {
    toolRow.appendChild(el('select', {
      class: 'input', style: 'width:auto;height:30px',
      onchange: e => loud(s.id, x => { const fr = x.frames.find(y => y.id === f.id); if (fr) fr.tool = e.target.value; })
    }, TOOLS.map(([id, name]) => { const o = el('option', { value: id }, name); if (f.tool === id) o.selected = true; return o; })));
  } else {
    toolRow.appendChild(el('span', { class: 'chip violet' }, (TOOLS.find(t => t[0] === f.tool) || TOOLS[0])[1]));
  }
  card.appendChild(toolRow);
  card.appendChild(promptBox(s, f, 'videoPrompt', 'VIDEO PROMPT', 'Describe the video / motion…', canEdit));
  return card;
}

function promptBox(s, f, key, label, ph, canEdit) {
  const copy = el('button', { class: 'btn small', onclick: e => copyText(f[key], e.currentTarget) }, 'Copy');
  const head = el('div', { class: 'row' }, el('span', { class: 'label' }, label), el('span', { class: 'spacer' }), copy);
  const ro = () => el('div', { class: 'ro-text' }, (f[key] || '').trim() || '—');
  const body = canEdit
    ? guarded('frame:' + s.id + ':' + f.id + ':' + key,
        () => el('textarea', { class: 'input', placeholder: ph, oninput: e => { f[key] = e.target.value; quiet(s.id, x => { const fr = x.frames.find(y => y.id === f.id); if (fr) fr[key] = e.target.value; }); } }, f[key] || ''),
        ro)
    : ro();
  return el('div', { class: 'col', style: 'gap:6px' }, head, body);
}

function uploadDrop(s, fid) {
  const input = el('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: e => doUpload(s, fid, e) });
  return el('label', { class: 'frame-drop' }, 'Upload frame image', el('small', null, '9:16 portrait'), input);
}
function uploadBtn(s, fid, label) {
  const input = el('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: e => doUpload(s, fid, e) });
  return el('label', { class: 'btn small', style: 'cursor:pointer' }, label, input);
}
async function doUpload(s, fid, e) {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  const { store } = await import('../app.js');
  try {
    const url = await store.uploadImage(file);
    loud(s.id, x => { const fr = (x.frames || []).find(y => y.id === fid); if (fr) fr.imageUrl = url; });
  } catch (err) { alert('Image upload failed — try again.\n' + (err.message || '')); }
}

async function moveFrame(s, fid, dir) {
  loud(s.id, x => {
    const fr = (x.frames || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const i = fr.findIndex(y => y.id === fid), j = i + dir;
    if (i < 0 || j < 0 || j >= fr.length) return;
    [fr[i], fr[j]] = [fr[j], fr[i]];
    fr.forEach((y, k) => y.order = k);
    x.frames = fr;
  });
}

function detailsBlock(s, canEdit) {
  const card = el('div', { class: 'card col', style: 'gap:15px' });
  card.appendChild(el('span', { class: 'label' }, 'SCRIPT DETAILS'));

  const typeSeg = canEdit
    ? el('div', { class: 'seg' }, TYPES.map(t =>
        el('button', { class: s.type === t ? 'on' : '', onclick: () => loud(s.id, x => x.type = t) }, t)))
    : el('span', { class: 'chip ' + (s.type === 'Growth' ? 'blue' : 'green') }, s.type || 'Product');

  card.appendChild(el('div', { class: 'row wrap', style: 'gap:16px;align-items:flex-end' },
    el('div', { class: 'col', style: 'gap:5px' }, el('span', { class: 'label' }, 'TYPE'), typeSeg),
    el('div', { class: 'col', style: 'gap:5px;flex:1;min-width:200px' }, el('span', { class: 'label' }, 'CONCEPT'),
      canEdit
        ? guarded('script:' + s.id + ':concept',
            () => el('input', { class: 'input', placeholder: 'e.g. Transformation, Villain…', value: s.concept || '', oninput: e => quiet(s.id, x => x.concept = e.target.value) }),
            () => el('span', { class: 'ro-text' }, (s.concept || '').trim() || '—'))
        : el('span', { class: 'ro-text' }, (s.concept || '').trim() || '—'))));

  card.appendChild(textBlock(s, 'hook', 'HOOK', 'The hook / opening line…', canEdit, true));
  card.appendChild(textBlock(s, 'body', 'BODY', 'The body / script…', canEdit, true));

  const refHead = el('div', { class: 'row' }, el('span', { class: 'label' }, 'REFERENCE VIDEO'), el('span', { class: 'hint' }, 'the video the frames are based on'));
  let refBody;
  if (canEdit) {
    const openA = () => /^https?:\/\//.test(s.referenceVideo || '')
      ? el('a', { class: 'btn small', href: s.referenceVideo, target: '_blank' }, 'Open ↗') : null;
    refBody = el('div', { class: 'row wrap' },
      guarded('script:' + s.id + ':referenceVideo',
        () => el('input', { class: 'input', style: 'flex:1;min-width:220px', placeholder: 'Paste the reference video link…', value: s.referenceVideo || '', oninput: e => quiet(s.id, x => x.referenceVideo = e.target.value) }),
        () => el('span', { class: 'ro-text' }, (s.referenceVideo || '').trim() || '—')),
      openA());
  } else {
    refBody = (s.referenceVideo || '').trim()
      ? el('a', { href: s.referenceVideo, target: '_blank', style: 'font-size:12.5px;font-weight:700;word-break:break-all' }, 'Open reference video ↗')
      : el('span', { class: 'hint' }, 'No reference video');
  }
  card.appendChild(el('div', { class: 'col', style: 'gap:6px' }, refHead, refBody));

  card.appendChild(textBlock(s, 'notes', 'NOTES', 'Anything the editors should know…', canEdit, false));
  return card;
}

function textBlock(s, key, label, ph, canEdit, copyable) {
  const head = el('div', { class: 'row' }, el('span', { class: 'label' }, label), el('span', { class: 'spacer' }),
    copyable && el('button', { class: 'btn small', onclick: e => copyText(s[key], e.currentTarget) }, 'Copy'));
  const ro = () => el('div', { class: 'ro-text' }, (s[key] || '').trim() || '—');
  const body = canEdit
    ? guarded('script:' + s.id + ':' + key,
        () => el('textarea', { class: 'input', placeholder: ph, oninput: e => { s[key] = e.target.value; quiet(s.id, x => x[key] = e.target.value); } }, s[key] || ''),
        ro)
    : ro();
  return el('div', { class: 'col', style: 'gap:6px' }, head, body);
}

function completion(s, u) {
  const accounts = myAccounts(u, state.db).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const canLog = can.logCompletion(u);
  const heading = can.seesAllAccounts(u) ? 'COMPLETION · ALL AVATARS' : 'YOUR AVATARS — LOG YOUR FINISHED VIDEO';

  const col = el('div', { class: 'col', style: 'gap:9px' }, el('span', { class: 'label' }, heading));
  if (!accounts.length) {
    col.appendChild(el('div', { class: 'hint', style: 'padding:12px' },
      can.seesAllAccounts(u) ? 'No avatars yet — add them under Avatars.' : 'No avatars assigned to you yet — ask an admin.'));
    return col;
  }

  accounts.forEach(a => {
    const en = state.db.entries.find(e => e.scriptId === s.id && e.accountId === a.id) || null;
    const done = !!(en && en.done);
    const row = el('div', { class: 'card row wrap', style: 'padding:10px 13px' + (done ? ';border-color:rgba(52,224,138,0.3);background:rgba(52,224,138,0.05)' : '') },
      avatar(a, 30),
      el('div', { style: 'min-width:120px' }, el('b', { style: 'font-size:12.5px;display:block' }, a.name)),
      el('button', {
        class: 'check' + (done ? ' on' : ''), disabled: !canLog,
        onclick: () => canLog && toggleDone(s, a, en)
      }, done ? '✓' : ''),
      el('span', { style: 'font-size:11.5px;font-weight:700;min-width:80px;color:' + (done ? '#9affc9' : 'var(--mut)') }, done ? 'Video done' : 'Not done'));

    if (canLog) {
      row.appendChild(el('input', {
        class: 'input', style: 'flex:1;min-width:200px;height:30px;font-size:12px', placeholder: 'Finished video link…',
        value: (en && en.videoLink) || '',
        oninput: e => setLink(s, a, en, e.target.value)
      }));
    } else if (en && (en.videoLink || '').trim()) {
      row.appendChild(el('a', { class: 'btn small', href: en.videoLink, target: '_blank' }, 'Video ↗'));
    }
    col.appendChild(row);
  });
  return col;
}

async function toggleDone(s, a, en) {
  const { save } = await import('../app.js');
  const item = en || { id: uid('e'), scriptId: s.id, accountId: a.id, done: false, videoLink: '' };
  item.done = !item.done;
  item.doneAt = item.done ? Date.now() : null;
  item.doneBy = item.done ? state.user.name : item.doneBy;
  save('entries', item); emit();
}
async function setLink(s, a, en, val) {
  const { save } = await import('../app.js');
  const item = en || (state.db.entries.find(e => e.scriptId === s.id && e.accountId === a.id)) || { id: uid('e'), scriptId: s.id, accountId: a.id, done: false, videoLink: '' };
  item.videoLink = val;
  save('entries', item); // quiet — no emit while typing
}
