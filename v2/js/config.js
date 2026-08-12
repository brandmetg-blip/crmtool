// ============================================================================
// config.js — the ONLY file you edit to go live.
// ----------------------------------------------------------------------------
// MODE:
//   'local'    — everything stays in this browser (for trying it out / dev).
//   'supabase' — shared, multi-user, live. Requires SUPABASE_URL + KEY below
//                and the one-time setup in SETUP.md.
// ============================================================================

export const MODE = 'supabase';

// From your Supabase project: Settings → API
// The anon key is a PUBLIC identifier — it ships inside the app to every
// visitor by design. What protects the data is the row-level security in
// SETUP.md §2b (nothing is readable until you are signed in). Never put the
// service_role key here; that one bypasses RLS entirely.
export const SUPABASE_URL = 'https://tcurzcgjfukrjrdfhgej.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjdXJ6Y2dqZnVrcmpyZGZoZ2VqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTY0MTEsImV4cCI6MjEwMjEzMjQxMX0.lCKKQWsaAAiNJ-ouTVng3U8-FaIbybd2P6aPe7XxKmw';

// ---------------------------------------------------------------------------
// The single admin. Whoever signs in with this email is the admin — full
// access to everything. There is no way to create another one from inside the
// app, which is the point: the admin is set here, not in the database.
// ---------------------------------------------------------------------------
export const ADMIN_EMAIL = 'dusanreljin@gmail.com';
export const ADMIN_NAME = 'Dusan';

// Local mode only. In supabase mode the password is checked by Supabase Auth
// and this is ignored — no password is ever stored in the database.
export const LOCAL_ADMIN_PASSWORD = 'admin';
