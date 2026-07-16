# Slate CRM — Backend & Data Model

How to take this app from a single-browser prototype to a shared, multi-user
tool with a real server. Written for whoever does the backend wiring (a
developer, or Claude Code).

---

## 1. Where things stand

- The app is a self-contained front-end. **All data is one JSON object** (`db`).
- Today it's saved in the browser's `localStorage` — so it's per-device and
  per-person. Nothing is shared.
- **All persistence goes through one seam:** `slate-store.js`. The app calls a
  `store` with four methods and never touches storage directly:

  | method | does |
  |---|---|
  | `loadData()` | return the whole `db` object, or `null` if none yet |
  | `saveData(db)` | persist the whole `db` |
  | `loadSession()` | return the logged-in user id, or `null` |
  | `saveSession(id)` | remember / clear who is logged in |

  Any method may return a Promise; the app already `await`s them. So a
  synchronous local store and an async server store are drop-in interchangeable.

- **Auth today is a placeholder and is NOT safe for production.** Team members
  and their passwords live in plaintext inside `db.team`, and the password check
  happens in the browser. Real auth must move to the server (see §5).

---

## 2. The data model (`db`)

One object with these collections. IDs are short strings (`acc_…`, `p_…`, etc).

| key | shape | what it is |
|---|---|---|
| `accounts` | array | social accounts being managed |
| `posts` | array | every logged post (drives all the analytics) |
| `concepts` | array | content concepts, each with `variations`, `hooks`, `bodies` |
| `products` | array | products the accounts promote |
| `team` | array | users + their role + assignments (**holds passwords today**) |
| `dailyEntries` | array | the daily content-builder rows (planned/made/posted) |
| `dailyMetrics` | object | keyed by date → `{ clicks, revenue, sales }` |
| `characterMeta` | object | per-character metadata |
| `assetLinks` | object | `{ baseImages, hooks, bodies }` shared drive links |
| `mainScripts` | array | per-day master scripts, each with ordered `frames` (Main Scripts feature) |
| `mainScriptEntries` | array | per-(script × account) completion for main scripts |

### Key fields per collection

**accounts:** `id, name, character, product (productId), phase (P1–P4),
status (Active|Warming|…), followers, followersHistory [{date,value}],
platforms {facebook:handle, …}, metaBusinessSuiteUrl, notes, repostCount,
target, avatar`

**posts:** `id, accountId, date (YYYY-MM-DD), type (Growth|Product),
concept, conceptId, prod (Assembly|Scratch|Repost), platforms [..], done,
createdAt`

**concepts:** `id, name, tagline, productLane, status, variations[], hooks[],
bodies[]` (hook/body/variation items: `{ id, label, value, kind, video… }`)

**products:** `id, name, short, lane, poison, symptoms`

**team:** `id, name, email, role (Admin|Poster|Editor), password ⚠, assignments
[{ accountId, platforms:[..] }]`

**dailyEntries:** `id, date, accountId, character, type, prod, done, posted,
platforms[], videoLink, conceptId/hookVarId/bodyVarId, postId, …`

**dailyMetrics:** `{ "2026-07-01": { date, clicks, revenue, sales }, … }`

**mainScripts:** `id, date (YYYY-MM-DD), title, order, createdById/Name,
createdAt, frames [{ id, imagePrompt, videoPrompt, videoTool
(grok|veo|omniflash), order }]`

**mainScriptEntries:** `id, scriptId, accountId, done, doneAt,
doneById/Name, videoLink, driveLink, updatedAt` — lazily created the first
time an editor ticks/edits a (script × account) cell.

> **Note:** `mainScripts` and `mainScriptEntries` are NOT in `ID_COLLECTIONS`
> in `slate-store.js`; like `characterMeta`/`assetLinks`/`notifications` they
> ride in the single `app_meta` row. That keeps the feature a pure front-end
> change (no new Supabase table/SQL). If concurrent completion edits ever need
> row-level safety, promote `mainScriptEntries` to its own table (add it to
> `ID_COLLECTIONS` **and** create the table first — see `GO-LIVE.md` §A3).

---

## 3. Roles (already enforced in the front-end)

- **Admin** — full access to everything.
- **Poster** — a VA who can post across all accounts.
- **Editor** — a VA limited to the accounts/platforms in their `assignments`.
  In the Daily Builder, editors see ONLY the Main Scripts area (not the
  per-account character cards).
- **Marketer** (role key `Marketer`, shown as "Marketing Manager") — limited to
  their assigned accounts like an Editor, but can also see the per-account
  character cards AND create/edit main scripts + frames (`canEditMainScripts`).

The UI already gates tabs and visible accounts by role. When you add server-side
auth, enforce the SAME rules in the database (row-level security) so a user can't
read/write beyond their role by hitting the API directly.

---

## 4. Persistence design — multi-user safe (IMPLEMENTED)

`slate-store.js` now ships the concurrency-safe design by default. Data is stored
**one row per item, one table per collection**, with **row-level writes** and
**realtime** live sync. This is what makes simultaneous editing safe.

### How it works
- **Row-level writes.** The app updates local state instantly, then hands the
  store the previous and next `db`. The store computes a **diff** and writes only
  the rows that actually changed. Two people editing different accounts/posts
  touch different rows and never overwrite each other.
- **Realtime.** The store subscribes to every table; when anyone changes
  anything, all open clients refetch (debounced) so everyone stays in sync live.
- **Optimistic + safe.** Writes are fire-and-forget with `Promise.allSettled`;
  a failed write is logged, never crashes the UI, and the next realtime refetch
  reconciles it.

### Schema (each table is `id` + a `jsonb` blob of the item — no column mapping)
```sql
create table accounts      ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table posts         ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table concepts      ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table products      ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table team          ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table daily_entries ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table daily_metrics ( date text primary key, data jsonb not null, updated_at timestamptz default now() );
create table app_meta      ( id int  primary key, data jsonb not null, updated_at timestamptz default now() );
```
The full copy-paste SQL (RLS + realtime enablement) is in **GO-LIVE.md §A3**.
`accounts, posts, concepts, products, team, daily_entries` map to the like-named
collections; `daily_metrics` is keyed by date; `app_meta` (single row, id=1)
holds everything else (`characterMeta`, `assetLinks`, seed flags).

### The one remaining edge case
If two people edit **the same item** in the same second, that single row is
last-write-wins (whoever saved last). That's rare and self-corrects on the next
edit. If you ever need field-level merging on the same record, that's a further
step — but for a posting team it isn't needed.

### Only a big list needs a typed schema
The `id + jsonb` design scales fine to thousands of rows. If you later want SQL
reporting/joins on posts, you can migrate `posts` to typed columns
(`account_id, date, type, prod, platforms…`) without touching the app — just
adjust how `SupabaseStore` reads/writes that one table.

---

## 5. Real authentication (do this before real users)

Replace the plaintext-password login with **Supabase Auth** (email/password or
magic link):

1. Remove `password` from `db.team` / the `team` table.
2. Create each teammate in Supabase Auth; store their `role` + `assignments` in
   the `team` table keyed by the Auth user id.
3. Point the app's login screen at `supabase.auth.signInWithPassword(...)`.
4. Wire `store.loadSession()` → `supabase.auth.getSession()` and logout →
   `supabase.auth.signOut()` (stubs are in `slate-store.js`).
5. Add **Row-Level Security** policies mirroring §3 so the server enforces roles.

---

## 6. Handoff checklist

- [ ] Supabase project created; tables + RLS + realtime SQL run (GO-LIVE §A3)
- [ ] `SUPABASE_URL` / `SUPABASE_ANON_KEY` set, Supabase script uncommented
- [ ] `STORE_MODE = 'supabase'` — data now shared, row-level, live
- [ ] Verified: two browsers editing at once both persist and sync
- [ ] Real auth via Supabase Auth; passwords removed from data
- [ ] Row-Level Security policies match the Admin / Poster / Editor rules
- [ ] Hosted somewhere with a URL the team can reach
