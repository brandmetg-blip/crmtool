# Handoff: Slate CRM — take the working prototype live

## Overview
Slate is a **fully working** CRM + affiliate/social posting dashboard for a small
team of admins and VAs. It manages social accounts, logs posts, tracks concepts
& products, plans daily content, and shows analytics. It already runs and is
feature-complete on the front end.

**The job here is not to rebuild the UI.** It's to connect this working app to a
real backend so (a) data persists on a server, (b) multiple people share the same
data, and (c) logins are real and secure. The design/UX is done.

## About the files in this bundle
- **`Slate.dc.html`** — the entire app (UI + logic). It runs as-is.
- **`slate-store.js`** — the persistence adapter: the ONE seam between the app and
  where data lives. Has a working `LocalStore` (browser storage) and a
  ready-to-finish `SupabaseStore` template. Switching backends is a config change
  here, not a rewrite.
- **`support.js`** — runtime that powers the app file. Do not edit.
- **`BACKEND.md`** — the data model, schema, roles, and two migration paths.
- **`GO-LIVE.md`** — the non-technical click-by-click deploy guide the owner will
  follow. Read it so your work matches those steps.

> Note on format: the app is authored as a self-contained HTML component. You do
> **not** need to port it to React/Vue to ship it — hosting the files as-is is a
> valid production path for this app. Only re-platform if the team explicitly
> wants to fold it into an existing codebase; if so, treat the HTML as the
> reference spec and reuse `slate-store.js` + `BACKEND.md` as the data contract.

## Fidelity
High-fidelity and functional. This is a finished product, not a mock.

## Architecture (what matters for the backend)
- **All state is one JSON object, `db`.** The app reads it once on load and
  mutates it through a single method, `commit(mut)`, which updates local state
  and calls `store.saveData(db)`.
- **The store interface** (in `slate-store.js`) is the whole contract:
  - `loadData() -> db | null` (may be async)
  - `saveData(db) -> void` (may be async; fire-and-forget / optimistic)
  - `loadSession() -> userId | null`
  - `saveSession(id) -> void`
  - `signIn(email, password, db) -> { userId } | { error }` (may be async)
  - `signOut() -> void`
- The app already `await`s every store call, so a synchronous local store and an
  async server store are interchangeable with zero app changes.

## The task, in order
1. **Stand up Supabase** (or equivalent). Quick path: a single `app_state`
   (jsonb) row holding the whole `db`. SQL is in `GO-LIVE.md` §A and `BACKEND.md`
   §4A. This gets shared data working immediately.
2. **Finish `SupabaseStore`** — it's mostly written. Fill `SUPABASE_URL` /
   `SUPABASE_ANON_KEY`, set `STORE_MODE = 'supabase'`, uncomment the Supabase
   client `<script>` in `Slate.dc.html`'s `<helmet>`.
3. **Real auth** — replace the plaintext-password login with Supabase Auth. The
   app's `doLogin` already delegates to `store.signIn`, and `SupabaseStore.signIn`
   already calls `supabase.auth.signInWithPassword` and maps the Auth user to a
   `team` row by email. Remaining work: create users, remove `password` from the
   data model, stop seeding demo passwords. See `BACKEND.md` §5.
4. **Row-Level Security** — enforce the roles (below) in the database so the API
   can't be used to bypass the UI's gating. This is the main step needing a
   developer.
5. **(Optional, when the team grows) Path B** — split `db` into per-entity tables
   to remove last-write-wins clobbering. Schema in `BACKEND.md` §4B. The seam
   stays `slate-store.js`; you'd add granular create/update/delete methods and
   adjust the app's `commit()` call sites.

## Roles to enforce server-side
- **Admin** — full access.
- **Poster** — VA; may post across all accounts.
- **Editor** — VA; limited to accounts/platforms in their `assignments`.
The front end already gates on these; RLS must mirror them.

## Data model
Full field-by-field breakdown is in **`BACKEND.md` §2**. Collections: `accounts`,
`posts`, `concepts`, `products`, `team`, `dailyEntries`, `dailyMetrics`,
`characterMeta`, `assetLinks`. `posts` drives all analytics (fields:
`accountId, date, type, concept, conceptId, prod, platforms[], done`).

## Security callouts
- `db.team[].password` is **plaintext today** — must be removed once Supabase Auth
  is live. Never ship the plaintext list to production.
- The starter SQL uses an open RLS policy so the app works on day one — tighten it
  (step 4) before real users.

## Definition of done
- [ ] Data shared across users via Supabase (`STORE_MODE='supabase'`)
- [ ] Supabase Auth logins; no passwords stored in `db`
- [ ] RLS policies enforce Admin / Poster / Editor
- [ ] App hosted at a URL the team can reach
- [ ] Owner can add/remove teammates from Supabase
