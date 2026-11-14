// ============================================================================
// pagelinks.js — the links and accounts a page runs on, per platform.
//
// Every placement (bio, ManyChat CTA, ...) on every platform has two links, one
// from LinkTwin and one from Lens. Facebook's LinkTwin links stay in
// `a.linktwin`, because captions are built around the caption link there.
// Everything else is in `a.placementLinks[platform][placement][tool]`.
//
// The accounts themselves are in `a.socials[platform]` as { created, url, email }.
// Facebook's created tick is `a.pageCreated`, the same box as on the Avatars
// sheet, and a profile link also fills the handle shown on the page's card.
//
// Used by the onboarding stages and by the avatar editor. `onMutate(fn)` applies
// fn to the account and persists it however the caller persists.
// ============================================================================

import { el } from './ui.js';
import { linktwinComplete } from './captions.js';

const BIO = ['bio', 'Bio'];
const CTA = ['manychatCta', 'ManyChat link (CTA)'];
const GROWTH = ['manychatGrowth', 'ManyChat link (Growth)'];

export const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', required: true, placements: [BIO, CTA, GROWTH] },
  { id: 'facebook', label: 'Facebook', required: true, placements: [BIO, CTA, GROWTH, ['caption', 'Caption']] },
  { id: 'youtube', label: 'YT Shorts', required: false, placements: [BIO] },
  { id: 'threads', label: 'Threads', required: false, placements: [BIO] },
];

const TOOLS = [['linktwin', 'LinkTwin'], ['lens', 'Lens']];

const FB_LINKTWIN = { bio: 'bio', caption: 'caption', manychatCta: 'manychatProduct', manychatGrowth: 'manychatGrowth' };

function linktwinKey(platform, placement, tool) {
  return platform === 'facebook' && tool === 'linktwin' ? FB_LINKTWIN[placement] : null;
}

export function placementLink(a, platform, placement, tool) {
  const key = linktwinKey(platform, placement, tool);
  if (key) return (a.linktwin || {})[key] || '';
  return (((a.placementLinks || {})[platform] || {})[placement] || {})[tool] || '';
}

function setPlacementLink(a, platform, placement, tool, url) {
  const key = linktwinKey(platform, placement, tool);
  if (key) {
    a.linktwin = Object.assign({}, a.linktwin, { [key]: url });
    a.linkCreated = linktwinComplete(a);
    return;
  }
  const all = a.placementLinks || (a.placementLinks = {});
  const p = all[platform] || (all[platform] = {});
  p[placement] = Object.assign({}, p[placement], { [tool]: url });
}

// How many required links are still empty. YT Shorts and Threads are optional,
// so their links are too.
export function missingLinks(a) {
  let n = 0;
  PLATFORMS.filter(p => p.required).forEach(p => p.placements.forEach(([id]) => TOOLS.forEach(([tool]) => {
    if (!placementLink(a, p.id, id, tool).trim()) n++;
  })));
  return n;
}

export function linkFieldsInto(container, a, onMutate, afterCaptionLink) {
  container.innerHTML = '';
  PLATFORMS.forEach(p => {
    container.appendChild(el('div', { class: 'links-plat' },
      el('div', { class: 'links-row links-head' },
        el('b', null, p.label, p.required ? null : el('span', { class: 'hint' }, ' · optional')),
        TOOLS.map(([, label]) => el('span', { class: 'label' }, label.toUpperCase()))),
      p.placements.map(([id, label]) => el('div', { class: 'links-row' },
        el('span', { class: 'links-name' }, label),
        TOOLS.map(([tool, toolLabel]) => el('input', {
          class: 'input', value: placementLink(a, p.id, id, tool),
          placeholder: toolLabel + ' link…', 'aria-label': p.label + ' ' + label + ' ' + toolLabel + ' link',
          oninput: e => {
            onMutate(x => setPlacementLink(x, p.id, id, tool, e.target.value));
            if (p.id === 'facebook' && id === 'caption' && tool === 'linktwin' && afterCaptionLink) afterCaptionLink();
          },
        }))))));
  });
}

// ---------------------------------------------------------------------------
// the accounts
// ---------------------------------------------------------------------------
export function social(a, platform) {
  return (a.socials || {})[platform] || {};
}

export function accountCreated(a, platform) {
  return platform === 'facebook' ? !!a.pageCreated : !!social(a, platform).created;
}

// Small marks for each platform, lit when its account exists, faint when not.
const ICONS = {
  facebook: '<path fill="currentColor" d="M13.6 21v-7.2h2.5l.4-2.9h-2.9V9.1c0-.8.3-1.4 1.4-1.4h1.6V5.1c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.1H8v2.9h2.5V21z"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/>',
  youtube: '<path fill="currentColor" fill-rule="evenodd" d="M6.5 5.5h11a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-11a4 4 0 0 1-4-4v-5a4 4 0 0 1 4-4zM10 9v6l5.2-3z"/>',
  threads: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.4"/><path d="M15.4 12v1.3a2.4 2.4 0 0 0 4.8 0V12a8.2 8.2 0 1 0-3.3 6.6"/></g>',
};

export function accountIcons(a) {
  return el('span', { class: 'plat-icons' }, PLATFORMS.map(p => {
    const on = accountCreated(a, p.id);
    return el('span', {
      class: 'plat-icon' + (on ? ' on' : ''), title: p.label + (on ? ': account made' : ': no account yet'),
      'aria-label': p.label + (on ? ' account made' : ' no account yet'),
      html: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' + ICONS[p.id] + '</svg>',
    });
  }));
}

function setSocial(a, platform, patch) {
  a.socials = Object.assign({}, a.socials, { [platform]: Object.assign({}, social(a, platform), patch) });
}

// facebook.com/serenewellness -> serenewellness, so a pasted profile link still
// reads as a handle on the page's card. Not a link: kept as it was typed.
function handleFrom(url) {
  const v = (url || '').trim();
  if (!/^https?:\/\//i.test(v)) return v;
  try {
    const u = new URL(v);
    return u.searchParams.get('id') || u.pathname.split('/').filter(Boolean).pop() || v;
  } catch (err) {
    return v;
  }
}

function setProfileLink(a, platform, url) {
  setSocial(a, platform, { url });
  if (platform !== 'facebook' && platform !== 'instagram') return;
  a.platforms = Object.assign({}, a.platforms, { [platform]: handleFrom(url) });
}

// The required details still missing, as words for the "still to do" line.
export function missingAccounts(a) {
  const out = [];
  PLATFORMS.filter(p => p.required).forEach(p => {
    if (!accountCreated(a, p.id)) out.push(p.label + ' account created');
    if (!(social(a, p.id).url || '').trim()) out.push(p.label + ' profile link');
  });
  if (!a.facebookProfileId) out.push('Facebook main account');
  if (!(social(a, 'instagram').email || '').trim()) out.push('Instagram email');
  return out;
}

// `mainAccount` is the control for the Facebook main account. The avatar editor
// already has one elsewhere on its form, so it passes nothing.
export function accountFieldsInto(container, a, onMutate, mainAccount) {
  container.innerHTML = '';
  PLATFORMS.forEach(p => {
    const tick = el('button', { class: 'cbox', type: 'button', 'aria-pressed': 'false' });
    const paintTick = () => {
      const on = accountCreated(a, p.id);
      tick.className = 'cbox' + (on ? ' on' : '');
      tick.setAttribute('aria-pressed', String(on));
      tick.innerHTML = '';
      tick.appendChild(el('span', { class: 'bx' }, on ? '✓' : ''));
      tick.appendChild(document.createTextNode('Account created'));
    };
    tick.onclick = () => {
      const next = !accountCreated(a, p.id);
      onMutate(x => {
        if (p.id === 'facebook') x.pageCreated = next;
        else setSocial(x, p.id, { created: next });
      });
      paintTick();
    };
    paintTick();

    const extra = field => el('div', { class: 'col', style: 'gap:4px;flex:1;min-width:200px' }, field);
    container.appendChild(el('div', { class: 'acct-plat' },
      el('div', { class: 'row wrap', style: 'gap:10px' },
        el('b', null, p.label, p.required ? null : el('span', { class: 'hint' }, ' · optional')),
        el('span', { class: 'spacer' }),
        tick),
      el('div', { class: 'row wrap', style: 'gap:10px' },
        extra([el('span', { class: 'label' }, 'PROFILE LINK'), el('input', {
          class: 'input', value: social(a, p.id).url || '', placeholder: 'https://…',
          oninput: e => onMutate(x => setProfileLink(x, p.id, e.target.value)),
        })]),
        p.id === 'facebook' && mainAccount
          ? extra([el('span', { class: 'label' }, 'MAIN ACCOUNT THE PAGE IS ON'), mainAccount])
          : null,
        p.id === 'instagram'
          ? extra([el('span', { class: 'label' }, 'EMAIL THE ACCOUNT IS ON'), el('input', {
            class: 'input', type: 'email', value: social(a, p.id).email || '', placeholder: 'name@example.com',
            oninput: e => onMutate(x => setSocial(x, p.id, { email: e.target.value })),
          })])
          : null)));
  });
}
