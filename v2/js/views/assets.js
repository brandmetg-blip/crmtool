// assets.js — the reference sheet an editor needs while cutting a video:
// what the avatar looks like, who the character is, and where the base images
// live. Read-only for everyone; it exists to be looked at and copied from.
//
// An editor sees only the avatars they have access to — the same set they get
// in the Daily Builder, so the two tabs never disagree about what is theirs.

import { state, builderAccounts, can } from '../state.js';
import { el, avatar, copyText } from '../ui.js';
import { sortedConcepts, bodyLinkFor, bodyRow } from '../concepts.js';

export function renderAssets(root) {
  const u = state.user;
  const accounts = builderAccounts(u, state.db)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const head = el('div', { class: 'page-head' },
    el('div', null,
      el('h1', null, 'Assets'),
      el('div', { class: 'sub' }, can.seesAllAccounts(u)
        ? accounts.length + (accounts.length === 1 ? ' avatar' : ' avatars')
        : 'The avatars you work on')),
    el('span', { class: 'spacer' }));
  import('../app.js').then(({ statusPill }) => head.appendChild(statusPill()));
  root.appendChild(head);

  if (!accounts.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      can.seesAllAccounts(u)
        ? 'No avatars yet — add them under Avatars.'
        : 'No avatars assigned to you yet — ask an admin.'));
    return;
  }

  root.appendChild(el('div', { class: 'grid' }, accounts.map(card)));
}

function card(a) {
  const link = (a.baseImageLink || '').trim();
  const isUrl = /^https?:\/\//.test(link);

  const box = el('div', { class: 'card col', style: 'gap:14px' },
    el('div', { class: 'row', style: 'gap:13px' },
      avatar(a, 64),
      el('div', { style: 'min-width:0;flex:1' },
        el('b', { style: 'display:block;font-size:14.5px' }, a.name || 'Untitled'),
        el('span', { class: 'hint' }, 'CHARACTER'),
        el('div', { style: 'font-size:13px;font-weight:600;color:#cfd0d4' }, (a.character || '').trim() || '—'))));

  const linkCol = el('div', { class: 'col', style: 'gap:6px;border-top:1px solid var(--line);padding-top:12px' },
    el('span', { class: 'label' }, 'BASE IMAGES'));

  if (isUrl) {
    linkCol.appendChild(el('div', { class: 'row wrap', style: 'gap:8px' },
      el('a', { class: 'btn small', href: link, target: '_blank', rel: 'noopener' }, 'Open folder ↗'),
      el('button', { class: 'btn small', onclick: e => copyText(link, e.currentTarget) }, 'Copy link')));
  } else if (link) {
    // Not a URL — still show it, since it may be a path or a note.
    linkCol.appendChild(el('div', { class: 'row wrap', style: 'gap:8px' },
      el('span', { class: 'ro-text', style: 'flex:1;min-width:0' }, link),
      el('button', { class: 'btn small', onclick: e => copyText(link, e.currentTarget) }, 'Copy')));
  } else {
    linkCol.appendChild(el('span', { class: 'hint' }, 'No base image link set yet.'));
  }

  box.appendChild(linkCol);
  box.appendChild(bodiesBlock(a));
  return box;
}

// The pre-made bodies for this character: a folder per concept, with an angle
// listed separately only when it has its own folder rather than sharing.
function bodiesBlock(a) {
  const concepts = sortedConcepts().filter(c => bodyLinkFor(a, c.id));

  const col = el('div', { class: 'col', style: 'gap:9px;border-top:1px solid var(--line);padding-top:12px' },
    el('div', { class: 'row' },
      el('span', { class: 'label' }, 'BODIES BY CONCEPT'),
      el('span', { class: 'spacer' }),
      concepts.length ? el('span', { class: 'hint' }, concepts.length + (concepts.length === 1 ? ' concept' : ' concepts')) : null));

  if (!concepts.length) {
    col.appendChild(el('span', { class: 'hint' },
      (a.bodyLinks || []).length
        ? 'Older links on this avatar are waiting to be imported — an admin can do it under Avatars → Concepts.'
        : 'No concepts set up for this character yet.'));
    return col;
  }

  concepts.forEach(c => {
    col.appendChild(linkLine(c.name, bodyLinkFor(a, c.id), true));
    const row = bodyRow(a, c.id);
    (c.variations || []).forEach(v => {
      const own = (row && row.varUrls && row.varUrls[v.id]) || '';
      if (!own.trim()) return;                 // shares the concept folder — nothing to add
      col.appendChild(el('div', { style: 'padding-left:14px' },
        linkLine(v.label || 'Untitled angle', own.trim(), false)));
    });
  });
  return col;
}

function linkLine(label, url, strong) {
  const isUrl = /^https?:\/\//.test(url);
  return el('div', { class: 'row wrap', style: 'gap:8px' },
    el('span', {
      style: 'flex:1;min-width:90px;font-size:' + (strong ? '12.5px;font-weight:700' : '11.5px;color:var(--mut)')
    }, label),
    isUrl
      ? el('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Open bodies ↗')
      : el('span', { class: 'hint' }, url || 'No link'),
    isUrl ? el('button', { class: 'btn small', onclick: e => copyText(url, e.currentTarget) }, 'Copy') : null);
}
