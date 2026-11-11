// ============================================================================
// onboarding.js — the five stages a new page goes through before it is a page.
//
//   1 Images    base image (also the profile picture), cover photo
//   2 Details   name, product, targeting, video quality
//   3 Links     a LinkTwin and a Lens link for each placement on each platform
//   4 Accounts  which accounts exist, their links, where they are held
//   5 Editor    who works on it (can stay unassigned)
//   6 Rule      which rule its videos follow (admin only; see rules.js)
//
// One stage fills the screen at a time. Continue is locked until the stage is
// complete, and any finished stage can be reopened to change it. Every change is
// written straight to the record, so leaving halfway loses nothing and the page
// reopens on the stage it was on.
//
// Nothing here is a separate record. It is the same avatar the rest of the app
// uses, carrying `onboarding: true` until it joins the account centre.
//
// Admin and marketing manager only.
// ============================================================================

import { state, forceEmit, uid, byId, can } from '../state.js';
import { el, avatar } from '../ui.js';
import { rampSeed, syncRampStage, ensureRampStages } from '../stages.js';
import { QUALITY, TARGETING, profileSelect } from './accounts.js';
import { productOptions } from '../brands.js';
import { linkFieldsInto, accountFieldsInto, missingLinks, missingAccounts } from '../pagelinks.js';
import { ruleChoices } from './rulesettings.js';
import { suggestedRule } from '../rules.js';

export function onboardingPages(db) {
  return ((db || state.db).accounts || []).filter(a => a.onboarding);
}

export function onboardingCount() {
  return onboardingPages(state.db).length;
}

const STAGES = [
  {
    label: 'Images', title: 'Upload the images', note: 'The image videos are built from, which is also the profile picture, and the page\'s banner.',
    missing: a => [!a.avatarUrl && 'Base image', !a.coverUrl && 'Cover photo'].filter(Boolean),
    body: imagesStage,
  },
  {
    label: 'Details', title: 'Page details', note: 'Who this page is and what it promotes.',
    missing: a => [
      !(a.name || '').trim() && 'Name', !byId(state.db.products, a.productId) && 'Product',
      !a.targeting && 'Targeting', !a.quality && 'Video quality',
    ].filter(Boolean),
    body: detailsStage,
  },
  {
    label: 'Links', title: 'Create the links', note: 'A LinkTwin and a Lens link for each placement.',
    missing: a => { const n = missingLinks(a); return n ? [n + (n === 1 ? ' Instagram or Facebook link' : ' Instagram and Facebook links')] : []; },
    body: linksStage,
  },
  {
    label: 'Accounts', title: 'Create the accounts', note: 'Tick each one once it exists. YT Shorts and Threads are optional.',
    missing: missingAccounts,
    body: accountsStage,
  },
  {
    label: 'Editor', title: 'Assign an editor', note: 'Who will work on this page. You can leave it unassigned and set it later under Team.',
    missing: () => [],
    body: editorStage,
  },
];

// The rule is the admin's to pick, so only the admin gets the step. A page someone
// else finishes takes the suggested rule, which can be changed under Edit avatar.
const RULE_STAGE = {
  label: 'Rule', title: 'Pick its rule', note: 'How this page’s first videos go. Only you see this.',
  missing: () => [],
  body: (a, change) => ruleChoices(a, change),
};
const stagesNow = () => (can.seeRules(state.user) ? STAGES.concat([RULE_STAGE]) : STAGES);
const lastStage = () => stagesNow().length;

// The first stage with something left to do, which is as far as a page can go.
function furthestStage(a) {
  const i = stagesNow().findIndex(s => s.missing(a).length);
  return i < 0 ? lastStage() : i + 1;
}

function currentStage(a) {
  return Math.min(Math.max(+a.obStage || 1, 1), furthestStage(a));
}

// ---------------------------------------------------------------------------
// creating and graduating
// ---------------------------------------------------------------------------
export async function startNewPage(seed) {
  const { save } = await import('../app.js');
  await ensureRampStages();
  const a = Object.assign({
    id: uid('a'), name: '', status: 'Building', phase: 'P1',
    productId: '', platforms: { facebook: '', instagram: '' },
    facebookProfileId: '', instagramProfileId: '',
    quality: '', targeting: '', targetingNote: '', ...rampSeed(),
    replacesId: '', wentLiveAt: null, droppedAt: null, dropReason: '',
    metaBusinessSuiteUrl: '', avatarUrl: '', coverUrl: '', baseImageLink: '',
    pageCreated: false, linkCreated: false, linkAdded: false, amazonAdded: false,
    linktwin: {}, placementLinks: {}, socials: {}, captions: {}, bodyLinks: [], notes: '',
    obStage: 1, onboarding: true, createdAt: Date.now(),
  }, seed || {});
  save('accounts', a);
  state.route = 'onboarding';
  state.onboardAvatar = a.id;
  forceEmit();
}

// Everything is filled in, so the page exists and is ready to run, which is what
// Live means.
async function submitPage(a) {
  if (furthestStage(a) < lastStage()) return;
  await ensureRampStages();
  const { mutate } = await import('../app.js');
  mutate('accounts', a.id, x => {
    x.onboarding = false;
    x.onboardedAt = Date.now();
    delete x.obStage;
    if (!(x.baseImageLink || '').trim()) x.baseImageLink = x.avatarUrl;
    // a page begun before stages were automatic joins them now
    if (!x.ruleId) x.ruleId = suggestedRule(x);
    if (!x.stageId) { x.ramp = true; syncRampStage(x); }
    if (x.status === 'Building') { x.status = 'Live'; x.wentLiveAt = x.wentLiveAt || Date.now(); }
  });
  state.onboardAvatar = null;
  state.route = 'accounts';
  forceEmit();
}

// ---------------------------------------------------------------------------
// the list of pages being set up
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
    if (a) { root.appendChild(wizard(a)); return; }
    state.onboardAvatar = null;      // submitted, discarded, or gone
  }

  root.appendChild(head(pages.length));

  if (!pages.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:40px' },
      'No pages being set up. Start one and it works through its stages here, ',
      'then joins the Avatars centre.'));
    return;
  }

  // closest to finished first: those are the ones worth pushing over the line
  const sorted = pages.slice().sort((x, y) =>
    furthestStage(y) - furthestStage(x) || (x.name || '').localeCompare(y.name || ''));

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
  const at = furthestStage(a);
  const ready = at === lastStage();
  return el('div', {
    class: 'card col click', style: 'gap:12px',
    onclick: () => { state.onboardAvatar = a.id; forceEmit(); },
  },
    el('div', { class: 'row', style: 'gap:11px' },
      avatar(a, 40),
      el('div', { style: 'min-width:0;flex:1' },
        el('b', { style: 'display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' },
          (a.name || '').trim() || 'Untitled page'),
        el('span', { class: 'hint' }, 'Stage ' + at + ' of ' + lastStage() + ': ' + stagesNow()[at - 1].label)),
      ready
        ? el('span', { class: 'chip green' }, 'Ready')
        : el('span', { class: 'chip amber' }, 'In progress')),
    el('div', { class: 'bar' },
      el('i', { style: 'width:' + Math.round((at - 1) / (lastStage() - 1) * 100) + '%;background:' + (ready ? 'var(--green)' : 'var(--amber)') })));
}

// ---------------------------------------------------------------------------
// the stages
// ---------------------------------------------------------------------------
function wizard(a) {
  const stage = currentStage(a);
  const def = stagesNow()[stage - 1];
  const wrap = el('div', { class: 'wiz' });

  const go = async n => {
    const { save } = await import('../app.js');
    a.obStage = n;
    save('accounts', a);
    forceEmit();
    window.scrollTo(0, 0);
  };

  // Written straight to the live record, and quietly, so a keystroke never
  // redraws the field being typed in.
  const change = fn => {
    fn(a);
    import('../app.js').then(m => m.saveQuiet('accounts', a));
    paint();
  };

  const steps = el('div', { class: 'wiz-steps' });
  const next = el('button', { class: 'btn primary', type: 'button' });
  const todo = el('span', { class: 'hint wiz-todo' });

  function paint() {
    steps.innerHTML = '';
    const reach = furthestStage(a);
    stagesNow().forEach((s, i) => {
      const n = i + 1;
      const done = n !== stage && !s.missing(a).length && n !== lastStage();
      steps.appendChild(el('button', {
        class: 'wiz-step' + (n === stage ? ' on' : '') + (done ? ' done' : ''), type: 'button',
        disabled: n > reach && n !== stage,
        'aria-current': n === stage ? 'step' : null,
        onclick: () => { if (n !== stage) go(n); },
      }, el('span', { class: 'wiz-num' }, done ? '✓' : String(n)), el('span', { class: 'wiz-name' }, s.label)));
    });
    const left = def.missing(a);
    next.disabled = stage === lastStage() ? reach < lastStage() : left.length > 0;
    todo.textContent = left.length ? 'Still needed: ' + left.join(', ') + '.' : '';
  }

  next.textContent = stage === lastStage() ? 'Add to the account centre' : 'Continue to stage ' + (stage + 1);
  next.onclick = () => (stage === lastStage() ? submitPage(a) : go(stage + 1));

  wrap.appendChild(el('div', { class: 'row wrap', style: 'gap:10px' },
    el('button', { class: 'btn small', type: 'button', onclick: () => { state.onboardAvatar = null; forceEmit(); } }, '‹ All pages'),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'btn small danger', type: 'button', onclick: async () => {
        if (!confirm('Discard this page?\n\nIt has not joined the account centre, so nothing is kept.')) return;
        const { removeItem } = await import('../app.js');
        removeItem('accounts', a.id);
        state.onboardAvatar = null;
        forceEmit();
      }
    }, 'Discard')));
  wrap.appendChild(steps);
  wrap.appendChild(el('div', { class: 'wiz-head' },
    el('span', { class: 'label' }, 'STAGE ' + stage + ' OF ' + lastStage()),
    el('h1', null, def.title),
    el('div', { class: 'sub' }, def.note)));
  wrap.appendChild(def.body(a, change));
  wrap.appendChild(el('div', { class: 'wiz-foot' },
    stage > 1 ? el('button', { class: 'btn', type: 'button', onclick: () => go(stage - 1) }, '‹ Back') : null,
    todo,
    el('span', { class: 'spacer' }),
    next));

  paint();
  return wrap;
}

// ---- stage 1
function imagesStage(a, change) {
  // One picture fills both. An older page's base images can be a Drive folder,
  // which a new profile picture does not replace.
  const base = {
    get: () => a.avatarUrl || '',
    set: url => change(x => {
      const shared = !(x.baseImageLink || '').trim() || x.baseImageLink === x.avatarUrl;
      x.avatarUrl = url;
      if (shared) x.baseImageLink = url;
    }),
  };
  const cover = { get: () => a.coverUrl || '', set: url => change(x => { x.coverUrl = url; }) };
  return el('div', { class: 'wiz-images' },
    uploadTile(base, 'Base image and profile picture', 'tall'),
    uploadTile(cover, 'Cover photo', 'wide'));
}

function uploadTile(image, label, shape) {
  const file = el('input', { class: 'sr-only', type: 'file', accept: 'image/*', 'aria-label': 'Upload ' + label });
  const shot = el('div', { class: 'up-shot ' + shape });
  const remove = el('button', { class: 'btn small danger', type: 'button' }, 'Remove');
  const pickLabel = el('span', null);
  const pick = el('label', { class: 'btn small', style: 'cursor:pointer' }, pickLabel, file);
  const err = el('div', { class: 'error', style: 'display:none' });

  const paint = () => {
    shot.innerHTML = '';
    const url = image.get().trim();
    if (url) {
      shot.appendChild(el('img', { src: url, alt: label }));
    } else {
      shot.appendChild(el('span', { class: 'hint' }, 'Drop an image here'));
    }
    pickLabel.textContent = url ? 'Replace' : 'Upload';
    remove.style.display = url ? '' : 'none';
  };

  const upload = async f => {
    if (!f) return;
    err.style.display = 'none';
    if (!/^image\//.test(f.type)) {
      err.textContent = 'That file is not an image.';
      err.style.display = '';
      return;
    }
    pickLabel.textContent = 'Uploading…';
    try {
      const { store } = await import('../app.js');
      const url = await store.uploadImage(f);
      image.set(url);
    } catch (e) {
      err.textContent = 'The upload failed. Try again. ' + (e.message || '');
      err.style.display = '';
    }
    paint();
  };

  file.onchange = e => { upload(e.target.files && e.target.files[0]); e.target.value = ''; };
  remove.onclick = () => { image.set(''); paint(); };
  shot.ondragover = e => { e.preventDefault(); shot.classList.add('over'); };
  shot.ondragleave = () => shot.classList.remove('over');
  shot.ondrop = e => {
    e.preventDefault();
    shot.classList.remove('over');
    upload(e.dataTransfer.files[0]);
  };

  paint();
  return el('div', { class: 'card up-tile ' + shape },
    el('b', null, label),
    shot,
    el('div', { class: 'row wrap', style: 'gap:8px' }, pick, remove),
    err);
}

// ---- stage 2
function detailsStage(a, change) {
  const row = (label, control, hint) => el('div', { class: 'col', style: 'gap:6px' },
    el('span', { class: 'label' }, label), control, hint || null);

  const seg = (pairs, current, apply) => {
    const box = el('div', { class: 'seg', style: 'align-self:flex-start;flex-wrap:wrap' });
    const paint = v => {
      box.innerHTML = '';
      pairs.forEach(([id, label]) => box.appendChild(el('button', {
        type: 'button', class: v === id ? 'on' : '', 'aria-pressed': String(v === id),
        onclick: () => { apply(id); paint(id); },
      }, label)));
    };
    paint(current);
    return box;
  };

  const product = el('select', {
    class: 'input', 'aria-label': 'Product',
    onchange: e => change(x => { x.productId = e.target.value; }),
  }, [el('option', { value: '' }, 'Choose a product')].concat(productOptions()));
  product.value = a.productId || '';

  const note = el('div', { class: 'col', style: 'gap:6px' });
  const paintNote = () => {
    note.innerHTML = '';
    if (a.targeting !== 'restricted') return;
    note.appendChild(el('span', { class: 'label' }, 'WHAT IS RESTRICTED'));
    note.appendChild(el('input', {
      class: 'input', value: a.targetingNote || '', placeholder: 'e.g. no EU, no UK',
      oninput: e => change(x => { x.targetingNote = e.target.value; }),
    }));
  };
  paintNote();

  return el('div', { class: 'card col wiz-form' },
    row('NAME', el('input', {
      class: 'input', value: a.name || '', placeholder: 'e.g. Chloe Bennett',
      oninput: e => change(x => { x.name = e.target.value; }),
    })),
    row('PRODUCT', product, state.db.products.length ? null : el('span', { class: 'hint' }, 'No products yet. Add one under Settings → Brands.')),
    row('TARGETING', seg(TARGETING.map(t => [t[0], t[1]]), a.targeting, v => { change(x => { x.targeting = v; }); paintNote(); })),
    note,
    row('VIDEO QUALITY', seg(QUALITY.map(q => [q[0], q[1]]), a.quality, v => change(x => { x.quality = v; }))));
}

// ---- stage 3
function linksStage(a, change) {
  const box = el('div', { class: 'col', style: 'gap:12px' });
  linkFieldsInto(box, a, change);
  return box;
}

// ---- stage 4
function accountsStage(a, change) {
  const box = el('div', { class: 'col', style: 'gap:12px' });
  accountFieldsInto(box, a, change,
    profileSelect('facebook', a.facebookProfileId, v => change(x => { x.facebookProfileId = v; })));
  return box;
}

// ---- stage 5
function editorStage(a) {
  const u = state.user;
  const editors = (state.db.team || []).filter(t => ['editor', 'manager'].includes(t.role) && !t.paused);
  const owners = editors.filter(t => (t.assignments || []).includes(a.id));

  const summary = el('div', { class: 'row', style: 'gap:12px' },
    avatar(a, 48),
    el('div', { style: 'min-width:0' },
      el('b', { style: 'display:block' }, (a.name || '').trim() || 'Untitled page'),
      el('span', { class: 'hint' }, (byId(state.db.products, a.productId) || {}).name || '')));

  // Assignments live on the team member, and only the admin can change those.
  if (!can.manageTeam(u)) {
    return el('div', { class: 'card col wiz-form' }, summary,
      el('span', { class: 'hint' }, owners.length
        ? 'Assigned to ' + owners.map(t => t.name).join(', ') + '.'
        : 'This page will be unassigned. The admin assigns it under Team.'));
  }

  const sel = el('select', {
    class: 'input', 'aria-label': 'Editor',
    onchange: async e => {
      const { mutate } = await import('../app.js');
      const id = e.target.value;
      editors.forEach(t => {
        const has = (t.assignments || []).includes(a.id);
        if (t.id === id && !has) mutate('team', t.id, m => { m.assignments = (m.assignments || []).concat([a.id]); });
        if (t.id !== id && has) mutate('team', t.id, m => { m.assignments = m.assignments.filter(x => x !== a.id); });
      });
    },
  }, [el('option', { value: '' }, 'Unassigned')].concat(editors.map(t => el('option', { value: t.id }, t.name))));
  sel.value = owners.length ? owners[0].id : '';

  return el('div', { class: 'card col wiz-form' }, summary,
    el('div', { class: 'col', style: 'gap:6px' }, el('span', { class: 'label' }, 'EDITOR'), sel,
      editors.length ? null : el('span', { class: 'hint' }, 'No editors yet. Add them under Team.')));
}
