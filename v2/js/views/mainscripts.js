// mainscripts.js — the Prompts tab, the copy-paste workspace. A script here is a
// finished reference
// video broken into shots: each shot has its reference image and its image and
// video prompts, ready to copy. The person making it picks the page it is for
// and ticks each step off, and the next step is always the one lit up.
//
// Progress is kept per page on that page's entry, so two people making the same
// script for different pages never touch each other's ticks.
//
// A video finds its script one of two ways. Connected by hand on the video, it
// points straight at the script (promptId). Otherwise it goes by its label: same
// day, same brand, same type, same version (Growth 1, CTA 2…), where the brand comes
// from the video's page and the version is the video's promptV. When a video has a
// script, the finished link and the done tick are the video's own, so nobody logs
// them twice.
//
// The whole shell is rebuilt on any change, so the reference video element is
// kept between renders. Put back in the same tick, it carries on playing.

import { state, emit, forceEmit, uid, todayStr, fmtDate, byId, can, myAccounts, builderAccounts, visibleEntries } from '../state.js';
import { el, copyText, avatar } from '../ui.js';
import { guarded } from '../guard.js';
import { liveAccounts } from '../stages.js';
import { productOptions, brands, brandById, pageBrand } from '../brands.js';

const TOOLS = [['veo', 'Veo'], ['omniflash', 'Omni Flash'], ['grok', 'Grok']];
const TYPES = ['Growth', 'Product'];
const STEP = { image: 'imagePrompt', video: 'videoPrompt' };

async function quiet(id, fn) { const { mutateQuiet } = await import('../app.js'); mutateQuiet('scripts', id, fn); }
async function loud(id, fn) { const { mutate } = await import('../app.js'); mutate('scripts', id, fn); }

export function scriptsMode(root, u) {
  const canEdit = can.editScripts(u);
  const allowed = scriptsFor(u);
  const scripts = allowed.filter(s => s.date === state.date).sort((a, b) => (a.order || 0) - (b.order || 0));
  // by id, not by day: a video made today can use a script written days ago
  const open = state.openScript ? allowed.find(s => s.id === state.openScript) : null;
  if (open) root.appendChild(detail(open, canEdit, u));
  else root.appendChild(list(scripts, canEdit, u, allowed));
}

// The scripts this person may see. Whoever writes prompts or oversees every page
// sees them all. A VA sees the ones for their own pages: a script already on videos
// belongs to those videos' pages, and one on no videos yet to its product, or
// failing that its brand.
export function scriptsFor(u) {
  if (can.editScripts(u) || can.seesAllAccounts(u)) return state.db.scripts;
  const pages = builderAccounts(u, state.db);
  const ids = new Set(pages.map(a => a.id));
  // their own pages only: being handed one video on another brand's page does not
  // open up that brand's other scripts
  const own = myAccounts(u, state.db);
  const products = new Set(own.map(a => a.productId).filter(Boolean));
  const brandIds = new Set(own.map(a => (pageBrand(a) || {}).id).filter(Boolean));
  const started = new Set(state.db.entries.filter(e => ids.has(e.accountId)).map(e => e.scriptId));
  const uses = videosByScript();
  return state.db.scripts.filter(s => {
    if (started.has(s.id)) return true;
    const videos = uses.get(s.id);
    if (videos) return visibleEntries(u, videos, pages).length > 0;
    return s.productId ? products.has(s.productId) : brandIds.has(s.brandId);
  });
}

// Does this video belong to this script?
function matches(s, v, a) {
  if (!v.promptV) return v.promptId === s.id;   // linked by hand before labels
  const b = pageBrand(a);
  return !!b && s.brandId === b.id && s.date === v.date && +s.version === +v.promptV
    && (s.type || 'Product') === (v.type || 'Product');
}

export function scriptForVideo(v) {
  if (!v.promptV && !v.promptId) return null;
  const a = byId(state.db.accounts, v.accountId);
  return best(state.db.scripts.filter(s => matches(s, v, a)));
}

// Two scripts can share a label: the blank one mass add made, and one with its
// prompts imported. The one with the work in it is the real one.
function best(list) {
  return list.find(s => (s.frames || []).length) || list[0] || null;
}

export const typeName = t => t === 'Growth' ? 'Growth' : 'CTA';
export const labelTitle = (brandId, type, version) =>
  ((brandById(brandId) || {}).name || 'Script') + ' ' + typeName(type) + ' ' + version;

export function findLabelled(date, brandId, type, version) {
  return best(state.db.scripts.filter(s => s.date === date && s.brandId === brandId && +s.version === +version
    && (s.type || 'Product') === (type || 'Product')));
}

// Labelling a script with prompts takes the place of the blank one mass add made
// for that label, keeping the script text if this one has none.
async function absorbBlank(id) {
  const s = byId(state.db.scripts, id);
  if (!s || !s.brandId || !(s.frames || []).length) return;
  const { save, removeItem } = await import('../app.js');
  state.db.scripts.filter(x => x.id !== s.id && !(x.frames || []).length && x.date === s.date && x.brandId === s.brandId
    && +x.version === +(s.version || 1) && (x.type || 'Product') === (s.type || 'Product')).forEach(x => {
    if (!(s.body || '').trim() && (x.body || '').trim()) { s.body = x.body; save('scripts', s); }
    removeItem('scripts', x.id);
    import('./library.js').then(m => m.inheritNumber(s.id, x.id));
    forceEmit();
  });
}

// Every script's videos, for a list of all of them. The same answer as
// scriptForVideo, without searching every script once per video.
export function videosByScript() {
  const label = (date, brandId, type, version) => [date, brandId, type || 'Product', +version].join('|');
  const scripts = new Map();
  state.db.scripts.forEach(s => {
    if (!s.brandId) return;
    const k = label(s.date, s.brandId, s.type, s.version);
    scripts.set(k, (scripts.get(k) || []).concat(s));
  });
  const brandIds = new Map();
  const brandIdOf = id => {
    if (!brandIds.has(id)) brandIds.set(id, (pageBrand(byId(state.db.accounts, id)) || {}).id || '');
    return brandIds.get(id);
  };
  const out = new Map();
  (state.db.dailyEntries || []).forEach(v => {
    const s = v.promptV
      ? best(scripts.get(label(v.date, brandIdOf(v.accountId), v.type, v.promptV)) || [])
      : (v.promptId ? { id: v.promptId } : null);
    if (s) out.set(s.id, (out.get(s.id) || []).concat(v));
  });
  return out;
}

// Connect a video straight to a script, or to nothing. The label stops mattering.
// A script with no brand yet takes the page's, on a version no other video is
// using, so the rest of that day's videos do not get connected to it by accident.
// The blank script mass add made goes once nothing is waiting on it, and whichever
// script replaced it picks up its text and number.
export async function connectVideo(video, scriptId) {
  const { save, mutate, removeItem } = await import('../app.js');
  const before = scriptForVideo(video);
  const target = scriptId ? byId(state.db.scripts, scriptId) : null;
  if ((before && before.id) === (target && target.id)) return;

  if (target && !target.brandId) {
    const b = pageBrand(byId(state.db.accounts, video.accountId));
    if (b) {
      const type = video.type || 'Product';
      const used = new Set(state.db.scripts.filter(s => s.date === target.date && s.brandId === b.id && (s.type || 'Product') === type).map(s => +s.version));
      (state.db.dailyEntries || []).filter(v => v.date === target.date && (v.type || 'Product') === type && v.promptV
        && (pageBrand(byId(state.db.accounts, v.accountId)) || {}).id === b.id).forEach(v => used.add(+v.promptV));
      let version = 1;
      while (used.has(version)) version++;
      Object.assign(target, { brandId: b.id, type, version });
      save('scripts', target);
    }
  }
  mutate('dailyEntries', video.id, v => { v.promptV = 0; v.promptId = target ? target.id : ''; });

  if (target && before && !(before.frames || []).length && !(videosByScript().get(before.id) || []).length) {
    if (!(target.body || '').trim() && (before.body || '').trim()) target.body = before.body;
    if (!(target.referenceVideo || '').trim() && (before.referenceVideo || '').trim()) target.referenceVideo = before.referenceVideo;
    save('scripts', target);
    removeItem('scripts', before.id);
    const { inheritNumber } = await import('./library.js');
    await inheritNumber(target.id, before.id, true);
    forceEmit();
  }
}

// The script for a label: the one already there, or a new one. Whatever the mass
// add knows goes into blanks only, so finished work is never written over.
export async function ensureScript({ date, brandId, type, version, productId, body, refVideo }) {
  const { save } = await import('../app.js');
  const s = findLabelled(date, brandId, type, version);
  if (s) {
    if (!(s.body || '').trim() && body) s.body = body;
    if (!(s.referenceVideo || '').trim() && refVideo) s.referenceVideo = refVideo;
    save('scripts', s);
    return s;
  }
  const made = {
    id: uid('s'), date, brandId, version, type: type || 'Product',
    order: state.db.scripts.filter(x => x.date === date).length,
    title: labelTitle(brandId, type, version), productId: productId || '',
    body: body || '', notes: '', referenceVideo: refVideo || '', frames: [],
    createdBy: state.user.name, createdAt: Date.now(),
  };
  save('scripts', made);
  return made;
}

// From a video's card: straight to its script, already on that avatar.
export function openPrompts(video) {
  state.builderMode = 'scripts';
  const s = scriptForVideo(video);
  if (!s) return;
  state.builderAvatar = null;
  state.openScript = s.id;
  state.scriptView = 'va';
  state.scriptPage = { scriptId: s.id, accountId: video.accountId };
  state.scriptBack = { scriptId: s.id, accountId: video.accountId };
  forceEmit();
}

// "6 of 24 steps" for a video's card.
export function promptProgress(video) {
  const s = scriptForVideo(video);
  if (!s) return null;
  return progress(s, state.db.entries.find(e => e.scriptId === s.id && e.accountId === video.accountId) || null);
}

export async function addScript() {
  const { save } = await import('../app.js');
  const existing = state.db.scripts.filter(s => s.date === state.date);
  const s = {
    id: uid('s'), date: state.date, order: existing.length, title: 'Script ' + (existing.length + 1),
    type: 'Product', productId: '', body: '', notes: '', referenceVideo: '',
    frames: [], brandId: '', version: 1, createdBy: state.user.name, createdAt: Date.now(),
  };
  save('scripts', s);
  state.openScript = s.id;
  state.scriptView = 'edit';
  forceEmit();
}

// ---------------------------------------------------------------------------
// what is left to do
// ---------------------------------------------------------------------------
const shotsOf = s => (s.frames || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
const stepsOf = f => Object.keys(STEP).filter(k => (f[STEP[k]] || '').trim());
export const scriptHasPrompts = s => shotsOf(s).some(f => stepsOf(f).length > 0);
const entryFor = (s, a) => a ? state.db.entries.find(e => e.scriptId === s.id && e.accountId === a.id) || null : null;
const stepDone = (en, f, k) => !!(en && en.shots && en.shots[f.id] && en.shots[f.id][k]);
// The video in the Videos tab this script is being made for on a page, if any.
// The one still to make wins, for a script used on the same page more than once.
function videoFor(s, a) {
  const all = (state.db.dailyEntries || []).filter(v => v.accountId === a.id && matches(s, v, a));
  return all.find(v => !v.done) || all[all.length - 1] || null;
}
function pageDone(s, a) {
  const v = videoFor(s, a);
  if (v) return !!v.done;
  const en = entryFor(s, a);
  return !!(en && en.done);
}
const shotDone = (en, f) => { const st = stepsOf(f); return st.length > 0 && st.every(k => stepDone(en, f, k)); };

function progress(s, en) {
  let done = 0, total = 0;
  shotsOf(s).forEach(f => stepsOf(f).forEach(k => { total++; if (stepDone(en, f, k)) done++; }));
  return { done, total };
}

function nextStep(s, en) {
  for (const f of shotsOf(s)) for (const k of stepsOf(f)) if (!stepDone(en, f, k)) return { id: f.id, step: k };
  return null;
}

// The pages this script can be made for: the person's running pages, narrowed to
// the script's product when it has one. A page already started always stays.
function pagesFor(s, u) {
  const all = myAccounts(u, state.db).filter(a => !a.onboarding);
  const live = liveAccounts(all);
  const started = a => state.db.entries.some(e => e.scriptId === s.id && e.accountId === a.id);
  const opened = state.scriptPage && state.scriptPage.scriptId === s.id ? byId(state.db.accounts, state.scriptPage.accountId) : null;
  const withVideo = all.filter(a => videoFor(s, a));
  let pages = all.filter(a => live.includes(a) || started(a));
  if (withVideo.length) {
    // linked in Videos: these are exactly the pages getting this script
    pages = all.filter(a => videoFor(s, a) || started(a));
  } else if (s.productId) {
    const onProduct = pages.filter(a => a.productId === s.productId || started(a));
    if (onProduct.length) pages = onProduct;
  }
  if (opened && !pages.includes(opened)) pages = pages.concat(opened);
  return pages.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function currentPage(s, pages) {
  const picked = state.scriptPage && state.scriptPage.scriptId === s.id ? pages.find(a => a.id === state.scriptPage.accountId) : null;
  if (picked) return picked;
  return pages.find(a => !pageDone(s, a)) || pages[0] || null;
}

async function writeEntry(s, a, fn) {
  const { save } = await import('../app.js');
  const item = entryFor(s, a) || { id: uid('e'), scriptId: s.id, accountId: a.id, done: false, videoLink: '' };
  fn(item);
  save('entries', item);
}

// ---------------------------------------------------------------------------
// the day's scripts
// ---------------------------------------------------------------------------
function list(scripts, canEdit, u, allowed) {
  if (!scripts.length) {
    const others = allowed.map(s => s.date).filter(d => d && d !== state.date).sort();
    const latest = others.pop();
    return el('div', { class: 'card col', style: 'align-items:center;text-align:center;color:var(--dim);padding:34px;gap:12px' },
      canEdit ? 'No scripts here for this day yet. Add one to start.' : 'No scripts here for this day yet.',
      latest ? el('button', { class: 'btn small', onclick: () => { state.date = latest; forceEmit(); } }, 'Go to ' + fmtDate(latest)) : null);
  }

  const filter = TYPES.includes(state.scriptFilter) ? state.scriptFilter : 'All';
  const shown = filter === 'All' ? scripts : scripts.filter(s => (s.type || 'Product') === filter);
  const wrap = el('div', { class: 'col', style: 'gap:14px' });

  if (scripts.length > 1) {
    wrap.appendChild(el('div', { class: 'seg mini', style: 'align-self:flex-start' }, ['All'].concat(TYPES).map(t =>
      el('button', { class: filter === t ? 'on' : '', onclick: () => { state.scriptFilter = t; forceEmit(); } }, t))));
  }
  if (!shown.length) {
    wrap.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:28px' }, 'No ' + filter.toLowerCase() + ' scripts here on this day.'));
    return wrap;
  }
  wrap.appendChild(el('div', { class: 'sc-list' }, shown.map(s => scriptCard(s, u))));
  return wrap;
}

function scriptCard(s, u) {
  const shots = shotsOf(s);
  const pages = pagesFor(s, u);
  const done = pages.filter(a => pageDone(s, a)).length;
  const pics = shots.filter(f => f.imageUrl);
  const product = byId(state.db.products, s.productId);

  return el('button', { class: 'card sc-card', onclick: () => { state.openScript = s.id; forceEmit(); } },
    el('div', { class: 'sc-card-strip' },
      pics.slice(0, 6).map(f => el('img', { src: f.imageUrl, alt: '', loading: 'lazy' })),
      !pics.length ? el('span', { class: 'hint' }, shots.length ? 'No reference images' : 'No shots yet') : null),
    el('div', { class: 'row', style: 'gap:8px' },
      el('b', { class: 'sc-card-title' }, s.title || 'Untitled'),
      el('span', { class: 'chip ' + (s.type === 'Growth' ? 'blue' : 'green') }, s.type || 'Product')),
    el('div', { class: 'hint' },
      [can.editScripts(u) && s.brandId ? labelTitle(s.brandId, s.type, s.version) : null,
       product ? product.name : null,
       shots.length + (shots.length === 1 ? ' shot' : ' shots'),
       pages.length ? done + ' of ' + pages.length + ' videos done' : null].filter(Boolean).join(' · ')));
}

// ---------------------------------------------------------------------------
// one script
// ---------------------------------------------------------------------------
function detail(s, canEdit, u) {
  const editing = canEdit && state.scriptView !== 'va';
  const wrap = el('div', { class: 'col', style: 'gap:16px' });
  wrap.appendChild(detailHead(s, canEdit, editing));

  wrap.appendChild(el('div', { class: 'sc-work' },
    el('aside', { class: 'sc-side' }, referencePanel(s, editing), scriptPanel(s, editing)),
    el('div', { class: 'sc-main' },
      can.logCompletion(u) && !editing ? nowPanel(s, u) : null,
      editing ? shotsEditor(s) : shotsList(s, u))));
  return wrap;
}

function detailHead(s, canEdit, editing) {
  const shots = shotsOf(s);
  const allOf = key => shots.map(f => (f[key] || '').trim()).filter(Boolean).join('\n\n');
  const copyAll = (key, label) => el('button', {
    class: 'btn small', disabled: !allOf(key), onclick: e => copyText(allOf(key), e.currentTarget)
  }, label);
  const product = byId(state.db.products, s.productId);

  return el('div', { class: 'row wrap', style: 'gap:10px' },
    backButton(s),
    editing
      ? guarded('script:' + s.id + ':title',
          () => el('input', { class: 'input sc-title', value: s.title || '', placeholder: 'Script name…', oninput: e => quiet(s.id, x => x.title = e.target.value) }),
          () => el('b', { style: 'font-size:16px' }, s.title || 'Untitled'))
      : el('b', { style: 'font-size:16px' }, s.title || 'Untitled'),
    !editing ? el('span', { class: 'chip ' + (s.type === 'Growth' ? 'blue' : 'green') }, s.type || 'Product') : null,
    !editing && product ? el('span', { class: 'chip gray' }, product.name) : null,
    el('span', { class: 'spacer' }),
    copyAll('imagePrompt', 'Copy all image prompts'),
    copyAll('videoPrompt', 'Copy all video prompts'),
    canEdit ? el('div', { class: 'seg mini' }, [['edit', 'Edit'], ['va', 'VA view']].map(([k, label]) =>
      el('button', { class: (editing ? 'edit' : 'va') === k ? 'on' : '', onclick: () => { state.scriptView = k; forceEmit(); } }, label))) : null,
    canEdit ? el('button', { class: 'btn small', title: 'Make a copy of this script on the same day', onclick: () => duplicate(s) }, 'Duplicate') : null,
    canEdit ? el('button', { class: 'btn small', onclick: () => copyToDay(s) }, 'Copy to another day') : null,
    canEdit ? el('button', {
      class: 'btn small danger', onclick: async () => {
        if (!confirm('Delete this script from Prompts, with its shots and everyone’s progress on it?')) return;
        const { removeItem } = await import('../app.js');
        state.db.entries.filter(e => e.scriptId === s.id).forEach(e => removeItem('entries', e.id));
        removeItem('scripts', s.id);
        if (state.libraryBack === s.id) state.builderMode = 'library';
        state.openScript = null; forceEmit();
      }
    }, 'Delete') : null);
}

// Came from a video: back to that avatar's videos. Otherwise back to the list.
function backButton(s) {
  const back = state.scriptBack && state.scriptBack.scriptId === s.id ? state.scriptBack : null;
  const a = back && byId(state.db.accounts, back.accountId);
  if (!a && state.libraryBack === s.id) {
    return el('button', {
      class: 'btn small', onclick: () => { state.builderMode = 'library'; state.openScript = null; forceEmit(); }
    }, '‹ Library');
  }
  if (!a) return el('button', { class: 'btn small', onclick: () => { state.openScript = null; forceEmit(); } }, '‹ All scripts');
  return el('button', {
    class: 'btn small', onclick: () => {
      state.builderMode = 'videos';
      state.builderAvatar = a.id;
      state.openScript = null;
      state.scriptBack = null;
      forceEmit();
    }
  }, '‹ Back to ' + (a.name || 'videos'));
}

// A copy on the same day, shots, prompts, pictures and links included, but
// nobody's progress. It can't share the original's label, or the two would
// fight over the same videos, so it takes the next free version of that brand
// and type; with none free it has no brand until one is picked.
async function duplicate(s) {
  const { save } = await import('../app.js');
  const copy = JSON.parse(JSON.stringify(s));
  copy.id = uid('s');
  copy.frames = shotsOf(copy).map((f, i) => Object.assign(f, { id: uid('f'), order: i }));
  const sameLabel = s.brandId && (s.title || '') === labelTitle(s.brandId, s.type, s.version);
  if (s.brandId) {
    const used = new Set(state.db.scripts.filter(x => x.date === s.date && x.brandId === s.brandId
      && (x.type || 'Product') === (s.type || 'Product')).map(x => +(x.version || 1)));
    const free = [1, 2, 3, 4, 5].find(n => !used.has(n));
    if (free) copy.version = free; else { copy.brandId = ''; copy.version = 1; }
  }
  copy.title = sameLabel && copy.brandId ? labelTitle(copy.brandId, copy.type, copy.version) : (s.title || 'Untitled') + ' (copy)';
  copy.order = state.db.scripts.filter(x => x.date === s.date).length;
  copy.createdBy = state.user.name;
  copy.createdAt = Date.now();
  save('scripts', copy);
  state.openScript = copy.id;
  state.scriptView = 'edit';
  forceEmit();
}

// A winning script gets used again, so it can be sent to another day whole.
async function copyToDay(s) {
  const date = (prompt('Copy this script to which date? (YYYY-MM-DD)', todayStr()) || '').trim();
  if (!date) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { alert('Use the format YYYY-MM-DD.'); return; }
  const { save } = await import('../app.js');
  const copy = JSON.parse(JSON.stringify(s));
  copy.id = uid('s');
  copy.date = date;
  copy.order = state.db.scripts.filter(x => x.date === date).length;
  copy.frames = shotsOf(copy).map((f, i) => Object.assign(f, { id: uid('f'), order: i }));
  copy.createdBy = state.user.name;
  copy.createdAt = Date.now();
  save('scripts', copy);
  state.date = date;
  state.openScript = copy.id;
  forceEmit();
}

// ---------------------------------------------------------------------------
// the side column: the finished video and the words
// ---------------------------------------------------------------------------
let player = { url: '', node: null };

function refPlayer(url) {
  if (player.url === url && player.node) return player.node;
  let node;
  const drive = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) {
    node = el('video', { class: 'sc-player', src: url, controls: true, playsinline: true, preload: 'metadata' });
  } else if (drive) {
    node = el('iframe', { class: 'sc-player', src: 'https://drive.google.com/file/d/' + drive[1] + '/preview', allow: 'autoplay; fullscreen', title: 'Reference video' });
  } else if (yt) {
    node = el('iframe', { class: 'sc-player', src: 'https://www.youtube.com/embed/' + yt[1], allow: 'fullscreen', title: 'Reference video' });
  } else {
    node = el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener', style: 'justify-content:center' }, 'Open reference video ↗');
  }
  player = { url, node };
  return node;
}

function referencePanel(s, editing) {
  const url = (s.referenceVideo || '').trim();
  const isUrl = /^https?:\/\//.test(url);
  const box = el('div', { class: 'card col', style: 'gap:10px' },
    el('div', { class: 'row' },
      el('span', { class: 'label' }, 'FINISHED REFERENCE VIDEO'),
      el('span', { class: 'spacer' }),
      isUrl ? el('a', { class: 'sc-link', href: url, target: '_blank', rel: 'noopener' }, 'Open ↗') : null));
  if (isUrl) box.appendChild(refPlayer(url));
  else if (!editing) box.appendChild(el('span', { class: 'hint' }, 'No reference video yet.'));
  if (editing) box.appendChild(guarded('script:' + s.id + ':referenceVideo',
    () => el('input', {
      class: 'input', placeholder: 'Paste the video link…', value: s.referenceVideo || '',
      oninput: e => quiet(s.id, x => x.referenceVideo = e.target.value),
      onchange: () => emit()
    }),
    () => el('span', { class: 'ro-text' }, url || '—')));
  if (editing) box.appendChild(el('label', { class: 'row', style: 'gap:8px;font-size:12.5px;color:var(--mut);cursor:pointer' },
    el('input', { type: 'checkbox', checked: !!s.hasAssets, onchange: e => loud(s.id, x => x.hasAssets = e.target.checked) }),
    el('span', null, 'Additional assets (Google Drive links)')));
  if (s.hasAssets) box.appendChild(allAssets(s, editing));
  return box;
}

const driveUrl = v => /^https?:\/\//.test((v || '').trim()) ? v.trim() : '';

// The one link to the folder that holds every frame's images.
function allAssets(s, editing) {
  const url = driveUrl(s.assetsLink);
  return el('div', { class: 'col', style: 'gap:8px;padding-top:10px;border-top:1px solid var(--line2)' },
    el('div', { class: 'row' },
      el('span', { class: 'label' }, 'ADDITIONAL ASSETS'),
      el('span', { class: 'spacer' }),
      url ? el('a', { class: 'sc-link', href: url, target: '_blank', rel: 'noopener' }, 'Open ↗') : null),
    editing
      ? guarded('script:' + s.id + ':assetsLink',
          () => el('input', {
            class: 'input', placeholder: 'Google Drive link to all the images…', value: s.assetsLink || '',
            oninput: e => quiet(s.id, x => x.assetsLink = e.target.value),
            onchange: () => emit()
          }),
          () => el('span', { class: 'ro-text' }, (s.assetsLink || '').trim() || '—'))
      : url ? null : el('span', { class: 'hint' }, 'No link yet.'));
}

// A shot's own Drive link, for when it needs an image that already exists.
// A shot can have several links; older shots saved just one, as text.
const assetLinks = f => Array.isArray(f.assets) ? f.assets : (f.assets ? [f.assets] : []);

function shotAssets(s, f, editing, set) {
  const head = el('div', { class: 'row', style: 'min-height:26px' }, el('span', { class: 'label' }, 'ADDITIONAL ASSETS'));
  const links = assetLinks(f);
  if (!editing) {
    const urls = links.map(driveUrl).filter(Boolean);
    return el('div', { class: 'sc-cell' }, head,
      urls.length
        ? urls.map((url, k) => el('a', { class: 'btn sc-copy', href: url, target: '_blank', rel: 'noopener', style: 'justify-content:center' },
            'Open assets' + (urls.length > 1 ? ' ' + (k + 1) : '') + ' ↗'))
        : el('div', { class: 'ro-text sc-prompt none' }, 'None for this shot.'));
  }
  const fields = links.length ? links.slice() : [''];
  const change = (k, value) => { fields[k] = value; set('assets', fields.slice()); };
  return el('div', { class: 'sc-cell' }, head,
    fields.map((v, k) => guarded('frame:' + s.id + ':' + f.id + ':assets:' + k,
      () => el('div', { class: 'row', style: 'gap:6px' },
        el('input', { class: 'input', style: 'flex:1;min-width:0', placeholder: 'Google Drive link…', value: v || '', 'aria-label': 'Google Drive link ' + (k + 1), oninput: e => change(k, e.target.value), onchange: () => emit() }),
        k > 0 ? el('button', {
          class: 'iconbtn danger', title: 'Remove this link', 'aria-label': 'Remove link ' + (k + 1),
          onclick: () => loud(s.id, x => { const fr = x.frames.find(y => y.id === f.id); if (fr) fr.assets = fields.filter((_, j) => j !== k); })
        }, '✕') : null),
      () => el('div', { class: 'ro-text' }, (v || '').trim() || '—'))),
    el('button', {
      class: 'btn small', style: 'align-self:flex-start;min-width:34px;justify-content:center;font-size:16px',
      title: 'Add another link', 'aria-label': 'Add another Google Drive link',
      onclick: () => loud(s.id, x => { const fr = x.frames.find(y => y.id === f.id); if (fr) fr.assets = fields.concat(''); })
    }, '+'));
}

function scriptPanel(s, editing) {
  const box = el('div', { class: 'card col', style: 'gap:12px' });

  if (editing) {
    box.appendChild(el('div', { class: 'row wrap', style: 'gap:12px' },
      el('div', { class: 'col', style: 'gap:5px' },
        el('span', { class: 'label' }, 'TYPE'),
        el('div', { class: 'seg mini' }, TYPES.map(t =>
          el('button', { class: s.type === t ? 'on' : '', onclick: async () => { await loud(s.id, x => x.type = t); absorbBlank(s.id); } }, t)))),
      el('div', { class: 'col', style: 'gap:5px;flex:1;min-width:150px' },
        el('span', { class: 'label' }, 'PRODUCT'),
        (() => {
          const sel = el('select', {
            class: 'input', style: 'height:32px',
            onchange: e => loud(s.id, x => x.productId = e.target.value)
          }, el('option', { value: '' }, 'Any product'), productOptions());
          sel.value = s.productId || '';
          return sel;
        })())));
    // the label videos find this script by, on this day
    const brandSel = el('select', {
      class: 'input', style: 'height:32px', 'aria-label': 'Brand label',
      onchange: async e => { await loud(s.id, x => x.brandId = e.target.value); absorbBlank(s.id); }
    }, el('option', { value: '' }, 'No brand, no videos match'), brands().map(b => el('option', { value: b.id }, b.name)));
    brandSel.value = s.brandId || '';
    box.appendChild(el('div', { class: 'row wrap', style: 'gap:12px' },
      el('div', { class: 'col', style: 'gap:5px;flex:1;min-width:150px' }, el('span', { class: 'label' }, 'LABEL: BRAND'), brandSel),
      el('div', { class: 'col', style: 'gap:5px' }, el('span', { class: 'label' }, 'VERSION'),
        el('div', { class: 'seg mini' }, [1, 2, 3, 4, 5].map(n =>
          el('button', { class: +(s.version || 1) === n ? 'on' : '', onclick: async () => { await loud(s.id, x => x.version = n); absorbBlank(s.id); } }, String(n)))))));
  }

  if ((s.hook || '').trim()) box.appendChild(textBlock(s, 'hook', 'HOOK (OLDER SCRIPT)', 'The opening line…', editing, true));
  box.appendChild(textBlock(s, 'body', 'SCRIPT', 'The whole script…', editing, true));
  if (editing || (s.notes || '').trim()) box.appendChild(textBlock(s, 'notes', 'NOTES', 'Anything the VAs should know…', editing, false));
  return box;
}

function textBlock(s, key, label, ph, editing, copyable) {
  const text = (s[key] || '').trim();
  const head = el('div', { class: 'row' },
    el('span', { class: 'label' }, label),
    el('span', { class: 'spacer' }),
    copyable ? el('button', { class: 'btn small', disabled: !text, onclick: e => copyText(s[key], e.currentTarget) }, 'Copy') : null);
  const ro = () => el('div', { class: 'ro-text sc-words' }, text || '—');
  const body = editing
    ? guarded('script:' + s.id + ':' + key,
        () => el('textarea', { class: 'input', style: key === 'body' ? 'min-height:190px' : '', placeholder: ph, oninput: e => { s[key] = e.target.value; quiet(s.id, x => x[key] = e.target.value); } }, s[key] || ''),
        ro)
    : ro();
  return el('div', { class: 'col', style: 'gap:6px' }, head, body);
}

// ---------------------------------------------------------------------------
// making it: which page, how far along, the finished link
// ---------------------------------------------------------------------------
function nowPanel(s, u) {
  const pages = pagesFor(s, u);
  if (!pages.length) {
    return el('div', { class: 'card hint' }, can.seesAllAccounts(u) ? 'No running pages to make this for.' : 'No pages assigned to you yet. Ask an admin.');
  }
  const a = currentPage(s, pages);
  const en = entryFor(s, a);
  const p = progress(s, en);
  const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
  const allDone = p.total > 0 && p.done === p.total;
  const video = videoFor(s, a);
  const finished = pageDone(s, a);
  const doneCount = pages.filter(x => pageDone(s, x)).length;
  const base = (a.baseImageLink || '').trim();

  const pick = el('select', {
    class: 'input', style: 'height:34px;width:auto;min-width:190px;max-width:100%;flex:0 1 auto',
    'aria-label': 'Page this video is for',
    onchange: e => { state.scriptPage = { scriptId: s.id, accountId: e.target.value }; forceEmit(); }
  }, pages.map(x => {
    return el('option', { value: x.id }, (x.name || 'Untitled') + (pageDone(s, x) ? ' (done)' : ''));
  }));
  pick.value = a.id;

  const box = el('div', { class: 'card col sc-now', style: 'gap:12px' },
    el('div', { class: 'row wrap', style: 'gap:10px' },
      avatar(a, 34),
      pick,
      /^https?:\/\//.test(base)
        ? el('a', { class: 'btn small', href: base, target: '_blank', rel: 'noopener' }, 'Base images ↗')
        : el('span', { class: 'hint' }, 'No base images linked'),
      el('span', { class: 'spacer' }),
      pages.length > 1 ? el('button', {
        class: 'btn small', 'aria-expanded': state.scriptAllPages ? 'true' : 'false',
        onclick: () => { state.scriptAllPages = !state.scriptAllPages; forceEmit(); }
      }, doneCount + ' of ' + pages.length + ' videos done') : null),
    el('div', { class: 'row', style: 'gap:10px' },
      el('div', { class: 'bar', style: 'flex:1' }, el('i', { style: 'width:' + pct + '%;background:var(--green)' })),
      el('span', { class: 'hint sc-count' }, p.done + ' of ' + p.total + ' steps')),
    el('div', { class: 'row wrap', style: 'gap:10px' },
      el('input', {
        class: 'input', style: 'flex:1;min-width:210px;height:34px', placeholder: 'Finished video link…',
        'aria-label': 'Finished video link', value: (video ? video.videoLink : en && en.videoLink) || '',
        oninput: async e => {
          const val = e.target.value;
          if (!video) return writeEntry(s, a, x => x.videoLink = val);
          const { mutateQuiet } = await import('../app.js');
          mutateQuiet('dailyEntries', video.id, x => x.videoLink = val);
        }
      }),
      el('button', {
        class: 'btn ' + (finished ? 'ok' : allDone ? 'primary' : ''), style: 'height:34px',
        onclick: async () => {
          const flip = x => {
            x.done = !x.done;
            x.doneAt = x.done ? Date.now() : null;
            x.doneBy = x.done ? state.user.name : x.doneBy;
          };
          if (video) {
            const { mutate } = await import('../app.js');
            await mutate('dailyEntries', video.id, flip);
          } else await writeEntry(s, a, flip);
          emit();
        }
      }, finished ? 'Video done ✓' : 'Mark video done')));

  if (state.scriptAllPages && pages.length > 1) {
    box.appendChild(el('div', { class: 'sc-pages' }, pages.map(x => {
      const e = entryFor(s, x);
      const pr = progress(s, e);
      return el('button', {
        class: 'sc-page' + (x.id === a.id ? ' on' : ''),
        onclick: () => { state.scriptPage = { scriptId: s.id, accountId: x.id }; forceEmit(); }
      },
        avatar(x, 24),
        el('span', { class: 'sc-page-name' }, x.name || 'Untitled'),
        el('span', { class: 'hint sc-count' }, pageDone(s, x) ? 'Done' : pr.done + ' of ' + pr.total));
    })));
  }
  return box;
}

// ---------------------------------------------------------------------------
// the shots, to copy from
// ---------------------------------------------------------------------------
function shotsList(s, u) {
  const shots = shotsOf(s);
  const wrap = el('div', { class: 'col', style: 'gap:12px' });
  if (!shots.length) {
    wrap.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' }, 'No shots added to this script yet.'));
    return wrap;
  }
  const logs = can.logCompletion(u);
  const a = logs ? currentPage(s, pagesFor(s, u)) : null;
  const en = entryFor(s, a);
  const next = a ? nextStep(s, en) : null;

  wrap.appendChild(filmstrip(shots, en, next));
  shots.forEach((f, i) => wrap.appendChild(shotRow(s, f, i, shots, a, en, next)));
  return wrap;
}

// The whole video at a glance: one tile per shot, ticked as it gets done. Stays
// on screen while the list scrolls, and jumps to any shot.
function filmstrip(shots, en, next) {
  return el('div', { class: 'sc-strip' }, shots.map((f, i) => {
    const done = shotDone(en, f);
    return el('button', {
      class: 'sc-tile' + (done ? ' done' : '') + (next && next.id === f.id ? ' next' : ''),
      title: 'Shot ' + (i + 1), 'aria-label': 'Go to shot ' + (i + 1) + (done ? ', done' : ''),
      onclick: () => { const t = document.getElementById('shot-' + f.id); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    },
      f.imageUrl ? el('img', { src: f.imageUrl, alt: '', loading: 'lazy' }) : null,
      el('span', null, done ? '✓' : String(i + 1)));
  }));
}

function shotRow(s, f, i, shots, a, en, next) {
  const isNext = next && next.id === f.id;
  const done = a && shotDone(en, f);
  return el('div', { id: 'shot-' + f.id, class: 'card sc-shot' + (isNext ? ' next' : '') + (done ? ' done' : '') },
    el('div', { class: 'sc-shot-head' },
      el('b', { class: 'sc-shot-n' }, 'Shot ' + (i + 1)),
      (f.line || '').trim() ? el('span', { class: 'sc-line' }, f.line.trim()) : null,
      el('span', { class: 'spacer' }),
      isNext ? el('span', { class: 'chip green' }, 'Next') : null,
      done ? el('span', { class: 'chip gray' }, 'Done') : null),
    el('div', { class: 'sc-shot-body' + (s.hasAssets ? ' assets' : '') },
      f.imageUrl
        ? el('button', { class: 'sc-ref', title: 'Make it bigger', 'aria-label': 'Open the reference image for shot ' + (i + 1), onclick: () => lightbox(shots, i) },
            el('img', { src: f.imageUrl, alt: 'Reference for shot ' + (i + 1), loading: 'lazy' }))
        : el('div', { class: 'sc-ref empty' }, 'No image'),
      promptCell(s, f, 'image', 'IMAGE PROMPT', null, a, en, isNext && next.step === 'image'),
      promptCell(s, f, 'video', 'VIDEO PROMPT', toolName(f), a, en, isNext && next.step === 'video'),
      s.hasAssets ? shotAssets(s, f, false) : null));
}

const toolName = f => { const t = TOOLS.find(x => x[0] === f.tool); return t ? t[1] : null; };

function promptCell(s, f, step, label, tool, a, en, lit) {
  const text = (f[STEP[step]] || '').trim();
  const done = stepDone(en, f, step);
  return el('div', { class: 'sc-cell' + (done ? ' done' : '') },
    el('div', { class: 'row', style: 'gap:7px;min-height:22px' },
      el('span', { class: 'label' }, label),
      tool ? el('span', { class: 'chip gray sc-tool' }, tool) : null),
    el('div', { class: 'ro-text sc-prompt' + (text ? '' : ' none') }, text || 'No prompt for this shot.'),
    text ? el('div', { class: 'row', style: 'gap:9px;margin-top:auto' },
      el('button', {
        class: 'btn sc-copy' + (lit ? ' primary' : ''),
        onclick: e => copyText(text, e.currentTarget)
      }, 'Copy prompt'),
      a ? el('button', {
        class: 'check' + (done ? ' on' : ''), 'aria-pressed': done ? 'true' : 'false',
        title: done ? 'Mark as not done' : 'Mark as done',
        'aria-label': (done ? 'Undo ' : 'Done with ') + step + ' for this shot',
        onclick: async () => {
          await writeEntry(s, a, x => {
            if (!x.shots) x.shots = {};
            if (!x.shots[f.id]) x.shots[f.id] = {};
            x.shots[f.id][step] = !done;
          });
          emit();
        }
      }, done ? '✓' : '') : null) : null);
}

function lightbox(shots, start) {
  const pics = shots.map((f, n) => ({ f, n })).filter(x => x.f.imageUrl);
  let at = pics.findIndex(x => x.n === start);
  const img = el('img', { class: 'sc-big', alt: '' });
  const cap = el('span', { class: 'sc-big-cap' });
  const open = el('a', { class: 'btn small', target: '_blank', rel: 'noopener' }, 'Open original ↗');
  const show = () => {
    const p = pics[at];
    img.src = p.f.imageUrl;
    img.alt = 'Reference for shot ' + (p.n + 1);
    cap.textContent = 'Shot ' + (p.n + 1) + ' of ' + shots.length;
    open.href = p.f.imageUrl;
  };
  const step = d => { at = (at + d + pics.length) % pics.length; show(); };
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  };
  const box = el('div', { class: 'overlay sc-box', onclick: e => { if (e.target === box) close(); } },
    pics.length > 1 ? el('button', { class: 'iconbtn sc-nav', 'aria-label': 'Previous shot', onclick: () => step(-1) }, '‹') : null,
    el('div', { class: 'col', style: 'gap:10px;align-items:center;min-height:0;max-height:100%' },
      img,
      el('div', { class: 'row', style: 'gap:10px' }, cap, open,
        el('button', { class: 'btn small', onclick: close }, 'Close'))),
    pics.length > 1 ? el('button', { class: 'iconbtn sc-nav', 'aria-label': 'Next shot', onclick: () => step(1) }, '›') : null);
  show();
  document.addEventListener('keydown', onKey);
  document.body.appendChild(box);
}

// ---------------------------------------------------------------------------
// the shots, to write
// ---------------------------------------------------------------------------
function shotsEditor(s) {
  const shots = shotsOf(s);
  const wrap = el('div', { class: 'col', style: 'gap:12px' });
  shots.forEach((f, i) => wrap.appendChild(shotEditor(s, f, i, shots.length)));

  const many = el('input', {
    type: 'file', accept: 'image/*', multiple: true, style: 'display:none',
    onchange: e => addFromImages(s, e.target.files)
  });
  wrap.appendChild(el('div', {
    class: 'sc-add',
    ondragover: e => e.preventDefault(),
    ondrop: e => { e.preventDefault(); addFromImages(s, e.dataTransfer.files); }
  },
    el('label', { class: 'btn primary', style: 'cursor:pointer' }, 'Add shots from images', many),
    el('button', { class: 'btn', onclick: () => addShot(s, '') }, '+ Add empty shot'),
    el('span', { class: 'hint' }, 'One shot per image, in file name order. You can also drop them here.')));
  return wrap;
}

function addShot(s, imageUrl) {
  return loud(s.id, x => {
    if (!Array.isArray(x.frames)) x.frames = [];
    const last = x.frames[x.frames.length - 1];
    x.frames.push({ id: uid('f'), line: '', imagePrompt: '', videoPrompt: '', tool: last ? last.tool : 'veo', imageUrl, order: x.frames.length });
  });
}

async function addFromImages(s, fileList) {
  const files = [...(fileList || [])].filter(f => f.type.startsWith('image/'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!files.length) return;
  const { store } = await import('../app.js');
  try {
    for (const file of files) await addShot(s, await store.uploadImage(file));
  } catch (err) { alert('An image failed to upload. Try again.\n' + (err.message || '')); }
}

function shotEditor(s, f, i, count) {
  const set = (key, value) => { f[key] = value; quiet(s.id, x => { const fr = x.frames.find(y => y.id === f.id); if (fr) fr[key] = value; }); };

  const toolSel = el('select', {
    class: 'input sc-tool-sel', 'aria-label': 'Video tool',
    onchange: e => loud(s.id, x => { const fr = x.frames.find(y => y.id === f.id); if (fr) fr.tool = e.target.value; })
  }, TOOLS.map(([id, name]) => el('option', { value: id }, name)));
  toolSel.value = f.tool || 'veo';

  const area = (key, ph) => guarded('frame:' + s.id + ':' + f.id + ':' + key,
    () => el('textarea', { class: 'input sc-area', placeholder: ph, oninput: e => set(key, e.target.value) }, f[key] || ''),
    () => el('div', { class: 'ro-text sc-prompt' }, (f[key] || '').trim() || '—'));

  return el('div', { class: 'card sc-shot' },
    el('div', { class: 'sc-shot-head' },
      el('b', { class: 'sc-shot-n' }, 'Shot ' + (i + 1)),
      guarded('frame:' + s.id + ':' + f.id + ':line',
        () => el('input', { class: 'input sc-line-in', placeholder: 'The script line this shot covers…', value: f.line || '', oninput: e => set('line', e.target.value) }),
        () => el('span', { class: 'sc-line' }, (f.line || '').trim() || '—')),
      el('button', { class: 'iconbtn', title: 'Move up', 'aria-label': 'Move shot up', disabled: i === 0, onclick: () => moveShot(s, f.id, -1) }, '↑'),
      el('button', { class: 'iconbtn', title: 'Move down', 'aria-label': 'Move shot down', disabled: i === count - 1, onclick: () => moveShot(s, f.id, 1) }, '↓'),
      el('button', {
        class: 'iconbtn danger', title: 'Delete shot', 'aria-label': 'Delete shot',
        onclick: () => {
          if (((f.imagePrompt || '') + (f.videoPrompt || '')).trim() && !confirm('Delete shot ' + (i + 1) + ' and its prompts?')) return;
          loud(s.id, x => { x.frames = x.frames.filter(y => y.id !== f.id); x.frames.forEach((y, k) => y.order = k); });
        }
      }, '✕')),
    el('div', { class: 'sc-shot-body' + (s.hasAssets ? ' assets' : '') },
      imageSlot(s, f),
      el('div', { class: 'sc-cell' },
        el('div', { class: 'row', style: 'min-height:26px' }, el('span', { class: 'label' }, 'IMAGE PROMPT')),
        area('imagePrompt', 'The prompt for this image…')),
      el('div', { class: 'sc-cell' },
        el('div', { class: 'row', style: 'min-height:26px;gap:8px' }, el('span', { class: 'label' }, 'VIDEO PROMPT'), el('span', { class: 'spacer' }), toolSel),
        area('videoPrompt', 'The prompt for this clip…')),
      s.hasAssets ? shotAssets(s, f, true, set) : null));
}

function imageSlot(s, f) {
  const input = el('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: e => uploadTo(s, f.id, e.target.files && e.target.files[0]) });
  const drop = {
    ondragover: e => e.preventDefault(),
    ondrop: e => { e.preventDefault(); uploadTo(s, f.id, e.dataTransfer.files && e.dataTransfer.files[0]); }
  };
  if (!f.imageUrl) return el('label', Object.assign({ class: 'sc-ref sc-drop' }, drop), 'Add reference image', input);
  return el('label', Object.assign({ class: 'sc-ref', title: 'Replace image' }, drop),
    el('img', { src: f.imageUrl, alt: '' }),
    el('span', { class: 'sc-swap' }, 'Replace'),
    input);
}

async function uploadTo(s, fid, file) {
  if (!file) return;
  const { store } = await import('../app.js');
  try {
    const url = await store.uploadImage(file);
    loud(s.id, x => { const fr = (x.frames || []).find(y => y.id === fid); if (fr) fr.imageUrl = url; });
  } catch (err) { alert('The image failed to upload. Try again.\n' + (err.message || '')); }
}

function moveShot(s, fid, dir) {
  loud(s.id, x => {
    const fr = (x.frames || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const i = fr.findIndex(y => y.id === fid), j = i + dir;
    if (i < 0 || j < 0 || j >= fr.length) return;
    [fr[i], fr[j]] = [fr[j], fr[i]];
    fr.forEach((y, k) => y.order = k);
    x.frames = fr;
  });
}
