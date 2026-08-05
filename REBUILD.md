# Save-layer rebuild — so it never lags or loses edits again

This is the structural fix for the two chronic problems (lag + edits disappearing).
Both come from the **data/save design**, not from any one bug — which is why
point-fixes never held. This document is the target architecture, the exact steps
**you** do in Supabase, the order everything must ship in, and how we prove each
phase works.

---

## 1. Why it breaks today (root causes)

| Symptom | Root cause in the current design |
|---|---|
| **Lag** | Every edit deep-copies the *entire* database; the database holds **images as raw base64 text**; the sync loop re-serializes the whole database every few seconds. |
| **Edits vanish (multi-user)** | Many collections (main scripts, profiles, notifications, frames) live in **one shared row** `app_meta`. Any change rewrites the whole row → last writer wins → the other person's change is gone. |
| **Edits vanish (even solo)** | Local edits are held ~0.5s before saving. A live-sync *pull* landing in that window replaces your unsaved edit with the server's older copy. |
| **Silent loss** | A failed save is only `console.error`'d — **no retry, no warning**. Bigger payloads (images) make failed/timed-out saves more likely. |

---

## 2. Target architecture

Four principles:

### A. One row per item (kill the shared blob)
Every collection is stored **one database row per item**, keyed by `id`, exactly
like `accounts` and `daily_entries` already are. Two people editing *different*
items then physically cannot overwrite each other.

- Move out of the `app_meta` blob into their own tables: **`main_scripts`,
  `main_script_entries`, `profiles`, `notifications`.**
- `app_meta` keeps only genuinely global, rarely-touched settings (`platforms`,
  `assetLinks`, `characterMeta`, feature flags) — low contention, safe there.

### B. Media lives in Storage, not the database
Images/videos upload to a **Supabase Storage bucket**; the row stores only a short
**URL string**. This removes the megabytes from state — kills most lag *and* the
"row too big → save silently fails" losses. Applies to account avatars, frame
images, concept reference videos.

### C. Writes are reliable (never dropped)
A **write queue with retry + backoff**: every change goes into a queue keyed by
`(table,id)` (newest value wins, so rapid edits collapse). A worker drains it and
**retries failed writes until they succeed** instead of dropping them. The queue is
mirrored to `localStorage`, so a refresh/crash mid-save doesn't lose anything.

### D. Sync merges, never clobbers
A live update from the server is **merged row-by-row**, and a row with a pending
local write (a "dirty" row) is **never overwritten**. Plus a visible save-status
indicator: **Saved / Saving… / Retrying… / Offline** so a failure is never silent.

### E. Performance
- Mutations touch only the one changed row (no whole-database copy).
- No whole-database `JSON.stringify` compares (row-level realtime tells us the one
  row that changed).
- With media as URLs, payloads are tiny.

---

## 3. What YOU do in Supabase (I can't — it's your dashboard)

Run these in **Supabase → SQL Editor → New query → Run**. This is the same pattern
already used for the existing tables (see `GO-LIVE.md` §A3).

### 3a. New per-item tables
```sql
create table if not exists main_scripts        ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table if not exists main_script_entries ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table if not exists profiles            ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table if not exists notifications       ( id text primary key, data jsonb not null, updated_at timestamptz default now() );

do $$ declare t text;
begin
  foreach t in array array['main_scripts','main_script_entries','profiles','notifications'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "team read"  on %I for select using (true)', t);
    execute format('create policy "team write" on %I for all using (true) with check (true)', t);
  end loop;
end $$;

alter publication supabase_realtime add table main_scripts, main_script_entries, profiles, notifications;
```

### 3b. Storage bucket for images/videos
```sql
insert into storage.buckets (id, name, public) values ('media', 'media', true)
  on conflict (id) do nothing;

create policy "public read media" on storage.objects for select using (bucket_id = 'media');
create policy "team upload media" on storage.objects for insert with check (bucket_id = 'media');
create policy "team update media" on storage.objects for update using (bucket_id = 'media');
```

You should see "Success. No rows returned." for each. That's the entire Supabase side.

---

## 4. Rollout order (this is critical)

**Supabase step must land before the code that uses it**, or the app breaks on load.
So each phase is: *you run the SQL → I ship the matching code → we verify → next phase.*
The store code is written to be **resilient** (a missing table is treated as empty,
not a crash) so a mistimed deploy degrades gracefully instead of bricking.

---

## 5. Phased plan & how each is verified

| Phase | What ships | Needs your Supabase step? | How we verify |
|---|---|---|---|
| **0 — Reliable writes** (in progress) | Retry-with-backoff on every save (no more silent drops) + a real Save/Saving/Retrying/Offline status in the header. | No | App boots in local mode; simulate a failing write and confirm it retries and the status shows it, and no edit is lost. |
| **1 — Split the blob** | `main_scripts`, `main_script_entries`, `profiles`, `notifications` become per-item tables; a one-time migration copies existing data out of `app_meta`; dirty-row merge guard on reload. | **Yes — §3a** | Two browser sessions edit different scripts at once → both persist, neither is lost. Edit while a reload lands → edit survives. |
| **2 — Media to Storage** | Avatars, frame images, concept videos upload to the `media` bucket; rows store only URLs; existing base64 images migrated up. | **Yes — §3b** | Upload an image → row holds a short URL, not base64; page loads fast; image still shows. Measure: no multi-MB payloads. |
| **3 — Perf polish** | Remove remaining whole-db clone/stringify from hot paths. | No | Type rapidly in a big workspace → no input lag; profiler shows no per-keystroke full-db work. |

Each phase is shippable on its own and improves things immediately; nothing is a
big-bang rewrite (that's what failed before). A phase is only merged after its
verification passes, and every phase is a separate commit that can be reverted.

---

## 6. Rollback

Every phase is one commit. If a phase misbehaves in production, `git revert <that
commit>` and push — the app returns to the previous behavior. The new Supabase
tables/bucket are additive and harmless to leave in place during a revert.
