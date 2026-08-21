// ============================================================================
// concepts.js — the concept library, and how a body link is resolved from it.
//
// A concept is defined ONCE and referenced everywhere. Its variations (the
// different angles you target) live inside it, so adding a fourth angle is one
// line in that concept and never a new concept of its own.
//
//   Breaking News
//     ├ Celebrity angle
//     ├ New study angle
//     └ Warning angle
//
// Pre-made bodies normally share one folder per concept per avatar, so the
// link lives on the CONCEPT and a variation only carries a link when that one
// angle genuinely has its own folder. Resolution is therefore:
//
//     variation override  →  concept link  →  nothing
//
// Everything here also understands the free-text concepts that existed before
// this file did, so links and videos saved back then keep resolving until they
// are imported.
// ============================================================================

import { state, byId, uid } from './state.js';

const norm = s => (s || '').trim().toLowerCase();

export function conceptById(id) { return byId(state.db.concepts, id); }

export function conceptByName(name) {
  const want = norm(name);
  if (!want) return null;
  return (state.db.concepts || []).find(c => norm(c.name) === want) || null;
}

export function variationOf(concept, variationId) {
  if (!concept || !variationId) return null;
  return (concept.variations || []).find(v => v.id === variationId) || null;
}

export function sortedConcepts() {
  return (state.db.concepts || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// "Breaking News · Celebrity angle", or just the concept when no angle is set.
export function conceptLabel(conceptId, variationId, legacyText) {
  const c = conceptById(conceptId);
  if (!c) return (legacyText || '').trim();
  const v = variationOf(c, variationId);
  return v ? c.name + ' · ' + v.label : c.name;
}

// ---------------------------------------------------------------------------
// an avatar's link rows
// ---------------------------------------------------------------------------
// One row per concept: { id, conceptId, url, varUrls: { [variationId]: url } }
// Rows written before the library existed carry a free-text `concept` instead
// of a conceptId; those are matched by name so nothing breaks before import.
export function bodyRow(account, conceptId) {
  const rows = (account && account.bodyLinks) || [];
  const direct = rows.find(r => r.conceptId === conceptId);
  if (direct) return direct;

  const c = conceptById(conceptId);
  if (!c) return null;
  return rows.find(r => !r.conceptId && norm(r.concept) === norm(c.name)) || null;
}

export function bodyLinkFor(account, conceptId, variationId) {
  const row = bodyRow(account, conceptId);
  if (!row) return '';
  const override = row.varUrls && row.varUrls[variationId];
  if (variationId && (override || '').trim()) return override.trim();
  return (row.url || '').trim();
}

export function hasBodies(account, conceptId, variationId) {
  return !!bodyLinkFor(account, conceptId, variationId);
}

// Set (or clear) the concept-level link on an avatar, creating the row if needed.
export function setConceptLink(account, conceptId, url) {
  if (!Array.isArray(account.bodyLinks)) account.bodyLinks = [];
  let row = account.bodyLinks.find(r => r.conceptId === conceptId);
  if (!row) {
    // adopt a legacy name-matched row rather than creating a duplicate
    const c = conceptById(conceptId);
    row = c && account.bodyLinks.find(r => !r.conceptId && norm(r.concept) === norm(c.name));
    if (row) row.conceptId = conceptId;
  }
  if (!row) {
    row = { id: uid('bl'), conceptId, url: '', varUrls: {} };
    account.bodyLinks.push(row);
  }
  row.url = url;
  if (!row.varUrls) row.varUrls = {};
  return row;
}

export function setVariationLink(account, conceptId, variationId, url) {
  const row = setConceptLink(account, conceptId, bodyRow(account, conceptId)?.url || '');
  if (!row.varUrls) row.varUrls = {};
  if ((url || '').trim()) row.varUrls[variationId] = url;
  else delete row.varUrls[variationId];
  return row;
}

// Rows worth keeping: anything with a concept link or at least one override.
export function pruneBodyLinks(account) {
  account.bodyLinks = (account.bodyLinks || []).filter(r =>
    (r.url || '').trim() || Object.values(r.varUrls || {}).some(v => (v || '').trim()));
}

// ---------------------------------------------------------------------------
// importing the free-text concepts that predate the library
// ---------------------------------------------------------------------------
// Returns the distinct names still living as text, with where each was found,
// so the import can be shown and confirmed rather than run silently.
export function discoverLegacyConcepts() {
  const found = new Map();   // normalised -> { name, avatars, videos }
  const note = (raw, key) => {
    const n = norm(raw);
    if (!n || conceptByName(raw)) return;          // already a real concept
    const hit = found.get(n) || { name: (raw || '').trim(), avatars: 0, videos: 0 };
    hit[key]++;
    // prefer a capitalised spelling for the name we would create
    if (/^[A-Z]/.test((raw || '').trim()) && !/^[A-Z]/.test(hit.name)) hit.name = (raw || '').trim();
    found.set(n, hit);
  };

  (state.db.accounts || []).forEach(a => (a.bodyLinks || []).forEach(r => {
    if (!r.conceptId) note(r.concept, 'avatars');
  }));
  (state.db.dailyEntries || []).forEach(e => {
    if (!e.conceptId) { note(e.bodyConcept, 'videos'); note(e.concept, 'videos'); }
  });

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
