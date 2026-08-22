// guard.js — soft locking for a field two people could type into at once.
//
// A record is saved as a whole row, so simultaneous typing in the same field
// would cost one person their text. Focusing a field claims it; everyone else
// sees it read-only with who is holding it, until they move away. Claims expire
// on their own, so nothing can get permanently stuck, and an admin can always
// take one over.

import { forceEmit } from './state.js';
import { el } from './ui.js';
import { presence } from './presence.js';

export function guarded(fieldKey, buildEditor, readOnly) {
  const held = presence.heldBy(fieldKey);
  if (!held) {
    const node = buildEditor();
    node.addEventListener('focus', () => presence.claim(fieldKey));
    node.addEventListener('blur', () => presence.release(fieldKey));
    return node;
  }
  return el('div', { class: 'col', style: 'gap:6px' },
    el('div', { class: 'lock' },
      held.name + ' is editing this',
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn small', title: 'Edit it anyway — their text stays in their own copy until they save',
        onclick: () => { presence.takeOver(fieldKey); forceEmit(); }
      }, 'Take over')),
    readOnly());
}
