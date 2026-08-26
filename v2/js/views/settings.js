// settings.js — the rules of the workspace, in one place.
//
// Admin only. Right now it holds the stages a page moves through and what kind
// of video belongs at each; it is laid out to take more settings later without
// turning into a wall.

import { state, forceEmit, uid, can } from '../state.js';
import { el } from '../ui.js';
import { sortedStages, stageColor, quotaFor, VIDEO_TYPES } from '../stages.js';
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
        'The life of a page, in order. What you write here is what editors read on Assets and on the avatar’s day, and the daily targets decide who still needs a video when you mass add — so nobody has to remember.')),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'btn primary', onclick: async () => {
        const name = prompt('Name of the new stage:');
        if (!name || !name.trim()) return;
        const { save } = await import('../app.js');
        save('stages', {
          id: uid('st'), name: name.trim(), goal: '', quota: { Growth: 1, Product: 1 },
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

    // the daily target per type — zero means this type does not belong here
    el('div', { class: 'col', style: 'gap:6px' },
      el('span', { class: 'label' }, 'VIDEOS PER DAY AT THIS STAGE'),
      el('div', { class: 'row wrap', style: 'gap:14px' }, VIDEO_TYPES.map(t => {
        const n = quotaFor(s, t);
        return el('div', { class: 'row', style: 'gap:7px' },
          el('span', {
            style: 'font-size:12.5px;font-weight:700;min-width:62px;color:'
              + (n ? (t === 'Growth' ? 'var(--blue)' : 'var(--green)') : 'var(--dim)')
          }, t),
          el('button', { class: 'iconbtn', title: 'One fewer', onclick: () => bump(s, t, -1) }, '−'),
          el('input', {
            class: 'input', type: 'number', min: '0', max: '20', value: String(n),
            style: 'width:62px;height:30px;text-align:center;font-weight:800',
            onchange: async e => {
              const v = Math.max(0, Math.min(20, Math.round(+e.target.value || 0)));
              const { mutate } = await import('../app.js');
              mutate('stages', s.id, x => { x.quota = Object.assign({}, x.quota, { [t]: v }); });
            }
          }),
          el('button', { class: 'iconbtn', title: 'One more', onclick: () => bump(s, t, 1) }, '+'));
      })),
      el('span', { class: 'hint' }, quotaSummary(s))),

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

async function bump(s, type, by) {
  const { mutate } = await import('../app.js');
  mutate('stages', s.id, x => {
    const v = Math.max(0, Math.min(20, quotaFor(x, type) + by));
    x.quota = Object.assign({}, x.quota, { [type]: v });
  });
}

function quotaSummary(s) {
  const parts = VIDEO_TYPES.map(t => [t, quotaFor(s, t)]).filter(p => p[1] > 0);
  if (!parts.length) return 'Nothing set — pages at this stage get no videos.';
  const total = parts.reduce((n, p) => n + p[1], 0);
  const zero = VIDEO_TYPES.filter(t => !quotaFor(s, t));
  return parts.map(p => p[1] + '× ' + p[0]).join(' + ')
    + ' a day (' + total + ' total)'
    + (zero.length ? '. A ' + zero.join(' or ') + ' video here is off-stage and takes a confirmation.' : '.');
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
