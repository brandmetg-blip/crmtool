// library.js — the Library tab: every script ever written, across all days.
//
// Prompts shows one day at a time, so an older script could only be found by
// remembering its date. Here each brand's scripts are listed together with a number
// (G006 for growth, C006 for CTA), whether they are ready to make, and the pages
// they have gone to.
//
// A number stays with its script for good, and is never given out twice, even after
// a delete. They live in one row of their own rather than on the scripts, because
// handing out numbers should not mean rewriting every script and its images.

import { state, forceEmit, byId } from '../state.js';
import { el, avatar } from '../ui.js';
import { brands, brandById } from '../brands.js';
import { typeName, videosByScript, scriptHasPrompts } from './mainscripts.js';

const ROW = 'scriptNumbers';
const TYPES = [['All', 'All'], ['Growth', 'Growth'], ['Product', 'CTA']];
const STATUS = {
  empty: { label: 'No script yet', chip: 'gray' },
  needs: { label: 'Needs prompts', chip: 'amber' },
  ready: { label: 'Ready', chip: 'green' },
};

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------
const storedNumbers = () => {
  const row = (state.db.settings || []).find(r => r.id === ROW);
  return (row && ((row.data && row.data.map) || row.map)) || {};
};
const numberKey = s => s.brandId + '|' + (s.type === 'Growth' ? 'G' : 'C');

// Oldest first, so the numbers run in the order the scripts were written. Whoever
// opens the Library first gives out any that are missing, and anyone else opening
// it would work out the same ones.
function currentNumbers() {
  const map = Object.assign({}, storedNumbers());
  const top = {};
  Object.values(map).forEach(x => { top[x.k] = Math.max(top[x.k] || 0, x.n); });
  let changed = false;
  state.db.scripts
    .filter(s => brandById(s.brandId))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0))
    .forEach(s => {
      const k = numberKey(s);
      if (map[s.id] && map[s.id].k === k) return;
      top[k] = (top[k] || 0) + 1;
      map[s.id] = { k, n: top[k] };
      changed = true;
    });
  if (changed) keepNumbers(map);
  return map;
}

async function keepNumbers(map) {
  const { save } = await import('../app.js');
  save('settings', { id: ROW, map });
}

// A script taking the place of the blank one mass add made takes its number too.
export async function inheritNumber(id, fromId) {
  const map = Object.assign({}, storedNumbers());
  if (!map[fromId]) return;
  map[id] = map[fromId];
  delete map[fromId];
  await keepNumbers(map);
}

const numberText = (s, map) => {
  const x = map[s.id];
  return x && x.k === numberKey(s) ? (s.type === 'Growth' ? 'G' : 'C') + String(x.n).padStart(3, '0') : '';
};

// ---------------------------------------------------------------------------
// one script's standing
// ---------------------------------------------------------------------------
function statusOf(s) {
  if (scriptHasPrompts(s)) return 'ready';
  return (s.body || '').trim() ? 'needs' : 'empty';
}

// Each page once, with the videos it has from this script.
function pagesOn(videos) {
  const seen = new Map();
  videos.forEach(v => {
    const a = byId(state.db.accounts, v.accountId);
    if (a && !seen.has(a.id)) seen.set(a.id, a);
  });
  return [...seen.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function shortDate(d) {
  if (!d) return '';
  const when = new Date(d + 'T00:00:00');
  const opts = { month: 'short', day: 'numeric' };
  if (when.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return when.toLocaleDateString(undefined, opts);
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------
export function libraryMode(root) {
  const numbers = currentNumbers();
  const uses = videosByScript();
  const list = el('div', { class: 'col', style: 'gap:18px' });

  const search = el('input', {
    class: 'input lib-search', type: 'search', placeholder: 'Search by number or words in the script…',
    'aria-label': 'Search scripts', value: state.libSearch || '',
    oninput: e => { state.libSearch = e.target.value; paint(); },
  });
  const filters = el('div', { class: 'lib-filters' });
  root.appendChild(el('div', { class: 'col', style: 'gap:12px;margin-bottom:16px' }, search, filters));
  root.appendChild(list);

  function paint() {
    const brandId = state.libBrand && brandById(state.libBrand) ? state.libBrand : '';
    const type = state.libType || 'All';
    const words = (state.libSearch || '').trim().toLowerCase();

    const found = state.db.scripts.filter(s => {
      if (brandId && s.brandId !== brandId) return false;
      if (type !== 'All' && (s.type || 'Product') !== type) return false;
      if (!words) return true;
      return [numberText(s, numbers), s.title, s.body].some(t => (t || '').toLowerCase().includes(words));
    });
    const counts = { empty: 0, needs: 0, ready: 0 };
    found.forEach(s => { counts[statusOf(s)]++; });
    const status = STATUS[state.libStatus] && counts[state.libStatus] ? state.libStatus : 'all';
    const shown = status === 'all' ? found : found.filter(s => statusOf(s) === status);

    const pick = (key, value) => () => { state[key] = value; paint(); };
    filters.innerHTML = '';
    filters.appendChild(el('div', { class: 'seg mini' },
      el('button', { class: brandId ? '' : 'on', onclick: pick('libBrand', '') }, 'All brands'),
      brands().map(b => el('button', { class: brandId === b.id ? 'on' : '', onclick: pick('libBrand', b.id) }, b.name))));
    filters.appendChild(el('div', { class: 'seg mini' }, TYPES.map(([k, label]) =>
      el('button', { class: type === k ? 'on' : '', onclick: pick('libType', k) }, label))));
    filters.appendChild(el('div', { class: 'seg mini' },
      el('button', { class: status === 'all' ? 'on' : '', onclick: pick('libStatus', 'all') }, 'All', el('span', { class: 'seg-count' }, String(found.length))),
      Object.keys(STATUS).filter(k => counts[k]).map(k =>
        el('button', { class: status === k ? 'on' : '', onclick: pick('libStatus', k) }, STATUS[k].label, el('span', { class: 'seg-count' }, String(counts[k]))))));

    list.innerHTML = '';
    if (!shown.length) {
      list.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
        state.db.scripts.length ? 'No scripts match this.' : 'No scripts yet. Scripts added in Videos or Prompts land here.'));
      return;
    }

    const newest = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0);
    const section = (title, note, scripts) => {
      if (!scripts.length) return;
      list.appendChild(el('section', { class: 'lib-group' },
        el('div', { class: 'lib-group-head' },
          el('b', null, title),
          el('span', { class: 'hint' }, scripts.length + (scripts.length === 1 ? ' script' : ' scripts')),
          note ? el('span', { class: 'hint' }, note) : null),
        el('div', { class: 'lib-rows' }, scripts.sort(newest).map(s => row(s, numbers, uses.get(s.id) || [])))));
    };
    section('No brand yet', 'Set the brand on a script to give it a number.', shown.filter(s => !brandById(s.brandId)));
    brands().forEach(b => section(b.name, '', shown.filter(s => s.brandId === b.id)));
  }
  paint();
}

function row(s, numbers, videos) {
  const st = STATUS[statusOf(s)];
  const pages = pagesOn(videos);
  const made = pagesOn(videos.filter(v => v.done)).length;
  const won = videos.some(v => v.win);
  const words = (s.body || '').trim().replace(/\s+/g, ' ');
  const product = byId(state.db.products, s.productId);
  const names = pages.slice(0, 2).map(a => a.name || 'Untitled').join(', ') + (pages.length > 2 ? ' +' + (pages.length - 2) : '');

  return el('button', {
    class: 'lib-row',
    onclick: () => {
      state.builderMode = 'scripts';
      state.openScript = s.id;
      state.scriptBack = null;
      state.libraryBack = s.id;
      forceEmit();
    },
  },
    el('span', { class: 'lib-num ' + (s.type === 'Growth' ? 'blue' : 'green') }, numberText(s, numbers) || typeName(s.type)),
    el('span', { class: 'lib-main' },
      el('b', { class: 'lib-words' }, words || s.title || 'Untitled'),
      el('span', { class: 'hint lib-meta' }, [s.title, product && product.name, shortDate(s.date)].filter(Boolean).join(' · '))),
    el('span', { class: 'lib-status' },
      el('span', { class: 'chip ' + st.chip }, st.label),
      won ? el('span', { class: 'chip violet' }, 'Winner') : null),
    pages.length
      ? el('span', { class: 'lib-pages' },
          el('span', { class: 'lib-stack' }, pages.slice(0, 3).map(a => avatar(a, 24))),
          el('span', { class: 'lib-names' },
            el('span', { class: 'lib-name' }, names),
            el('span', { class: 'hint' }, made + ' of ' + pages.length + ' made')))
      : el('span', { class: 'hint lib-pages' }, 'No pages yet'));
}
