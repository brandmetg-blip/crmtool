# Remote Commerce — Content Ops — setup

Two ways to run it.

- **Local mode** (default): everything stays in your browser. Nothing to set up.
  Good for trying it out. Not shared — each person sees only their own data.
- **Supabase mode**: shared, live, multi-user. Follow section 2.

---

## 1. Run it locally

The app is plain ES modules, so it must be served over `http://` — opening
`index.html` from the filesystem makes the browser refuse to load the imports.
A server is included that needs nothing installed:

```bash
powershell -ExecutionPolicy Bypass -File v2/serve.ps1
```

Then open **http://localhost:5173**. The first screen creates the owner account.

---

## 2. Go multi-user (Supabase)

### 2a. Create the project

1. Go to https://supabase.com → **New project**. Pick the region closest to the team.
2. Sidebar → **SQL Editor** → **New query**. Paste all of section 2b and click **Run**.
3. Sidebar → **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
4. Open `v2/js/config.js` and set:

```js
export const MODE = 'supabase';
export const SUPABASE_URL = 'https://YOURPROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ…';
```

### 2b. The SQL

One table per collection, one row per item. This is what stops two people's
edits from overwriting each other — they are physically different rows.

```sql
-- ---------- tables ----------
create table if not exists team           ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table if not exists accounts       ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table if not exists profiles       ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table if not exists scripts        ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table if not exists script_entries ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
create table if not exists daily_entries  ( id text primary key, data jsonb not null, updated_at timestamptz default now() );

-- ---------- row level security ----------
-- Signed-in users only. Anonymous visitors get nothing, which is the whole
-- point: the anon key ships inside the app, so it must not be a password.
do $$ declare t text;
begin
  foreach t in array array['team','accounts','profiles','scripts','script_entries','daily_entries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "signed in read"  on %I', t);
    execute format('drop policy if exists "signed in write" on %I', t);
    execute format('create policy "signed in read"  on %I for select to authenticated using (true)', t);
    execute format('create policy "signed in write" on %I for all    to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- live sync ----------
alter publication supabase_realtime add table team, accounts, profiles, scripts, script_entries, daily_entries;

-- ---------- image storage ----------
-- Frame stills and avatar photos go here as files. The database only ever
-- holds a short URL, never the image itself.
insert into storage.buckets (id, name, public) values ('media', 'media', true)
  on conflict (id) do nothing;

drop policy if exists "public read media"  on storage.objects;
drop policy if exists "signed in upload"   on storage.objects;
create policy "public read media" on storage.objects
  for select using (bucket_id = 'media');
create policy "signed in upload"  on storage.objects
  for insert to authenticated with check (bucket_id = 'media');
```

Each statement should report "Success. No rows returned."

### 2c. Give people logins

There is **no sign-up screen**. You are either the admin, or someone the admin
added under Team. Nobody can create an account from inside the app.

**The admin** is set in `config.js` and nowhere else:

```js
export const ADMIN_EMAIL = 'you@yourcompany.com';
export const ADMIN_NAME  = 'Your Name';
```

Whoever signs in with that address is the admin, with full access. There is
exactly one, it is not stored in the database, and no other admin can be
created from the UI.

**Everyone else** — two steps per person:

1. Supabase → **Authentication → Users → Add user**. Their real email, an
   initial password, tick *Auto Confirm User*. (Do this for the admin too.)
2. In the app → **Team → + Add member**. The **same email**, then pick
   Marketing Manager or Video Editor, and for editors tick their avatars.

The two are matched on email. Someone who exists in Auth but not in Team is
told so at sign-in rather than landing in a broken session.

In Supabase mode the password is checked by Supabase Auth — **no password is
ever written to the database.**

> Because the tables are readable only by signed-in users, the app establishes
> the Supabase Auth session **before** it loads any data. A logged-out visitor
> sees the sign-in screen and nothing else — not an empty workspace.

### 2d. Who can do what

**Only the admin changes anything.** A marketing manager sees the whole
workspace and can change none of it; a video editor sees only what is assigned
to them, and the one thing they may change is marking their own video made.

| | Admin | Marketing Manager | Video Editor |
|---|---|---|---|
| See the Daily Builder | ✅ everything | ✅ everything | only what's assigned to them |
| Add / mass add scripts and videos | ✅ | ❌ | ❌ |
| Write the brief (concept, hook, body, notes, type, production) | ✅ | ❌ view only | ❌ view only |
| Assign a video to an editor | ✅ | ❌ view only | ❌ |
| Copy the script | ✅ | ✅ | ✅ |
| Be assigned a video | — | ✅ | ✅ |
| Tick "video made" + paste the finished link | ✅ any | ✅ only videos assigned to them | ✅ |
| Mark posted + platforms | ✅ | ❌ view only | sees it once posted |
| Filter by video editor | ✅ | ✅ | ❌ |
| "Still to finish" panel | ✅ | ❌ | ❌ |
| Main Scripts (frames, prompts) | ✅ | ❌ view + copy | ❌ view + copy |
| Avatars | ✅ | ❌ view only | ❌ |
| Assets | ✅ | ✅ all | ✅ theirs only |
| Analytics | ✅ | ✅ | ❌ |
| Team | ✅ | ❌ | ❌ |

---

## 3. Deploying to Cloudflare Pages

The app is static files — there is no build step, nothing to compile.

1. Commit and push the `v2/` folder to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick the repo, then:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `v2`
4. **Save and Deploy.** You get a `*.pages.dev` URL in about a minute.
5. Custom domain: **Custom domains → Set up a domain →** `remotecommerce.net`.
   If the domain's DNS is already on Cloudflare this is one click. If it is not,
   Cloudflare gives you the DNS record to add wherever the domain is managed.

Every push to the main branch redeploys. Every deploy is listed and can be
rolled back with one click, so a bad change is a 30-second fix.

`config.js` is committed with the keys in it, which is normal for a Supabase
anon key: it is a public identifier, not a secret. What protects the data is the
RLS in 2b — the anon key alone can read nothing until someone signs in. Never
put the **service_role** key in this file; it bypasses RLS entirely.

---

## 4. What makes it safe with many people at once

| Risk | What the app does |
|---|---|
| Two people edit different things | Every item is its own row, so the writes never touch each other. |
| A save fails or the network drops | The write is queued and retried with backoff until it lands. The queue is mirrored to `localStorage`, so closing the tab mid-save loses nothing. |
| A save fails silently | It can't — the header pill shows Saved / Saving… / Retrying… / Offline. |
| Someone else's update overwrites what you're typing | Incoming live rows are merged one at a time and never applied to a row you have an unsaved change on. |
| Two people type in the *same* field | Focusing a field claims it. Everyone else sees "Ana is editing" and a read-only copy until you leave. Claims expire on their own, so nothing gets stuck. |
