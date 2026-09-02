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
import { sortedStages, stageOf, quotaSummaryFor } from '../stages.js';
import {
  conceptsForAccount, bodyLinkFor, scriptLinkFor, setConceptLink, setConceptScript,
} from '../concepts.js';
import { QUALITY, TARGETING, openAccount } from './accounts.js';

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
  // The two below are ticked by hand, and they are the only ones that are.
  // Both happen somewhere this tool cannot see — in LinkTwin, and on the page
  // itself — so there is no field to read them off. A box someone ticks is
  // honest about that; inferring it from anything here would not be.
  linktwin: { label: 'LinkTwin links', hint: 'The links for this page are created.', done: a => !!a.linktwinDone },
  automations: { label: 'Automations', hint: 'Automations and links added to the page.', done: a => !!a.automationsDone },
  product: { label: 'Product', hint: 'What this page promotes.', done: a => !!byId(state.db.products, a.productId) },
  targeting: { label: 'Targeting', hint: 'Who it is set to reach.', done: a => !!a.targeting },
  quality: { label: 'Video quality', hint: 'Whether its videos are built from scratch or assembled.', done: a => !!a.quality },
  stage: {
    label: 'Stage', hint: 'Which decides how many videos a day it gets.',
    done: a => !!stageOf(a) || !!a.quotaOverride,
  },
  base: { label: 'Base images', hint: 'The folder an editor cuts from.', done: a => !!(a.baseImageLink || '').trim() },
  bodies: { label: 'Bodies', hint: 'The concepts it starts with, and a folder of bodies for each.', done: a => bodiesReady(a) },
};

const PHASES = [
  {
    label: 'The page itself', note: 'What it looks like, where it lives, and what is wired up on it.',
    steps: ['name', 'avatar', 'cover', 'links', 'linktwin', 'automations'],
  },
  { label: 'How it runs', note: 'What it sells, who it reaches, how much it makes a day.', steps: ['product', 'targeting', 'quality', 'stage'] },
  { label: 'Content ready', note: 'What an editor needs before they can make anything for it.', steps: ['base', 'bodies'] },
];

const ALL_STEPS = PHASES.reduce((list, p) => list.concat(p.steps), []);

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
  const done = ALL_STEPS.filter(k => STEPS[k].done(a)).length;
  return { done, total: ALL_STEPS.length, ready: done === ALL_STEPS.length };
}

function nextStep(a) {
  const k = ALL_STEPS.find(x => !STEPS[x].done(a));
  return k ? STEPS[k].label : null;
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
    stageId: '', quality: '', quotaOverride: null, targeting: '', targetingNote: '',
    replacesId: '', wentLiveAt: null, droppedAt: null, dropReason: '',
    metaBusinessSuiteUrl: '', avatarUrl: '', coverUrl: '', baseImageLink: '',
    linktwinDone: false, automationsDone: false,
    bodyLinks: [], setupConcepts: [], notes: '',
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
      el('i', { style: 'width:' + Math.round(p.done / p.total * 100) + '%;background:' + (p.ready ? 'var(--green)' : 'var(--amber)') })),
    el('span', { class: 'hint' }, p.ready ? 'Everything filled in — open it to submit.' : 'Next: ' + next));
}

// ---------------------------------------------------------------------------
// the setup sheet — one page, worked through top to bottom
// ---------------------------------------------------------------------------
function setupSheet(a) {
  const wrap = el('div', { class: 'col', style: 'gap:16px' });

  // Written straight to the record rather than to a copy: a page half set up
  // is a real state, and closing the tab should never lose it. Quiet, so a
  // re-render never yanks the field being typed in.
  const set = async fn => {
    const { mutateQuiet } = await import('../app.js');
    mutateQuiet('accounts', a.id, fn);
    paint();
  };

  const ticks = {};                     // step id -> its tick element
  const bar = el('i');
  const counter = el('span', { class: 'hint' });
  const submit = el('button', { class: 'btn primary', onclick: () => submitPage(a) }, 'Add to the account centre');
  const readyNote = el('span', { class: 'hint' });

  // Repaints only what the checklist says, never the controls — so ticks keep
  // up with typing without the field losing focus mid-word.
  function paint() {
    const p = progressOf(a);
    ALL_STEPS.forEach(k => {
      const t = ticks[k];
      if (!t) return;
      const on = STEPS[k].done(a);
      t.classList.toggle('on', on);
      t.textContent = on ? '✓' : '';
    });
    bar.style.cssText = 'width:' + Math.round(p.done / p.total * 100) + '%;background:'
      + (p.ready ? 'var(--green)' : 'var(--amber)');
    counter.textContent = p.done + ' of ' + p.total + ' done';
    submit.disabled = !p.ready;
    readyNote.textContent = p.ready
      ? 'Everything is filled in.'
      : 'Still to do: ' + ALL_STEPS.filter(k => !STEPS[k].done(a)).map(k => STEPS[k].label).join(', ') + '.';
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
  const hooks = {};

  // ---- phases
  PHASES.forEach((ph, i) => {
    wrap.appendChild(el('div', { class: 'ob-phase' },
      el('span', { class: 'ob-num' }, String(i + 1)),
      el('b', { style: 'font-size:13.5px' }, ph.label),
      el('span', { class: 'hint' }, ph.note)));
    const box = el('div', { class: 'col', style: 'gap:9px' });
    ph.steps.forEach(k => box.appendChild(stepRow(a, k, set, ticks, paint, hooks)));
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
function stepRow(a, key, set, ticks, paint, hooks) {
  const step = STEPS[key];
  const tick = el('span', { class: 'check' });
  ticks[key] = tick;

  const control = el('div', { class: 'col', style: 'gap:6px;flex:1;min-width:220px' });
  buildControl(a, key, control, set, paint, hooks);

  return el('div', { class: 'card ob-step' },
    tick,
    el('div', { class: 'col', style: 'gap:2px;flex:0 0 148px;min-width:120px' },
      el('b', { style: 'font-size:12.5px' }, step.label),
      el('span', { class: 'hint' }, step.hint)),
    control);
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

  // The two hand-ticked steps. The box carries the words, so what is being
  // confirmed is on screen rather than remembered from the label alone.
  if (key === 'linktwin' || key === 'automations') {
    const f = key === 'linktwin' ? 'linktwinDone' : 'automationsDone';
    const said = key === 'linktwin' ? 'Links created' : 'Added to the page';
    const btn = el('button', { class: 'cbox' + (a[f] ? ' on' : '') },
      el('span', { class: 'bx' }, a[f] ? '✓' : ''), said);
    btn.onclick = async () => {
      const next = !a[f];
      await set(x => x[f] = next);
      btn.classList.toggle('on', next);
      btn.firstChild.textContent = next ? '✓' : '';
    };
    box.appendChild(btn);
    box.appendChild(el('span', { class: 'hint' }, key === 'linktwin'
      ? 'Done in LinkTwin, so this is the only record of it here.'
      : 'Done on the page itself, so this is the only record of it here.'));
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
      [['', 'Not set'], ['broad', 'Broad']].concat(TARGETING.map(t => [t[0], t[1]])), a.targeting,
      (x, v) => x.targeting = v));
    box.appendChild(el('span', { class: 'hint' }, 'Broad still counts as a decision — it just carries no flag.'));
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
      note.textContent = (stageOf(a) || a.quotaOverride)
        ? quotaSummaryFor(a) + '.'
        : (stages.length ? '' : 'No stages defined yet — add them under Settings.');
    };
    // built here rather than through pick(), so the summary below updates in
    // the same breath as the choice
    const sel = el('select', {
      class: 'input', style: 'width:auto;min-width:170px',
      onchange: async e => { await set(x => x.stageId = e.target.value); paintNote(); },
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

