# Pit — project instructions

Read `BRIEF.md` first for the product vision, then this file for how the code is
laid out and the rules to respect.

**Pit** is a "Letterboxd for concerts": you log shows you've been to, rate and
review them, post photos/clips, and follow people whose taste matches yours to
discover bands worth seeing live. Social-first is the wedge — the incumbents
(Concert Archives, Encore, Setlist.fm) are archive-first.

## Stack

- **Expo (React Native)** — one codebase, iOS + Android. SDK 56, React 19, RN 0.85.
- JavaScript (JSX), no TypeScript yet. Plain `StyleSheet`, no UI library.
- **No backend yet.** This is a clickable prototype: data is in-memory
  (`src/data.js`), state lives in `App.js`. Logging a show prepends to the feed
  and resets on reload. The real build replaces `src/data.js` with the
  Performance / Artist / Venue spine described in `BRIEF.md`.

## Run it

```
npm install        # once
npx expo start     # scan the QR with Expo Go (iOS App Store / Android Play Store)
```

## Architecture

- `App.js` — root. Holds tab state, the in-memory feed, and lightweight overlay
  navigation (show detail + the log flow). No nav library yet; swap in
  `expo-router` when screens multiply.
- `src/theme.js` — the **stage-light** design system. Use these tokens; don't
  hardcode colors.
- `src/data.js` — mock data, `newId()`, and `rankShows()` (best-rated ranking).
  `ratedShows` = base seed + the ingested `catalogShows`.
- **Location layer** (`store.js`): every user has a `home` { city, lat, lng }
  (set at signup, editable in profile). `localVenues`/`regionShows` filter by
  `haversineKm` within 75 km; `localFeed` shows people in your city;
  `recommendedShows` ranks upcoming shows by genre affinity + proximity + who you
  follow. `cityCoords` + venue `lat/lng` stand in for real geocoding. Tour dates
  carry `soldOut` (Ticketmaster `offsale` status on ingest).
- `src/seed/catalog.js` — legally-sourceable seed (venue facts, tour dates,
  setlists). `scripts/ingest.mjs` regenerates/extends it from open APIs —
  **see `DATA_SOURCES.md`**. Rule: facts (dates/setlists/venues) are free.
  Photo galleries self-heal through a tiered pool: Commons → Openverse (both
  licensed/attributed) → **Google Images** as a last resort (`source:"google"`,
  used **takedown-on-request** via store `removePhoto` — not license-cleared).
  Still NO HTML scraping of Ticketmaster/Songkick/socials for *facts* (ToS).
- `src/store.js` — **prototype in-memory store** (React context, `useStore()`):
  auth/session, users, feed, moderation (`removedIds`), artist requests, tour
  dates. NO backend — resets on reload. `isStaff(role)` / `isArtist(role)` helpers.
- `src/components/` — `Icon` (hand-drawn SVG set — NO emoji), `TicketStub` (feed
  card), `Stars` (clipped half-stars), `RatingSplit` (band-vs-room meters).
- `src/geo.js` — Continent→Country→State→City hierarchy + `formatPlace()` (feeds
  the structured `LocationPicker`, so no typos/format drift).
- `src/components/` also has `Avatar` (photo or initials, tappable),
  `LocationPicker` (drill-down), `DatePicker` (Year/Month/Day columns), and
  `CityMap` — a stylized SVG "soundmap" (no map tiles): streets generated
  deterministically from the city name, venues plotted by real lat/lng, the focal
  venue glowing with radar rings. Static and on-theme by design.
- `src/screens/` — `Feed` (with a Following/Everyone filter via `followingFeed`),
  `Search` (artists/shows/dates), `Discover`, `You`, `Artist` (live-reputation
  rollup across every night via `artistSummary`, plus upcoming dates), `Venue`
  (room reputation via `venueSummary` — sound/sightlines/crowd aggregate here,
  not to the band — with capacity, upcoming dates, and a Commons photo banner once
  ingested), `Show` (performance page, with a "Log/review this show" CTA and links
  to the artist + venue pages, plus a `CityMap`), `Nearby` (local venues + region
  shows with a toggleable 25/50/75/150 km radius, a city selector to browse any
  city, an overview `CityMap`, and sold-out badges), `Log`, `TopRated`, `Auth`
  (signup captures your city), `Admin`
  (report queue + approvals + manual override), `BulkTourDates` (batch + scheduled
  release), `RequestArtist`, `Profile` (social profile), `EditProfile` (photo via
  `expo-image-picker`), `Report` (reason picker).

## Roles, auth & moderation (prototype)

- **Roles** are plain strings: `fan` (default), `artist` (admin-approved),
  `admin`. Gate with `isStaff` (admin) and `isArtist` (artist or admin).
- **Auth**: cookie/JWT sessions don't exist yet — `store.login/signup/logout`
  just hold the current user in memory. Logging a show is gated behind login (the
  `+` opens Auth if logged out).
- **Artist accounts** are request → admin-approve: a fan submits a
  `RequestArtist`; an admin approves in `Admin`, flipping their role to `artist`
  and letting them post tour dates (only for their own `artistName`).
- **Moderation is per-report, not review-first.** Content is public the moment
  it's posted (Letterboxd-style). Users `reportContent(id, reason)`; admins triage
  the **report queue** and `actionReport` (removes) or `dismissReport`. Admins can
  still `removeContent`/`restoreContent` manually. Public feed uses
  `visibleFeed(false)` to hide removed posts; staff see everything flagged. Admin
  role = report triage, verification distribution, and site upkeep.
- **Tour dates / tickets**: artists/admins post a **bulk batch** via
  `BulkTourDates` with a **scheduled release** (`releaseAt`) — dates stay private
  to the creating team until release, then `visibleTourDates` exposes them. Each
  gets a real **Ticketmaster** link (`Linking.openURL`). Locations come from the
  `LocationPicker` cascade and dates from `DatePicker` — never free text.
- **Profiles & social graph**: every user has an avatar (uploaded photo or
  generated initials), bio, genres, and playlists. Tap any avatar/name to open
  their `Profile` (recent concerts, counts, top genre, playlists). `follow` /
  `unfollow` drive the social graph. Clicking a concert anywhere opens the
  performance page, where you can log/review it in post.

When this goes real, `src/store.js` is the seam to replace: move it to a backend
(server sessions, DB, an `AuditLog` for every mod action, real artist
verification) and keep the same `useStore()` shape so screens don't change.

## Rules to respect (these are the product, not decoration)

- **The data spine is two levels.** A `Performance` = one artist + one venue +
  one date (the thing people rate). An `Artist` sits above it so nights roll up
  into "how good are they live, generally." Keep this distinction — it's what
  makes ratings aggregate instead of fragment.
- **Band vs Room split.** Performance/setlist/energy = "the band"; sound/venue/
  crowd = "the room." Room scores must aggregate to the *venue*, never drag down
  the artist. See `RatingSplit`.
- **Logging is one tap.** Only an overall score is required; the breakdown and
  review are optional. Don't add required fields to the log flow — friction kills
  the habit.
- **Setlists are spoiler-gated** when a show is inside the artist's active tour
  window (`inTourWindow`). Default to hidden in that case; tap to reveal.
- **Seed from real data, never hand-entry.** The real build pulls artists/venues
  from MusicBrainz, past shows/setlists from Setlist.fm, upcoming dates from
  Bandsintown/Songkick, and copies Encore's email-import trick. Don't build a
  catalog by hand.
- **Theme is "stage-light," dark.** Deep blue-black venue, tungsten amber ("the
  band"), cool blue ("the room"), gold stars, magenta gel accent. Mono type for
  dates/stats (ticket-stub printing). No generic "dark + one neon" cliché.

## Conventions

- Functional components, hooks. Keep screens in `src/screens`, reusable bits in
  `src/components`.
- Import design tokens from `src/theme` — `colors`, `mono`, `radius`, `space`.
- Don't bulk-edit `.jsx` with PowerShell Get/Set-Content (mangles UTF-8). Use the
  editor tools.
