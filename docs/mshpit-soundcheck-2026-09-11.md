# Mshpit Soundcheck: audit and running order, 2026-09-11

This is the current credibility plan. It supersedes the improvement lists in
`PIT_100_IMPROVEMENTS_2026-08-21.md`, `PIT_RESEARCH_BACKED_IMPROVEMENTS_2026-08-20.md`,
`PIT_RESEARCH_BACKED_IMPROVEMENTS_2026-08-21.md`, `MSHPIT_PRODUCT_EXPANSION_PLAN.md`,
and the project audits dated 2026-07-28 and 2026-08-04 as the source of what to
work on next. Evidence and current release state still live in `STATUS.md`.

Scope: repository at `cf3e328`, the live site and its public sitemaps fetched
signed out on 2026-09-11, and a local database copy dated 2026-08-13 that
appears to be early production. Current production user numbers are pending;
run `npm run audit:userbase` in the Render Shell (counts only).

## The short version

The copy is not the problem. A scan of every screen and public page found no
stock AI phrasing worth counting, no emoji, and 36 em-dashes, most of them in
generated page titles. The problem is shape: a site with a few dozen member
posts presents itself through 65,000 generated pages and a feature list sized
for millions. Visitors land on empty artist pages, ticket add-ons listed as
concerts, and text in 44 different sizes. Developers open a repository with 41
root markdown files, no README, and a 9,034-line routes file. Most of the fix is
subtraction.

## Who made the site (live sitemaps, 2026-09-11)

| Page type | URLs |
| --- | ---: |
| Ticketmaster events | 52,120 |
| Venues | 7,055 |
| Cities | 3,494 |
| Artists | 2,438 |
| Home, about, policies | 15 |
| Made by members (34 posts, 41 concert pages, 8 profiles) | 83 |
| Total | 65,205 |

## Layer by layer

Levels: clean (healthy), hot (working, with real risk), clipping (distorting
what people see).

1. **Disk and hosting: hot.** One Render instance with SQLite on a persistent
   disk, so every deploy is about a minute offline. The 1 GB disk filled on
   2026-09-11 and the site was down about 14:43 to 15:25; the disk is now 5 GB
   and the startup backup prunes to fit (`cf3e328`). No off-site backups, no
   staging, and direct pushes bypass the pull-request rule on `master`.
2. **Schema: hot.** 93 tables across 11 files; 162 indexes, 37 triggers, 92
   foreign keys, 160 CHECK constraints. Changes are 142 boot-time
   `ALTER TABLE ... ADD COLUMN` statements, not numbered migrations. `users` has
   44 columns including unused Spotify token columns. Lists live as JSON in text
   columns (post photos, setlists, tagged users, rating dimensions, user genres
   and favorite artists).
3. **Show identity: clipping.** `CLAUDE.md` makes the Performance the core
   entity, but posts store artist, venue, city and date as free text with no
   show id column. In the 2026-08-13 snapshot 17 of 18 live posts had no artist
   key and 16 no venue key; the local dev database has no `shows` rows.
   Attendance keeps eight `legacy_*` text columns.
4. **Catalog: clipping.** The landing page advertises 30,161 artists and 7,848
   venues while the sitemaps index 2,438 and 7,055. The landing page lists
   "Freedom Street Europe 2026 Souvenir Ticket" as an upcoming live event even
   though `publicMusicEventTitleViolations` rejects souvenir tickets, and it
   showed a September 10 event as upcoming on September 11. 1.7% of local event
   names look like ticket add-ons.
5. **Queries and routes: hot.** 162 inline routes in `server/api.js` (9,034
   lines); `server/db.js` 3,096 lines. `tour_dates` has at least eight indexes
   that take about as much space as the table locally. The architecture checker
   tracks 102 silent catches and 47 ambiguous async fallbacks.
6. **Privacy and retention: hot.** Live code stores empty session IP and user
   agent (`server/auth.js`) and no analytics IP (`server/analyticsService.js`).
   The local `backups/pit-20260813-195945.db` holds what look like real accounts
   plus raw IPs and user agents for 36 sessions, unencrypted on disk (git
   ignored). Spotify token columns remain.
7. **People: clipping.** Live: 34 public posts, 41 concert pages, 8 member
   profiles. 2026-08-13 snapshot: 15 real-looking accounts, all created in July,
   plus 3 on test domains; 6 live posts from 4 real people and the other 12 of 18
   from test accounts; 1 of 15 active after their first week; 5 of 15 never
   recorded an action; every account with a home city chose the same city.
   Current production: pending `npm run audit:userbase`.

## What developers see

- **Volume:** 256,068 lines across 1,455 JavaScript files since 2026-07-03, 341
  commits, 214 with a Claude co-author line, 12 of the last 150 touching 100 or
  more files.
- **Hotspots:** `server/api.js` 9,034, `src/store.js` 6,774,
  `server/mediaAssets.js` 3,195, `server/db.js` 3,096, `LogScreen.jsx` 2,122,
  `ArtistScreen.jsx` 2,063.
- **Scope:** 57 screens, 99 components, 30 client and 26 server feature folders
  (artist death watch, memorials, lounges, owner approvals, share cards) for 8
  public member profiles.
- **Tests:** 151 test files read source files as text and regex-match them (for
  example `src/domain/artistHubNavigation.test.mjs`). They break on refactors and
  pass on broken behavior.
- **Dead weight:** `src/screens/SongPicker.jsx`, `src/components/PlaylistAttachment.jsx`,
  `src/db/schema.js`, `src/components/media-editor/index.js`; 28 scripts nothing
  references (2,465 lines, including `scripts/enrich-spotify.mjs`); 7 app modules
  used only by their tests (`src/domain/playlist-insights.mjs`,
  `listeningRediscovery.mjs`, `mediaProcessing.mjs`, `pullRefreshCoverage.mjs`,
  `listeningHistoryView.mjs`, `artistUpcomingShows.mjs`, `playlistVisibility.mjs`).
- **Paper trail:** 41 root markdown files, no README, `HANDOFF.md` 3,051 lines.
- **Design system:** `src/theme.js` has colors and no type scale. UI files use
  1,783 font-size values in 44 sizes (698 under 12px), 415 hex literals (88
  distinct) and 268 rgba literals.
- **Already good:** constraints and foreign keys, the ratcheting architecture
  checker, privacy-aware logging, full-suite CI, 789 accessibility labels across
  616 pressables.

## What visitors and search engines see

- Landing page uses the generic generated look (letter-spaced labels on every
  block, orange on dark glass cards, icon stat tiles); desktop and phone show
  different taglines; the hero rotates member selfies including an admin post;
  it asks "What would make you come back?" and promotes lounges behind sign-in.
- Drake's artist page: empty image box, "No concert ratings yet", "No upcoming
  dates are listed here yet."
- Search index: 52,120 event pages of about 160 to 200 words, 7,055 venue pages
  that say "Be the first", 3,494 city pages from 110 words, all index, follow.
  Thresholds in `server/features/seo/publicEntityPolicy.js`: a city needs 3
  events at 2 venues; an event needs only an eligible provider listing. This
  contradicts `SEO_IMPLEMENTATION_PLAN.md` ("No page for every database row").
- Generated titles carry provider prefixes ("Rescheduled:", "Vegas Vibes:"),
  em-dashes, and "Page N" suffixes (`publicDocumentProjection.js`).
- Initial JavaScript 495.2 of 512 KiB gzip. PageSpeed quota was exhausted, so no
  speed scores are claimed.

## Running order

### This week: stop showing the slop

1. Noindex event, venue and city pages without member reviews, photos or
   attendance and remove them from sitemaps; keep artist pages with a real
   biography; resubmit in Search Console.
2. Apply the public event rules to every event list (landing included) and hide
   events whose local date has passed.
3. One landing tagline on every screen size; remove the suggestion prompt and
   the lounges promo; show only browsable counts or none.
4. Remove provider prefixes, em-dashes and "Page N" from generated titles.
5. Delete local production copies (`backups/`, `.tmp/`) or move them to
   encrypted storage.
6. Run `npm run audit:userbase` on Render and record the baseline in `STATUS.md`.

Done when: sitemaps list under 3,000 URLs, every sampled indexed page has member
content or an original biography, and the landing page shows no past or add-on
events.

### Next two weeks: cut the product to its core

1. State the core loop in one sentence (log a show, rate artist and venue
   separately, see who else was there) and make the landing page say it.
2. Hide off-loop features behind flags: lounges, artist death watch and
   memorials, fan clubs, playlists, media editor, extra badges. Delete what
   nobody asks for within 30 days.
3. Every empty state gets one action; empty sections are hidden.
4. A six-size type scale with a 12px floor and all colors in theme tokens,
   enforced by `scripts/check-architecture.mjs`.
5. Uppercase labels only where they name a real category.

Done when: five or fewer navigation destinations, no text under 12px, eight or
fewer sizes, at most one empty-state message per public page.

### Weeks three to six: make the data trustworthy

1. `show_id` on posts and attendance with a reported backfill; no new free-text
   identity writes.
2. `created_at` on likes, follows and ratings.
3. Numbered migrations with a schema version; drop the Spotify token columns.
4. Filter ticket add-ons at import; one source for landing counts.
5. Off-site backups and a timed restore rehearsal.

Done when: every new post has a `show_id`, the backfill match rate is in
`STATUS.md`, and an off-site restore has been timed.

### Weeks three to ten, alongside: make the codebase legible

1. Add a README; keep only README, CLAUDE, AGENTS, STATUS and TODO in the root
   and move the rest to `docs/archive`.
2. Split `server/api.js` into feature route modules and `src/store.js` by domain,
   ratcheting 162 inline routes and 145 legacy hooks to zero.
3. Rewrite or delete the 151 source-text tests as behavior tests, then ban
   reading source files in tests.
4. Delete the dead files, orphan scripts and test-only modules listed above.
5. One-purpose pull requests, no branch-protection bypass, written reason for
   any change over 30 files.
6. Reduce the 102 silent catches by a fixed number each week.

Done when: no source file over 1,500 lines, no test reads source text, five root
markdown files, every change through a reviewed pull request.

### Ongoing: earn the content

1. Build for the city where the early users are; invite concertgoers there
   directly.
2. Track weekly with `npm run audit:userbase`: new real accounts, members active
   after week one, posts from non-staff accounts, indexed pages with member
   content.
3. Reopen an index type only when most of its pages carry member content.

Done when: week-one return and weekly member posts rise four weeks in a row.

## Scoreboard

| Measure | Today | Target |
| --- | --- | --- |
| Public pages made by members | 83 of 65,205 | every indexed page |
| URLs in the sitemaps | 65,205 | under 3,000 |
| Early accounts active after week one | 1 of 15 (snapshot) | set from production |
| Posts linked to a show | no column | every new post |
| Font-size values under 12px | 698 of 1,783 | 0 |
| Distinct text sizes | 44 | 8 or fewer |
| Hard-coded colors in UI files | 415 hex, 268 rgba | 0 outside the theme |
| Largest source file | 9,034 lines | under 1,500 |
| Test files that read source text | 151 | 0 |
| Root markdown files | 41, no README | 5, with a README |
| Silent catches | 102 | 0 |

## Owner decisions needed

1. Run `npm run audit:userbase` in the Render Shell and share the output.
2. Share where the "vibe slop" criticism was made.
3. Approve noindexing thin event, venue and city pages.
4. Mark which hidden-feature candidates must stay visible.
