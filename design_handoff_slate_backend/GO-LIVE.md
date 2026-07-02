# Go Live — literal step-by-step

This is the click-by-click version. Follow it top to bottom and the app goes
from "just my browser" to "my whole team, shared, online." No prior backend
experience assumed. Budget ~1 hour.

You'll do three things: **(A)** create a free database, **(B)** flip two settings
in one file, **(C)** put the app online. Then **(D)** turn on real logins.

---

## A. Create the database (Supabase) — ~15 min

1. Go to **https://supabase.com** and click **Start your project** → sign in with
   GitHub or email.
2. Click **New project**.
   - **Name:** `slate-crm`
   - **Database Password:** click **Generate**, then copy it somewhere safe.
   - **Region:** pick the one closest to your team.
   - Click **Create new project**. Wait ~2 min while it sets up.
3. In the left sidebar click **SQL Editor** → **New query**. Paste this and click
   **Run** (bottom right). It creates one table per kind of data (so people
   editing different things never overwrite each other) and turns on live sync:
   ```sql
   -- one table per collection; each row is an item stored as JSON
   create table accounts      ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
   create table posts         ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
   create table concepts      ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
   create table products      ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
   create table team          ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
   create table daily_entries ( id text primary key, data jsonb not null, updated_at timestamptz default now() );
   create table daily_metrics ( date text primary key, data jsonb not null, updated_at timestamptz default now() );
   create table app_meta      ( id int  primary key, data jsonb not null, updated_at timestamptz default now() );

   -- turn on Row Level Security, then allow the app in (tighten in step D)
   do $$ declare t text;
   begin
     foreach t in array array['accounts','posts','concepts','products','team','daily_entries','daily_metrics','app_meta'] loop
       execute format('alter table %I enable row level security', t);
       execute format('create policy "team read"  on %I for select using (true)', t);
       execute format('create policy "team write" on %I for all using (true) with check (true)', t);
     end loop;
   end $$;

   -- enable live sync (realtime) on every table
   alter publication supabase_realtime add table accounts, posts, concepts, products, team, daily_entries, daily_metrics, app_meta;
   ```
   You should see "Success. No rows returned." (The open read/write policy is
   fine to start; step D tightens it.)
4. In the sidebar click **Project Settings** (gear) → **API**. Keep this tab open.
   You need two values from here:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - **anon public** key (a long string under "Project API keys")

---

## B. Point the app at the database — ~5 min

Open the file **`slate-store.js`** in the project and change three things near
the top:

1. Find this line and paste your Project URL between the quotes:
   ```js
   const SUPABASE_URL = 'https://abcdxyz.supabase.co';
   ```
2. Find this line and paste your anon public key between the quotes:
   ```js
   const SUPABASE_ANON_KEY = 'eyJhbGci....(your long key)....';
   ```
3. Find this line and change `'local'` to `'supabase'`:
   ```js
   const STORE_MODE = 'supabase';
   ```

Then open **`Slate.dc.html`**, find this line in the `<helmet>` near the top, and
remove the `<!--` and `-->` around it so the Supabase library loads:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

Save. That's the entire code change. Data now lives in Supabase and everyone who
opens the app sees the same data.

---

## C. Put the app online — ~15 min

The app is a set of files (`Slate.dc.html`, `slate-store.js`, `support.js`). To
share a link, host them. Easiest free option: **Netlify Drop**.

1. Download the project from this workspace (Download button → the whole project
   as a zip) and unzip it on your computer.
2. Go to **https://app.netlify.com/drop**.
3. Drag the **project folder** onto the page. It uploads and gives you a live URL
   like `https://random-name.netlify.app`.
4. Open that URL. Rename `Slate.dc.html` to `index.html` before uploading if you
   want the bare URL to open it directly; otherwise visit
   `…netlify.app/Slate.dc.html`.
5. Send the link to your team. Done — it's live and shared.

> Want a real domain (e.g. `crm.yourbrand.com`)? In Netlify: **Domain settings**
> → **Add a custom domain** and follow the prompts.

---

## D. Turn on real logins — ~20 min (do before real use)

Right now logins use a demo password list stored in the data. Before real people
use this, switch to real accounts so passwords are private and secure.

1. In Supabase sidebar: **Authentication** → **Providers** → make sure **Email**
   is enabled.
2. **Authentication** → **Users** → **Add user** → **Create new user**. Enter each
   teammate's **email + a password**. Do this once per person.
   - The email MUST match the email on their profile inside the app (Settings →
     team). That's how the app links a login to the right person and role.
3. In **`slate-store.js`**, the login code is already wired for this — no change
   needed. As long as `STORE_MODE = 'supabase'`, logins now go through Supabase.
4. Remove the demo password prefill: it's only a convenience and does nothing
   harmful, but you can ignore it.
5. Tighten the database so people can only touch what their role allows. Back in
   **SQL Editor**, replace the open policy from step A3 with role-aware rules.
   This part is best handed to a developer or Claude Code (see the handoff
   package) — it's the one step that benefits from a code person.

After D, each teammate logs in with their own email + password, and you manage
who has access from the Supabase **Users** screen.

---

## Quick reference — the only things you edit

| Where | What to set |
|---|---|
| `slate-store.js` → `SUPABASE_URL` | your Project URL |
| `slate-store.js` → `SUPABASE_ANON_KEY` | your anon public key |
| `slate-store.js` → `STORE_MODE` | `'supabase'` |
| `Slate.dc.html` `<helmet>` | uncomment the Supabase `<script>` |
| Supabase → SQL Editor | run the table + realtime SQL (step A3) |
| Supabase → Authentication → Users | add each teammate |

If anything errors, open the browser console (right-click → Inspect → Console);
messages there start with `[store]` and say what's wrong.
