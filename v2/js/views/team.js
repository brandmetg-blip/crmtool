// team.js — who can sign in, what they are allowed to do, and (for editors)
// which avatars they are responsible for. Admin only.

import { state, forceEmit, uid, ROLES, roleLabel, can, PERMISSIONS } from '../state.js';
import { el, avatar } from '../ui.js';
import { overlay } from './accounts.js';
import { isAdminEmail } from '../store.js';
import { MODE } from '../config.js';

const ROLE_NOTE = {
  admin: 'Everything — scripts, avatars, the team.',
  manager: 'Sees everything — every avatar, every video, the analytics — and can change none of it.',
  editor: 'Read-only. Copies the script and logs their finished video link. Sees only what is assigned to them.',
};
const ROLE_CHIP = { admin: 'green', manager: 'violet', editor: 'blue' };

export function renderTeam(root) {
  if (!can.manageTeam(state.user)) {
    root.appendChild(el('div', { class: 'card', style: 'text-align:center;color:var(--dim);padding:34px' },
      'Only an admin can manage the team.'));
    return;
  }

  const members = state.db.team.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const head = el('div', { class: 'page-head' },
    el('div', null, el('h1', null, 'Team'), el('div', { class: 'sub' }, members.length + (members.length === 1 ? ' member' : ' members'))),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: () => openMember(null) }, '+ Add member'));
  import('../app.js').then(({ statusPill }) => head.insertBefore(statusPill(), head.lastChild));
  root.appendChild(head);

  if (MODE === 'supabase') {
    root.appendChild(el('div', { class: 'card', style: 'margin-bottom:16px;padding:12px 14px' },
      el('div', { class: 'hint' },
        'Adding someone here gives them a role and assignments. They also need a login: create them in Supabase → Authentication → Users with the same email address.')));
  }

  // The admin comes from config.js, not the database — shown, never editable.
  const me = state.user;
  root.appendChild(el('div', { class: 'card row', style: 'margin-bottom:14px;gap:11px' },
    avatar(me, 40),
    el('div', { style: 'min-width:0;flex:1' },
      el('b', { style: 'display:block' }, me.name, ' (you)'),
      el('span', { class: 'hint', style: 'word-break:break-all' }, me.email)),
    el('span', { class: 'chip green' }, 'Admin'),
    el('span', { class: 'hint' }, 'set in config.js')));

  root.appendChild(el('div', { class: 'grid' }, members.map(m => {
    const assigned = (m.assignments || []).length;
    return el('div', { class: 'card click col', style: 'gap:11px', onclick: () => openMember(m) },
      el('div', { class: 'row' },
        avatar(m, 40),
        el('div', { style: 'min-width:0;flex:1' },
          el('b', { style: 'display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' },
            m.name || 'Unnamed'),
          el('span', { class: 'hint', style: 'word-break:break-all' }, m.email || 'no email')),
        el('span', { class: 'chip ' + (ROLE_CHIP[m.role] || 'gray') }, roleLabel(m.role))),
      // The role's description only holds while the role is all they have.
      // Printing "sees only what is assigned to them" above a granted "See
      // every page" chip states the opposite of what is true.
      el('div', { class: 'hint' },
        assigned ? assigned + (assigned === 1 ? ' avatar assigned' : ' avatars assigned')
          : extraPerms(m).length ? 'Their role, widened by what is granted below.'
            : ROLE_NOTE[m.role] || ''),
      // what this person can do beyond their role, at a glance
      extraPerms(m).length
        ? el('div', { class: 'row wrap', style: 'gap:5px' },
          extraPerms(m).map(p => el('span', { class: 'chip green' }, p)))
        : null);
  })));
}

// Only what was granted on top of the role — a chip for something the role
// already includes would say nothing.
function extraPerms(m) {
  return PERMISSIONS
    .filter(([key]) => !roleGrants(m.role, key) && m.perms && m.perms[key])
    .map(([, label]) => label);
}

function closeModal() { state.modal = null; forceEmit(); }

// `draft` carries the in-progress edits when the modal repaints itself after a
// permission toggle, so nothing typed is lost.
function openMember(existing, draft) {
  const m = draft || (existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid('t'), name: '', email: '', role: 'editor', password: '', assignments: [], perms: {}, createdAt: Date.now() });
  if (!Array.isArray(m.assignments)) m.assignments = [];
  if (!m.perms) m.perms = {};

  const body = el('div', { class: 'modal-body' });
  const err = el('div', { class: 'error', style: 'display:none' });

  body.appendChild(fieldRow('NAME', el('input', {
    class: 'input', value: m.name, placeholder: 'Full name', oninput: e => m.name = e.target.value
  })));
  body.appendChild(fieldRow('EMAIL', el('input', {
    class: 'input', type: 'email', value: m.email, placeholder: 'name@company.com',
    oninput: e => m.email = e.target.value
  })));

  // role + the explanation of what it means, live
  const note = el('div', { class: 'hint' }, ROLE_NOTE[m.role] || '');
  const assignWrap = el('div', { class: 'col', style: 'gap:7px' });
  const roleSel = el('select', {
    class: 'input', onchange: e => {
      m.role = e.target.value;
      note.textContent = ROLE_NOTE[m.role] || '';
      renderAssignments();
    }
  }, ROLES.map(([v, label]) => el('option', { value: v }, label)));
  roleSel.value = m.role;
  body.appendChild(el('div', { class: 'col', style: 'gap:5px' }, el('span', { class: 'label' }, 'ROLE'), roleSel, note));

  // local mode has no real auth, so the password lives on the record
  if (MODE !== 'supabase') {
    body.appendChild(fieldRow(existing ? 'PASSWORD (leave blank to keep)' : 'PASSWORD', el('input', {
      class: 'input', type: 'password', placeholder: '••••••••',
      oninput: e => m._newPassword = e.target.value
    })));
  }

  // assignments — for anyone who can be handed a video (editors and managers)
  function renderAssignments() {
    assignWrap.innerHTML = '';
    if (m.role !== 'editor' && m.role !== 'manager') return;
    assignWrap.appendChild(el('span', { class: 'label' }, 'ASSIGNED AVATARS'));
    const accounts = state.db.accounts.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (!accounts.length) {
      assignWrap.appendChild(el('div', { class: 'hint' }, 'No avatars exist yet — create them under Avatars first.'));
      return;
    }
    assignWrap.appendChild(el('div', { class: 'row wrap', style: 'gap:7px' },
      el('button', { class: 'btn small', onclick: () => { m.assignments = accounts.map(a => a.id); renderAssignments(); } }, 'Select all'),
      el('button', { class: 'btn small', onclick: () => { m.assignments = []; renderAssignments(); } }, 'Clear')));
    accounts.forEach(a => {
      const on = m.assignments.includes(a.id);
      assignWrap.appendChild(el('div', {
        class: 'card row', style: 'padding:7px 10px;gap:9px;cursor:pointer' + (on ? ';border-color:rgba(52,224,138,0.3)' : ''),
        onclick: () => {
          m.assignments = on ? m.assignments.filter(x => x !== a.id) : m.assignments.concat([a.id]);
          renderAssignments();
        }
      },
        el('span', { class: 'check' + (on ? ' on' : '') }, on ? '✓' : ''),
        avatar(a, 26),
        el('span', { style: 'font-size:12.5px;font-weight:600' }, a.name || 'Untitled')));
    });
  }
  renderAssignments();
  body.appendChild(assignWrap);

  // Extra permissions on top of the role — how you let one person do more
  // without making them an admin.
  const permWrap = el('div', { class: 'col', style: 'gap:7px' },
    el('span', { class: 'label' }, 'EXTRA PERMISSIONS'),
    el('span', { class: 'hint' },
      'Their role already covers the usual work. Tick anything extra this person should be able to do.'));

  PERMISSIONS.forEach(([key, label, note]) => {
    const byRole = roleGrants(m.role, key);
    const on = byRole || !!(m.perms && m.perms[key]);
    permWrap.appendChild(el('div', {
      class: 'card row', style: 'padding:8px 11px;gap:10px;align-items:flex-start'
        + (byRole ? ';opacity:.6' : ';cursor:pointer') + (on && !byRole ? ';border-color:rgba(52,224,138,0.3)' : ''),
      onclick: byRole ? null : () => {
        if (!m.perms) m.perms = {};
        if (m.perms[key]) delete m.perms[key]; else m.perms[key] = true;
        openMemberRepaint();
      }
    },
      el('span', { class: 'check' + (on ? ' on' : ''), style: 'margin-top:1px' }, on ? '✓' : ''),
      el('div', { style: 'min-width:0;flex:1' },
        el('b', { style: 'font-size:12.5px;display:block' }, label),
        el('span', { class: 'hint' }, byRole ? 'Included in their role.' : note))));
  });
  body.appendChild(permWrap);
  body.appendChild(err);

  // repaint just this modal in place, keeping whatever is typed in the fields
  function openMemberRepaint() {
    const scroll = body.parentElement ? body.parentElement.scrollTop : 0;
    openMember(existing, m);
    const modal = state.modal && state.modal.querySelector('.modal');
    if (modal) modal.scrollTop = scroll;
  }

  body.appendChild(el('div', { class: 'row', style: 'gap:9px;padding-top:4px' },
    existing && el('button', {
      class: 'btn danger', onclick: async () => {
        if (!confirm('Remove ' + (m.name || 'this member') + ' from the team? They will no longer be able to sign in.')) return;
        const { removeItem } = await import('../app.js');
        removeItem('team', m.id);
        closeModal();
      }
    }, 'Remove'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    el('button', {
      class: 'btn primary', onclick: async () => {
        const fail = validate(m, existing);
        if (fail) { err.textContent = fail; err.style.display = ''; return; }
        m.name = m.name.trim(); m.email = m.email.trim().toLowerCase();
        if (m._newPassword) m.password = m._newPassword;
        delete m._newPassword;
        if (m.role !== 'editor' && m.role !== 'manager') m.assignments = [];
        // drop grants the role already covers, so a role change cannot leave a
        // permission silently attached
        PERMISSIONS.forEach(([key]) => { if (roleGrants(m.role, key)) delete m.perms[key]; });
        const { save } = await import('../app.js');
        save('team', m);
        closeModal();
      }
    }, existing ? 'Save changes' : 'Add member')));

  state.modal = overlay(existing ? 'Edit member' : 'Add team member', body);
  forceEmit();
}

// Which permissions a role already includes, so they show as ticked-and-locked
// rather than as something you could take away here.
function roleGrants(role, key) {
  if (role === 'manager') return ['seesAllAccounts', 'editHooks'].includes(key);
  return false;
}

function validate(m, existing) {
  if (!m.name.trim()) return 'Enter a name.';
  const email = m.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Enter a valid email address.';
  if (isAdminEmail(email)) return 'That is the admin address — it cannot be a team member too.';
  const clash = state.db.team.find(t => (t.email || '').toLowerCase() === email && t.id !== m.id);
  if (clash) return 'Someone on the team already uses that email.';
  if (MODE !== 'supabase' && !existing && !m._newPassword) return 'Set a password for this member.';
  return null;
}

function fieldRow(label, control) {
  return el('div', { class: 'col', style: 'gap:5px' }, el('span', { class: 'label' }, label), control);
}
