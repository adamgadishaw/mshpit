# PIT / mshpit.com — Handoff

> **Living doc.** Whoever works on this next: read this first, and UPDATE it before you end a session (move things between "Done" and "Backlog", note anything running). Point a fresh Claude Code chat at this file to get up to speed without re-explaining.
>
> Last updated: 2026-07-04

---

## What this is
**Pit** (live at **mshpit.com**) — "Letterboxd for concerts." Log shows, rate band-vs-room, follow people with your taste, discover gigs worth seeing. Expo / React Native (web + iOS/Android via react-native-web), JavaScript, no TypeScript. See `BRIEF.md` (vision) and `CLAUDE.md` (rules).

## Run it locally
```
npm install
npx expo start --web         # app on http://localhost:8081
npm run server               # backend API + serves the web build (server/index.js)
npm run pipeline             # self-running scraper (needs .env, see below)
```
- **Node 24 required** (backend uses built-in `node:sqlite`; pinned in package.json engines).
- After code changes, **hard-refresh the browser (Ctrl+Shift+R)** — Metro lets the tab cache the old bundle. This has repeatedly looked like "changes didn't apply."

## Deployment (LIVE)
- Host: **Render**, one-click via `render.yaml` (Blueprint). Plan: Starter ($7/mo — needed for the **persistent disk** at `/data` that holds the SQLite DB; without it every deploy wipes users).
- Build: `npm ci && npm run build:web` → start: `node server/index.js`.
- Domain: **mshpit.com** bought at **GoDaddy**. DNS: `A @ → 216.24.57.1`, `CNAME www → mshpit.onrender.com`. HTTPS auto-issued by Render.
- **To deploy changes:** commit → **push to GitHub** (repo `adamgadishaw/mshpit`, branch `master`) → Render auto-redeploys.
- Full details: `LAUNCH.md`.

## Backend
- `server/` — **zero-dependency** Node (built-ins only: `node:sqlite`, `crypto` scrypt + HMAC-signed sessions). Chosen for "hard to crash, easy to fix." Schema/tables in `server/db.js`; auth in `server/auth.js`; routes in `server/index.js`.
- **Admin** is seeded server-side from env `ADMIN_EMAIL` + `ADMIN_PASSWORD` on boot. (Locally you may not have run the server; admin lives in the DB once the server starts.)
- ⚠️ **Client is NOT fully wired to the backend yet.** The app still runs largely on the in-memory `src/store.js` + `localStorage` persistence (`src/lib/persist.js`). The backend is a working foundation; migrating the store's reads/writes to the API is the big open architecture task.

## Secrets — where they live (NOT in git)
- **Local:** `pit/.env` (gitignored). Keys present: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `EXPO_PUBLIC_GOOGLE_MAPS_KEY`.
- **Production:** Render dashboard → service → Environment. Needs: `ADMIN_PASSWORD`, `EXPO_PUBLIC_GOOGLE_MAPS_KEY` (build-time), plus the ones in render.yaml.
- Google Maps key is restricted to `mshpit.com/*`, `www.mshpit.com/*`, `localhost:8081/*` + Maps Static API only. Cost ≈ $0 (Static Maps: $2/1k views, $200/mo free credit). Consider a daily quota cap in Google Cloud as a hard safety net.
- If a secret was ever pasted into a chat, **rotate it.**

## The scraper / data pipeline
- `npm run pipeline` → `scripts/pipeline.mjs`. Self-running loop: grows the artist roster (MusicBrainz), syncs curated arenas, then Spotify photos → album covers → top tracks → venue photos. **Precheck-skips** finished work (no-op cycles don't rewrite the file).
- Hardened: 15s request timeouts + a 45-min per-stage watchdog, so it can't freeze (it did once — hung 7h on a timeout-less fetch).
- Env knobs: `ARTIST_TARGET` (default 800), `CYCLE_H` (6), `STAGE_TIMEOUT_MS`.
- **It writes `src/seed/catalog.generated.json`.** That's bundled data — changes only reach the LIVE site after a **rebuild + redeploy (push)**. Also, running it while `expo start` is up triggers dev hot-reloads, so run it when you're NOT actively clicking around (or overnight).
- Catalog now: ~550+ artists (Spotify photos/genres/popularity, album covers via Cover Art Archive, top tracks), ~1010 venues across 15 countries incl. major CA/US arenas.
- Other scripts: `scripts/prune-photos.mjs` (drop dead image URLs), `scripts/sync-anchors.mjs` (curated arenas → catalog), `scripts/enrich-*.mjs`.

## Recently done (2026-07-04 session)
- **Back navigation rebuilt as a real stack** (`App.js`). Was a single flat `nav`
  object where every close called `clear()` → always dumped you to the feed. Now
  `stack` of frames: `go()` pushes a screen, `back()` pops one, `replace()` swaps,
  `clear()` returns to the tabs. Browser/hardware Back is wired to the same stack
  (web routes through `history.back()` → `popstate`; Android via `BackHandler`).
  Verified: feed→artist→fan club, Back retraces correctly.
- **Live Google Maps fixed.** Code was always correct; the live build had no key
  because `render.yaml` had `EXPO_PUBLIC_GOOGLE_MAPS_KEY` as `sync:false` (blank
  unless typed into the Render dashboard). Now committed as a `value:` in
  render.yaml — safe because `EXPO_PUBLIC_*` ships in the public bundle anyway and
  the key is referrer-locked to mshpit.com. **⚠️ Render may keep the old blank
  dashboard value on first deploy — if the map is still drawn after deploy, delete
  the env var in the Render dashboard so the blueprint `value:` takes, or paste the
  key there.**
- **Interactive Google map (upgrade).** The static snapshot looked garish (bright
  amber road grid + colliding labels). Replaced with a REAL embedded map on web:
  new `LiveMap.jsx` uses the Maps **JavaScript** API (pan/zoom, clickable pins,
  a cleaner muted dark theme). `ConcertMap` delegates to it on web when a Google
  key is present, and falls back to the static/drawn map (incl. on native, or on
  `gm_authFailure`). Now used on **Nearby** AND the **performance page**: the
  `AfterpartySection` shows the venue (amber pin) + afterparty spots (pink pins,
  tap for directions). `mapConfig` now `export`s `GOOGLE_KEY`.
  **⚠️ Needs the "Maps JavaScript API" enabled on the key** (Static Maps alone is
  not enough). It works locally with the current key; if the live map shows a grey
  "can't load Google Maps" tile, enable that API + add it to the key's API
  restrictions in Google Cloud. Costs fall under the $200/mo free credit.
- **Setlist spoiler gating** re-added to the full `ShowScreen` (feed card already
  had it): hidden when `log.inTourWindow`, tap "Reveal" to show.
- **Theme saved to the account.** New `chooseTheme()` in `store.js` persists the
  preset on the user (session + server `extras` blob via `PATCH /api/me`) and
  applies it; on login/new device a `session.theme` effect re-applies it. Wired
  into Menu, Settings, Edit profile, and the **signup onboarding** (theme swatches
  in `PickArtistsScreen`, applied on Done). Removed the old local-only
  `themeMode`/`setThemeMode`.
- **DM Requests vs Friends split.** `inboxThreads()` now tags each thread `main`
  vs `requests` (stranger = not followed AND you haven't replied). Inbox has
  Messages / Requests tabs; replying promotes a request to Messages; the unread
  badge counts only `main`. `requestCount()` added.
- **Profile photo gallery.** `ProfileScreen` aggregates every `photos[]` from a
  user's posts into a grid (public-only on others' profiles); tap opens the
  full-screen `PhotoViewer`. Seed: added photos to Mara's Fillmore post to demo it.
- **a11y slice:** accessibility labels/roles on the core nav controls (ScreenHeader
  back, bottom tab bar, profile back).

## Recently done (earlier stretch)
- Backend foundation + admin seed; launch on Render + GoDaddy DNS + HTTPS.
- Real **Google map** on "Near you" (drawn map is the no-key fallback); watermark-safe city label.
- Mobile fixes: iOS **safe-area** insets (viewport-fit=cover + dynamic viewport); **search** = segmented tabs + single scroll (was unreachable stacked panes); **landing scrolls** so large text can't overlap; desktop 3-col shell only ≥1150px (tablets/landscape get mobile layout).
- Photo reliability: prune dead URLs + runtime proxy fallback (wsrv.nl) + skip-on-error, so venues aren't blank.
- Signup **artist taste picker** feeding recommendations; "Make a post" rename; theme presets (4); community search (fan clubs + afterparties); emoji removed.

## Open backlog (user-requested)
- ~~Setlist spoiler tag~~ ✅ (2026-07-04)
- ~~Theme saved to the account + chosen at signup~~ ✅ (2026-07-04)
- ~~Profile photo gallery~~ ✅ (2026-07-04)
- ~~DM Requests vs Friends split~~ ✅ (2026-07-04)
1. **Full SQLite migration** — move `src/store.js` dynamic data onto the backend
   API. **Big open task; started.** See **`MIGRATION.md`** for the ordered plan +
   prerequisites (server data seeding, missing read endpoints). Done so far:
   **slice 1 (follows)**, **slice 2 (posts/feed)**, **slice 3 (likes/comments)**,
   **slice 4 (DMs)** — all write-through + hydrate, best-effort/non-breaking.
   `hydrateFeed()` pulls the public server feed on load (guests too) and merges it
   over the bundled seed; `addLog`/`toggleLike`/`addComment`/`sendDM` write through
   and adopt server ids; `loadComments()`/`loadThread()` hydrate a thread on open.
   DMs added 3 endpoints (`GET /api/me/threads`, `GET`/`POST /api/dms/:otherId`);
   the Requests/Friends split + unread stay client-side. `chooseTheme` (server
   `extras.theme`) was the original template. **Verified end-to-end** against
   `npm run server` (3000): signup→post→like→comment and two-way DMs persist and
   re-hydrate. **Slice 5 (fan clubs)** also done: `GET /api/me/fanclubs` +
   join/message write-through + `loadFanClub()` hydrate (messages + real member
   count). Remaining slices: reports, ratings/going/venue-reviews. Verify with the
   server running + a real signed-up account (`u_demo` is offline-only).
2. **Broader mobile/responsive polish + accessibility.** Started: a11y
   labels/roles on core nav controls. Remaining: audit remaining icon-only buttons,
   test large OS text sizes for clipping in fixed-height rows, tighten responsive
   breakpoints. (Native `<Text>` already scales with OS size by default.)

## Known gotchas
- **Hard-refresh** after deploys/changes (browser caches the bundle).
- Git shows harmless `LF will be replaced by CRLF` warnings on Windows — ignore.
- `node:sqlite` needs Node ≥ 24.
- Background processes started in a chat session are killed when that session ends — restart `npm run pipeline` / `npm run server` as needed.
