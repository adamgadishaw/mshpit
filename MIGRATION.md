# SQLite migration plan — `src/store.js` → backend API

> Status: **planning / not started in code.** This is the execution plan for
> backlog item #1 in `HANDOFF.md`. Read it before writing migration code.

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

1. **Follows** — smallest graph. Add `GET /api/me/following` (returns ids).
   Hydrate `follows[session.id]` on login; `follow`/`unfollow` write through to
   `POST /api/users/:id/follow`. Server endpoints for the toggle already exist.
2. **Posts / feed** — `GET /api/feed` + `POST /api/posts` exist. Decide catalog
   vs user posts (keep catalog bundled; store user posts in `posts`). Hydrate
   feed on load, merge with bundled catalog shows, write through `addLog`.
3. **Likes + comments** — endpoints exist (`/api/posts/:id/like`,
   `/api/posts/:id/comments`). Write-through `toggleLike`, `addComment`.
4. **DMs** — needs new tables usage + `GET /api/me/threads`, `GET /api/dms/:otherId`,
   `POST /api/dms/:otherId`. The `dms` table already exists in `server/db.js`.
   Preserve the new Requests/Friends split (`bucket`) server-side or compute it
   client-side from the follow graph as it does now.
5. **Fan clubs** — endpoints exist (`/api/fanclubs/...`).
6. **Reports / moderation** — endpoints exist (`/api/reports`, `/api/admin/...`).
7. **Ratings, going/attendance, venue reviews, artist requests/profiles** — need
   new tables + endpoints; lowest priority.

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
