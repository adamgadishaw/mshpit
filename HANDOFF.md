# PIT / mshpit.com — Handoff

> **Living doc.** Whoever works on this next: read this first, and UPDATE it before you end a session (move things between "Done" and "Backlog", note anything running). Point a fresh Claude Code chat at this file to get up to speed without re-explaining.
>
> Last updated: **2026-07-09**

> **Working agreement (owner's standing instruction):** ALWAYS `git commit` **and** `git push` to `master` after a change — no need to ask. Push auto-deploys (brief 502 while Render restarts). Do not leave work only committed locally.

**Artist ranking = Deezer, NOT Spotify (2026-07-09).** Spotify's dev-mode app strips `popularity`/`followers`/`genres` from every artist endpoint (Nov-2024 change), so the scraper never got rank data. `scripts/enrich-deezer.mjs` (keyless `nb_fan` → 0-100 popularity) is the ranking source now — wired into the pipeline, backfilled for 1,629 artists, drives Top-100 + the Discover podium. The DB **re-merges the bundled catalog on every boot** so refreshed popularity/rank propagates. Don't re-enable Spotify for rank unless the app gets extended quota. **Player:** the bottom sheet is gone — `PlayerBar.jsx` is a persistent top toolbar (queue-aware prev/next, plays via the Spotify embed, keeps playing across navigation). **Spotify Connect (Web Playback SDK) IS built now** (OAuth in `server/api.js` `/api/spotify/*`, tokens stored server-side, `PlayerBar.jsx` streams full tracks when connected, connect prompts at signup + Settings). **It needs config to work:** (1) set `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` on the **Render web service** (they're only in local `.env` today); (2) in the Spotify dashboard add redirect URIs `https://www.mshpit.com/api/spotify/callback` and `http://localhost:3000/api/spotify/callback`; (3) app is in **dev mode**, so add each tester's Spotify account under Users (max 25) or request extended quota; (4) full playback needs listener **Premium**. Without config, Connect throws a clean 503. **Search people = pure type-ahead** now (never a full list). **Style rule: no em-dashes anywhere** (swept from all src+server copy 2026-07-09).

**Members ARE persisting + searchable** (verified live: `GET /api/people?q=` returns the directory + `total`). The old "can't find anyone" was a missing UI, not lost data: no member browse, no member count, and the People list had been emptied. Fixed 2026-07-09 (empty search now browses the member directory; Discover has a MEMBERS stat).

**Artist catalog is now DB-BACKED (2026-07-09)** — the fix for "missing key artists / can't keep manually inputting them." Artists moved out of the bundled JSON into a server `artists` table (seeded once on boot from `catalog.generated.json`). Endpoints: `GET /api/artists?q=` (search, notable-first via `rank_score`) and `GET /api/artists/resolve?name=` (**on-demand**: if absent, fetch from MusicBrainz + insert — so no artist is ever missing; the first lookup creates it). Client wired: Search queries the API + a "Look up '…'" row resolves misses; ArtistScreen resolves on open. Verified live (Gulfer/Oso Oso created from MB). **Bulk pre-seed:** `scripts/seed-mb-dump.mjs <mbdump-dir> --min-releases N` loads notable MB artists (ranked by release count) — run locally or in a Render one-off shell against `PIT_DATA_DIR=/data`; NOT run on deploy. The tag-crawl (`ingest-artists.mjs`) is now just for growing the bundled seed; the DB is the real catalog.

---

## What this is
**Pit** (live at **mshpit.com**) — "Letterboxd for concerts." Log shows, rate band-vs-room, follow people with your taste, discover gigs worth seeing, chat in fan clubs / afterparties, DMs. Expo / React Native (web + iOS/Android via react-native-web), JavaScript, no TypeScript. See `BRIEF.md` (vision) and `CLAUDE.md` (rules).

## Run it locally
```
npm install
npx expo start --web         # app on http://localhost:8081  (NO CSP in dev)
npm run server               # backend API on :3000 + serves the web build (server/index.js)
npm run pipeline             # local scraper (roster + Spotify enrichment); writes the bundled catalog
```
- **Node 24 required** (`node:sqlite`). After code changes, **hard-refresh (Ctrl+Shift+R)** — Metro caches the bundle; this repeatedly looked like "changes didn't apply."
- **Dev architecture:** the Expo dev server (:8081) serves the app and talks to the backend at `localhost:3000` (see `src/lib/api.js`). Run BOTH for full-stack local testing. `npm run server` does **not** auto-load `.env`; pass env vars inline if the in-process tour-date scheduler needs them (e.g. `TICKETMASTER_KEY`).
- Build-check without a browser: `curl "http://localhost:8081/index.bundle?platform=web&dev=true"` and grep for `SyntaxError`/`Unable to resolve`.

## Deployment (LIVE) — **auto-deploys, nothing manual for code**
- Host: **Render**, Blueprint via `render.yaml`. Plan: **Starter** ($7/mo — needs the **persistent disk** at `/data` holding `pit.db`; without it every deploy wipes users).
- Build `npm ci && npm run build:web` → start `node server/index.js`. Health check `/api/health`.
- Domain **mshpit.com** (GoDaddy). DNS `A @ → 216.24.57.1`, `CNAME www → mshpit.onrender.com`. HTTPS auto. Cloudflare sits in front (index.html is `no-cache`).
- **Code changes deploy automatically on push to `master`** (repo `adamgadishaw/mshpit`, `autoDeploy: true`). A brief **502 for ~30–60s after each push is normal** (service restarting) — wait and refresh.
- **`render.yaml` structural changes** (new services, env-var slots) need a **Blueprint re-sync** in the Render dashboard to take effect. Code alone does not.
- ⚠️ **TODO in Render dashboard:** delete the retired **`pit-catalog-refresh` cron** service (replaced by the in-process scheduler — see Scraper). It will otherwise keep failing daily.
- Full details: `LAUNCH.md`.

## Backend — the client IS now wired to it
- `server/` — **zero-dependency** Node (built-ins only: `node:sqlite`, `crypto` scrypt + HMAC sessions). Tables/schema in `server/db.js`; routes in `server/api.js`; boot/CSP/static-serving in `server/index.js`; auth in `server/auth.js`; tour-date scraper in `server/tourdates.js`.
- **The SQLite migration is DONE (slices 1–7).** `src/store.js` is now a reactive cache: it **hydrates** from the API on load/login and **writes through** on mutations (best-effort, offline-safe — the app still works with no backend on the bundled seed). Server-backed: auth, follows, feed/posts, likes, comments, DMs, fan clubs, reports/moderation-queue, ratings, going, notifications, people search, profile edits (incl. @handle), tour dates. See `MIGRATION.md`.
- **DB tables:** users (+ `handle_changed_at`), sessions, posts, likes, comments, follows, dms, fan_club_members, fan_club_messages, reports, ratings, going, **notifications**, **tour_dates**, **events** (analytics), schema_version. Additive column migrations run on boot (guarded `ALTER TABLE … ADD COLUMN`, see bottom of `db.js`).
- **Admin** seeded from env `ADMIN_EMAIL` (default adamgadishaw@gmail.com) + `ADMIN_PASSWORD` on boot.
- **Session restore on reload:** an `/api/me` effect in `store.js` re-absorbs the account + re-hydrates everything (fixed the old "data didn't save on reload").
- **CSP** (in `server/index.js`, prod only — dev has none): broad `img-src`; `script/connect/worker-src` allow `*.googleapis.com`/`*.gstatic.com` (interactive map); **`frame-src`** allows `open.spotify.com` + `youtube.com`/`youtube-nocookie.com` (in-app players). If you embed a new external thing and it's blank on prod but fine in dev, it's almost always the CSP.

## Secrets & keys
- **Local `.env`** (gitignored): `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `EXPO_PUBLIC_GOOGLE_MAPS_KEY`, `TICKETMASTER_KEY`.
- **Google Maps key** is committed as a `value:` in `render.yaml` (safe — `EXPO_PUBLIC_*` ships in the public bundle regardless; the key is referrer-locked + the **Maps JavaScript API is enabled**, so the interactive map works live).
- **Render WEB-service env** (dashboard, `sync:false`): `ADMIN_PASSWORD`, and for tour dates `TICKETMASTER_KEY` and/or `BANDSINTOWN_APP_ID` (+ optional `TOURDATE_LIMIT`, `TOURDATE_REFRESH_H`). Spotify keys are only for the **local** scraper enrichment, not the server.
- ⚠️ The Ticketmaster key in `.env` currently returns **`Invalid ApiKey`** — almost certainly the new-key **activation delay** (TM keys can take hours). Re-test: `curl "https://app.ticketmaster.com/discovery/v2/events.json?keyword=Coldplay&apikey=KEY"` — when it returns events (not a `fault`), it's live. **Bandsintown** now requires an **approved app_id** (self-assign no longer works). **SeatGeek** (free instant `client_id`) is the easiest untried backup.
- If a secret was pasted into a chat, **rotate it.**

## The scraper / data pipeline
Two separate paths now:
1. **Roster + media (bundled file, manual).** `npm run pipeline` → `scripts/pipeline.mjs`: grows the artist roster from **MusicBrainz** (keyless; ~50 genre tags, `ARTIST_TARGET` default **1500**), syncs curated arenas, then Spotify photos → album covers → top tracks → venue photos. Precheck-skips finished work; 15s timeouts + 45-min stage watchdog. **Writes `src/seed/catalog.generated.json`** (bundled) → only reaches LIVE after a rebuild/push. Running it while `expo start` is up triggers dev hot-reloads. Catalog now ~560 artists / ~1010 venues. `--once` runs a single cycle.
2. **Tour dates (DB, automatic, live).** `server/tourdates.js` runs **in the web server** on a timer (`startTourDateScheduler()`), scraping **Ticketmaster + Bandsintown** (whichever keys are set) for the top artists by popularity and upserting into the `tour_dates` table. `GET /api/tourdates` serves them; the client hydrates + merges over the bundled catalog. **No cron, no git push, no redeploy — live the moment it writes.** Needs `TICKETMASTER_KEY` and/or `BANDSINTOWN_APP_ID` on the Render web service. (Render disks attach to ONE service, which is why a cron can't do this — it runs in-process.)
- `scripts/enrich-tourdates.mjs` is the standalone/local version (writes the bundled file). `scripts/cron-scrape.mjs` is the **retired** git-push cron entrypoint — kept for reference, not used.

---

## Workflow rule (standing)
- **Always commit AND push finished work to `master`** (auto-deploys to mshpit.com) — the user asked for this as the default; don't wait for per-change approval. An automated committer also periodically commits `catalog.generated.json` (scrape output).

## This session (2026-07-09, latest)
- **Discover = music-data dashboard.** Rebuilt `DiscoverScreen` as a "data-center": KPI tiles (artists/venues/countries/genres), a **top-3 podium** with new gold/silver/bronze **medallion badges** (`rank1/2/3` in `Badge.jsx`, drawn numerals), a **region→genre donut** (drawn with react-native-svg arcs, country picker from catalog `country` field, `topGenres`), and a **top-photos wall** (most-liked feed photos). Store: **ranking-provider framework** `chartTop`/`chartInfo` — abstracted `CHART_SOURCE` (`spotify-popularity` now → swap to `billboard-hot-100`/`in-app-score` later), **falls back** popularity → followers → fan-reputation → A–Z so the podium always fills; plus `catalogCountries`, `topGenres`, `topPhotos`, `discoverStats`. (Removed the old "For you"/tasteMatches sections — say if you want them back.)
- **Search polish.** Kept the typeahead; added an editorial header (kicker + "Search") and a bigger, elevated field to match Discover.
- ⚠️ **Spotify egress is blocked in the sandbox** (calls hang), so `popularity` can't be scraped here — the podium runs on fan-reputation until you run `npm run pipeline` on your machine (where Spotify works), then it auto-upgrades to real popularity. **Ticketmaster key IS provided** (per user) — still needs to be set on the Render **web service** env to make live tour dates flow (backlog #5).

## This session (2026-07-09, later)
- **Navigation persistence.** Reload no longer dumps you on the feed / flashes around: `App.js` now persists `tab` + the whole nav `stack` (localStorage, `pit.tab`/`pit.stack`) and restores synchronously in the `useState` initializers, and **rebuilds browser history to the restored depth** on mount so Back stays 1:1. `exitToLanding` resets nav (feed + empty stack) on logout.
- **Admin-managed verification.** New admin-granted blue check, independent of role (groundwork for a paid tier — not surfaced as paid). Full-stack: `users.verified` column + `POST /api/admin/users/:id/verified` (admin-gated) + `publicUser` projection; store `setVerified` (optimistic, best-effort write-through); `userBadges` folds it in (deduped). Admin → Members tab has a **Verify** toggle per user + shows the badge on the row.
- **Search = typeahead dropdown.** Removed the People column and the whole multi-column/tab layout. `SearchScreen` is now one character-matched **dropdown** merging artists/venues/events/fan clubs (prefix matches first, per-type icon + tag, badges on artist rows); empty state shows a Popular-artists + Trending-venues browse shelf.

## Earlier this session (2026-07-09) — badges, map, search-people, 10k scrape
- **Search — People auto-match.** Killed the endless default People list; results now populate only as you type, matched on characters against name/@handle (`SearchScreen.jsx`).
- **Map polish.** Replaced the flat `SymbolPath.CIRCLE` markers ("MS-Paint circles") in `LiveMap.jsx` with themed teardrop SVG map-pins (drop shadow, glossy highlight, white core; amber focal w/ glow, blue venues, magenta afterparty dots). Added a **Google-Maps-style hover card** (photo · name · place+capacity · star rating) positioned via a hidden `OverlayView` projection, themed dark. `NearbyScreen` now enriches each pin with photo/rating/cap from `venueSummary`.
- **Badge / verification system.** New `components/Badge.jsx` — generated scalloped verification **seals** (Catmull-Rom spline, `sealPath()`) + gold **Top-100 star medallion**; `Badge`, `BadgeRow`, `BadgeChip`. Types: `verified` (blue), `top100` (gold), `staff` (magenta), `mod` (green), `founder`. Wired into ArtistScreen (real, data-driven — replaced the always-on "VERIFIED ARTIST" tag), ProfileScreen, TicketStub (feed author), and Search rows. Store: `isVerifiedArtist` (claimed+approved account), `isTop100`/`artistRank` (Spotify popularity, `ARTIST_RANK` map), `artistBadges`/`userBadges`, `roleBadge`. **Colored @s** extended: verified artist → amber (`roleColor` in `theme.js`).
- **10k scrape.** `pipeline.mjs` `ARTIST_TARGET` default → **10000**; `ingest-artists.mjs` now **paginates** MusicBrainz per tag (offset, `PER_TAG`=depth default 400) with a global target stop — fixes the old ~2.5k plateau (each tag was single-page, exhausted after one pass). `enrich-spotify.mjs --missing` now also **backfills null `popularity`** (needed for Top-100; the 559 pre-enriched artists never had it). Pipeline running in background this session — mainly backfilling popularity. To grow toward 10k: `ARTIST_TARGET=10000 npm run pipeline` (hours; MusicBrainz ~1 req/s; ~60MB bundle at 10k per your call).

## Recently done (2026-07-09 session)
Everything below is committed to `master` and auto-deployed.
- **In-app playback (Spotify).** No more `Linking.openURL` to spotify/youtube for music. New `SpotifyEmbed.jsx` (mounts the official embed iframe into the RNW DOM node; native falls back to tap-to-open) + `MediaSheet.jsx` (floating player sheet, opened via `App.js` `openPlayer`). Artist pages get a **LISTEN** section (artist embed) + song taps + Listen button + album art all play in-app. CSP `frame-src` opened for Spotify + YouTube. **Video is NOT embedded yet** — no video IDs in the data (see backlog).
- **Real @handles.** Editable **USERNAME** in Edit Profile with live available/taken check; server enforces uniqueness (409). Profile edits (name/handle/bio/avatar/banner/city/genres) now **write through to the server** (previously only theme persisted). **10-business-day cooldown** on handle changes (`users.handle_changed_at`; 429 with next-eligible date). **Staff role-tags:** admins must have `admin` in their @, mods `mod` (enforced on change; `setUserRole` auto-tags on promotion). **Colored @s** (Discord-style): admin = magenta, moderator = green — in profile header, feed author line, account chip (`roleColor()` in `theme.js`).
- **8 themes** (was 4): dark = Stage/Neon/Forest/**Ember**; light = Daylight/**Ice**/**Rose**/**Mint**. All shown as swatches in Edit Profile. **Shadows are theme-aware** (`shadow` in `theme.js`) — dark themes get a deeper shadow so cards read as lifted (a black shadow vanished on the near-black page = the "dark has no depth" complaint).
- **Find friends.** `GET /api/people` (name/handle search) + a **People** tab in Search with avatars + inline Follow/Following; results absorbed into `users`. `searchPeople`/`absorbUsers` in store.
- **Moderation console** rebuilt (tabbed: Overview/Reports/Members/Content/Requests); fixed the stretched-oval tab bar. **Moderator role tier** (`isMod`): mods moderate reports/members/content; admins also administer roles, see the Audience/ads panel, approve artists. Members tab = role pills + Timeout/Ban/Unban.
- **Discover = hub** (Explore grid surfaces Best rated / Near you / Fan clubs / Find venues). **Nav cohesion:** Activity + Inbox reachable from the You tab. **Onboarding:** welcome notification + dismissible "Get started" feed card. **Visual polish:** shadows, real segmented control, real photo thumbnails in the feed (killed the empty-placeholder tiles), guiding empty states.
- **Notifications / Activity** — server-backed cross-device (`notifications` table, `addNotif()` from follow/like/comment/DM, `GET/POST /api/me/notifications[/read]`, client hydrate). `NotificationsScreen`.
- **Quick wins:** log-a-show **date picker** (DatePicker takes a year range; past years back to 2000); **map city labels** brightened for dark mode; **artist profile reordered** (upcoming shows → fan reviews → fan photos, releases/songs below).
- **Interactive Google map** fully working live (was falling back to the static image because the server **CSP** blocked `maps.googleapis.com`; widened it). LiveMap (pan/zoom, clickable pins) on Nearby + the performance page (`AfterpartySection`: venue + afterparty pins).

## Earlier sessions (condensed)
- **SQLite migration slices 1–7** complete (see Backend + `MIGRATION.md`).
- **Privacy + Terms** rewritten as full FB/Twitter-style docs (activity collection, profiling, **ad targeting**); **consent checkbox at signup** (`consentAt`/`TERMS_VERSION`); **analytics** (`events` table, `POST /api/events`, `GET /api/admin/analytics`, client `track()`, Admin "Audience & ads" panel).
- **Back navigation** rebuilt as a real stack in `App.js` (`go`/`back`/`replace`/`clear`; browser/Android Back wired in). **Data-loss-on-reload** fixed (`usePersisted` + `/api/me` restore).
- Setlist spoiler gating; theme saved to account; DM Requests-vs-Friends split; profile photo gallery; a11y on core nav.
- Backend foundation + admin seed; Render + GoDaddy + HTTPS launch. Mobile safe-areas; search segmented tabs; photo self-heal (wsrv.nl proxy).

---

## Open backlog (what to do next)
**User-requested, not yet done:**
1. **📱 Mobile polish.** User says mobile "feels like old-gen Pit, not easily accessible." Needs iterative visual work — get a phone screenshot of the feed (or resize narrow) and fix header density / touch targets / spacing on real pixels. Browser tools (claude-in-chrome / preview) have been **flaky all session** — a full screen-by-screen visual audit is still open; do it with a working preview.
2. **🛡️ Moderation user-tracking.** Extend the Members tab: **users per region + a live total count**; **granular Discord-style mutes** — remove/mute a user within a specific **fan club** or **afterparty** (not just global ban/timeout). Self-contained; buildable without a browser.
3. **🎬 Video embeds (in-app).** CSP is ready for YouTube. Two paths: (a) scrape a top **YouTube video ID** per artist (needs a free YouTube Data API key) → embed a WATCH section; (b) let users attach **video clips** to posts and play inline. Music (Spotify) is done; video is the remaining "keep them in-app" piece.
4. **🔔 Show-near-you push.** Notify when a followed/loved artist announces a gig near the user's city. Depends on a **working tour-date source** (see below). This answers "what to push besides DMs."
5. **Tour dates need a valid key.** Set `TICKETMASTER_KEY` on the Render **web service** (the current key is invalid — likely still activating; re-test per Secrets). Or add **SeatGeek** as a source (free instant key; ~10-min wire-up next to the TM/Bandsintown fetchers in `server/tourdates.js`).
6. **Sponsored feed slot.** The analytics collect ad-interest signals (top genres/artists/searches); the actual targeted "Sponsored" feed card keyed to a user's taste is **not built**.
7. **Roster growth to prod is still manual** (bundled catalog): `npm run pipeline` locally → push. Could be re-automated later (a proper cron/worker or moving artists to the DB too).

## Known gotchas
- **Spotify app is in RESTRICTED / dev mode** → popularity/followers/genres are stripped from every artist endpoint (search omits them, `/artists/{id}` returns a stub of `id/name/images/uri`, `/artists?ids=` **403s**). Photos + top-tracks (search) still work. **Top-100 ranking cannot use Spotify popularity** until the app is approved for **extended quota mode** (Spotify dashboard → request extension). `enrich-popularity.mjs` exists + aborts fast when restricted; the pipeline has NO popularity stage for now. Until then, the chart/podium falls back to **fan-reputation** ranking; the founder also wants a **Billboard Hot 100** source for the Top-3 pedestal + Top-100 badge (backlog).
- **Hard-refresh** after deploys (bundle cache). Brief **502 right after a push** = normal restart.
- **CSP** blocks new external embeds/scripts on prod (fine in dev) — update `server/index.js` `frame-src`/`script-src`/`connect-src`.
- **Render disks are single-service** — background scrapers must run in the web process (that's why tour dates moved in-process).
- Git shows harmless `LF will be replaced by CRLF` on Windows — ignore.
- `node:sqlite` needs Node ≥ 24. Background processes started in a chat die when the session ends — restart `npm run server` / `npm run pipeline`.
- Don't bulk-edit `.jsx` with PowerShell Get/Set-Content (mangles UTF-8) — use editor tools.
