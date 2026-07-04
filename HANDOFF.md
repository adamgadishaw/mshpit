# PIT / mshpit.com — Handoff

> **Living doc.** Whoever works on this next: read this first, and UPDATE it before you end a session (move things between "Done" and "Backlog", note anything running). Point a fresh Claude Code chat at this file to get up to speed without re-explaining.
>
> Last updated: 2026-07-03

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

## Recently done (this stretch)
- Backend foundation + admin seed; launch on Render + GoDaddy DNS + HTTPS.
- Real **Google map** on "Near you" (drawn map is the no-key fallback); watermark-safe city label.
- Mobile fixes: iOS **safe-area** insets (viewport-fit=cover + dynamic viewport); **search** = segmented tabs + single scroll (was unreachable stacked panes); **landing scrolls** so large text can't overlap; desktop 3-col shell only ≥1150px (tablets/landscape get mobile layout).
- Photo reliability: prune dead URLs + runtime proxy fallback (wsrv.nl) + skip-on-error, so venues aren't blank.
- Signup **artist taste picker** feeding recommendations; "Make a post" rename; theme presets (4); community search (fan clubs + afterparties); emoji removed.

## Open backlog (user-requested, not yet done)
1. **Setlist spoiler tag** — re-introduce the spoiler gating on setlists.
2. **Theme saved to the account** (persist server-side; survives sign-out / new device) and **chosen at signup**. Currently theme is localStorage-only + reload-based (`src/theme.js`).
3. **Profile photo gallery** on individual profiles.
4. **DM Requests vs Friends** split — strangers go to Requests, not the main inbox.
5. **Full SQLite migration** — move `src/store.js` dynamic data (accounts, posts, follows, comments, DMs, fan clubs, ratings) onto the backend API. This is the structural fix that also ends the "stale bundle / dev reload" pain for real data.
6. Broader mobile/responsive polish + accessibility (respect OS text-size).

## Known gotchas
- **Hard-refresh** after deploys/changes (browser caches the bundle).
- Git shows harmless `LF will be replaced by CRLF` warnings on Windows — ignore.
- `node:sqlite` needs Node ≥ 24.
- Background processes started in a chat session are killed when that session ends — restart `npm run pipeline` / `npm run server` as needed.
