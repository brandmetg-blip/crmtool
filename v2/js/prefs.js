// prefs.js — workspace-wide settings, shared by everyone.
//
// One row, id 'workspace', holding whatever the team has configured. Kept as a
// single record rather than a field per table so a new setting costs nothing.

import { state } from './state.js';

const ROW = 'workspace';

export const DEFAULTS = {
  sheetColumns: [],     // extra columns on the avatar sheet
  brands: null,         // the brand list once edited; null = the built-in five
  firstVideosOn: true,  // every page's first videos are growth, one a day
  firstVideosCount: 3,  // how many; a video counts as soon as it is added
  rampGrowthStage: '',  // the stage a new page starts in
  rampCtaStage: '',     // the stage it moves to once it has its growth videos
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
