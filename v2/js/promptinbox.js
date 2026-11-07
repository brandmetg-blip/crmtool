// promptinbox.js — brings finished projects over from Prompt Studio.
//
// Prompt Studio is a Claude artifact on another account. It cannot sign in here,
// so it drops each project into a small inbox table it can only add to (see
// SETUP.md §Prompt Studio sync). Whoever has the tool open picks it up, uploads
// its images and files it as a script under its label, so the videos of that day,
// brand, type and version find it. If the artifact cannot reach us, the same
// project arrives as a file or pasted text through Import.

import { state, forceEmit, uid, can } from './state.js';
import { el } from './ui.js';
import { brands } from './brands.js';
import { findLabelled, labelTitle } from './views/mainscripts.js';
import { overlay } from './views/accounts.js';

const CHECK_EVERY = 60000;
const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (v, max) => String(v == null ? '' : v).slice(0, max);

class BadProject extends Error {}

function check(p) {
  if (!p || typeof p !== 'object') throw new BadProject('That is not a Prompt Studio project.');
  if (!/^[\w-]{1,80}$/.test(String(p.projectId || ''))) throw new BadProject('The project has no id.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''))) throw new BadProject('The project has no date.');
  if (!['Growth', 'Product'].includes(p.type)) throw new BadProject('The project is not marked Growth or CTA.');
  const v = +p.version;
  if (!Number.isInteger(v) || v < 1 || v > 5) throw new BadProject('The version must be 1 to 5.');
  if (!Array.isArray(p.frames) || !Array.isArray(p.clips)) throw new BadProject('The project has no prompts.');
}

// Image prompts and video prompts are two lists over there; a shot here holds
// both, so they pair by number. The ids stay the same on every send, which keeps
// each VA's ticks.
function mergeShots(p) {
  const shots = new Map();
  const shot = n => {
    if (!shots.has(n)) shots.set(n, { id: 'pf' + n, n, line: '', imagePrompt: '', videoPrompt: '', tool: 'omniflash' });
    return shots.get(n);
  };
  p.frames.forEach(f => {
    if (!Number.isInteger(+f.n)) return;
    const s = shot(+f.n);
    s.line = text(f.script, 4000);
    s.imagePrompt = text(f.prompt, 20000);
  });
  const extras = [];
  p.clips.forEach((c, i) => {
    if (Number.isInteger(+c.n) && !c.custom) {
      const s = shot(+c.n);
      if (!s.line) s.line = text(c.lines, 4000);
      s.videoPrompt = text(c.prompt, 20000);
    } else {
      extras.push({ id: 'pc' + i, line: text(c.lines, 4000), imagePrompt: '', videoPrompt: text(c.prompt, 20000), tool: 'omniflash' });
    }
  });
  const list = [...shots.values()].sort((a, b) => a.n - b.n).concat(extras);
  return list.map((s, order) => { const { n, ...rest } = s; return { ...rest, order, imageUrl: '' }; });
}

function toFile(dataUrl, name) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]), { type: 'image/' + m[1] });
}

// Files one project as a script. Sending it again updates the same script.
export async function importProject(p) {
  check(p);
  const { save, removeItem, store } = await import('./app.js');
  const brand = brands().find(b => norm(b.name) === norm(p.brand)) || null;
  const brandId = brand ? brand.id : '';
  const type = p.type;
  let version = +p.version;

  const mine = state.db.scripts.find(s => s.sourceProject === p.projectId) || null;
  let labelled = brandId ? findLabelled(p.date, brandId, type, version) : null;
  if (labelled && labelled !== mine && labelled.sourceProject) {
    // another project already holds this label: take the next free version
    // rather than write over it
    const free = [1, 2, 3, 4, 5].find(n => !findLabelled(p.date, brandId, type, n));
    if (!free) throw new Error('All five versions of ' + labelTitle(brandId, type, version) + ' are taken on ' + p.date + '.');
    version = free;
    labelled = null;
  }
  if (mine && labelled && labelled !== mine && !(labelled.frames || []).length) removeItem('scripts', labelled.id);
  const target = mine || labelled;

  const old = new Map(((target && target.frames) || []).map(f => [f.id, f]));
  const frames = mergeShots(p);
  for (const f of frames) {
    const number = f.id.startsWith('pf') ? f.id.slice(2) : '';
    const file = number ? toFile((p.images || {})[number], 'studio-' + p.projectId + '-' + number) : null;
    if (file) f.imageUrl = await store.uploadImage(file);
    else if (old.has(f.id)) f.imageUrl = old.get(f.id).imageUrl || '';
  }

  const s = Object.assign({}, target || {
    id: uid('s'), notes: '', referenceVideo: '', productId: '', createdAt: Date.now(),
    order: state.db.scripts.filter(x => x.date === p.date).length,
  }, {
    date: p.date, brandId, type, version, frames,
    title: text(p.name, 80) || (brandId ? labelTitle(brandId, type, version) : 'Prompt Studio project'),
    body: text(p.script, 40000),
    sourceProject: p.projectId,
    createdBy: (target && target.createdBy) || 'Prompt Studio',
  });
  save('scripts', s);
  forceEmit();
  return s;
}

// ---------------------------------------------------------------------------
// the inbox
// ---------------------------------------------------------------------------
let checking = false;
async function checkInbox() {
  if (checking || !state.user) return;
  checking = true;
  try {
    const { store } = await import('./app.js');
    for (const id of await store.inboxIds()) {
      const project = await store.inboxRow(id);
      if (!project) continue;
      try {
        await importProject(project);
        await store.inboxDrop(id);
      } catch (err) {
        // something wrong with the project itself will never get better; a
        // failed upload might, so that one stays for the next check
        console.warn('[prompt studio] project', id, err);
        if (err instanceof BadProject) await store.inboxDrop(id);
      }
    }
  } catch (err) {
    console.warn('[prompt studio] inbox', err);
  } finally {
    checking = false;
  }
}

export function startInbox() {
  checkInbox();
  setInterval(checkInbox, CHECK_EVERY);
}

// ---------------------------------------------------------------------------
// by hand, for when the artifact cannot reach us
// ---------------------------------------------------------------------------
export function openImport() {
  if (!can.editScripts(state.user)) return;
  const note = el('div', { class: 'hint' }, 'Choose the file Prompt Studio saved, or paste what it copied.');
  const area = el('textarea', { class: 'input', style: 'min-height:160px;font-size:12px', placeholder: 'Paste here…', 'aria-label': 'Sync data from Prompt Studio' });
  const close = () => { state.modal = null; forceEmit(); };
  const run = async raw => {
    try {
      const s = await importProject(JSON.parse(raw));
      state.modal = null;
      state.date = s.date;
      state.openScript = s.id;
      state.scriptView = 'edit';
      state.scriptBack = null;
      forceEmit();
    } catch (err) {
      note.textContent = err instanceof SyntaxError ? 'That is not valid sync data. Copy it from Prompt Studio again.' : (err.message || 'The import failed. Try again.');
      note.style.color = 'var(--red, #ff7a7a)';
    }
  };
  state.modal = overlay('Import from Prompt Studio', el('div', { class: 'col', style: 'gap:12px;padding:18px' },
    note,
    el('input', {
      class: 'input', type: 'file', accept: '.json,application/json,text/plain', 'aria-label': 'Sync file from Prompt Studio', style: 'padding-top:8px',
      onchange: async e => { const f = e.target.files[0]; if (f) run(await f.text()); }
    }),
    area,
    el('div', { class: 'row', style: 'gap:10px;justify-content:flex-end' },
      el('button', { class: 'btn', onclick: close }, 'Cancel'),
      el('button', { class: 'btn primary', onclick: () => run(area.value) }, 'Import'))));
  forceEmit();
}
