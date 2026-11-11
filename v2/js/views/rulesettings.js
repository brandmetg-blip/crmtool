// rulesettings.js — Settings → Rules, and the rule pickers on a page.
//
// Admin only. The rules themselves, which niche each brand is in, and how the
// pages on each rule are doing inside each niche, which is the point of having
// more than one.

import { state, forceEmit, uid } from '../state.js';
import { el } from '../ui.js';
import { sortedStages } from '../stages.js';
import { getPref, setPref } from '../prefs.js';
import { brands, saveBrands } from '../brands.js';
import { isLive, pageStats } from '../lifecycle.js';
import {
  THEN, NONE, rules, saveRules, ruleById, defaultRuleId, ruleOf, describeRule,
  nicheOfBrand, nicheOf, niches, pagesOnRule, suggestedRule,
} from '../rules.js';

const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

export function rulesPanel() {
  const wrap = el('div', { class: 'col', style: 'gap:22px' });
  wrap.appendChild(rulesCard());
  wrap.appendChild(resultsCard());
  wrap.appendChild(nichesCard());
  wrap.appendChild(stagesCard());
  return wrap;
}

// ---------------------------------------------------------------------------
// the rules
// ---------------------------------------------------------------------------
function rulesCard() {
  const list = rules();
  const update = async (id, fn) => {
    await saveRules(rules().map(r => (r.id === id ? fn({ ...r }) : r)));
    forceEmit();
  };

  const row = r => {
    const count = pagesOnRule(r.id).length;
    return el('div', { class: 'rule-row' },
      el('div', { class: 'col', style: 'gap:5px;flex:2;min-width:200px' },
        el('span', { class: 'label' }, 'NAME'),
        el('input', {
          class: 'input', value: r.name || '', placeholder: 'e.g. V1',
          onchange: e => update(r.id, x => { x.name = e.target.value.trim() || x.name; return x; }),
        }),
        el('span', { class: 'hint' }, describeRule(r))),
      el('div', { class: 'col', style: 'gap:5px' },
        el('span', { class: 'label' }, 'FIRST GROWTH'),
        el('input', {
          class: 'input', type: 'number', min: '0', max: '30', value: String(+r.first || 0),
          style: 'width:84px;height:34px;font-weight:800;text-align:center', 'aria-label': 'First growth videos',
          onchange: e => {
            const v = Math.max(0, Math.min(30, Math.round(+e.target.value || 0)));
            update(r.id, x => { x.first = v; return x; });
          },
        }),
        el('span', { class: 'hint' }, '0 = none')),
      el('div', { class: 'col', style: 'gap:5px' },
        el('span', { class: 'label' }, 'THEN'),
        el('div', { class: 'seg mini' }, THEN.map(([k, label]) => el('button', {
          type: 'button', class: (r.then || 'any') === k ? 'on' : '',
          onclick: () => update(r.id, x => { x.then = k; return x; }),
        }, label)))),
      el('div', { class: 'col', style: 'gap:5px' },
        el('span', { class: 'label' }, 'SPLIT TEST'),
        el('div', { class: 'seg mini' }, [[true, 'In test'], [false, 'Out']].map(([v, label]) => el('button', {
          type: 'button', class: !!r.testing === v ? 'on' : '',
          onclick: () => update(r.id, x => { x.testing = v; return x; }),
        }, label)))),
      el('div', { class: 'col', style: 'gap:5px;align-items:flex-end;margin-left:auto' },
        el('span', { class: 'hint' }, plural(count, 'page')),
        el('button', {
          class: 'btn small danger', type: 'button',
          onclick: async () => {
            if (list.length < 2) { alert('Keep at least one rule.'); return; }
            if (!confirm('Delete the rule “' + (r.name || 'Untitled') + '”?'
              + (count ? '\n\nIts ' + plural(count, 'page') + ' move to the default rule.' : ''))) return;
            const { save } = await import('../app.js');
            (state.db.accounts || []).filter(a => a.ruleId === r.id).forEach(a => { delete a.ruleId; save('accounts', a); });
            const rest = rules().filter(x => x.id !== r.id);
            await saveRules(rest);
            if (getPref('defaultRule') === r.id) await setPref('defaultRule', rest[0].id);
            forceEmit();
          },
        }, 'Delete')));
  };

  const def = el('select', {
    class: 'input', style: 'width:auto;min-width:220px;height:34px', 'aria-label': 'Default rule',
    onchange: async e => { await setPref('defaultRule', e.target.value); forceEmit(); },
  }, list.map(r => el('option', { value: r.id }, r.name || 'Untitled')).concat([el('option', { value: NONE }, 'No rule')]));
  def.value = defaultRuleId();

  return el('div', { class: 'card col', style: 'gap:14px' },
    el('div', null,
      el('b', { style: 'font-size:14px' }, 'Rules'),
      el('div', { class: 'hint' },
        'How a page’s videos go: how many growth videos it starts with, one a day, and what it takes after. '
        + 'Each page has its own, picked as the last step of onboarding or under Edit avatar. Only you see them. '
        + 'Daily Builder holds back videos a page’s rule does not allow, and you can still add one after confirming.')),
    el('div', { class: 'col', style: 'gap:10px' }, list.map(row)),
    el('div', { class: 'row wrap', style: 'gap:12px' },
      el('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          await saveRules(rules().concat([{ id: uid('r'), name: 'New rule', first: 3, then: 'any', testing: false }]));
          forceEmit();
        },
      }, '+ Add rule'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'label' }, 'PAGES WITH NO RULE PICKED FOLLOW'),
      def));
}

// ---------------------------------------------------------------------------
// how each rule is doing, niche by niche
// ---------------------------------------------------------------------------
function resultsCard() {
  const groups = niches().concat(['']);
  const card = el('div', { class: 'card col', style: 'gap:14px' },
    el('div', null,
      el('b', { style: 'font-size:14px' }, 'Split test'),
      el('div', { class: 'hint' },
        'Pages on each rule, compared inside their niche. Winners are the videos starred in Daily Builder. '
        + 'Days count from when the page went live.')));

  let any = false;
  groups.forEach(niche => {
    const ids = [...new Set((state.db.accounts || []).filter(a => !a.onboarding && nicheOf(a) === niche)
      .map(a => (ruleOf(a) || { id: NONE }).id))];
    if (!ids.length) return;
    any = true;
    const rows = ids.map(id => {
      const pages = pagesOnRule(id, niche);
      const s = pages.map(pageStats);
      const days = s.filter(x => x.days != null);
      const posted = s.reduce((n, x) => n + x.posted, 0);
      const wins = s.reduce((n, x) => n + x.wins, 0);
      const r = ruleById(id);
      return [
        el('td', null, el('b', null, r ? r.name || 'Untitled' : 'No rule'),
          r && r.testing ? el('span', { class: 'chip blue', style: 'margin-left:8px' }, 'In test') : null),
        el('td', null, String(pages.length)),
        el('td', null, String(pages.filter(isLive).length)),
        el('td', null, days.length ? String(Math.round(days.reduce((n, x) => n + x.days, 0) / days.length)) : '–'),
        el('td', null, String(posted)),
        el('td', null, String(wins)),
        el('td', null, posted ? (Math.round(wins / posted * 1000) / 10) + '%' : '–'),
      ];
    });
    card.appendChild(el('div', { class: 'col', style: 'gap:8px' },
      el('b', { style: 'font-size:13px' }, niche || 'No niche'),
      el('div', { class: 'rule-table-wrap' },
        el('table', { class: 'rule-table' },
          el('thead', null, el('tr', null, ['Rule', 'Pages', 'Still live', 'Avg days', 'Posted', 'Winners', 'Win rate'].map(t => el('th', null, t)))),
          el('tbody', null, rows.map(cells => el('tr', null, cells)))))));
  });
  if (!any) card.appendChild(el('div', { class: 'hint' }, 'No pages yet.'));
  return card;
}

// ---------------------------------------------------------------------------
// niches
// ---------------------------------------------------------------------------
function nichesCard() {
  const known = niches();
  const list = el('datalist', { id: 'niche-list' }, known.map(n => el('option', { value: n })));
  return el('div', { class: 'card col', style: 'gap:12px' },
    el('div', null,
      el('b', { style: 'font-size:14px' }, 'Niches'),
      el('div', { class: 'hint' }, 'Brands that sell the same kind of thing, so a test compares like with like. Type a niche, or pick one already used.')),
    list,
    el('div', { class: 'rule-niches' }, brands().map(b => el('label', { class: 'rule-niche' },
      el('b', null, b.name || 'Untitled'),
      el('input', {
        class: 'input', list: 'niche-list', value: nicheOfBrand(b), placeholder: 'No niche',
        onchange: async e => {
          await saveBrands(brands().map(x => (x.id === b.id ? { ...x, niche: e.target.value.trim() } : x)));
          forceEmit();
        },
      })))));
}

// ---------------------------------------------------------------------------
// the two stages a page moves between
// ---------------------------------------------------------------------------
function stagesCard() {
  const pick = (key, label, hint, auto) => {
    const sel = el('select', {
      class: 'input', style: 'height:34px',
      onchange: async e => { await setPref(key, e.target.value); forceEmit(); },
    }, [el('option', { value: '' }, auto)].concat(sortedStages().map(s => el('option', { value: s.id }, s.name || 'Untitled'))));
    sel.value = getPref(key) || '';
    return el('div', { class: 'col', style: 'gap:5px;flex:1;min-width:200px' },
      el('span', { class: 'label' }, label), sel, el('span', { class: 'hint' }, hint));
  };
  return el('div', { class: 'card col', style: 'gap:12px' },
    el('div', null,
      el('b', { style: 'font-size:14px' }, 'Stages'),
      el('div', { class: 'hint' }, 'A new page starts in one stage and moves on by itself once it has its first growth videos.')),
    el('div', { class: 'row wrap', style: 'gap:20px;align-items:flex-start' },
      pick('rampGrowthStage', 'STARTS IN STAGE', 'Where a new page begins.', 'First on the list'),
      pick('rampCtaStage', 'MOVES TO STAGE', 'Where it goes after its first growth videos.', 'Second on the list')));
}

// ---------------------------------------------------------------------------
// on a page
// ---------------------------------------------------------------------------
// For Edit avatar: '' follows the default rule.
export function ruleField(a) {
  const d = ruleById(defaultRuleId());
  const note = el('span', { class: 'hint' });
  const paint = () => { note.textContent = describeRule(ruleOf(a)); };
  const sel = el('select', {
    class: 'input', style: 'width:auto;min-width:200px', 'aria-label': 'Rule',
    onchange: e => { if (e.target.value) a.ruleId = e.target.value; else delete a.ruleId; paint(); },
  }, [el('option', { value: '' }, 'Default (' + (d ? d.name : 'no rule') + ')')]
    .concat(rules().map(r => el('option', { value: r.id }, r.name || 'Untitled')))
    .concat([el('option', { value: NONE }, 'No rule')]));
  sel.value = a.ruleId && (a.ruleId === NONE || ruleById(a.ruleId)) ? a.ruleId : '';
  paint();
  return el('div', { class: 'col', style: 'gap:5px' },
    el('span', { class: 'label' }, 'RULE'), sel, note,
    el('span', { class: 'hint' }, 'Only you see this. Niche: ' + (nicheOf(a) || 'none, set it under Settings → Rules') + '.'));
}

// For the last step of onboarding: one card per rule, with the suggestion marked.
export function ruleChoices(a, change) {
  const box = el('div', { class: 'col', style: 'gap:10px' });
  const niche = nicheOf(a);
  const paint = () => {
    box.innerHTML = '';
    const suggested = suggestedRule(a);
    const current = a.ruleId || suggested;   // saved as the page is added
    const option = (id, name, line) => {
      const count = pagesOnRule(id, niche).filter(p => p.id !== a.id).length;
      return el('button', {
        type: 'button', class: 'card rule-choice' + (current === id ? ' on' : ''), 'aria-pressed': String(current === id),
        onclick: () => { change(x => { x.ruleId = id; }); paint(); },
      },
        el('span', { class: 'row', style: 'gap:8px' },
          el('b', null, name),
          id === suggested ? el('span', { class: 'chip green' }, 'Suggested') : null,
          el('span', { class: 'spacer' }),
          el('span', { class: 'hint' }, plural(count, 'page') + (niche ? ' in ' + niche : ''))),
        el('span', { class: 'hint' }, line));
    };
    rules().forEach(r => box.appendChild(option(r.id, r.name || 'Untitled', describeRule(r))));
    box.appendChild(option(NONE, 'No rule', describeRule(null)));
  };
  paint();
  return el('div', { class: 'card col wiz-form' },
    el('span', { class: 'hint' }, niche
      ? 'Niche: ' + niche + '. Suggested is the rule under test with the fewest pages in it, so each version gets its share.'
      : 'This page’s brand has no niche yet. Set one under Settings → Rules to compare like with like.'),
    box);
}
