// ============================================================================
// onboarding.js — the pipeline a new page goes through before it is a page.
//
// Buying a blank page is not the same as having one. Between the two there is
// a list of things that must all be true — it needs a name, a face, a cover, a
// link, a product, a targeting decision, a quality tier, a stage, base images,
// and bodies for the concepts it will run. Miss one and the failure surfaces
// days later as an editor with nothing to work from.
//
// So a new page starts here and not in the account centre. It works through
// three phases, the checklist watches itself, and only when everything is
// filled in can it be submitted. Until then it does not appear on Avatars at
// all: the account centre is finished pages, and nothing else.
//
// Nothing here is a separate record. It is the same avatar the rest of the app
// uses, carrying `onboarding: true` until it graduates — so everything already
// written to read an avatar keeps working, and submitting is one flag.
//
// Admin and marketing manager only.
// ============================================================================

import { state, forceEmit, uid, byId, can } from '../state.js';
import { el, avatar } from '../ui.js';
import { sortedStages, stageOf } from '../stages.js';
import { captionsReady, linktwinComplete } from '../captions.js';
import {
  conceptsForAccount, bodyLinkFor, scriptLinkFor, setConceptLink, setConceptScript,
} from '../concepts.js';
import { QUALITY, TARGETING, openAccount, captionFieldsInto, linktwinFieldsInto, overlay } from './accounts.js';
import { getPref, setPref } from '../prefs.js';

// Pages still in the pipeline. Anything without the flag has already
// graduated, which is what makes this safe for avatars that existed before
// the pipeline did — they are finished by definition.
export function onboardingPages(db) {
  return ((db || state.db).accounts || []).filter(a => a.onboarding);
}

export function onboardingCount() {
  return onboardingPages(state.db).length;
}

// ---------------------------------------------------------------------------
// the checklist
// ---------------------------------------------------------------------------
// Each step answers itself from the record. Nothing is ticked by hand, so the
// list can never claim a page is ready when it is not.
const STEPS = {
  name: { label: 'Name', hint: 'What the page is called.', done: a => !!(a.name || '').trim() },
  avatar: { label: 'Profile picture', hint: 'The face of the page.', done: a => !!a.avatarUrl },
  cover: { label: 'Cover photo', hint: 'The banner across the top of the page.', done: a => !!a.coverUrl },
  links: {
    label: 'Page link', hint: 'Where the page actually lives.',
    done: a => !!((a.platforms || {}).facebook || '').trim() || !!((a.platforms || {}).instagram || '').trim(),
  },
  // The hand-ticked steps, and the only ones that are. Each happens somewhere
  // this tool cannot see — on Facebook, in LinkTwin, on the page itself, in
  // Amazon — so there is no field to read them off. A box someone ticks is
  // honest about that; inferring it from anything here would not be.
  //
  // Three of them write the fields the Avatars sheet already had, so a page
  // ticked in one place is ticked in the other: it is one fact, not two.
  fbPage: { label: 'Facebook page', hint: 'The page actually exists on Facebook.', done: a => !!a.pageCreated },
  automations: { label: 'Automations', hint: 'Automations and links added to the page.', done: a => !!a.linkAdded },
  // Not a hand-tick any more: the four LinkTwin links are entered here, and the
  // step is done once all four are in. The caption link among them is what
  // every caption is built around.
  linktwin: { label: 'LinkTwin links', hint: 'The four links this page runs on.', done: a => linktwinComplete(a) },
  amazon: { label: 'Amazon settings', hint: 'The page is added in Amazon.', done: a => !!a.amazonAdded },
  captions: {
    label: 'Captions', hint: 'What goes out with its videos.',
    done: a => captionsReady(a),
  },
  product: { label: 'Product', hint: 'What this page promotes.', done: a => !!byId(state.db.products, a.productId) },
  targeting: { label: 'Targeting', hint: 'Who it is set to reach.', done: a => !!a.targeting },
  quality: { label: 'Video quality', hint: 'Whether its videos are built from scratch or assembled.', done: a => !!a.quality },
  stage: {
    label: 'Stage', hint: 'Where it is in its life, and what to do there.',
    done: a => !!stageOf(a),
  },
  base: { label: 'Base images', hint: 'The folder an editor cuts from.', done: a => !!(a.baseImageLink || '').trim() },
  bodies: { label: 'Bodies', hint: 'The concepts it starts with, and a folder of bodies for each.', done: a => bodiesReady(a) },
};

// The layout used until the admin edits the form. Amazon settings is left out
// by default but is still a built-in step, so it can be added back.
const DEFAULT_PHASES = [
  {
    id: 'ph1', label: 'The page itself', note: 'That it exists, what it looks like, and what is wired up on it.',
    steps: ['fbPage', 'name', 'avatar', 'cover', 'links', 'automations', 'linktwin'],
  },
  { id: 'ph2', label: 'How it runs', note: 'What it sells, who it reaches, and where it is in its life.', steps: ['product', 'targeting', 'quality', 'stage'] },
  { id: 'ph3', label: 'Content ready', note: 'What an editor needs before they can make anything for it.', steps: ['captions', 'base', 'bodies'] },
];

// ---------------------------------------------------------------------------
// the editable form
// ---------------------------------------------------------------------------
// The admin can reorder, remove and re-add the built-in steps, rename and add
// phases, and add fields of their own. All of it is one workspace setting:
//   { phases: [{ id, label, note, steps: [key…] }], fields: [{ id, label, … }] }
// A step key is either a built-in (a key of STEPS) or the id of a custom field.
// Custom answers live on the page under `custom[fieldId]`.
export const FIELD_KINDS = [
  ['check', 'Checkbox'],
  ['text', 'Text'],
  ['link', 'Link'],
  ['select', 'Dropdown'],
];

function form() {
  const saved = getPref('onboardingForm');
  const fields = (saved && Array.isArray(saved.fields) ? saved.fields : []).filter(f => f && f.id);
  const known = k => !!STEPS[k] || fields.some(f => f.id === k);
  const phases = (saved && Array.isArray(saved.phases) ? saved.phases : DEFAULT_PHASES)
    .map(p => ({ id: p.id || uid('ph'), label: p.label || '', note: p.note || '', steps: (p.steps || []).filter(known) }));
  return { phases, fields };
}

function stepDef(key, f) {
  if (STEPS[key]) return STEPS[key];
  const fd = (f || form()).fields.find(x => x.id === key);
  if (!fd) return null;
  return {
    label: fd.label || 'Untitled field', hint: fd.hint || '', custom: fd,
    required: fd.required !== false,
    done: a => {
      const v = (a.custom || {})[fd.id];
      return fd.kind === 'check' ? v === true : !!String(v == null ? '' : v).trim();
    },
  };
}

// Every step on the form, in order; and the ones that must be done to submit.
function formSteps(f) {
  f = f || form();
  return f.phases.reduce((list, p) => list.concat(p.steps), []);
}
function requiredSteps(f) {
  f = f || form();
  return formSteps(f).filter(k => { const d = stepDef(k, f); return d && d.required !== false; });
}

// The steps a person confirms rather than the record answering. Three write
// the fields the Avatars sheet has always used, so the two views tick the
// same box rather than each keeping their own.
const TICKS = {
  fbPage: {
    field: 'pageCreated', said: 'Page exists',
    why: 'The same box as “Page created” on the Avatars sheet.',
  },
  automations: {
    field: 'linkAdded', said: 'Added to the page',
    why: 'Done on the page itself — the same box as “Link added” on the sheet.',
  },
  amazon: {
    field: 'amazonAdded', said: 'Added in Amazon',
    why: 'Done in Amazon, so this is the only record of it here.',
  },
};

function chosenConcepts(a) {
  return (Array.isArray(a.setupConcepts) ? a.setupConcepts : [])
    .map(id => conceptsForAccount(a).find(c => c.id === id))
    .filter(Boolean);
}

// Bodies are ready when at least one concept has been chosen and every chosen
// one has somewhere for its bodies to live. A page with no concepts picked is
// not "done by default" — that would let an empty page through.
function bodiesReady(a) {
  const list = chosenConcepts(a);
  return list.length > 0 && list.every(c => !!bodyLinkFor(a, c.id));
}

export function progressOf(a) {
  const f = form();
  const req = requiredSteps(f);
  const done = req.filter(k => stepDef(k, f).done(a)).length;
  return { done, total: req.length, ready: done === req.length };
}

function pctOf(p) { return p.total ? Math.round(p.done / p.total * 100) : 100; }

function nextStep(a) {
  const f = form();
  const k = requiredSteps(f).find(x => !stepDef(x, f).done(a));
  return k ? stepDef(k, f).label : null;
}

// ---------------------------------------------------------------------------
// creating and graduating
// ---------------------------------------------------------------------------
export async function startNewPage(seed) {
  const { save } = await import('../app.js');
  const a = Object.assign({
    id: uid('a'), name: '', status: 'Building', phase: 'P1',
    productId: '', platforms: { facebook: '', instagram: '' },
    facebookProfileId: '', instagramProfileId: '',
    stageId: '', quality: '', targeting: '', targetingNote: '',
    replacesId: '', wentLiveAt: null, droppedAt: null, dropReason: '',
    metaBusinessSuiteUrl: '', avatarUrl: '', coverUrl: '', baseImageLink: '',
    pageCreated: false, linkCreated: false, linkAdded: false, amazonAdded: false,
    linktwin: {}, captions: {}, bodyLinks: [], setupConcepts: [], notes: '',
    onboarding: true, createdAt: Date.now(),
  }, seed || {});
  save('accounts', a);
  state.route = 'onboarding';
  state.onboardAvatar = a.id;
  forceEmit();
}

// Everything is filled in, so the page exists and is ready to run — which is
// what Live means. Leaving it as "Setting up" would name a state it has just
// finished being in.
async function submitPage(a) {
  const p = progressOf(a);
  if (!p.ready) return;
  const { mutate } = await import('../app.js');
  mutate('accounts', a.id, x => {
    x.onboarding = false;
    x.onboardedAt = Date.now();
    if (x.status === 'Building') { x.status = 'Live'; x.wentLiveAt = x.wentLiveAt || Date.now(); }
  });
  state.onboardAvatar = null;
  state.route = 'accounts';
  forceEmit();
}

// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------
export function renderOnboarding(root, u) {
  if (!can.seeOnboarding(u)) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      'Onboarding is for the admin and the marketing manager.'));
    return;
  }

  const pages = onboardingPages(state.db);

  if (state.obEditForm && can.manageSettings(u)) { root.appendChild(formEditor()); return; }
  state.obEditForm = false;

  if (state.onboardAvatar) {
    const a = byId(pages, state.onboardAvatar);
    if (a) { root.appendChild(setupSheet(a)); return; }
    state.onboardAvatar = null;      // submitted, discarded, or gone
  }

  root.appendChild(head(pages.length));

  if (!pages.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:40px' },
      'No pages being set up. Start one and it works through its checklist here, ',
      'then joins the Avatars centre once everything is filled in.'));
    return;
  }

  // closest to finished first — those are the ones worth pushing over the line
  const sorted = pages.slice().sort((x, y) =>
    progressOf(y).done - progressOf(x).done || (x.name || '').localeCompare(y.name || ''));

  root.appendChild(el('div', { class: 'grid' }, sorted.map(pageCard)));
}

function head(n) {
  const spacer = el('span', { class: 'spacer' });
  const wrap = el('div', { class: 'page-head' },
    el('div', null,
      el('h1', null, 'Onboarding'),
      el('div', { class: 'sub' }, n
        ? n + (n === 1 ? ' page being set up' : ' pages being set up')
        : 'Nothing being set up')),
    spacer);
  import('../app.js').then(({ statusPill }) => wrap.insertBefore(statusPill(), spacer.nextSibling));
  if (can.manageSettings(state.user)) {
    wrap.appendChild(el('button', { class: 'btn', onclick: () => { state.obEditForm = true; forceEmit(); } }, 'Edit form'));
  }
  wrap.appendChild(el('button', { class: 'btn primary', onclick: () => startNewPage() }, '+ New page'));
  return wrap;
}

function pageCard(a) {
  const p = progressOf(a);
  const next = nextStep(a);
  return el('div', {
    class: 'card col click', style: 'gap:12px',
    onclick: () => { state.onboardAvatar = a.id; forceEmit(); },
  },
    el('div', { class: 'row', style: 'gap:11px' },
      avatar(a, 40),
      el('div', { style: 'min-width:0;flex:1' },
        el('b', { style: 'display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' },
          (a.name || '').trim() || 'Untitled page'),
        el('span', { class: 'hint' }, p.done + ' of ' + p.total + ' done')),
      p.ready
        ? el('span', { class: 'chip green' }, 'Ready')
        : el('span', { class: 'chip amber' }, p.total - p.done + ' left')),
    el('div', { class: 'bar' },
      el('i', { style: 'width:' + pctOf(p) + '%;background:' + (p.ready ? 'var(--green)' : 'var(--amber)') })),
    el('span', { class: 'hint' }, p.ready ? 'Everything filled in — open it to submit.' : 'Next: ' + next));
}

// ---------------------------------------------------------------------------
// the setup sheet — one page, worked through top to bottom
// ---------------------------------------------------------------------------
// Briefly, LinkTwin and automations had flags of their own, before it was
// spotted that the Avatars sheet had been carrying the same two ticks all
// along. Anything ticked under the old names is folded into the real fields
// once, here, so no one loses a tick and nothing is asked for twice.
// Folded on the record itself before anything reads it, so the checklist below
// never renders off the old fields for a frame. Persisting it can wait.
function foldLegacyTicks(a) {
  if (a.linktwinDone === undefined && a.automationsDone === undefined) return;
  if (a.linktwinDone && !a.linkCreated) a.linkCreated = true;
  if (a.automationsDone && !a.linkAdded) a.linkAdded = true;
  delete a.linktwinDone;
  delete a.automationsDone;
  import('../app.js').then(({ save }) => save('accounts', a));
}

function setupSheet(a) {
  foldLegacyTicks(a);
  const wrap = el('div', { class: 'col', style: 'gap:16px' });

  // Written straight to the record rather than to a copy: a page half set up
  // is a real state, and closing the tab should never lose it. Quiet, so a
  // re-render never yanks the field being typed in.
  const set = async fn => {
    const { mutateQuiet } = await import('../app.js');
    mutateQuiet('accounts', a.id, fn);
    paint();
  };

  // Like `set`, but applies the change to the record synchronously so anything
  // that rebuilds itself right after (the shared caption/link blocks) sees it.
  // `a` is the live account, so the mutation lands immediately; the save is
  // quiet and can happen a tick later.
  const setSync = fn => {
    fn(a);
    import('../app.js').then(m => m.save('accounts', a));
    paint();
  };

  const ticks = {};                     // step id -> its tick element
  const bar = el('i');
  const counter = el('span', { class: 'hint' });
  const submit = el('button', { class: 'btn primary', onclick: () => submitPage(a) }, 'Add to the account centre');
  const readyNote = el('span', { class: 'hint' });

  // Repaints only what the checklist says, never the controls — so ticks keep
  // up with typing without the field losing focus mid-word.
  const f = form();
  function paint() {
    const p = progressOf(a);
    formSteps(f).forEach(k => {
      const t = ticks[k];
      if (!t) return;
      const on = stepDef(k, f).done(a);
      t.classList.toggle('on', on);
      t.textContent = on ? '✓' : '';
    });
    bar.style.cssText = 'width:' + pctOf(p) + '%;background:'
      + (p.ready ? 'var(--green)' : 'var(--amber)');
    counter.textContent = p.done + ' of ' + p.total + ' done';
    submit.disabled = !p.ready;
    readyNote.textContent = p.ready
      ? 'Everything is filled in.'
      : 'Still to do: ' + requiredSteps(f).filter(k => !stepDef(k, f).done(a)).map(k => stepDef(k, f).label).join(', ') + '.';
  }

  // ---- header
  wrap.appendChild(el('div', { class: 'row wrap', style: 'gap:11px' },
    el('button', { class: 'btn small', onclick: () => { state.onboardAvatar = null; forceEmit(); } }, '‹ All pages'),
    avatar(a, 34),
    el('b', { style: 'font-size:15px' }, (a.name || '').trim() || 'Untitled page'),
    el('span', { class: 'spacer' }),
    counter,
    el('button', { class: 'btn small', onclick: () => openAccount(a) }, 'Full editor'),
    el('button', {
      class: 'btn small danger', onclick: async () => {
        if (!confirm('Discard this page?\n\nIt has not joined the account centre, so nothing is kept.')) return;
        const { removeItem } = await import('../app.js');
        removeItem('accounts', a.id);
        state.onboardAvatar = null;
        forceEmit();
      }
    }, 'Discard')));

  wrap.appendChild(el('div', { class: 'bar' }, bar));

  // The bodies step registers its own repaint here, because the product step
  // has to be able to trigger it: changing the product changes which concepts
  // the page can take, and a stale list would offer bodies that are not
  // allowed on it.
  const hooks = { setSync };

  // ---- phases (empty ones are skipped, and numbered without the gap)
  f.phases.filter(ph => ph.steps.length).forEach((ph, i) => {
    wrap.appendChild(el('div', { class: 'ob-phase' },
      el('span', { class: 'ob-num' }, String(i + 1)),
      el('b', { style: 'font-size:13.5px' }, ph.label),
      el('span', { class: 'hint' }, ph.note)));
    const box = el('div', { class: 'col', style: 'gap:9px' });
    ph.steps.forEach(k => box.appendChild(stepRow(a, k, f, set, ticks, paint, hooks)));
    wrap.appendChild(box);
  });

  // ---- submit
  wrap.appendChild(el('div', { class: 'card row wrap', style: 'gap:11px;margin-top:6px' },
    readyNote, el('span', { class: 'spacer' }), submit));

  paint();
  return wrap;
}

// One row: the tick that watches itself, the name of the thing, and the
// control that fills it in — all on the same line, so the list is the form.
function stepRow(a, key, f, set, ticks, paint, hooks) {
  const step = stepDef(key, f);
  const tick = el('span', { class: 'check' });
  ticks[key] = tick;

  const control = el('div', { class: 'col', style: 'gap:6px;flex:1;min-width:220px' });
  if (step.custom) customControl(a, step.custom, control, set);
  else buildControl(a, key, control, set, paint, hooks);

  return el('div', { class: 'card ob-step' },
    tick,
    el('div', { class: 'col', style: 'gap:2px;flex:0 0 148px;min-width:120px' },
      el('b', { style: 'font-size:12.5px' }, step.label,
        step.required === false ? el('span', { class: 'hint', style: 'font-weight:600' }, ' · optional') : null),
      el('span', { class: 'hint' }, step.hint)),
    control);
}

// A field the admin added. Its answer is kept on the page under custom[id].
function customControl(a, fd, box, set) {
  const val = () => (a.custom || {})[fd.id];
  const put = v => set(x => { x.custom = Object.assign({}, x.custom, { [fd.id]: v }); });

  if (fd.kind === 'check') {
    const btn = el('button', { class: 'cbox' + (val() === true ? ' on' : '') },
      el('span', { class: 'bx' }, val() === true ? '✓' : ''), (fd.said || '').trim() || 'Done');
    btn.onclick = async () => {
      const next = val() !== true;
      await put(next);
      btn.classList.toggle('on', next);
      btn.firstChild.textContent = next ? '✓' : '';
    };
    box.appendChild(btn);
    return;
  }

  if (fd.kind === 'select') {
    const opts = (fd.options || []).filter(o => (o || '').trim());
    const sel = el('select', {
      class: 'input', style: 'width:auto;min-width:170px',
      onchange: e => put(e.target.value),
    }, [el('option', { value: '' }, 'Not set')].concat(opts.map(o => el('option', { value: o }, o))));
    sel.value = val() || '';
    box.appendChild(sel);
    if (!opts.length) box.appendChild(el('span', { class: 'hint' }, 'This dropdown has no options yet — add them under Edit form.'));
    return;
  }

  // text and link
  const open = el('a', { class: 'btn small', target: '_blank', rel: 'noopener' }, 'Open ↗');
  const paintOpen = v => {
    const ok = fd.kind === 'link' && /^https?:\/\//i.test((v || '').trim());
    open.style.display = ok ? '' : 'none';
    if (ok) open.href = v.trim();
  };
  box.appendChild(el('div', { class: 'row', style: 'gap:8px' },
    el('input', {
      class: 'input', style: 'flex:1', value: val() || '',
      placeholder: fd.kind === 'link' ? 'Paste the link…' : 'Type here…',
      oninput: e => { put(e.target.value); paintOpen(e.target.value); },
    }),
    fd.kind === 'link' ? open : null));
  paintOpen(val());
}

function buildControl(a, key, box, set, paint, hooks) {
  const text = (value, ph, apply) => el('input', {
    class: 'input', value: value || '', placeholder: ph,
    oninput: e => set(x => apply(x, e.target.value)),
  });

  const pick = (pairs, current, apply) => {
    const sel = el('select', {
      class: 'input', style: 'width:auto;min-width:170px',
      onchange: e => set(x => apply(x, e.target.value)),
    }, pairs.map(([v, label]) => el('option', { value: v }, label)));
    sel.value = current || '';
    return sel;
  };

  if (key === 'name') {
    box.appendChild(text(a.name, 'e.g. Sarah — Wellness', (x, v) => x.name = v));
    return;
  }

  if (key === 'avatar' || key === 'cover') {
    const field = key === 'avatar' ? 'avatarUrl' : 'coverUrl';
    const shot = el('div', { class: key === 'avatar' ? 'ob-pfp' : 'ob-cover' });
    const paintShot = () => {
      shot.innerHTML = '';
      shot.appendChild(a[field]
        ? el('img', { src: a[field], alt: '' })
        : el('span', { class: 'hint', style: 'font-size:9.5px' }, 'none yet'));
    };
    paintShot();
    const file = el('input', {
      type: 'file', accept: 'image/*', style: 'display:none',
      onchange: async e => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        const label = box.querySelector('.upl');
        if (label) label.textContent = 'Uploading…';
        try {
          const { store } = await import('../app.js');
          const url = await store.uploadImage(f);
          await set(x => x[field] = url);
          paintShot();
        } catch (err) { alert('Image upload failed — try again.\n' + (err.message || '')); }
        if (label) label.textContent = 'Upload';
        e.target.value = '';
      }
    });
    box.appendChild(el('div', { class: 'row wrap', style: 'gap:10px' },
      shot,
      el('label', { class: 'btn small upl', style: 'cursor:pointer' }, 'Upload', file),
      a[field] ? el('button', {
        class: 'btn small danger',
        onclick: async () => { await set(x => x[field] = ''); paintShot(); }
      }, 'Remove') : null));
    return;
  }

  // The hand-ticked steps. The box carries the words, so what is being
  // confirmed is on screen rather than remembered from the label alone.
  if (TICKS[key]) {
    const { field, said, why } = TICKS[key];
    const btn = el('button', { class: 'cbox' + (a[field] ? ' on' : '') },
      el('span', { class: 'bx' }, a[field] ? '✓' : ''), said);
    btn.onclick = async () => {
      const next = !a[field];
      await set(x => x[field] = next);
      btn.classList.toggle('on', next);
      btn.firstChild.textContent = next ? '✓' : '';
    };
    box.appendChild(btn);
    box.appendChild(el('span', { class: 'hint' }, why));
    return;
  }

  if (key === 'linktwin') {
    // the caption preview downstream is built around the caption link, so a
    // change to it re-renders the captions step
    linktwinFieldsInto(box, a, hooks.setSync, () => hooks && hooks.repaintCaptions && hooks.repaintCaptions());
    box.appendChild(el('span', { class: 'hint' },
      'All four are needed. Every caption is built around the caption link.'));
    return;
  }

  if (key === 'captions') {
    // the shared caption UI, following the page's product by default. Which
    // captions are needed follows the page's mix, so the stage step can ask
    // for this to be redrawn when it changes.
    const render = () => captionFieldsInto(box, a, hooks.setSync);
    if (hooks) hooks.repaintCaptions = () => { render(); paint(); };
    render();
    return;
  }

  if (key === 'links') {
    box.appendChild(el('div', { class: 'row wrap', style: 'gap:9px' },
      el('span', { class: 'chip blue' }, 'FB'),
      text((a.platforms || {}).facebook, 'Facebook page handle', (x, v) => {
        if (!x.platforms) x.platforms = {}; x.platforms.facebook = v;
      })));
    box.appendChild(el('div', { class: 'row wrap', style: 'gap:9px' },
      el('span', { class: 'chip pink' }, 'IG'),
      text((a.platforms || {}).instagram, 'Instagram handle', (x, v) => {
        if (!x.platforms) x.platforms = {}; x.platforms.instagram = v;
      })));
    box.appendChild(el('span', { class: 'hint' }, 'One is enough. Profiles and the Business Suite URL are in the full editor.'));
    return;
  }

  if (key === 'product') {
    const products = state.db.products.slice().sort((x, y) => (x.name || '').localeCompare(y.name || ''));
    const sel = el('select', {
      class: 'input', style: 'width:auto;min-width:170px',
      onchange: async e => {
        await set(x => x.productId = e.target.value);
        // the concepts on offer below follow the product
        if (hooks && hooks.repaintBodies) hooks.repaintBodies();
      },
    }, [['', 'No product']].concat(products.map(p => [p.id, p.name]))
      .map(([v, label]) => el('option', { value: v }, label)));
    sel.value = a.productId || '';
    box.appendChild(sel);
    box.appendChild(el('span', { class: 'hint' },
      products.length
        ? 'Also decides which concepts this page can take.'
        : 'No products yet — add one under Avatars → Products.'));
    return;
  }

  if (key === 'targeting') {
    box.appendChild(pick(
      [['', 'Not set']].concat(TARGETING.map(t => [t[0], t[1]])), a.targeting,
      (x, v) => x.targeting = v));
    box.appendChild(el('span', { class: 'hint' }, 'Broad still counts as a decision — it just shows as a quiet chip rather than a loud one.'));
    return;
  }

  if (key === 'quality') {
    box.appendChild(pick([['', 'Not set']].concat(QUALITY.map(q => [q[0], q[1]])), a.quality,
      (x, v) => x.quality = v));
    return;
  }

  if (key === 'stage') {
    const stages = sortedStages();
    const note = el('span', { class: 'hint' });
    const paintNote = () => {
      const s = stageOf(a);
      note.textContent = s
        ? (s.goal || '').trim()
        : (stages.length ? '' : 'No stages defined yet — add them under Settings.');
    };
    // built here rather than through pick(), so the summary below updates in
    // the same breath as the choice
    const sel = el('select', {
      class: 'input', style: 'width:auto;min-width:170px',
      onchange: async e => {
        await set(x => x.stageId = e.target.value);
        paintNote();
      },
    }, [['', 'No stage set']].concat(stages.map(s => [s.id, s.name]))
      .map(([v, label]) => el('option', { value: v }, label)));
    sel.value = a.stageId || '';
    box.appendChild(sel);
    box.appendChild(note);
    paintNote();
    return;
  }

  if (key === 'base') {
    box.appendChild(text(a.baseImageLink, 'Drive folder with this page’s base images…',
      (x, v) => x.baseImageLink = v));
    return;
  }

  if (key === 'bodies') {
    if (hooks) hooks.repaintBodies = () => { box.innerHTML = ''; bodiesControl(a, box, set, paint); paint(); };
    bodiesControl(a, box, set, paint);
  }
}

// The concepts this page starts on. Picked from the library rather than typed,
// and narrowed to the ones its product actually takes — so choosing a product
// already rules out the bodies that would have been wasted work.
function bodiesControl(a, box, set, paint) {
  const repaint = () => { box.innerHTML = ''; bodiesControl(a, box, set, paint); paint(); };

  const offered = conceptsForAccount(a);
  if (!offered.length) {
    box.appendChild(el('span', { class: 'hint' },
      state.db.concepts.length
        ? 'This page’s product takes none of the concepts in the library.'
        : 'No concepts yet — add them under Avatars → Concepts.'));
    return;
  }

  const picked = new Set(Array.isArray(a.setupConcepts) ? a.setupConcepts : []);
  box.appendChild(el('div', { class: 'row wrap', style: 'gap:7px' }, offered.map(c => {
    const on = picked.has(c.id);
    return el('button', {
      class: 'cbox' + (on ? ' on' : ''),
      title: on ? 'This page starts on ' + c.name : 'Add ' + c.name + ' to this page',
      onclick: async () => {
        const next = on ? [...picked].filter(x => x !== c.id) : [...picked, c.id];
        await set(x => x.setupConcepts = next);
        repaint();
      },
    }, el('span', { class: 'bx' }, on ? '✓' : ''), c.name);
  })));

  const chosen = chosenConcepts(a);
  if (!chosen.length) {
    box.appendChild(el('span', { class: 'hint' }, 'Pick the concepts this page starts on.'));
    return;
  }

  // One block per chosen concept: the script the editor works from, and the
  // folder the finished bodies land in. The second is what marks it done,
  // because a script with nothing made from it is not a body.
  chosen.forEach(c => {
    const has = !!bodyLinkFor(a, c.id);
    box.appendChild(el('div', { class: 'card col', style: 'gap:7px;padding:10px 11px' },
      el('div', { class: 'row wrap', style: 'gap:8px' },
        el('span', { class: 'check' + (has ? ' on' : ''), style: 'width:18px;height:18px;font-size:11px' }, has ? '✓' : ''),
        el('b', { style: 'font-size:12.5px;flex:1;min-width:0' }, c.name),
        scriptLinkFor(a, c.id)
          ? el('a', { class: 'btn small', href: scriptLinkFor(a, c.id), target: '_blank', rel: 'noopener' }, 'Script ↗')
          : null,
        bodyLinkFor(a, c.id)
          ? el('a', { class: 'btn small', href: bodyLinkFor(a, c.id), target: '_blank', rel: 'noopener' }, 'Bodies ↗')
          : null),
      el('input', {
        class: 'input', style: 'height:30px;font-size:12px', value: scriptLinkFor(a, c.id),
        placeholder: 'Script for this body — the editor works from this…',
        oninput: e => set(x => setConceptScript(x, c.id, e.target.value)),
      }),
      el('input', {
        class: 'input', style: 'height:30px;font-size:12px', value: bodyLinkFor(a, c.id),
        placeholder: 'Folder the finished bodies go in…',
        oninput: e => set(x => setConceptLink(x, c.id, e.target.value)),
      })));
  });

  const left = chosen.filter(c => !bodyLinkFor(a, c.id)).length;
  box.appendChild(el('span', { class: 'hint' },
    left ? left + ' of ' + chosen.length + ' still need their bodies folder.'
      : 'All ' + chosen.length + ' have their bodies.'));
}


// ---------------------------------------------------------------------------
// the form editor — admin only
// ---------------------------------------------------------------------------
// Every change is saved straight away. Removing a step only takes it off the
// form: pages keep whatever was filled in, so adding it back loses nothing.
function formEditor() {
  const f = form();
  // write the form; `loud` re-renders, typing in a name stays quiet
  const commit = loud => {
    // setPref saves asynchronously, so re-render only once it has landed
    setPref('onboardingForm', { phases: f.phases, fields: f.fields }).then(() => { if (loud) forceEmit(); });
  };
  const wrap = el('div', { class: 'col', style: 'gap:14px' });

  const head = el('div', { class: 'page-head' },
    el('div', null,
      el('h1', null, 'Edit onboarding form'),
      el('div', { class: 'sub' }, 'Reorder, remove or add the steps every new page goes through')),
    el('span', { class: 'spacer' }));
  import('../app.js').then(({ statusPill }) => head.insertBefore(statusPill(), head.children[2]));
  head.appendChild(el('button', {
    class: 'btn', onclick: () => {
      if (!confirm('Reset the form to the built-in layout?\n\nYour own fields are removed from the form; answers already given on pages are kept.')) return;
      setPref('onboardingForm', null).then(forceEmit);
    }
  }, 'Reset to default'));
  head.appendChild(el('button', { class: 'btn primary', onclick: () => { state.obEditForm = false; forceEmit(); } }, 'Done'));
  wrap.appendChild(head);

  wrap.appendChild(el('div', { class: 'card hint', style: 'padding:11px 14px' },
    'Changes save as you go and apply to every page being set up. Removing a step does not delete what was already filled in on a page — add it back and it is still there.'));

  // ---- sections
  f.phases.forEach((ph, pi) => {
    const card = el('div', { class: 'card col', style: 'gap:10px' });
    card.appendChild(el('div', { class: 'row wrap', style: 'gap:8px' },
      el('span', { class: 'ob-num' }, String(pi + 1)),
      el('input', {
        class: 'input', style: 'flex:1;min-width:160px;height:33px;font-weight:700', value: ph.label, placeholder: 'Section name…',
        oninput: e => { ph.label = e.target.value; commit(); },
      }),
      el('button', { class: 'iconbtn', title: 'Move section up', onclick: () => { moveIn(f.phases, pi, -1); commit(true); } }, '↑'),
      el('button', { class: 'iconbtn', title: 'Move section down', onclick: () => { moveIn(f.phases, pi, 1); commit(true); } }, '↓'),
      el('button', {
        class: 'iconbtn danger', title: 'Delete section', onclick: () => {
          if (ph.steps.length && !confirm('Delete the “' + (ph.label || 'untitled') + '” section?\n\nIts ' + ph.steps.length + ' step(s) come off the form too.')) return;
          f.fields = f.fields.filter(x => !ph.steps.includes(x.id));
          f.phases.splice(pi, 1);
          commit(true);
        }
      }, '✕')));
    card.appendChild(el('input', {
      class: 'input', style: 'height:30px;font-size:12px', value: ph.note, placeholder: 'Short description (optional)…',
      oninput: e => { ph.note = e.target.value; commit(); },
    }));

    if (!ph.steps.length) card.appendChild(el('div', { class: 'hint' }, 'No steps in this section yet.'));
    ph.steps.forEach((k, si) => card.appendChild(stepEditRow(f, ph, k, si, commit)));

    card.appendChild(el('div', { class: 'row wrap', style: 'gap:8px;padding-top:2px' },
      el('button', { class: 'btn small', onclick: () => openFieldEditor(f, ph, null, commit) }, '+ Add field'),
      addBuiltinPicker(f, ph, commit)));
    wrap.appendChild(card);
  });

  wrap.appendChild(el('div', { class: 'row' },
    el('button', {
      class: 'btn', onclick: () => {
        const name = prompt('Name of the new section:');
        if (!name || !name.trim()) return;
        f.phases.push({ id: uid('ph'), label: name.trim(), note: '', steps: [] });
        commit(true);
      }
    }, '+ Add section')));
  return wrap;
}

function moveIn(list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const t = list[i]; list[i] = list[j]; list[j] = t;
}

// One step in the editor: its name, what kind it is, and how to move it.
function stepEditRow(f, ph, key, si, commit) {
  const d = stepDef(key, f);
  const kindPair = d.custom && FIELD_KINDS.find(x => x[0] === d.custom.kind);
  const kind = d.custom ? (kindPair ? kindPair[1] : 'Field') : 'Built-in';
  const others = f.phases.filter(p => p !== ph);

  let mover = null;
  if (others.length) {
    mover = el('select', {
      class: 'input', style: 'width:auto;height:30px;font-size:12px', title: 'Move to another section',
      onchange: e => {
        const to = f.phases.find(p => p.id === e.target.value);
        if (!to) return;
        ph.steps.splice(si, 1);
        to.steps.push(key);
        commit(true);
      }
    }, [el('option', { value: '' }, 'Move to…')]
      .concat(others.map(p => el('option', { value: p.id }, p.label || 'Untitled section'))));
  }

  return el('div', { class: 'ob-edit-step' },
    el('div', { class: 'col', style: 'gap:1px;flex:1;min-width:150px' },
      el('b', { style: 'font-size:12.5px' }, d.label,
        d.required === false ? el('span', { class: 'hint', style: 'font-weight:600' }, ' · optional') : null),
      d.hint ? el('span', { class: 'hint' }, d.hint) : null),
    el('span', { class: 'chip ' + (d.custom ? 'violet' : 'gray') }, kind),
    d.custom ? el('button', { class: 'btn small', onclick: () => openFieldEditor(f, ph, d.custom, commit) }, 'Edit') : null,
    mover,
    el('button', { class: 'iconbtn', title: 'Move up', onclick: () => { moveIn(ph.steps, si, -1); commit(true); } }, '↑'),
    el('button', { class: 'iconbtn', title: 'Move down', onclick: () => { moveIn(ph.steps, si, 1); commit(true); } }, '↓'),
    el('button', {
      class: 'iconbtn danger', title: 'Remove from the form', onclick: () => {
        if (d.custom) {
          if (!confirm('Delete the field “' + d.label + '”?\n\nAnswers already given on pages are kept, but the field is gone from the form.')) return;
          f.fields = f.fields.filter(x => x.id !== key);
        }
        ph.steps.splice(si, 1);
        commit(true);
      }
    }, '✕'));
}

// Built-in steps that are not on the form, offered back.
function addBuiltinPicker(f, ph, commit) {
  const used = new Set(formSteps(f));
  const free = Object.keys(STEPS).filter(k => !used.has(k));
  if (!free.length) return null;
  return el('select', {
    class: 'input', style: 'width:auto;height:30px;font-size:12px',
    onchange: e => {
      if (!e.target.value) return;
      ph.steps.push(e.target.value);
      commit(true);
    }
  }, [el('option', { value: '' }, '+ Add a removed built-in step…')]
    .concat(free.map(k => el('option', { value: k }, STEPS[k].label))));
}

// Add or edit one custom field, in a modal.
function openFieldEditor(f, ph, existing, commit) {
  const fd = existing ? JSON.parse(JSON.stringify(existing))
    : { id: uid('cf'), label: '', hint: '', kind: 'check', said: '', options: [], required: true };
  const body = el('div', { class: 'modal-body' });
  const err = el('div', { class: 'error', style: 'display:none' });
  const row = (label, control, hint) => el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, label), control, hint ? el('span', { class: 'hint' }, hint) : null);

  body.appendChild(row('NAME', el('input', {
    class: 'input', value: fd.label, placeholder: 'e.g. Pixel installed', oninput: e => fd.label = e.target.value,
  })));
  body.appendChild(row('DESCRIPTION', el('input', {
    class: 'input', value: fd.hint, placeholder: 'One line on what this means (optional)', oninput: e => fd.hint = e.target.value,
  })));

  const extra = el('div', { class: 'col', style: 'gap:12px' });
  const paintExtra = () => {
    extra.innerHTML = '';
    if (fd.kind === 'check') {
      extra.appendChild(row('CHECKBOX TEXT', el('input', {
        class: 'input', value: fd.said || '', placeholder: 'Done', oninput: e => fd.said = e.target.value,
      }), 'What the box says next to the tick.'));
    }
    if (fd.kind === 'select') {
      extra.appendChild(row('OPTIONS', el('textarea', {
        class: 'input', style: 'min-height:80px', placeholder: 'One option per line',
        oninput: e => fd.options = e.target.value.split('\n').map(s => s.trim()).filter(Boolean),
      }, (fd.options || []).join('\n')), 'One per line.'));
    }
  };
  const kindSeg = el('div', { class: 'seg mini' });
  const paintKind = () => {
    kindSeg.innerHTML = '';
    FIELD_KINDS.forEach(([k, label]) => kindSeg.appendChild(el('button', {
      class: fd.kind === k ? 'on' : '', onclick: () => { fd.kind = k; paintKind(); paintExtra(); }
    }, label)));
  };
  paintKind();
  paintExtra();
  body.appendChild(row('TYPE', el('div', { class: 'row' }, kindSeg),
    'A checkbox is done when ticked; the others when something is filled in.'));
  body.appendChild(extra);

  const reqBtn = el('button', { class: 'cbox' });
  const paintReq = () => {
    reqBtn.className = 'cbox' + (fd.required !== false ? ' on' : '');
    reqBtn.innerHTML = '';
    reqBtn.appendChild(el('span', { class: 'bx' }, fd.required !== false ? '✓' : ''));
    reqBtn.appendChild(document.createTextNode('Required before a page can be submitted'));
  };
  reqBtn.onclick = () => { fd.required = fd.required === false; paintReq(); };
  paintReq();
  body.appendChild(reqBtn);
  body.appendChild(err);

  const close = () => { state.modal = null; forceEmit(); };
  body.appendChild(el('div', { class: 'row', style: 'gap:9px;padding-top:4px' },
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: close }, 'Cancel'),
    el('button', {
      class: 'btn primary', onclick: () => {
        fd.label = (fd.label || '').trim();
        if (!fd.label) { err.textContent = 'Give the field a name.'; err.style.display = ''; return; }
        if (fd.kind === 'select' && !(fd.options || []).length) { err.textContent = 'Add at least one option.'; err.style.display = ''; return; }
        if (fd.kind !== 'select') delete fd.options;
        if (fd.kind !== 'check') delete fd.said;
        const i = f.fields.findIndex(x => x.id === fd.id);
        if (i >= 0) f.fields[i] = fd;
        else { f.fields.push(fd); ph.steps.push(fd.id); }
        state.modal = null;
        commit(true);
      }
    }, existing ? 'Save field' : 'Add field')));

  state.modal = overlay(existing ? 'Edit field' : 'Add a field', body);
  forceEmit();
}
