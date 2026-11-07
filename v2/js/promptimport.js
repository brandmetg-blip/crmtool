// promptimport.js — brings finished projects over from Prompt Studio.
//
// Prompt Studio is a Claude artifact on another account, and it cannot reach this
// tool. Its Copy data button gives a project as text, and Prompts → Import files it
// as a script on the day on screen. Its brand, type and version are then set by
// hand on the script. Importing the same project again updates that script and
// keeps those choices.

import { state, forceEmit, uid, can } from './state.js';
import { el } from './ui.js';
import { overlay } from './views/accounts.js';

const text = (v, max) => String(v == null ? '' : v).slice(0, max);

class BadProject extends Error {}

function check(p) {
  if (!p || typeof p !== 'object') throw new BadProject('That is not a Prompt Studio project.');
  if (!/^[\w-]{1,80}$/.test(String(p.projectId || ''))) throw new BadProject('The project has no id.');
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
  const { save, store } = await import('./app.js');
  const target = state.db.scripts.find(s => s.sourceProject === p.projectId) || null;

  const old = new Map(((target && target.frames) || []).map(f => [f.id, f]));
  const frames = mergeShots(p);
  for (const f of frames) {
    const number = f.id.startsWith('pf') ? f.id.slice(2) : '';
    const file = number ? toFile((p.images || {})[number], 'studio-' + p.projectId + '-' + number) : null;
    const had = old.has(f.id) ? old.get(f.id).imageUrl || '' : '';
    // a saved project's previews are small, so they only fill empty shots
    if (file && !(p.previews && had)) f.imageUrl = await store.uploadImage(file);
    else f.imageUrl = had;
  }

  const s = Object.assign({}, target || {
    id: uid('s'), notes: '', referenceVideo: '', productId: '', createdAt: Date.now(),
    date: state.date, brandId: '', type: 'Growth', version: 1,
    title: text(p.name, 80) || 'Prompt Studio project',
    order: state.db.scripts.filter(x => x.date === state.date).length,
    createdBy: 'Prompt Studio',
  }, { frames, body: text(p.script, 40000), sourceProject: p.projectId });
  save('scripts', s);
  forceEmit();
  return s;
}

// ---------------------------------------------------------------------------
// the import box
// ---------------------------------------------------------------------------
export function openImport() {
  if (!can.editScripts(state.user)) return;
  const note = el('div', { class: 'hint' }, 'Paste what Copy data gave you in Prompt Studio. It goes on ' + state.date + ', and you set its brand, type and version on the script.');
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
    area,
    el('div', { class: 'row', style: 'gap:10px;justify-content:flex-end' },
      el('button', { class: 'btn', onclick: close }, 'Cancel'),
      el('button', { class: 'btn primary', onclick: () => run(area.value) }, 'Import'))));
  forceEmit();
}
