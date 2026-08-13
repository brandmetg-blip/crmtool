// accounts.js — the avatars. Every account is one avatar/persona posting on
// Facebook + Instagram. Admins and managers create and edit them; everyone
// else sees the ones assigned to them, read-only.
//
// Profiles (the named FB/IG identities an avatar posts from) are managed here
// too, because they only ever exist to be attached to an avatar.

import { state, emit, forceEmit, uid, byId, can, myAccounts } from '../state.js';
import { el, avatar } from '../ui.js';

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
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (!shown.length) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      all.length ? 'No avatars match these filters.'
        : canEdit ? 'No avatars yet — add the first one.' : 'No avatars assigned to you yet — ask an admin.'));
    return;
  }
  root.appendChild(el('div', { class: 'grid' }, shown.map(a => card(a, canEdit))));
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
    wrap.appendChild(el('button', { class: 'btn', onclick: openProfiles }, 'Profiles'));
    wrap.appendChild(el('button', { class: 'btn primary', onclick: () => openAccount(null) }, '+ New avatar'));
  }
  return wrap;
}

function filters(all) {
  const fbProfiles = state.db.profiles.filter(p => p.platform === 'facebook');
  const row = el('div', { class: 'row wrap', style: 'margin-bottom:16px' },
    el('div', { class: 'seg' }, [['all', 'All']].concat(STATUSES.map(s => [s[0], s[0]])).map(([k, label]) =>
      el('button', {
        class: state.acctStatus === k ? 'on' : '',
        onclick: () => { state.acctStatus = k; forceEmit(); }
      }, label))));

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

  // ---- pre-made bodies, one Drive folder per concept --------------------------
  // Concepts are whatever you type in the Daily Builder, so these are free text
  // rather than a fixed list — the label just has to match how the team says it.
  const bodies = el('div', { class: 'col', style: 'gap:7px' });
  function paintBodies() {
    bodies.innerHTML = '';
    bodies.appendChild(el('span', { class: 'label' }, 'BODIES BY CONCEPT'));
    bodies.appendChild(el('span', { class: 'hint' },
      'A link to this character’s pre-made bodies for each concept. Editors see them as buttons under Assets.'));

    a.bodyLinks.forEach(b => {
      bodies.appendChild(el('div', { class: 'row wrap', style: 'gap:7px' },
        el('input', {
          class: 'input', style: 'flex:0 0 150px;height:32px;font-size:12px', value: b.concept || '',
          placeholder: 'Concept…', oninput: e => b.concept = e.target.value
        }),
        el('input', {
          class: 'input', style: 'flex:1;min-width:170px;height:32px;font-size:12px', value: b.url || '',
          placeholder: 'Drive folder link…', oninput: e => b.url = e.target.value
        }),
        el('button', {
          class: 'iconbtn danger', title: 'Remove this concept',
          onclick: () => { a.bodyLinks = a.bodyLinks.filter(x => x.id !== b.id); paintBodies(); }
        }, '✕')));
    });

    if (!a.bodyLinks.length) bodies.appendChild(el('span', { class: 'hint' }, 'None yet.'));
    bodies.appendChild(el('button', {
      class: 'btn small', style: 'align-self:flex-start',
      onclick: () => { a.bodyLinks.push({ id: uid('bl'), concept: '', url: '' }); paintBodies(); }
    }, '+ Add concept'));
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
        // drop rows the user added but never filled in
        a.bodyLinks = a.bodyLinks
          .filter(b => (b.concept || '').trim() || (b.url || '').trim())
          .map(b => ({ ...b, concept: (b.concept || '').trim(), url: (b.url || '').trim() }));
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
