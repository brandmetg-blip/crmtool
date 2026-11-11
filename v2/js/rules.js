// rules.js — how a page's videos go, so different ways of growing a page can be
// tested against each other.
//
// A rule says two things: how many growth videos a page starts with (one a day,
// none at all is allowed), and what it takes after those:
//
//   any   any video
//   mix   one CTA and one growth a day
//   cta   CTA only
//
// Each page carries its own rule. A page with none set follows the default rule.
// Brands are grouped into niches (skincare, gut health…) so a test compares pages
// that sell the same kind of thing. Rules are the admin's own: nobody else sees
// which rule a page is on.

import { state, byId } from './state.js';
import { getPref, setPref } from './prefs.js';
import { brands, pageBrand } from './brands.js';

export const THEN = [
  ['any', 'Any video'],
  ['mix', '1 CTA + 1 growth a day'],
  ['cta', 'CTA only'],
];
export const NONE = 'none';     // a page set to follow no rule at all

export function rules() {
  const list = getPref('rules');
  if (Array.isArray(list)) return list;
  const n = Math.max(1, Math.round(+getPref('firstVideosCount') || 3));
  return [
    { id: 'r-standard', name: 'Standard', first: n, then: 'any', testing: false },
    { id: 'r-v1', name: 'V1 · Growth first, then mix', first: 3, then: 'mix', testing: true },
    { id: 'r-v2', name: 'V2 · Growth first, then CTA', first: 3, then: 'cta', testing: true },
    { id: 'r-v2-cta', name: 'V2 · CTA from the start', first: 0, then: 'cta', testing: true },
  ];
}
export const saveRules = list => setPref('rules', list);
export const ruleById = id => byId(rules(), id);

// Before rules existed the first videos rule could be switched off, which is the
// same as defaulting to no rule.
export function defaultRuleId() {
  const set = getPref('defaultRule');
  if (set === NONE || ruleById(set)) return set;
  return getPref('firstVideosOn') === false ? NONE : (rules()[0] || {}).id || NONE;
}

export function ruleOf(a) {
  if (!a) return null;
  const id = a.ruleId === NONE || ruleById(a.ruleId) ? a.ruleId : defaultRuleId();
  return id === NONE ? null : ruleById(id) || null;
}

// What the rule does, in one line.
export function describeRule(r) {
  if (!r) return 'No rule: the page takes any video.';
  const then = { any: 'any video', mix: '1 CTA and 1 growth a day', cta: 'CTA only' }[r.then] || 'any video';
  const n = Math.max(0, +r.first || 0);
  return n
    ? 'First ' + n + ' video' + (n === 1 ? '' : 's') + ' growth, one a day, then ' + then + '.'
    : (r.then === 'any' ? 'Any video from the start.' : 'From the start: ' + then + '.');
}

// ---------------------------------------------------------------------------
// niches
// ---------------------------------------------------------------------------
const STARTING_NICHE = { 'b-jiyu': 'Skincare', 'b-pura': 'Gut health', 'b-serene': 'Gut health' };

export function nicheOfBrand(b) {
  if (!b) return '';
  return (b.niche !== undefined ? b.niche : STARTING_NICHE[b.id] || '').trim();
}
export function nicheOf(a) {
  return nicheOfBrand(pageBrand(a));
}
export function niches() {
  return [...new Set(brands().map(nicheOfBrand).filter(Boolean))].sort((x, y) => x.localeCompare(y));
}

// The pages that count in a test: anything past onboarding.
const runningPages = () => (state.db.accounts || []).filter(a => !a.onboarding);

export function pagesOnRule(ruleId, niche) {
  return runningPages().filter(a => {
    const r = ruleOf(a);
    return (r ? r.id : NONE) === ruleId && (niche === undefined || nicheOf(a) === niche);
  });
}

// For a new page: the rule under test with the fewest pages in its niche, so
// every version gets its share. With nothing under test, the default.
export function suggestedRule(a) {
  const testing = rules().filter(r => r.testing);
  if (!testing.length) return defaultRuleId();
  const niche = nicheOf(a);
  const count = r => pagesOnRule(r.id, niche).filter(p => p.id !== (a && a.id)).length;
  return testing.slice().sort((x, y) => count(x) - count(y))[0].id;
}
