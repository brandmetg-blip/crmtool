// accounts.js — the avatars. Every account is one avatar/persona posting on
// Facebook + Instagram. Admins and managers create and edit them; everyone
// else sees the ones assigned to them, read-only.
//
// Profiles (the named FB/IG identities an avatar posts from) are managed here
// too, because they only ever exist to be attached to an avatar.

import { state, emit, forceEmit, uid, byId, can, myAccounts } from '../state.js';
import { el, avatar, nameColor } from '../ui.js';
import {
  sortedConcepts, discoverLegacyConcepts, bodyRow, setConceptLink, setVariationLink, pruneBodyLinks,
} from '../concepts.js';

const STATUSES = [['Active', 'green'], ['Warming', 'amber'], ['Paused', 'gray'], ['Banned', 'red']];
const PHASES = ['P1', 'P2', 'P3', 'P4'];

export function renderAccounts(root) {
  const u = state.user;
  const canEdit = can.editAccounts(u);
  const all = myAccounts(u, state.db);

  root.appendChild(head(canEdit, all.length));
  root.appendChild(filters(all));

  const shown = all
    .filter(a => state.acctStatus === 'all' || (a.status || 'Active') === state.acctStatus)
    .filter(a => state.acctProfile === 'all' || a.facebookProfileId === state.acctProfile)
    .filter(a => matchesProduct(a, state.acctProduct))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (!shown.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      all.length ? 'No avatars match these filters.'
        : canEdit ? 'No avatars yet — add the first one.' : 'No avatars assigned to you yet — ask an admin.'));
    return;
  }
  root.appendChild(groupedCards(shown, canEdit));
}

// Laid out under a heading per product by default, so which pages belong to
// which product is obvious without touching a filter. Falls back to one plain
// grid when no products exist, rather than a lone "No product" heading.
function groupedCards(shown, canEdit) {
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
  const grid = list => el('div', { class: 'grid' }, list.map(a => card(a, canEdit)));

  const groups = [];
  state.db.products.slice().sort(byName).forEach(p => {
    const mine = shown.filter(a => a.productId === p.id);
    if (mine.length) groups.push({ product: p, accounts: mine });
  });
  // no product set, or pointing at one that has since been deleted
  const orphans = shown.filter(a => !byId(state.db.products, a.productId));
  if (orphans.length) groups.push({ product: null, accounts: orphans });

  if (!groups.some(g => g.product)) return grid(shown);

  return el('div', { class: 'col', style: 'gap:22px' }, groups.map(g => {
    const c = g.product ? productColor(g.product) : 'var(--dim)';
    const n = g.accounts.length;
    const active = g.accounts.filter(a => (a.status || 'Active') === 'Active').length;
    return el('div', null,
      el('div', { class: 'group-head' },
        el('span', { class: 'group-dot', style: 'background:' + c }),
        el('b', { style: 'font-size:13.5px;color:' + c }, g.product ? g.product.name : 'No product'),
        el('span', { class: 'hint' }, n + (n === 1 ? ' avatar' : ' avatars')),
        el('span', { class: 'spacer' }),
        active < n ? el('span', { class: 'chip gray' }, active + ' active') : null),
      grid(g.accounts));
  }));
}

function head(canEdit, n) {
  const spacer = el('span', { class: 'spacer' });
  const wrap = el('div', { class: 'page-head' },
    el('div', null, el('h1', null, 'Avatars'), el('div', { class: 'sub' }, n + (n === 1 ? ' account' : ' accounts'))),
    spacer);
  // async so it lands after the buttons below are appended — anchor on the
  // spacer so the pill sits to their left either way
  import('../app.js').then(({ statusPill }) => wrap.insertBefore(statusPill(), spacer.nextSibling));
  if (canEdit) {
    wrap.appendChild(el('button', { class: 'btn', onclick: openConcepts }, 'Concepts'));
    wrap.appendChild(el('button', { class: 'btn', onclick: openProducts }, 'Products'));
    wrap.appendChild(el('button', { class: 'btn', onclick: openProfiles }, 'Profiles'));
    wrap.appendChild(el('button', { class: 'btn primary', onclick: () => openAccount(null) }, '+ New avatar'));
  }
  return wrap;
}

// 'all' | 'none' (no product, or one since deleted) | a product id
function matchesProduct(a, pid) {
  if (!pid || pid === 'all') return true;
  if (pid === 'none') return !byId(state.db.products, a.productId);
  return a.productId === pid;
}

function filters(all) {
  const fbProfiles = state.db.profiles.filter(p => p.platform === 'facebook');
  const products = state.db.products.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const row = el('div', { class: 'row wrap', style: 'margin-bottom:16px' },
    el('div', { class: 'seg' }, [['all', 'All']].concat(STATUSES.map(s => [s[0], s[0]])).map(([k, label]) =>
      el('button', {
        class: state.acctStatus === k ? 'on' : '',
        onclick: () => { state.acctStatus = k; forceEmit(); }
      }, label))));

  if (products.length) {
    const noneCount = all.filter(a => !byId(state.db.products, a.productId)).length;
    const sel = el('select', {
      class: 'input', style: 'width:auto;min-width:170px',
      onchange: e => { state.acctProduct = e.target.value; forceEmit(); }
    },
      [el('option', { value: 'all' }, 'Any product')]
        .concat(products.map(p => {
          const n = all.filter(a => a.productId === p.id).length;
          return el('option', { value: p.id }, p.name + ' (' + n + ')');
        }))
        .concat(noneCount ? [el('option', { value: 'none' }, 'No product (' + noneCount + ')')] : []));
    sel.value = state.acctProduct || 'all';
    row.appendChild(sel);
  }

  if (fbProfiles.length) {
    const sel = el('select', {
      class: 'input', style: 'width:auto;min-width:190px',
      onchange: e => { state.acctProfile = e.target.value; forceEmit(); }
    },
      [el('option', { value: 'all' }, 'All Facebook profiles')].concat(fbProfiles.map(p => {
        const n = all.filter(a => a.facebookProfileId === p.id).length;
        return el('option', { value: p.id }, p.name + ' (' + n + ')');
      })));
    sel.value = state.acctProfile;
    row.appendChild(sel);
  }

  const filtered = state.acctStatus !== 'all'
    || (state.acctProduct && state.acctProduct !== 'all')
    || state.acctProfile !== 'all';
  if (filtered) {
    row.appendChild(el('button', {
      class: 'btn small',
      onclick: () => {
        state.acctStatus = 'all'; state.acctProduct = 'all'; state.acctProfile = 'all';
        forceEmit();
      }
    }, 'Clear filters'));
  }
  return row;
}

function card(a, canEdit) {
  const st = STATUSES.find(s => s[0] === (a.status || 'Active')) || STATUSES[0];
  const fb = byId(state.db.profiles, a.facebookProfileId);
  const ig = byId(state.db.profiles, a.instagramProfileId);

  const c = el('div', {
    class: 'card col' + (canEdit ? ' click' : ''), style: 'gap:12px',
    onclick: canEdit ? () => openAccount(a) : null,
  },
    el('div', { class: 'row' },
      avatar(a, 44),
      el('div', { style: 'min-width:0;flex:1' },
        el('b', { style: 'display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, a.name || 'Untitled'),
        el('span', { class: 'hint' }, a.character || 'No character')),
      el('span', { class: 'chip ' + st[1] }, st[0])),

    // no product chip here — the group heading above already says it
    el('div', { class: 'row wrap', style: 'gap:6px' },
      a.phase && el('span', { class: 'chip gray' }, a.phase),
      handleChip('facebook', a.platforms && a.platforms.facebook, fb),
      handleChip('instagram', a.platforms && a.platforms.instagram, ig)));

  if ((a.notes || '').trim()) {
    c.appendChild(el('div', { class: 'hint', style: 'white-space:pre-wrap;border-top:1px solid var(--line);padding-top:9px' },
      a.notes.trim().slice(0, 140) + (a.notes.trim().length > 140 ? '…' : '')));
  }
  return c;
}

// Colours a product can wear. Fixed set rather than a free colour picker:
// every one of these is legible on the dark surface, and the label always
// carries the product NAME too, so identity never rests on colour alone.
export const PRODUCT_COLORS = [
  '#34e08a', '#5b8def', '#9a7bff', '#f0b341', '#e879b9',
  '#5bd5ef', '#f97b5a', '#6ee7b7', '#f0584e', '#8b8b93',
];

export function productColor(p) {
  if (!p) return '';
  return p.color || nameColor(p.name || '');   // deterministic default until one is picked
}

export function productChip(a) {
  const p = byId(state.db.products, a && a.productId);
  if (!p) return null;
  const c = productColor(p);
  return el('span', {
    class: 'chip', title: 'Promotes ' + p.name,
    style: 'color:' + c + ';background:' + c + '1f;border-color:' + c + '55',
  }, p.name);
}

function handleChip(platform, handle, profile) {
  if (!handle && !profile) return null;
  const label = handle ? '@' + String(handle).replace(/^@/, '') : profile.name;
  return el('span', {
    class: 'chip ' + (platform === 'facebook' ? 'blue' : 'pink'),
    title: profile ? profile.name : '',
  }, platform === 'facebook' ? 'FB' : 'IG', label);
}

// ---------------------------------------------------------------------------
// account editor
// ---------------------------------------------------------------------------
function closeModal() { state.modal = null; forceEmit(); }

function openAccount(existing) {
  // Edit a COPY. Nothing is written until Save, so an abandoned modal can't
  // half-write a record, and a live update from someone else can't be
  // scribbled over by a form the user never submitted.
  const a = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
      id: uid('a'), name: '', character: '', status: 'Active', phase: 'P1',
      productId: '',
      platforms: { facebook: '', instagram: '' },
      facebookProfileId: '', instagramProfileId: '',
      metaBusinessSuiteUrl: '', avatarUrl: '', baseImageLink: '', bodyLinks: [],
      notes: '', createdAt: Date.now(),
    };
  if (!a.platforms) a.platforms = { facebook: '', instagram: '' };
  if (!Array.isArray(a.bodyLinks)) a.bodyLinks = [];   // added after the first avatars existed

  const body = el('div', { class: 'modal-body' });

  // avatar + name
  const pic = el('div', { class: 'row', style: 'gap:14px' });
  const picHolder = el('div', null, avatar(a, 60));
  const fileIn = el('input', {
    type: 'file', accept: 'image/*', style: 'display:none',
    onchange: async e => {
      const file = e.target.files && e.target.files[0]; if (!file) return;
      const btn = pic.querySelector('.upl');
      if (btn) btn.textContent = 'Uploading…';
      try {
        const { store } = await import('../app.js');
        a.avatarUrl = await store.uploadImage(file);
        picHolder.innerHTML = ''; picHolder.appendChild(avatar(a, 60));
      } catch (err) {
        alert('Image upload failed — try again.\n' + (err.message || ''));
      }
      if (btn) btn.textContent = 'Upload photo';
    }
  });
  pic.appendChild(picHolder);
  pic.appendChild(el('div', { class: 'col', style: 'gap:6px;flex:1' },
    el('label', { class: 'btn small upl', style: 'cursor:pointer;align-self:flex-start' }, 'Upload photo', fileIn),
    a.avatarUrl && el('button', {
      class: 'btn small danger', style: 'align-self:flex-start',
      onclick: () => { a.avatarUrl = ''; picHolder.innerHTML = ''; picHolder.appendChild(avatar(a, 60)); }
    }, 'Remove photo')));
  body.appendChild(pic);

  body.appendChild(field('NAME', el('input', {
    class: 'input', value: a.name, placeholder: 'e.g. Sarah — Wellness',
    oninput: e => a.name = e.target.value
  })));

  body.appendChild(field('CHARACTER', el('input', {
    class: 'input', value: a.character || '', placeholder: 'The persona this avatar plays',
    oninput: e => a.character = e.target.value
  })));

  // what this avatar promotes
  body.appendChild(el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, 'PRODUCT'),
    productSelect(a.productId, v => a.productId = v),
    el('span', { class: 'hint' }, 'Shown beside the avatar when mass adding, so you can tell at a glance what each one is promoting.')));

  // status + phase
  body.appendChild(el('div', { class: 'row wrap', style: 'gap:16px;align-items:flex-end' },
    field('STATUS', select(STATUSES.map(s => [s[0], s[0]]), a.status || 'Active', v => a.status = v)),
    field('PHASE', select(PHASES.map(p => [p, p]), a.phase || 'P1', v => a.phase = v))));

  // platforms
  body.appendChild(el('span', { class: 'label' }, 'FACEBOOK'));
  body.appendChild(el('div', { class: 'row wrap', style: 'gap:10px' },
    el('input', {
      class: 'input', style: 'flex:1;min-width:150px', value: a.platforms.facebook || '', placeholder: 'Page handle',
      oninput: e => a.platforms.facebook = e.target.value
    }),
    profileSelect('facebook', a.facebookProfileId, v => a.facebookProfileId = v)));

  body.appendChild(el('span', { class: 'label' }, 'INSTAGRAM'));
  body.appendChild(el('div', { class: 'row wrap', style: 'gap:10px' },
    el('input', {
      class: 'input', style: 'flex:1;min-width:150px', value: a.platforms.instagram || '', placeholder: 'Account handle',
      oninput: e => a.platforms.instagram = e.target.value
    }),
    profileSelect('instagram', a.instagramProfileId, v => a.instagramProfileId = v)));

  body.appendChild(field('META BUSINESS SUITE URL', el('input', {
    class: 'input', value: a.metaBusinessSuiteUrl || '', placeholder: 'https://business.facebook.com/…',
    oninput: e => a.metaBusinessSuiteUrl = e.target.value
  })));

  // Where this avatar's base images live. Editors see it on the Assets tab.
  body.appendChild(el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, 'BASE IMAGE LINK'),
    el('input', {
      class: 'input', value: a.baseImageLink || '', placeholder: 'Drive folder with this avatar’s base images…',
      oninput: e => a.baseImageLink = e.target.value
    }),
    el('span', { class: 'hint' }, 'Shown to the video editors assigned to this avatar, under Assets.')));

  // ---- pre-made bodies, one folder per concept --------------------------------
  // The concept list is shared, so nothing is typed here — you just say where
  // this character's bodies live. Variations normally share the concept's
  // folder; expand one only when a single angle has its own.
  const bodies = el('div', { class: 'col', style: 'gap:8px' });
  const openConcept = {};   // which concepts are expanded in this modal

  function paintBodies() {
    bodies.innerHTML = '';
    bodies.appendChild(el('span', { class: 'label' }, 'BODIES BY CONCEPT'));

    const concepts = sortedConcepts();
    if (!concepts.length) {
      bodies.appendChild(el('div', { class: 'hint' },
        'No concepts defined yet. Add them under Avatars → Concepts, then set this avatar’s folders for each.'));
      return;
    }
    // Name the avatar explicitly: these folders belong to this one avatar and
    // nothing here is shared with any other.
    bodies.appendChild(el('span', { class: 'hint' },
      'Folders belonging to ' + ((a.name || '').trim() || 'this avatar') + ' alone — every avatar has its own. '
      + 'Each angle can have its own folder; leave one blank and it falls back to the concept’s main folder.'));

    const countFor = c => {
      const row = bodyRow(a, c.id);
      return ((row && row.url) || '').trim() ? 1 : 0
        + ((c.variations || []).filter(v => ((row && row.varUrls && row.varUrls[v.id]) || '').trim()).length);
    };
    // On an avatar with nothing set yet everything opens, so a new avatar never
    // looks like an empty section with nowhere to type. Once it has some
    // folders, the concepts it doesn't use tuck themselves away.
    const blankAvatar = !concepts.some(c => countFor(c) > 0);

    concepts.forEach(c => {
      const row = bodyRow(a, c.id);
      const url = (row && row.url) || '';
      const vars = c.variations || [];
      const setCount = (url.trim() ? 1 : 0)
        + vars.filter(v => ((row && row.varUrls && row.varUrls[v.id]) || '').trim()).length;
      const expanded = openConcept[c.id] === undefined
        ? (blankAvatar || setCount > 0)
        : !!openConcept[c.id];

      const block = el('div', { class: 'concept-block' + (expanded ? ' open' : '') });

      block.appendChild(el('div', {
        class: 'concept-head',
        onclick: () => { openConcept[c.id] = !expanded; paintBodies(); }
      },
        el('span', { class: 'twisty' }, expanded ? '▾' : '▸'),
        el('b', { style: 'font-size:12.5px;flex:1;min-width:0' }, c.name),
        el('span', { class: 'hint' }, setCount
          ? setCount + ' folder' + (setCount === 1 ? '' : 's') + ' set'
          : 'not used by this avatar')));

      if (expanded) {
        const fields = el('div', { class: 'concept-fields' });

        const line = (label, value, onInput, muted) => el('div', { class: 'row wrap', style: 'gap:8px' },
          el('span', {
            style: 'flex:0 0 104px;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
              + (muted ? 'color:var(--mut)' : 'font-weight:700')
          }, label),
          el('input', {
            class: 'input', style: 'flex:1;min-width:160px;height:30px;font-size:11.5px',
            value, placeholder: muted ? (url ? 'Falls back to the main folder' : 'Drive folder link…') : 'Drive folder link…',
            oninput: e => onInput(e.target.value)
          }));

        fields.appendChild(line(vars.length ? 'Main folder' : 'Folder', url,
          v => setConceptLink(a, c.id, v), false));

        vars.forEach(v => fields.appendChild(line(
          v.label || 'Untitled angle',
          (row && row.varUrls && row.varUrls[v.id]) || '',
          val => setVariationLink(a, c.id, v.id, val),
          true)));

        block.appendChild(fields);
      }
      bodies.appendChild(block);
    });
  }
  paintBodies();
  body.appendChild(bodies);

  body.appendChild(field('NOTES', el('textarea', {
    class: 'input', placeholder: 'Anything the team should know about this avatar…',
    oninput: e => a.notes = e.target.value
  }, a.notes || '')));

  const err = el('div', { class: 'error', style: 'display:none' });
  body.appendChild(err);

  body.appendChild(el('div', { class: 'row', style: 'gap:9px;padding-top:4px' },
    existing && el('button', {
      class: 'btn danger', onclick: async () => {
        const n = state.db.entries.filter(e => e.accountId === a.id).length;
        if (!confirm('Delete "' + (a.name || 'this avatar') + '"?' + (n ? '\n\n' + n + ' logged video(s) for this avatar will also be removed.' : ''))) return;
        const { removeItem } = await import('../app.js');
        state.db.entries.filter(e => e.accountId === a.id).forEach(e => removeItem('entries', e.id));
        removeItem('accounts', a.id);
        closeModal();
      }
    }, 'Delete'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    el('button', {
      class: 'btn primary', onclick: async () => {
        if (!a.name.trim()) { err.textContent = 'Give the avatar a name.'; err.style.display = ''; return; }
        a.name = a.name.trim();
        pruneBodyLinks(a);   // drop concepts left blank for this avatar
        const { save } = await import('../app.js');
        save('accounts', a);
        closeModal();
      }
    }, existing ? 'Save changes' : 'Create avatar')));

  state.modal = overlay(existing ? 'Edit avatar' : 'New avatar', body);
  forceEmit();
}

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------
function openProfiles() {
  const body = el('div', { class: 'modal-body' });
  body.appendChild(el('div', { class: 'hint' },
    'The identities your avatars post from. One Facebook profile usually creates many pages; an Instagram profile is one account.'));

  ['facebook', 'instagram'].forEach(platform => {
    const list = state.db.profiles.filter(p => p.platform === platform);
    const col = el('div', { class: 'col', style: 'gap:7px' },
      el('span', { class: 'label' }, platform === 'facebook' ? 'FACEBOOK PROFILES' : 'INSTAGRAM PROFILES'));

    list.forEach(p => {
      const used = state.db.accounts.filter(a =>
        (platform === 'facebook' ? a.facebookProfileId : a.instagramProfileId) === p.id).length;
      col.appendChild(el('div', { class: 'card row', style: 'padding:8px 11px;gap:9px' },
        el('input', {
          class: 'input', style: 'height:30px;font-size:12.5px;flex:1', value: p.name,
          oninput: async e => {
            const { mutateQuiet } = await import('../app.js');
            mutateQuiet('profiles', p.id, x => x.name = e.target.value);
          }
        }),
        el('span', { class: 'hint', style: 'white-space:nowrap' }, used + (used === 1 ? ' avatar' : ' avatars')),
        el('button', {
          class: 'iconbtn danger', title: 'Delete profile', onclick: async () => {
            if (used && !confirm('This profile is attached to ' + used + ' avatar(s). Delete it anyway? They will simply have no profile set.')) return;
            const { removeItem, save } = await import('../app.js');
            const key = platform === 'facebook' ? 'facebookProfileId' : 'instagramProfileId';
            state.db.accounts.filter(a => a[key] === p.id).forEach(a => { a[key] = ''; save('accounts', a); });
            removeItem('profiles', p.id);
            openProfiles();
          }
        }, '✕')));
    });
    if (!list.length) col.appendChild(el('div', { class: 'hint', style: 'padding:2px 2px 4px' }, 'None yet.'));

    col.appendChild(el('button', {
      class: 'btn small', style: 'align-self:flex-start', onclick: async () => {
        const name = prompt('Name of the new ' + platform + ' profile:');
        if (!name || !name.trim()) return;
        const { save } = await import('../app.js');
        save('profiles', { id: uid('p'), name: name.trim(), platform, createdAt: Date.now() });
        openProfiles();
      }
    }, '+ Add ' + platform + ' profile'));

    body.appendChild(col);
  });

  body.appendChild(el('div', { class: 'row', style: 'padding-top:4px' },
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: closeModal }, 'Done')));

  state.modal = overlay('Profiles', body);
  forceEmit();
}

// Products are a shared list, so several avatars promoting the same thing stay
// in step and a rename updates everywhere. New ones can be created inline.
function productSelect(current, onset) {
  const list = state.db.products.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const sel = el('select', {
    class: 'input',
    onchange: async e => {
      if (e.target.value === '__new') {
        const name = prompt('Name of the new product:');
        if (!name || !name.trim()) { sel.value = current || ''; return; }
        const { save } = await import('../app.js');
        const p = { id: uid('pr'), name: name.trim(), createdAt: Date.now() };
        save('products', p);
        sel.insertBefore(el('option', { value: p.id }, p.name), sel.lastChild);
        sel.value = p.id; current = p.id; onset(p.id);
        return;
      }
      current = e.target.value; onset(e.target.value);
    }
  },
    [el('option', { value: '' }, 'No product')]
      .concat(list.map(p => el('option', { value: p.id }, p.name)))
      .concat([el('option', { value: '__new' }, '+ New product…')]));
  sel.value = current || '';
  return sel;
}

// ---------------------------------------------------------------------------
// concepts + their variations
// ---------------------------------------------------------------------------
function openConcepts() {
  const body = el('div', { class: 'modal-body' });
  body.appendChild(el('div', { class: 'hint' },
    'Concepts are defined once here and picked everywhere else. Variations are the different angles you target — they live inside a concept, so a new angle never means a new concept.'));

  const legacy = discoverLegacyConcepts();
  if (legacy.length) {
    body.appendChild(el('div', { class: 'card col', style: 'gap:9px;border-color:rgba(240,179,65,0.35)' },
      el('b', { style: 'font-size:12.5px;color:#f0c97a' }, 'Import existing concepts'),
      el('div', { class: 'hint' },
        legacy.length + ' concept name' + (legacy.length === 1 ? '' : 's') + ' still stored as plain text: '
        + legacy.map(l => '“' + l.name + '”').join(', ')
        + '. Importing creates them here and repoints the avatars and videos already using them.'),
      el('button', {
        class: 'btn small', style: 'align-self:flex-start', onclick: () => runImport(legacy)
      }, 'Import ' + legacy.length + ' concept' + (legacy.length === 1 ? '' : 's'))));
  }

  const list = sortedConcepts();
  const col = el('div', { class: 'col', style: 'gap:9px' });

  list.forEach(c => {
    const used = state.db.accounts.filter(a => (a.bodyLinks || []).some(r => r.conceptId === c.id)).length;
    const vars = c.variations || [];

    const card = el('div', { class: 'card col', style: 'padding:11px 12px;gap:9px' },
      el('div', { class: 'row', style: 'gap:9px' },
        el('input', {
          class: 'input', style: 'height:31px;font-size:13px;font-weight:700;flex:1', value: c.name,
          oninput: async e => {
            const { mutateQuiet } = await import('../app.js');
            mutateQuiet('concepts', c.id, x => x.name = e.target.value);
          }
        }),
        el('span', { class: 'hint', style: 'white-space:nowrap' }, used + (used === 1 ? ' avatar' : ' avatars')),
        el('button', {
          class: 'iconbtn danger', title: 'Delete concept', onclick: async () => {
            const vids = state.db.dailyEntries.filter(e => e.conceptId === c.id).length;
            if (!confirm('Delete “' + c.name + '”' + (vars.length ? ' and its ' + vars.length + ' variation(s)' : '') + '?'
              + (used || vids ? '\n\n' + used + ' avatar link(s) and ' + vids + ' video(s) reference it and will lose the connection.' : ''))) return;
            const { removeItem } = await import('../app.js');
            removeItem('concepts', c.id);
            openConcepts();
          }
        }, '✕')));

    // variations
    const vwrap = el('div', { class: 'col', style: 'gap:6px;padding-left:11px;border-left:2px solid var(--line2)' });
    vars.forEach(v => {
      vwrap.appendChild(el('div', { class: 'row', style: 'gap:7px' },
        el('input', {
          class: 'input', style: 'height:28px;font-size:12px;flex:1', value: v.label, placeholder: 'Angle…',
          oninput: async e => {
            const { mutateQuiet } = await import('../app.js');
            mutateQuiet('concepts', c.id, x => {
              const t = (x.variations || []).find(y => y.id === v.id); if (t) t.label = e.target.value;
            });
          }
        }),
        el('button', {
          class: 'iconbtn danger', title: 'Remove variation', onclick: async () => {
            const { mutate } = await import('../app.js');
            mutate('concepts', c.id, x => { x.variations = (x.variations || []).filter(y => y.id !== v.id); });
            openConcepts();
          }
        }, '✕')));
    });
    if (!vars.length) vwrap.appendChild(el('span', { class: 'hint' }, 'No variations — this concept is used on its own.'));
    vwrap.appendChild(el('button', {
      class: 'btn small', style: 'align-self:flex-start', onclick: async () => {
        const { mutate } = await import('../app.js');
        mutate('concepts', c.id, x => {
          if (!Array.isArray(x.variations)) x.variations = [];
          x.variations.push({ id: uid('cv'), label: '', note: '' });
        });
        openConcepts();
      }
    }, '+ Add variation'));

    card.appendChild(vwrap);
    col.appendChild(card);
  });

  if (!list.length) col.appendChild(el('div', { class: 'hint' }, 'No concepts yet.'));
  col.appendChild(el('button', {
    class: 'btn small', style: 'align-self:flex-start', onclick: async () => {
      const name = prompt('Name of the new concept:');
      if (!name || !name.trim()) return;
      const { save } = await import('../app.js');
      save('concepts', { id: uid('c'), name: name.trim(), variations: [], createdAt: Date.now() });
      openConcepts();
    }
  }, '+ Add concept'));

  body.appendChild(col);
  body.appendChild(el('div', { class: 'row', style: 'padding-top:4px' },
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: closeModal }, 'Done')));

  state.modal = overlay('Concepts', body);
  forceEmit();
}

// Turn the free-text names into real concepts and repoint everything at them.
async function runImport(legacy) {
  if (!confirm('Create ' + legacy.length + ' concept(s) and repoint the avatars and videos using them?')) return;
  const { save } = await import('../app.js');
  const made = {};

  legacy.forEach(l => {
    const c = { id: uid('c'), name: l.name, variations: [], createdAt: Date.now() };
    made[l.name.trim().toLowerCase()] = c;
    save('concepts', c);
  });
  const find = txt => made[(txt || '').trim().toLowerCase()];

  state.db.accounts.forEach(a => {
    let touched = false;
    (a.bodyLinks || []).forEach(r => {
      if (r.conceptId) return;
      const c = find(r.concept);
      if (c) { r.conceptId = c.id; if (!r.varUrls) r.varUrls = {}; touched = true; }
    });
    if (touched) save('accounts', a);
  });

  state.db.dailyEntries.forEach(e => {
    if (e.conceptId) return;
    const c = find(e.bodyConcept) || find(e.concept);
    if (c) { e.conceptId = c.id; save('dailyEntries', e); }
  });

  openConcepts();
}

function openProducts() {
  const body = el('div', { class: 'modal-body' });
  body.appendChild(el('div', { class: 'hint' },
    'The products your avatars promote. Renaming one here updates every avatar using it.'));

  const list = state.db.products.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const col = el('div', { class: 'col', style: 'gap:7px' });

  list.forEach(p => {
    const used = state.db.accounts.filter(a => a.productId === p.id).length;
    const current = productColor(p);

    const preview = el('span', { class: 'chip' }, p.name || 'Untitled');
    const paintPreview = c => preview.style.cssText = 'color:' + c + ';background:' + c + '1f;border-color:' + c + '55';
    paintPreview(current);

    const swatches = el('div', { class: 'row wrap', style: 'gap:6px' }, PRODUCT_COLORS.map(c =>
      el('button', {
        class: 'swatch' + (c.toLowerCase() === current.toLowerCase() ? ' on' : ''),
        style: 'background:' + c, title: c,
        // capture the button BEFORE awaiting — currentTarget is nulled once the
        // handler yields, which silently killed the repaint below
        onclick: async e => {
          const btn = e.currentTarget;
          const { mutate } = await import('../app.js');
          mutate('products', p.id, x => x.color = c);
          swatches.querySelectorAll('.swatch').forEach(s => s.classList.remove('on'));
          btn.classList.add('on');
          paintPreview(c);
        }
      })));

    col.appendChild(el('div', { class: 'card col', style: 'padding:10px 11px;gap:9px' },
      el('div', { class: 'row', style: 'gap:9px' },
        el('input', {
          class: 'input', style: 'height:30px;font-size:12.5px;flex:1', value: p.name,
          oninput: async e => {
            const { mutateQuiet } = await import('../app.js');
            mutateQuiet('products', p.id, x => x.name = e.target.value);
            preview.textContent = e.target.value || 'Untitled';
          }
        }),
        el('span', { class: 'hint', style: 'white-space:nowrap' }, used + (used === 1 ? ' avatar' : ' avatars')),
        el('button', {
          class: 'iconbtn danger', title: 'Delete product', onclick: async () => {
            if (used && !confirm('This product is set on ' + used + ' avatar(s). Delete it anyway? They will simply have no product set.')) return;
            const { removeItem, save } = await import('../app.js');
            state.db.accounts.filter(a => a.productId === p.id).forEach(a => { a.productId = ''; save('accounts', a); });
            removeItem('products', p.id);
            openProducts();
          }
        }, '✕')),
      el('div', { class: 'row wrap', style: 'gap:9px' }, swatches, preview)));
  });
  if (!list.length) col.appendChild(el('div', { class: 'hint' }, 'None yet.'));

  col.appendChild(el('button', {
    class: 'btn small', style: 'align-self:flex-start', onclick: async () => {
      const name = prompt('Name of the new product:');
      if (!name || !name.trim()) return;
      const { save } = await import('../app.js');
      save('products', { id: uid('pr'), name: name.trim(), createdAt: Date.now() });
      openProducts();
    }
  }, '+ Add product'));

  body.appendChild(col);
  body.appendChild(el('div', { class: 'row', style: 'padding-top:4px' },
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: closeModal }, 'Done')));

  state.modal = overlay('Products', body);
  forceEmit();
}

function profileSelect(platform, current, onset) {
  const list = state.db.profiles.filter(p => p.platform === platform);
  const sel = el('select', {
    class: 'input', style: 'width:auto;min-width:170px',
    onchange: async e => {
      if (e.target.value === '__new') {
        const name = prompt('Name of the new ' + platform + ' profile:');
        if (!name || !name.trim()) { sel.value = current || ''; return; }
        const { save } = await import('../app.js');
        const p = { id: uid('p'), name: name.trim(), platform, createdAt: Date.now() };
        save('profiles', p);
        sel.appendChild(el('option', { value: p.id }, p.name));
        sel.value = p.id; current = p.id; onset(p.id);
        return;
      }
      current = e.target.value; onset(e.target.value);
    }
  },
    [el('option', { value: '' }, 'No profile')]
      .concat(list.map(p => el('option', { value: p.id }, p.name)))
      .concat([el('option', { value: '__new' }, '+ New profile…')]));
  sel.value = current || '';
  return sel;
}

// ---------------------------------------------------------------------------
// small shared bits
// ---------------------------------------------------------------------------
function field(label, control) {
  return el('div', { class: 'col', style: 'gap:5px;flex:1;min-width:140px' }, el('span', { class: 'label' }, label), control);
}

function select(pairs, current, onset) {
  const sel = el('select', { class: 'input', style: 'width:auto;min-width:120px', onchange: e => onset(e.target.value) },
    pairs.map(([v, label]) => el('option', { value: v }, label)));
  sel.value = current;
  return sel;
}

export function overlay(title, body) {
  const ov = el('div', {
    class: 'overlay',
    onclick: e => { if (e.target === ov) closeModal(); }
  },
    el('div', { class: 'modal' },
      el('div', { class: 'modal-head' }, title,
        el('button', { class: 'iconbtn', onclick: closeModal }, '✕')),
      body));
  return ov;
}
