// prefs.js — workspace-wide settings, shared by everyone.
//
// One row, id 'workspace', holding whatever the team has configured. Kept as a
// single record rather than a field per table so a new setting costs nothing.

import { state } from './state.js';

const ROW = 'workspace';

export const DEFAULTS = {
  rosterTarget: 10,     // how many pages should be live at once
  reviewAfterDays: 30,  // runway before a page with no winners is worth a decision
  sheetColumns: [],     // extra columns on the avatar sheet
};

export function prefs() {
  const row = (state.db.settings || []).find(r => r.id === ROW);
  return Object.assign({}, DEFAULTS, (row && row.data) || row || {});
}

export function getPref(key) {
  const v = prefs()[key];
  return v === undefined ? DEFAULTS[key] : v;
}

export async function setPref(key, value) {
  const { save } = await import('./app.js');
  const existing = (state.db.settings || []).find(r => r.id === ROW);
  const next = Object.assign({ id: ROW }, existing || {}, { [key]: value });
  save('settings', next);
}
