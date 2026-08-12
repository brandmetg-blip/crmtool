// login.js — the sign-in screen. There is no sign-up: you are either the admin
// set in config.js, or someone the admin added under Team.

import { state, forceEmit } from '../state.js';
import { el } from '../ui.js';

// The sign-in screens are rendered before app.js finishes wiring the shell, so
// the mark is built here rather than imported (which would be circular).
function mark() {
  return el('div', { class: 'brand', style: 'margin-bottom:2px' },
    el('img', { class: 'brand-logo', src: './logo.png', alt: '', style: 'width:34px;height:34px' }),
    el('div', { class: 'brand-text' },
      el('b', { style: 'font-size:15px' }, 'Remote Commerce'),
      el('small', null, 'CONTENT OPS')));
}

export function renderLogin() {
  let email = '', pw = '';
  const err = state.loginError ? el('div', { class: 'error' }, state.loginError) : null;
  return el('div', { class: 'login-wrap' },
    el('form', {
      class: 'card login-card col', style: 'gap:14px;padding:24px',
      onsubmit: async e => {
        e.preventDefault();
        const { store } = await import('../app.js');
        const res = await store.signIn(email, pw);
        if (res.error) { state.loginError = res.error; forceEmit(); return; }
        state.loginError = null;
        if (res.db) state.db = res.db;                 // cloud mode could only read once signed in
        state.user = res.user; state.route = 'builder'; forceEmit();
      }
    },
      mark(),
      el('div', { class: 'hint' }, 'Sign in with your team account.'),
      err,
      el('div', { class: 'col', style: 'gap:5px' }, el('span', { class: 'label' }, 'EMAIL'),
        el('input', { class: 'input', type: 'email', autocomplete: 'username', oninput: e => email = e.target.value })),
      el('div', { class: 'col', style: 'gap:5px' }, el('span', { class: 'label' }, 'PASSWORD'),
        el('input', { class: 'input', type: 'password', autocomplete: 'current-password', oninput: e => pw = e.target.value })),
      el('button', { class: 'btn primary', type: 'submit', style: 'height:42px;justify-content:center' }, 'Sign in')));
}
