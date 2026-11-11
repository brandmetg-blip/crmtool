// settings.js — the rules of the workspace, in one place.
//
// Brands, concepts and profiles are what the rest of the tool picks from. The
// workspace tab holds the rules, and stays admin only.

import { state, forceEmit, uid, can } from '../state.js';
import { el } from '../ui.js';
import { sortedStages, stageColor } from '../stages.js';
import { getPref, setPref } from '../prefs.js';
import { PRODUCT_COLORS } from './accounts.js';
import { openColumns } from './sheet.js';
import { conceptsPanel, profilesPanel } from './accounts.js';
import { brandsPanel } from './brandsettings.js';
import { rulesPanel } from './rulesettings.js';

export function renderSettings(root, u) {
  if (!can.manageSettings(u) && !can.editAccounts(u)) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      'Only an admin can change settings.'));
    return;
  }

  const head = el('div', { class: 'page-head' },
    el('div', null, el('h1', null, 'Settings'), el('div', { class: 'sub' }, 'Brands, concepts, profiles, rules and the workspace')),
    el('span', { class: 'spacer' }));
  import('../app.js').then(({ statusPill }) => head.appendChild(statusPill()));
  root.appendChild(head);

  const tabs = [['brands', 'Brands'], ['concepts', 'Concepts'], ['profiles', 'Profiles']];
  if (can.manageSettings(u)) tabs.push(['rules', 'Rules'], ['workspace', 'Workspace']);
  const tab = tabs.some(t => t[0] === state.settingsTab) ? state.settingsTab : 'brands';
  root.appendChild(el('div', { class: 'seg settings-tabs' }, tabs.map(([k, label]) =>
    el('button', { class: tab === k ? 'on' : '', onclick: () => { state.settingsTab = k; state.settingsBrand = null; forceEmit(); } }, label))));

  if (tab === 'brands') root.appendChild(brandsPanel());
  else if (tab === 'concepts') root.appendChild(conceptsPanel());
  else if (tab === 'profiles') root.appendChild(profilesPanel());
  else if (tab === 'rules') root.appendChild(rulesPanel());
  else {
    root.appendChild(sheetSection());
    root.appendChild(stagesSection());
  }
}

// Extra columns on the avatar sheet, for anything the built-in ones miss.
// Concept columns are not here — those generate themselves from the concept
// library, so adding a concept already adds its column.
function sheetSection() {
  const cols = getPref('sheetColumns') || [];
  const n = cols.length;

  return el('div', { class: 'card col', style: 'gap:12px;margin-bottom:22px' },
    el('div', null,
      el('b', { style: 'font-size:14px' }, 'Avatar sheet columns'),
      el('div', { class: 'hint' },
        'The sheet shows the page tick, product, name, status, stage, caption and link ticks — plus a column per concept, generated from the concept library. Anything else you track goes in an extra column.')),
    el('div', { class: 'row wrap', style: 'gap:10px' },
      el('span', { class: 'chip ' + (n ? 'blue' : 'gray') },
        n ? n + (n === 1 ? ' extra column' : ' extra columns') : 'No extra columns'),
      n ? el('span', { class: 'hint' }, cols.map(c => c.label || 'Untitled').join(' · ')) : null,
      el('span', { class: 'spacer' }),
      // the editor lives with the sheet, where the columns are actually seen
      el('button', { class: 'btn small', onclick: openColumns }, 'Edit columns')));
}

// ---------------------------------------------------------------------------
function stagesSection() {
  const wrap = el('div', { class: 'col', style: 'gap:12px' });

  wrap.appendChild(el('div', { class: 'row wrap' },
    el('div', null,
      el('b', { style: 'font-size:14px' }, 'Stages'),
      el('div', { class: 'hint' },
        'The life of a page, in order. What you write here is what editors read on Assets and on the avatar’s day.')),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'btn primary', onclick: async () => {
        const name = prompt('Name of the new stage:');
        if (!name || !name.trim()) return;
        const { save } = await import('../app.js');
        save('stages', {
          id: uid('st'), name: name.trim(), goal: '',
          color: PRODUCT_COLORS[sortedStages().length % PRODUCT_COLORS.length],
          order: sortedStages().length, createdAt: Date.now(),
        });
        forceEmit();
      }
    }, '+ Add stage')));

  const list = sortedStages();
  if (!list.length) {
    wrap.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:30px' },
      'No stages yet. Most teams start with something like Warming → Growth → Product.'));
    return wrap;
  }

  list.forEach((s, i) => wrap.appendChild(stageCard(s, i, list.length)));
  return wrap;
}

function stageCard(s, i, total) {
  const c = stageColor(s);

  return el('div', { class: 'card col', style: 'gap:12px;border-left:3px solid ' + c },
    el('div', { class: 'row wrap', style: 'gap:9px' },
      el('span', { class: 'num' }, String(i + 1)),
      el('input', {
        class: 'input', style: 'height:33px;font-size:13.5px;font-weight:700;flex:1;min-width:160px', value: s.name,
        placeholder: 'Stage name…',
        oninput: async e => {
          const { mutateQuiet } = await import('../app.js');
          mutateQuiet('stages', s.id, x => x.name = e.target.value);
        }
      }),
      el('span', { class: 'hint', style: 'white-space:nowrap' },
        state.db.accounts.filter(a => a.stageId === s.id).length + ' pages'),
      el('button', { class: 'iconbtn', title: 'Move earlier', onclick: () => move(s, -1, total) }, '↑'),
      el('button', { class: 'iconbtn', title: 'Move later', onclick: () => move(s, 1, total) }, '↓'),
      el('button', {
        class: 'iconbtn danger', title: 'Delete stage', onclick: async () => {
          const used = state.db.accounts.filter(a => a.stageId === s.id).length;
          if (!confirm('Delete the “' + s.name + '” stage?'
            + (used ? '\n\n' + used + ' page(s) are at this stage and will be left with no stage.' : ''))) return;
          const { removeItem, save } = await import('../app.js');
          state.db.accounts.filter(a => a.stageId === s.id).forEach(a => { a.stageId = ''; save('accounts', a); });
          removeItem('stages', s.id);
          forceEmit();
        }
      }, '✕')),

    el('div', { class: 'col', style: 'gap:5px' },
      el('span', { class: 'label' }, 'WHAT TO DO AT THIS STAGE'),
      el('textarea', {
        class: 'input', style: 'min-height:54px;font-size:12.5px',
        placeholder: 'e.g. Growth videos only, 3 a day. No product mentions until 1k followers.',
        oninput: async e => {
          const { mutateQuiet } = await import('../app.js');
          mutateQuiet('stages', s.id, x => x.goal = e.target.value);
        }
      }, s.goal || '')),

    el('div', { class: 'col', style: 'gap:5px' },
      el('span', { class: 'label' }, 'COLOUR'),
      el('div', { class: 'row wrap', style: 'gap:6px' }, PRODUCT_COLORS.map(col => el('button', {
        class: 'swatch' + (col.toLowerCase() === c.toLowerCase() ? ' on' : ''),
        style: 'background:' + col, title: col,
        onclick: async () => {
          const { mutate } = await import('../app.js');
          mutate('stages', s.id, x => x.color = col);
        }
      })))));
}

async function move(s, dir, total) {
  const rows = sortedStages();
  const i = rows.findIndex(x => x.id === s.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= total) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  const { mutate } = await import('../app.js');
  for (let k = 0; k < rows.length; k++) await mutate('stages', rows[k].id, x => x.order = k);
  forceEmit();
}
