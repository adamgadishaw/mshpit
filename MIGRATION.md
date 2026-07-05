# SQLite migration plan — `src/store.js` → backend API

> Status: **COMPLETE (slices 1–7).** Every dynamic data type now writes through to
> the server and hydrates back, best-effort/offline-safe. Kept as the reference for
> how the write-through + hydrate pattern works. Prereqs remain for prod scale
> (server-side seeding of demo users/catalog is still optional — the bundled seed
> is the offline cache).

## The goal

Today the app's dynamic data (accounts, posts, follows, comments, DMs, fan clubs,
ratings, going/attendance, venue reviews, artist requests, moderation) lives in
`src/store.js` React state, persisted to `localStorage` via `src/lib/persist.js`.
It resets per browser and never reaches the server. **Auth is the exception** —
`login`/`signup` are already server-first (`absorbServerUser`), falling back to
local demo accounts only when the backend is unreachable.

The end state: the server (`server/`, `node:sqlite`) is the source of truth for
all dynamic data; the store becomes a **reactive cache** that hydrates from the
API on load and writes through on every mutation. Screens keep calling
`useStore()` with the same shape, so they don't change.

## Why this is big (and can't be a quick partial)

1. **The server DB is empty except admin.** All users/shows/venues/catalog are
   client seed data (`src/data.js`, `src/seed/`). A partial migration would leave
   half the graph local and half server — worse than either. **Prerequisite: seed
   the server DB** with the demo users + the catalog shows (or decide the catalog
   stays a bundled read-only asset and only *user-generated* rows move to SQL).
2. **Missing read endpoints.** `server/api.js` has writes + some reads, but not
   e.g. "list the ids I follow", "my DM threads", "my going list". These must be
   added before hydration works.
3. **Sync → async.** ~80 `useStore()` methods are synchronous. Mutations become
   fire-and-write-through (optimistic local update + background `api()` call);
   reads stay synchronous off the cache. Errors need reconciliation.

## Recommended order (each slice: add endpoint → hydrate on login → write-through → verify)

Run `npm run server` (port 3000) and load the app so the preview (8081) proxies
to it; sign up a **real** account (local demo `u_demo` is offline-only and won't
persist server-side).

1. **Follows** ✅ (slice 1). `GET /api/me/following`; hydrate on login;
   `follow`/`unfollow` write through to `POST /api/users/:id/follow`.
2. **Posts / feed** ✅ (slice 2). `hydrateFeed()` in `store.js` pulls `GET /api/feed`
   on mount (public — guests included) and again on login, merging server posts
   OVER the bundled seed (dedupe by id; catalog stays bundled). `addLog` writes
   through `POST /api/posts` and adopts the returned server id so likes/comments
   key correctly. Best-effort/offline-safe.
3. **Likes + comments** ✅ (slice 3). `toggleLike` → `POST /api/posts/:id/like`;
   `addComment` → `POST /api/posts/:id/comments` (adopts server comment id);
   `loadComments(id)` hydrates a post's thread (called from `AfterpartySection`).
   Like counts/`liked` hydrate from the feed payload. The local like model
   (`likes[id]` excludes the viewer, `myLikes[id]` is their toggle) is preserved by
   subtracting the viewer back out of the server total on hydrate.
4. **DMs** ✅ (slice 4). Added `GET /api/me/threads` (each thread + its messages +
   the other user), `GET /api/dms/:otherId`, `POST /api/dms/:otherId` on the
   existing `dms` table. Client hydrates threads on login (absorbing the other
   users), `sendDM` writes through + adopts the server id, `loadThread()` refreshes
   a thread on open (called from `ThreadScreen`). The Requests/Friends `bucket` and
   unread markers stay **client-side** (computed from the follow graph), per plan.
5. **Fan clubs** ✅ (slice 5). Added `GET /api/me/fanclubs` (my memberships) to the
   existing join/messages endpoints. Client hydrates membership on login;
   `joinFanClub`/`addFanClubMessage` write through (adopt ids); `loadFanClub()`
   hydrates a club's messages + real member count on open (`FanClubScreen`).
   `fanClubMeta` holds the server member count, preferred over the local-graph count.
6. **Reports / moderation** ✅ (slice 6). `reportContent` writes through
   `POST /api/reports`; admins hydrate the open queue on login (`GET /api/admin/reports`,
   mapped to client shape); `actionReport`/`dismissReport` write through to the
   admin action/dismiss endpoints; `banUser` writes through `POST /api/admin/users/:id/ban`.
   Server ids (`r_...`) round-trip; local-only ids (`rep_...`) 404 harmlessly.
7. **Ratings · going · venue reviews · artist requests/profiles** ✅ (slice 7).
   Added 6 tables (`ratings`, `going`, `venue_reviews`, `artist_requests`,
   `artist_profiles`, `artist_posts`) + endpoints. Client: `rateAlbum`/`rateSong`
   write through and overlay a server aggregate (`ratingAgg`, loaded via
   `loadRating`); `toggleGoing` writes through + hydrates on login; `addVenueReview`
   writes through, `loadVenueReviews` hydrates (VenueScreen); `requestArtist` +
   admin approve/reject write through, admins hydrate the pending queue;
   `updateArtistProfile`/`addArtistPost`/`removeArtistPost` write through with an
   owner check (`ownsArtist`), `loadArtistPage` hydrates overrides + updates feed
   (ArtistScreen). All best-effort/offline-safe.

## Pattern to follow (already proven by the theme feature)

`chooseTheme` in `store.js` is the template: it updates local state, persists,
AND writes through to `PATCH /api/me` (best-effort). Generalize this:

- A small `useServerHydrate()` effect that, on `session` change and when
  `serverUp()`, loads the server slices into cache.
- Each mutation: optimistic local `setX(...)` + `api(...).catch(reportSyncError)`.
- Keep `persist.js` as an offline cache so the app still works with no backend
  (the current dev-fallback behavior must survive).

## Do NOT

- Rip out `localStorage` persistence — it's the offline fallback.
- Change `useStore()` return shape or make reads async (screens rely on sync).
- Migrate a slice without its hydrate endpoint (you'll get write-only data that
  vanishes on reload).
