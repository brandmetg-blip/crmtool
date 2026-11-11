// flags.js — a country's flag from its name, as LinkTwin writes it ("United
// States", "DR Congo"). Emoji flags don't show on Windows, so the flag is a
// small picture from flagcdn.com.

import { el } from './ui.js';

// Names LinkTwin (or anyone) writes differently from the browser's own list.
const ALIAS = {
  'usa': 'US', 'united states of america': 'US', 'uk': 'GB', 'great britain': 'GB', 'england': 'GB',
  'dr congo': 'CD', 'democratic republic of the congo': 'CD', 'congo - kinshasa': 'CD',
  'congo': 'CG', 'republic of the congo': 'CG', 'congo - brazzaville': 'CG',
  'ivory coast': 'CI', "cote d'ivoire": 'CI', 'czech republic': 'CZ', 'russia': 'RU',
  'south korea': 'KR', 'korea': 'KR', 'north korea': 'KP', 'turkey': 'TR', 'turkiye': 'TR',
  'vietnam': 'VN', 'laos': 'LA', 'syria': 'SY', 'iran': 'IR', 'bolivia': 'BO', 'venezuela': 'VE',
  'tanzania': 'TZ', 'moldova': 'MD', 'macedonia': 'MK', 'north macedonia': 'MK', 'palestine': 'PS',
  'palestinian territories': 'PS', 'taiwan': 'TW', 'hong kong': 'HK', 'macau': 'MO', 'macao': 'MO',
  'eswatini': 'SZ', 'swaziland': 'SZ', 'cape verde': 'CV', 'myanmar': 'MM', 'burma': 'MM',
  'brunei': 'BN', 'vatican': 'VA', 'vatican city': 'VA', 'micronesia': 'FM', 'bosnia': 'BA',
  'bosnia and herzegovina': 'BA', 'trinidad': 'TT', 'bahamas': 'BS', 'the bahamas': 'BS',
  'gambia': 'GM', 'the gambia': 'GM', 'kosovo': 'XK', 'reunion': 'RE', 'curacao': 'CW',
  'st. lucia': 'LC', 'saint lucia': 'LC', 'st. kitts and nevis': 'KN', 'saint kitts and nevis': 'KN',
  'st. vincent and the grenadines': 'VC', 'saint vincent and the grenadines': 'VC',
  'east timor': 'TL', 'timor-leste': 'TL', 'the netherlands': 'NL', 'holland': 'NL', 'uae': 'AE',
};

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, 'and').replace(/\s+/g, ' ').trim();

// Old or reserved codes the browser still names (UK, East Germany…), which
// would otherwise take a country's name from its real code.
const RETIRED = new Set(['UK', 'DD', 'BU', 'CS', 'FX', 'NT', 'SU', 'TP', 'YD', 'YU', 'ZR', 'AN', 'QO', 'EU', 'EZ', 'UN', 'XA', 'XB']);

let names = null;
function table() {
  if (names) return names;
  names = new Map();
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (RETIRED.has(code)) continue;
      try { const n = dn.of(code); if (n && n !== code && !/unknown/i.test(n)) names.set(norm(n), code); } catch (_) { /* not a region */ }
    }
  } catch (_) { /* old browser: aliases only */ }
  return names;
}

export function countryCode(name) {
  const raw = String(name || '').trim();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  const n = norm(raw);
  return ALIAS[n] || table().get(n) || '';
}

// The flag, or a plain globe mark when the country is unknown.
export function flag(name, cls) {
  const code = countryCode(name);
  if (!code) return el('span', { class: 'flag none' + (cls ? ' ' + cls : ''), title: name || 'Unknown', 'aria-hidden': 'true' });
  return el('img', {
    class: 'flag' + (cls ? ' ' + cls : ''), src: 'https://flagcdn.com/' + code.toLowerCase() + '.svg',
    alt: '', title: name, loading: 'lazy', width: '20', height: '15',
  });
}
