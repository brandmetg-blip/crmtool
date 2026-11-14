# Connecting the tool to Meta

This gives the tool one login token that can see your Facebook Pages and their
Instagram accounts, read how many views each video got, and post to them. It is
what the reposting automation (and later, posting finished videos) runs on.

You only do this once. It takes about 20 minutes. Meta changes its screens
often, so a button may be worded a little differently from what is written here.

> **Never paste the token in chat, in the tool, or anywhere in this repo.** It
> goes in one place only: Supabase secrets (step 6). Anyone who has it can post
> to every page.

---

## 1. Check the pages are in your Business Manager

Go to **business.facebook.com → Settings (the gear) → Accounts**.

- **Pages:** every avatar's Facebook Page should be listed here.
- **Instagram accounts:** every avatar's Instagram should be listed here.

Each Instagram account must be a **Business** account (not Creator, not
personal) and **connected to its Facebook Page**. To check one: on the Instagram
app, open the profile → Settings → Account type and tools. Or in Meta Business
Suite, open the Page → Settings → Linked accounts → Instagram.

A page that is missing here can't be reposted to. You can add the rest later.
The tool will tell you which ones it can't see.

## 2. Create the app

1. Go to **developers.facebook.com** and sign in with the same Facebook account
   that is an admin of your Business Manager.
2. **My Apps → Create app.**
3. Name it something plain, like `Remote Commerce Tool`. Use your own email.
4. When it asks what the app is for, choose **Other**, then app type
   **Business**.
5. When it asks for a business portfolio, pick **your Business Manager**.
6. Create it. Leave it in **Development** mode. That is fine for pages your own
   business owns.

## 3. Add Instagram and Facebook Pages to the app

In the app's dashboard:

1. **Add product → Instagram** (if offered: "API setup with Facebook login").
   This is what lets the app read and post on the Instagram accounts.
2. If the dashboard shows **Use cases**, make sure these are added:
   - Manage everything on your Page
   - Manage messaging and content on Instagram (or "Instagram API")

You don't need to fill in privacy policy pages or submit anything for review
yet.

## Pages on your personal profile (no Business Manager)

If the avatar pages belong to your own Facebook profile rather than a business,
skip steps 4 and 5 and do this instead:

1. **developers.facebook.com/tools/explorer.** On the right: **Meta App** →
   your app. **User or Page** → **User Token**.
2. **Add a permission** → add `pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts`, `read_insights`, `instagram_basic`,
   `instagram_content_publish`, `instagram_manage_insights`.
3. **Generate Access Token.** In the Facebook window, choose all the avatar
   Pages and all their Instagram accounts, and allow everything.
4. That token lasts about an hour. Click the blue **ⓘ** next to it → **Open in
   Access Token Tool** → **Extend Access Token** at the bottom. Copy the new,
   long token.
5. Go to step 6 and save it as `META_TOKEN`.

The tool swaps it for one token per Page, which don't expire. You need to do
this again if you change your Facebook password or Facebook logs you out
everywhere; the tool will tell you when.

## 4. Make a system user

A system user is a "robot" login that belongs to your business, not to a
person. Its token doesn't expire when someone changes their Facebook password.

1. **business.facebook.com → Settings → Users → System users → Add.**
2. Name it `Tool poster`. Role: **Admin**.
3. With the system user selected, click **Assign assets**:
   - **Pages:** tick every avatar page and give it **full control** (or at
     least *Content* and *Insights*).
   - **Instagram accounts:** tick every avatar's Instagram, full control.
   - **Apps:** tick the app from step 2, **Manage app**.
4. Save.

## 5. Make the token

Still on the system user:

1. Click **Generate new token**.
2. App: the one from step 2.
3. Expiration: **Never**.
4. Tick these permissions (use the search box):
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `read_insights`
   - `instagram_basic`
   - `instagram_content_publish`
   - `instagram_manage_insights`
   - `business_management`
5. **Generate**, then **copy** the token. Meta shows it only once. Don't
   paste it anywhere except step 6.

If one of the permissions isn't in the list, the app is missing that product
(step 3). Add it and generate again.

## 6. Put the token in Supabase

1. **supabase.com → your project → Edge Functions → Secrets** (in some
   versions: Project Settings → Edge Functions).
2. **Add new secret:**
   - Name: `META_TOKEN`
   - Value: the token you copied
3. Save.

That's it on your side. Tell Claude it's done. Don't send the token.

---

## What happens next

1. **Read only.** The tool lists every Page and Instagram account the token can
   see and matches them to your avatars. Pages in Reposting show their real
   top videos by views. Nothing is posted yet.
2. **One test page.** Reposting is turned on for one page first. You check the
   repost looks right (video, original caption, AI label).
3. **All Reposting pages.** Each one posts one past winner a day to Facebook
   and Instagram at 12:00 New York time (9:00 Los Angeles), the middle of the US
   day. The same video doesn't come back until the others have had their turn.

## If something goes wrong

- **"Permissions error" or "(#200)":** a permission from step 5 is missing, or
  the system user isn't assigned that page (step 4). Fix it and generate a new
  token. Replace the old one in Supabase.
- **An Instagram account doesn't show up:** it isn't a Business account, isn't
  connected to its Page, or isn't assigned to the system user.
- **Meta asks for Business Verification:** go to Business Manager → Security
  Centre → Start verification. It needs your company's documents and can take a
  few days.
- **The token leaked:** Business Manager → System users → Revoke tokens, then
  make a new one.
