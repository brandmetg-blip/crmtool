// settings.js — the rules of the workspace, in one place.
//
// Admin only. Right now it holds the stages a page moves through and what kind
// of video belongs at each; it is laid out to take more settings later without
// turning into a wall.

import { state, forceEmit, uid, can } from '../state.js';
import { el } from '../ui.js';
import { sortedStages, stageColor, allowedTypes, VIDEO_TYPES } from '../stages.js';
import { PRODUCT_COLORS } from './accounts.js';

export function renderSettings(root, u) {
  if (!can.manageSettings(u)) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      'Only an admin can change settings.'));
    return;
  }

  const head = el('div', { class: 'page-head' },
    el('div', null, el('h1', null, 'Settings'), el('div', { class: 'sub' }, 'How the workspace behaves')),
    el('span', { class: 'spacer' }));
  import('../app.js').then(({ statusPill }) => head.appendChild(statusPill()));
  root.appendChild(head);

  root.appendChild(stagesSection());
}

// ---------------------------------------------------------------------------
function stagesSection() {
  const wrap = el('div', { class: 'col', style: 'gap:12px' });

  wrap.appendChild(el('div', { class: 'row wrap' },
    el('div', null,
      el('b', { style: 'font-size:14px' }, 'Stages'),
      el('div', { class: 'hint' },
        'The life of a page, in order. What you write here is what editors read on Assets and on the avatar’s day — and which video types are allowed decides what the builder lets you add.')),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'btn primary', onclick: async () => {
        const name = prompt('Name of the new stage:');
        if (!name || !name.trim()) return;
        const { save } = await import('../app.js');
        save('stages', {
          id: uid('st'), name: name.trim(), goal: '', allows: VIDEO_TYPES.slice(),
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
  const allows = allowedTypes(s);

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

    // which video types belong here — the rule the builder enforces
    el('div', { class: 'col', style: 'gap:5px' },
      el('span', { class: 'label' }, 'VIDEO TYPES ALLOWED AT THIS STAGE'),
      el('div', { class: 'row wrap', style: 'gap:7px' }, VIDEO_TYPES.map(t => {
        const on = allows.includes(t);
        return el('button', {
          class: 'chip click ' + (on ? (t === 'Growth' ? 'blue' : 'green') : 'gray'),
          onclick: async () => {
            const { mutate } = await import('../app.js');
            mutate('stages', s.id, x => {
              const cur = allowedTypes(x);
              const next = cur.includes(t) ? cur.filter(y => y !== t) : cur.concat([t]);
              // never leave a stage allowing nothing — that would block all work
              x.allows = next.length ? next : VIDEO_TYPES.slice();
            });
          }
        }, (on ? '✓ ' : '') + t);
      })),
      el('span', { class: 'hint' }, allows.length === VIDEO_TYPES.length
        ? 'Both types allowed. Turn one off once a page at this stage should stop getting it.'
        : 'Adding a ' + VIDEO_TYPES.filter(t => !allows.includes(t)).join(' or ')
          + ' video to a page here is flagged as off-stage, and takes a deliberate confirmation.')),

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
