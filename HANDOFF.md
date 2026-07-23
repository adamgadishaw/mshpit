# PIT / mshpit.com — Handoff

> **Living doc.** Whoever works on this next: read this first, and UPDATE it before you end a session (move things between "Done" and "Backlog", note anything running). Point a fresh Claude Code chat at this file to get up to speed without re-explaining.
>
> Last updated: **2026-07-22** (batch 1 verified, ISO date migration, merged to master)

> **Working agreement (owner's standing instruction, updated 2026-07-22):** ALWAYS `git commit`, **merge to `master`**, and `git push` after a verified batch. Do not stop to ask whether to merge; the owner does not want to be asked. A review branch is still the right place to build a large or risky change, but finishing the work means landing it on `master`. The one hard gate is `npm run check` (tests + syntax + web export) passing on the branch **and** again on `master` after the merge, because a master push auto-deploys and briefly restarts Render. If the gate fails, report it instead of pushing.

## RECOVERED OWNER REQUESTS (2026-07-21)

The vanished July 18-21 Claude Code conversation was recovered from the local
Claude JSONL history. The supplied export ZIP only reaches July 12, so do not
mistake it for the latest task record. The complete secret-redacted timeline and
the final 18-item owner backlog are preserved in
`CLAUDE_SESSION_RECOVERY_2026-07-21.md`. Item 19 was blank in the saved source.
Treat those entries as requested/backlog work unless a current implementation and
test prove an item has already shipped.

## OWNER ACTIONS OUTSTANDING (read first)

These are blocked on private configuration only. No code work is required.

> **Secrets hygiene:** the Ticketmaster, Resend, and Cloudflare R2 keys were all
> pasted into a chat (2026-07-21 / 2026-07-16), so they are considered exposed and
> **should be rotated after launch**. They live only in the local gitignored
> `.env`. `.gitignore` ignores `.env*` so no backup copy can ever be committed.
> Never put a key value in this file or any other tracked file.

**Live status (prod `/api/health`, 2026-07-17):** `database` ✅,
`youtubeConfigured` ✅, `tourProviderConfigured` ✅ (**750** tour dates and
climbing as the scheduler runs), `mediaStorageConfigured` ✅, `mailConfigured`
❌. Only email remains. Prod bundle + all commits below are deployed and
verified live (`git log origin/master..HEAD` is empty; tree clean).

| What | Status | Where | Effect while unset |
| --- | --- | --- | --- |
| `TICKETMASTER_KEY` | ✅ **DONE.** Set on Render and live; `tourProviderConfigured: true`, 672 tour dates scraped. Only the Consumer key is used (the Secret is for OAuth, unused). | Render web service env (`sync:false`) | Was: real tour dates empty. Never backfill fabricated `g_t_*`/`ca_t_*`/`ct*`/`t1`-`t4` rows to fill cards. |
| `MEDIA_*` (all six: `MEDIA_ENDPOINT`, `MEDIA_BUCKET`, `MEDIA_REGION`, `MEDIA_ACCESS_KEY_ID`, `MEDIA_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_BASE_URL`) | ✅ **DONE.** Cloudflare R2 bucket `pit-media`. Set on Render; `mediaStorageConfigured: true`. Verified end to end: keys authenticate (S3 PUT 200), public read via r2.dev 200, and a browser CORS preflight from `https://www.mshpit.com` returns `Access-Control-Allow-Methods: PUT, GET, HEAD`. Uploads work. `MEDIA_REGION` is literally `auto` for R2. | Render web service env | Was: photo/video uploads failed closed. |
| `RESEND_API_KEY` | ⚠️ **Set on Render, key valid**, but see MAIL_FROM. | Render web service env | Reset links logged server-side, not emailed. |
| `MAIL_FROM` | ❌ **THE LAST GAP.** Two parts: (1) set `MAIL_FROM = Pit <noreply@mshpit.com>` on Render (health shows `mailConfigured: false`, so this or the key is still missing there); (2) **verify `mshpit.com` in Resend** (the account has **zero verified domains**, so any send from `@mshpit.com` is rejected regardless). Add Resend's DNS records in **Cloudflare** (DNS now lives there), set the mail records to **DNS-only / grey cloud**, then click Verify. | Resend dashboard (Cloudflare DNS) + Render env | Reset email silently fails; links keep getting logged instead. |

`YOUTUBE_API_KEY` is already set (`youtubeConfigured: true`). Nothing to do.

## Recovered-backlog batch 1 verified and committed (2026-07-22, Claude)

Branch: `codex/recovered-backlog-batch-1`. The previous session wrote this batch
but ran out of budget before running a single check, so nothing was committed and
no gate had been executed. This session verified it and fixed what verification
found. `TODO.md` is the item-by-item status list; this is the evidence record.

**Automated gates (all green on the working tree):** `npm run test` 67/67,
`npm run check:syntax` 51 files, `npm run build:web` exports clean.

**Local browser run** (dev API on `:3000` serving the fresh `dist`, Chromium at
1280x720 and 375x812, two throwaway accounts created through `/api/signup`):

- `/api/health` returns the new capacity block: `youtubeLookup.search`
  `{used:0, limit:90, remaining:90}`, `circuitOpen:false`, `inFlight:0`.
- Comments: parent + reply + owner delete round-trips. The delete response
  returns `tombstone:true`, the parent comes back with empty text, and the child
  reply keeps its `parentId`. Nested replies render on the feed card.
- Messages: `GET /api/people?q=` searches members, `POST /api/dms/:otherId`
  sends, `GET /api/me/threads?summary=1` returns one latest message per thread
  ordered by recency. The Inbox **New message** panel finds members by name and
  correctly excludes the signed-in account.
- Theme: choosing Lavender writes `pit_theme` + `pit_theme_owner` (the account
  id) and persists to the server (`/api/me` → `theme: "lavender"`). Log out
  clears **both** keys and returns to the default. All 12 themes are listed.
- Clips: no nav entry, no aria-label, no text match anywhere in the signed-in or
  guest shell.
- Desktop scrubber: with a track playing, the track element measures 231px inside
  a 331px row in a 355px column, so it stretches instead of collapsing. Clicking
  at 75% of a 30s preview seeks to 0:23.
- Playback falls back to a Deezer preview labeled `PREVIEW AUDIO` when
  `YOUTUBE_API_KEY` is unset locally, which is the intended honest fallback.
- Mobile (375px): the compact bar's play control measures 54x54.

**Fixed during verification:** `src/components/AfterpartyPreview.jsx` rendered a
deleted-parent tombstone in the feed card as an empty bubble with a `?` avatar.
The card preview now filters tombstones out; `PostScreen` and `AfterpartySection`
still render them as "Comment deleted" so replies keep their context.

**Also added:** an `api` entry in `.claude/launch.json` so the next session can
start the local API without a shell.

**Not verified, still open:**

- Real iOS/Android devices for item 13. On web the player's minimize control is
  34x34 and the nav Menu button is 40x40, both under the 44pt target the item
  asks for. The album shuffle/play rows (34x34) and the wrong-video report button
  (30x30) are the same story but predate this batch.
- Two-device realtime: an out-of-band DM did not appear in an already-open Inbox
  until reload. The in-app send path updates locally, so this needs a real
  two-client check before item 5 can be accepted.
- Items 1, 2, 7, 10, 15 stay PARTIAL/OPEN for the reasons in `TODO.md`. Nothing
  here changes the Resend configuration gap above.
## Performance dates are now validated (2026-07-22, Claude)

Chasing the `2026 � 06 � 21` row from the verification pass turned up a real
spine bug rather than a display glitch.

**Root cause.** `POST /api/posts` and `PATCH /api/posts/:id` only length-clamped
`date` (`clean(x, { max: LIMITS.date })`), so any string up to 20 characters
became a performance date. `concertKey` in `src/store.js` is
`artist|venue|date`, so a mangled date forks one night into two performances and
permanently splits its lounge, attendance and score aggregation. That is exactly
what happened: The Fillmore shows twice on the Turnstile page, once as
`2026-06-21` and once as `2026 <U+FFFD> 06 <U+FFFD> 21`. The stored bytes are
`EF BF BD`, so the corruption happened before insertion, on a write path that
lost the encoding. The row dates from 2026-07-05, long before this batch.

**Careful bit.** The app does **not** store ISO dates. `DatePicker` and
`LogScreen`'s `todayStr` both emit `YYYY · MM · DD` with U+00B7, so enforcing
ISO would have rejected every concert log. `server/validate.js` now has `isDate`
/ `cleanDate`, which accept the separators the product actually writes, require
a real calendar day (so `2026-02-31` and `2026-13-01` are out), bound the year
to 1900..next year, and **return the input unchanged**. Normalizing the
separator here would give new posts a different identity than existing rows,
which is the same fork the guard exists to prevent.

Edit is guarded too, but only when the date changes, so a post already holding a
legacy bad date stays editable by its owner. Clearing the date (`""`) remains a
normal edit. Two regression tests in `server/post.edit.test.mjs` cover accepted
formats, the mangled separator, impossible days, and the legacy-row path.

Verified live: the picker's own format posts and round-trips unchanged, the
mangled date is refused with 400, clearing works.

**The real fix landed next; see the section below.** The guard above only stopped
new damage.

## Startup performance: the bundled catalogue was the mobile lag (2026-07-22, Claude)

Audited for mobile lag and measured before optimizing. The result was not where
it was assumed to be.

**Not the problem.** The feed already uses `FlatList`, and driving a 30-step
scroll produced **zero** long tasks and zero blocking time. Discover's chart is
capped at 24 rows, so it does not need virtualizing. Player position lives in
`PlayerBar`'s own state, not the store, so ticking does not re-render the app.

**The problem.** `src/seed/catalog.generated.json` is **9.9 MB** and was a static
import, reached from `src/data.js`, `LandingScreen` and `store.js`. Every launch
downloaded it, parsed it and allocated it. Breakdown: artist `albums` 3.71 MB,
venue `galleryPool` 1.45 MB, venue `photos` 0.59 MB — 5.75 MB of the payload
served two screens, neither of which needs it at launch.

**What changed.** `scripts/split-catalog.mjs` derives a startup core from the
scraper output (which is untouched, an automated job owns it):

| | before | after |
| --- | --- | --- |
| web bundle | 8.28 MB | **4.8 MB** |
| catalogue allocated at startup | 9.65 MB | **1.24 MB** |
| catalogue parse (desktop / est. mid-range phone) | 33ms / ~167ms | **12ms / ~62ms** |
| DOMContentLoaded, warm localhost | 277ms | **126ms** |

Two different mechanisms, deliberately:

- **Artist discographies are dropped from the bundle.** The artist page already
  prefers `GET /api/artists/discography`, so a second stale copy on every device
  bought nothing. Nothing imports them, so Metro leaves them out.
- **Venue photo pools are deferred, not dropped.** They have no server
  equivalent, so removing them would have cost real function. They stay in the
  bundle behind a lazy `require` in `src/seed/ingested.js`; Metro only runs a
  module's factory on first require, so the 2.1 MB is allocated when a venue
  gallery is first opened instead of at launch.

**The trade, stated plainly:** offline, on an artist page whose discography has
never loaded, the RELEASES strip is empty rather than showing stale bundled
releases. Nothing else changes. Verified after the change: artist pages still
show genre, songs and discography; Red Rocks still renders its gallery photo
from the lazily loaded pool; no console errors.

**Guardrails.** `npm run check` and `npm run build:web` regenerate the split
first, so the scraper rewriting `catalog.generated.json` can never stall a
deploy — this was checked by simulating a scraper commit. Four tests in
`src/seed/catalog.split.test.mjs` assert the core stays under 1.8 MB, that the
heavy fields never leak back in, that nothing imports the 9.9 MB source, and
that the venue pool is reached only through the one lazy require.

**Not done, and the honest next step:** the store is a single provider with 51
state slots, no `useMemo`/`useCallback`, and a fresh object literal as its
context value, consumed by 44 files — so any state change re-renders every
consumer. Measurement did not show that hurting yet on desktop, and fixing it
properly means splitting the context (stable actions vs volatile data), which is
a large refactor across those 44 files. Memoizing the value alone would create
stale-closure bugs. It should be done deliberately, with a profiler on a real
device, not bolted onto this pass.

## Backlog sweep: items 5, 6, 7, 11, 12, 15, 18 (2026-07-22, Claude)

Worked down the rest of `TODO.md`. What changed, and what was only confirmed:

**Item 6, autoplay.** The selection algorithm lived inside the `useStore` hook,
so none of its criteria could be tested. Extracted to `src/domain/recommend.mjs`
as a pure function; the store still gathers the candidate pool. Nine tests cover
the two-per-artist cap, rotations opening differently, recently-played deferral
by provider id *and* artist+title, just-heard artists sinking without a ban, the
seed never recurring, and empty accounts returning `[]`. Live: a fresh Listen
built a 52-track queue, no console errors.

**Item 5, messages.** Verified with two genuinely separate clients (the browser
session plus a Node session with its own cookie): a DM reached the other's open
thread and updated the inbox preview and ordering within a second, no refresh.
An earlier attempt looked like a failure only because the headless tab was
hidden and the poller correctly pauses on `AppState` background. Polling is
still the scale limit.

**Item 7, preview-only playback.** Added `scripts/sample-playback.mjs`, the
before/after instrument the criteria asked for. It keeps **capacity** (budget or
circuit refusal) separate from **missing**, which is the distinction that made
the old impression unreliable. Locally it honestly reports 100% preview because
`YOUTUBE_API_KEY` is unset. The production run is still outstanding.

**Items 11, 12, 18, verified live rather than assumed.** Watch/`youtu.be`/shorts
links all canonicalize to one id with a server-derived thumbnail, other hosts
refused. Duplicate track reports are bounded, invalid categories and links
refused, non-admin pin 403; an admin pin stored the override, closed the open
reports, left no stale `yt_cache` row, and a later report was treated as fresh.
Playlist sharing keeps an immutable snapshot: renaming the playlist and
replacing every track left the published post unchanged.

**One real gap fixed on the way:** a playlist track supplying only a YouTube
watch `url` never captured its video id, so a snapshot held weaker evidence than
it could. `cleanPlaylistTracks` now derives the id from the link.

**Item 15, analytics.** Non-admin gets 403 on both the dashboard and per-user
inspection; export returns the full account; opt-out deletes existing rows and
blocks new ones; guests are never stored; retention is capped at 180 days.
What remains is a legal review of the policy copy and moving analytics off the
primary database, neither of which is code I can finish here.

**Still blocked on you, not on code:** item 4 needs the Resend domain verified in
DNS, and item 13 needs real iOS/Android hardware. Items 1 and 7 need a production
run with the real key.

## Genre authority: Discover was reading crawl buckets (2026-07-22, Claude)

TODO item 2, and the cause of the "Discover looks broken" complaint.

**Root cause.** The catalogue seeder discovers artists by crawling MusicBrainz
*tag pages* and published the crawl bucket as the artist's genre. Those pages
return loosely related artists, so Justin Bieber came back under "Metal", Eminem
under "Hardcore", Rihanna under "House", Nirvana under "Punk". CLAUDE.md already
says MusicBrainz search tags are discovery hints, not canonical primary genres,
so the data violated a rule the repo had already written down. Enrichment then
froze it: `genre: row.genre || e.genre` let a stale bucket outrank Deezer, which
knew perfectly well that Bieber is pop.

**`src/domain/genre.mjs` is the authority.** A genre is a claim with a source,
never a bare string. Hierarchy `staff` > `provider` > `consensus` > `tag_hint`,
each with a confidence, and only evidence-backed claims may be stated as fact.
Every source keeps its own claim, which is what makes a staff correction
reversible without destroying the provider evidence underneath. `publicArtist`
returns an unverified bucket as `genreHint`, not `genre`.

Legacy rows are classified by shape: the seeder wrote an exact Title-Case label
from its `GENRE_TAGS` vocabulary, while provider enrichment arrives lowercased
("hip hop", "thrash metal"), so membership of that vocabulary identifies a
bucket. Matching is exact, so a real "thrash metal" is never demoted.

**Also shipped:** `POST /api/admin/artists/genre` (admin-only, audited via
`moderation_actions`, reversible by passing an empty genre) and
`scripts/backfill-genres.mjs`, which asks Deezer what each artist actually is,
most-popular first and resumable.

**Verified.** 91 tests pass. Against the real database, the top 200 ranked
artists went from 37 to 180 evidence-backed genres, and Discover now reads
Rihanna POP, Eminem HIP-HOP, Nirvana Rock, Michael Jackson Pop, Linkin Park
Alternative. No console errors.

**Unfinished, deliberately.** Only ~150 of 2657 artists are backfilled. Run
`node scripts/backfill-genres.mjs 500` repeatedly until the pending count hits
zero; it is keyless, rate-limited and safe against production. Until then the
long tail shows **no** genre rather than a wrong one, which is the intended
failure mode but does mean Discover's genre coverage is thinner than the old
(wrong) data made it look. `consensus` is ranked but nothing emits it yet.

## Performance dates are canonical ISO now (2026-07-22, Claude)

Storing a display-formatted date inside the identity key was fragile by
construction, so storage and display are now separate concerns.

**`src/domain/dates.mjs` is the single authority.** `toIsoDate` accepts every
shape the product has ever written (ISO, the DatePicker's `YYYY · MM · DD`, the
mangled `U+FFFD` variant, `/` and `.` separators) and returns `YYYY-MM-DD`, or
`""` for anything that is not a real calendar day. `formatDate` renders the
display form, so **nothing users see changed**. `todayIso` is the composer's
default. Both server and client import it; `server/rewards.js` already set the
precedent for sharing a pure module across that boundary.

**What changed together, because it all had to move at once:**

- `server/validate.js` `cleanDate` canonicalizes instead of preserving input, so
  create and edit both store ISO. Editing a post now *repairs* a legacy date
  rather than rejecting its owner.
- `server/db.js` runs a one-time migration behind the `dates:canonical-iso:v1`
  marker, in a transaction, following the events-IP-purge pattern. It rewrites
  `posts.date`, `tour_dates.date`, `going.date` **and** `going.concert_key`, and
  the date segment of `lounge_messages.lounge_id`. `going` uses
  `UPDATE OR REPLACE` because `PRIMARY KEY (user_id, concert_key)` collides
  exactly when a merge is correct: one fan, two spellings, one night.
- `src/store.js` `concertKey` canonicalizes the date, so bundled seed data and
  legacy local posts key onto the same performance as migrated server rows.
- `DatePicker` emits ISO and previews the display form. `LogScreen` holds ISO.
- Ten render sites moved to `formatDate`.
- The Ticketmaster ingest (`server/tourdates.js`, `scripts/ingest.mjs`,
  `scripts/enrich-tourdates.mjs`) stops converting the provider's ISO date into
  the display form, which is where all 797 middot tour dates came from.
- **`server/discovery.js` was the trap.** It string-compares
  `tour_dates.date >= today`, so its `today` had to move to ISO in the same
  change or upcoming shows would silently vanish. Verified after: 685 future
  dates, sidebar returns 8 upcoming events.

**A date too broken to parse is left exactly as it is.** Blanking it would
destroy the only record of when someone's night happened, and `formatDate` falls
back rather than rendering mojibake.

**Verified.** 77 tests pass, including `src/domain/dates.test.mjs` (parser,
leap years, idempotence) and `server/dates.migration.test.mjs`, which seeds a
database with all three real-world date shapes and asserts the merge: two
`going` rows collapse to one, two lounges become one room with both messages
kept, unparseable rows untouched.

Then run against the real dev database: the mangled row became `2026-06-21`, all
797 tour dates are ISO, and the two Turnstile reviews that used to produce
`...|2026 � 06 � 21` and `...|2026-06-21` now both key to
`turnstile|the fillmore|2026-06-21`. **The Fillmore fork is healed.** In the
browser: no mojibake anywhere, no raw ISO leaking into the UI, feed and composer
render `2026 · 07 · 09` as before, "Today" still resolves, no console errors.

**Deploying this:** the migration runs automatically on boot and is idempotent.
Back up `server/data/pit.db` first anyway, since it rewrites primary-key
material. The bundled seed catalog still holds 156 display-format dates; they
canonicalize on read, and the ingest scripts now emit ISO, so it converges
whenever the catalog is regenerated. There is no need to force that.

**Touch targets.** Re-measured rather than trusted: the nav buttons, album
controls and report buttons already carried `hitSlop` putting them past 44pt.
Genuinely short were the player's own `headIcon` controls (34pt, no `hitSlop`)
and the queue row actions (28pt + 6). Both now reach 44pt via `hitSlop`, with
the visual design unchanged per CLAUDE.md.

**Still open from the verification pass:** 698 of 2657 artists (26%) have photos
hotlinked from Spotify's CDN (`i.scdn.co`) with `"photoCredit":"Spotify"`, left
over from the removed Spotify integration. That is a licensing and reliability
problem needing an ingest change, tracked separately.

## Song sourcing rebuilt around the artist's own channel (2026-07-18)

The owner reported, repeatedly, that songs played the wrong video (reaction
videos, another act's song), that Korn was unreachable, and that many songs fell
back to 30s previews. Three genuinely separate root causes, all now fixed:

1. **Korn was unreachable: wrong Deezer artist.** Deezer lists the band as
   **"KoЯn"** (Cyrillic Я, 2.6M fans). Two impostor accounts spelled exactly
   "Korn" (4,497 and 25 fans) exist, and `selectDeezerArtist` considered ONLY
   exact-name matches, so it picked a 2-album impostor and the page came up
   empty. Selection now compares a character-level similarity that keeps
   non-latin glyphs (so "koяn" ~ "korn" = 0.75) and lets the established act win
   when it is overwhelmingly bigger, while a genuine same-name collision
   (Jorn/Lorn) still prefers the exact spelling. A previously auto-saved wrong
   id is now only a HINT and self-heals; a listener's explicit pick still wins.
   Verified live: Korn resolves to KoЯn, 25 songs, 25 albums, genre Rock.
2. **Wrong videos: the selection never checked the creator.** The old gate
   accepted a video if the artist name appeared ANYWHERE in title or channel, so
   "Tory Lanez - X (feat. Nelly Furtado)" passed on Nelly Furtado's page. The
   resolver now searches **inside the artist's own channel** ("<Artist> - Topic",
   the auto-generated channel holding official audio for their whole catalogue),
   so a reaction video or another act's song is structurally impossible. When no
   channel resolves, the global search runs behind a hard creator gate: the
   channel must carry the artist's name, or the title must LEAD with it.
3. **Previews everywhere: YouTube quota exhaustion.** Every song burned a
   `search.list` at **100 quota units**, and the default daily quota is 10,000,
   so roughly 99 songs a day then everything silently fell back to previews. The
   resolver now pulls the artist's upload catalogue once via
   `channels.list` + `playlistItems.list` (**1 unit per 50 videos**, ~5 units per
   artist, cached 7 days) and matches titles locally, so a song costs ~1 unit
   instead of 101. That is roughly 80x more songs per day.

Order of attempts: artist catalogue (cheap, exact) -> search within the artist's
channel -> global search behind the creator gate -> Deezer preview. Every step
falls through safely, so the worst case is the previous behaviour.

Files: `server/musicProviders.js`, `server/musicProviders.test.mjs`.
Tests (15 in that file, 63 total): stylized-name/impostor/self-heal, creator gate
including the exact feat. case, Topic-channel preference, catalogue matching
(studio over live/karaoke), and a quota assertion that a song resolves with **no**
keyword search. `npm run check` green.

**Not verifiable locally** (no `YOUTUBE_API_KEY` in the dev env): the live
YouTube paths are covered by mocked-fetch tests only. Spot-check on prod after
deploy. If an artist has no Topic/VEVO channel the global-search fallback is
stricter than before, so a few songs may prefer the preview over a doubtful
video, which is the intended trade.

## Composer, search, You tab, genres (2026-07-18, shipped to master)

Follow-on batches after the play-history/playlist recovery, each verified in the
browser and pushed to master (auto-deployed):

- **Composer redesign** (`a87964e`, `src/screens/LogScreen.jsx`): status mode
  opens on an author card (avatar, name, Public chip) with a clean text box;
  both modes get an "Add to your post" chip bar (Photo/Song, plus Playlist on
  status) that reveals each attachment panel on tap instead of three always-open
  labeled sections. Presentation only.
- **Recent searches** (`eb26c56`, `src/store.js`, `src/screens/SearchScreen.jsx`):
  opening any result records a deduped, newest-first, on-device recent list
  (`pit.recentSearches`, max 8); the empty Search state shows the last 5 with
  per-item remove + Clear.
- **Near You on the You tab** (`265b0c8`, `App.js`, `src/screens/YouScreen.jsx`):
  a prominent card under the hero (local venues + upcoming shows) that opens the
  Nearby screen. It had no You-tab entry point before.
- **Genre correction** (`34c39e6`, `server/musicProviders.js`): the catalog
  genre column was full of wrong MusicBrainz tags (Justin Bieber -> "Metal").
  `getDeezerDiscography` now reads each album's clean Deezer genre, takes the
  most common, and persists it, overriding the bad tag. Discography cache bumped
  to v5 so cached artists re-derive on next view. **Self-heals per artist on
  view**; a bulk backfill script for all catalog artists remains a future option
  (would need a rate-limited prod run). See [[discover-genre-data-wrong]].

Still open from the owner's latest report (screenshot-blind items I could not
verify locally, so deliberately not guessed at): the subjective You-tab / Discover
**visual** polish (owner should point at specifics), a **performance/lag** pass
(can't reproduce lag on a tiny local DB), and **artist song accuracy** (no local
YouTube key; needs concrete failing examples).

## Play history + shareable playlists (2026-07-18, branch `codex/playlists-history`)

Recovery + completion of a Codex session that ran out of usage mid-edit. The
uncommitted tree parsed and passed all checks (the "duplicated code" the owner
pasted was Codex's editor buffer, not the saved file). What that batch delivered,
now verified and committed:

- **Play history is account-scoped, server-backed, and paginated** (`src/store.js`).
  Local cache keys per account (`pit.playhistory.<uid>`), hydrates from
  `GET /api/me/plays` with a sequence/account guard so a stale login response
  can't clobber the current one, and preserves the exact resolved YouTube
  `videoId` so replay never searches for a different upload. Fixes the "listening
  session shows previously listened songs" gap.
- **Idle player column shows RECENTLY PLAYED** instead of an empty state
  (`PlayerBar.jsx`); the panel refresh re-pulls history on open. Native treats a
  resolved id as metadata (`hasVideo = web && …`) so it uses the preview engine
  instead of hanging on "connecting".
- **`explicitCount`** on the player (`App.js`, `PlayerBar.jsx`) so "Save mix"
  snapshots only the songs you queued, not the auto-recommendations after them.

**Completed this session (the client half Codex never wired):** posting a
playlist. Server already accepted `playlistId` on status posts and stored an
immutable snapshot (`playlistSnapshotForPost` / `playlistPostProjection` in
`server/api.js`, `posts.playlist` column). Added:

- Composer "SHARE A PLAYLIST" picker (status mode) listing the user's shareable
  (public/unlisted, non-empty) playlists (`src/screens/LogScreen.jsx`).
- `src/components/PlaylistAttachment.jsx`: a playable playlist card on the feed
  (cover, name, owner, song count, first 3 tracks). Tap the header or any track
  → `openPlayer(track, tracks)` loads the whole list, carrying each track's exact
  `videoId`. Wired into `TicketStub` beside `SongAttachment`.
- `addLog`/`editLog` send `playlistId`; PATCH preserves the snapshot unless
  `playlistId` is sent, and `playlistId: null` clears it.
- Regression test `server/post.edit.test.mjs` ("status posts can share an owned
  playlist as an immutable snapshot": share, private-rejected, not-owned 404,
  edit-preserves, null-clears).

Verified: `npm run check` green (58 tests, web export); browser E2E on a fresh
local DB — created a playlist + status post via the API, the feed rendered the
PlaylistAttachment card, and clicking Play loaded a 33-item queue
(`explicitCount: 3`) with `videoId` preserved (BLACKOUT→dQw4w9WgXcQ). No console
errors. **Not yet deployed** — awaiting the owner's go-ahead to merge to master.

## OWNER PRIORITY BACKLOG (authoritative, deduplicated 2026-07-18)

This is the current product backlog from the owner's latest report and the copied
Claude transcript. It supersedes conflicting "next up" lists farther down this
historical document. **A committed foundation is not the same as an accepted
feature:** when the owner still reports it broken, tiny, laggy, or unprofessional,
the item remains open until the user-visible acceptance checks below pass.

Status terms used here:

- **COMMITTED FOUNDATION / REOPENED:** useful code is on `master`, but the latest
  owner report means the end-to-end feature is not accepted.
- **PARTIAL / REOPENED:** a vertical slice now works, but one or more acceptance
  checks (usually native-device or production validation) remain.
- **OPEN:** no trustworthy end-to-end implementation has been demonstrated.

### 2026-07-18 recovery batch completed from Claude's interrupted worktree

The three partial server files left by Claude were preserved, reviewed, and
completed as coherent vertical slices in this batch:

- `posts.song` is migrated, validated on create/edit/read, resolved through a
  rate-limited YouTube oEmbed endpoint, composed on both post types, rendered as
  a song card, and handed to the existing player by exact video ID. The player no
  longer searches again and substitutes a same-titled lyric/karaoke upload.
- Same-name artist candidates now have an artist-page **Wrong artist?** picker.
  Selecting a candidate reloads its Deezer identity, visible tracks/releases, and
  persistent playback queue. Albums and EPs now load up to 40 releases instead of
  silently stopping at 12 albums.
- Native media upload now sends Expo SDK 56 `File` bodies through `expo/fetch`
  instead of converting large local files to JS blobs. Status and review posts
  share a large 1/2/3/4+ collage; the viewer is a true full-screen modal with
  per-item likes and video playback.
- Verification before commit: **57/57 tests**, syntax check, Expo web export, and
  an isolated browser walkthrough covering song-only publish, exact YouTube IFrame
  playback, a four-image feed collage, full-screen navigation, and a durable photo
  reaction.

Do not overstate the remaining gaps: a real iPhone/Android HEIC + MOV upload and
production smoke test are still required; video posters/transcoding are still
open; discography still has a 40-release ceiling and no singles/pagination; and a
proper provider-identity mapping table remains preferable to name-keyed metadata.

### P0 - restore correctness, media reliability, and responsiveness

#### 1. Media uploads + large Facebook-style feed media + viewer/reactions

**Current reality: PARTIAL / REOPENED.** The current recovery batch replaces the
64px strip with the large responsive collage on both post types, portals the
viewer to a true full-screen modal, and repairs the SDK 56 native upload body.
R2, video playback, and durable per-media likes were already committed. Browser
verification passed; physical-device formats and production remain the P0 gate.

Acceptance criteria:

- Reproduce the production failure with a real iPhone photo plus MP4/MOV on both
  desktop and a narrow phone viewport. Upload has progress, retryable error copy,
  and survives reload/cross-device hydration; no blank or device-local URLs.
- A one-photo post uses the available card width with a natural, bounded aspect
  ratio; 2-4 photos use a deliberate collage; text sits above the media. It must
  not fall back to the old row of tiny thumbnails. Video cards show a real poster
  and duration/play affordance rather than a generic dark tile.
- Clicking any item opens the correct index in one fullscreen media viewer.
  Arrows/swipe/keyboard/close work, only the active video mounts/plays, video uses
  contain/letterbox rather than crop, and leaving it releases playback.
- Like/reaction count and the signed-in user's state are consistent in the feed,
  viewer, profile/artist galleries, and after reload. Optimistic failure rolls
  back honestly. Preserve the existing inline comment preview.
- Verify on production after deployment with one fresh image post, multi-image
  post, HEIC, and video; record exact failing formats/browser if anything remains.

**Required media-pipeline dependency before broad use:** direct-to-R2 upload is
only the ingest step. Add a server-controlled finalize record/job that verifies
the stored bytes and ownership, sniffs real MIME, strips image metadata, converts
HEIC/HEIF, creates bounded responsive thumbnails, moderates/quarantines, and
deletes abandoned objects. For video, validate duration/container/codecs, create
a poster frame, and transcode to a broadly playable H.264/AAC MP4 (or an HLS
ladder when volume justifies it); expose processing/failed/ready states. Feed and
gallery surfaces must request derivatives, never decode the original 100 MB clip.
This pipeline is also a dependency for the performance item below. Do not rely on
the current external HEIC proxy or client-generated thumbnail as the long-term
processing architecture.

#### 2. Correct artist/song identity, full discographies, and same-name selection

**Current reality: PARTIAL / REOPENED.** `05118d8` added hard YouTube artist/title
gates. The current recovery batch completes the same-name candidate picker,
candidate-specific reload/queue replacement, and album+EP expansion to 40 releases.
This materially improves the reported Drake/same-name failure, but the remaining
identity-table, singles, pagination, provider-gap, and production spot checks below
are still required before calling discography correctness complete.

Acceptance criteria:

- Artist search returns distinct same-name candidates, not one guessed match.
  Each row supplies enough identity evidence (photo, provider identity, releases
  or top song, fan count and origin/genre where reliable) for a person to choose.
- Persist a durable provider identity on the Pit artist/profile or navigation
  target. Discography, artwork, top tracks, preview lookup, and YouTube resolution
  must all use that selected identity; a display name alone is not a primary key.
- Artist pages load the complete provider-backed release history available to the
  app, including older albums and EPs, with pagination/lazy loading instead of a
  silent 12/40-item cut. Define how singles, compilations, deluxe duplicates, and
  reissues are grouped and label provider gaps honestly.
- Playing any row must resolve the exact selected artist + exact title/version;
  rejected/low-confidence YouTube candidates fall back visibly instead of playing
  a different act. Preserve the official-channel and made-for-kids gates.
- Add provider-mocked tests plus production spot checks for at least five deep
  catalogues and five same-name collisions. Verify the tapped row, queue entry,
  visible player metadata, and actual video/audio are the same recording.

Dependencies: replace the current name-keyed provider pin with a first-class
artist-provider identity mapping; respect Deezer/YouTube quotas and stale-cache
fallback before removing the remaining release ceiling.

#### 3. Site lag and scalable rendering/data flow

**Current reality: OPEN / existing ALPHA foundations only.** Feed and chats have
cursor contracts and bounded caches, active clip mounting is limited, and some
duplicate-load guards exist. The site still feels increasingly laggy. Do not
guess that bundle size is the only cause; profile it.

**2026-07-18 read-only audit (fix in this order):** the worst amplification is
runtime polling/state churn, not the bundle alone. The 12-second feed refresh
always creates new feed/like objects inside one 211-field Context; eight visible
cards can each fetch up to 400 comments, while post detail repeats that full read
every four seconds; DM login hydrates up to 500 messages per thread and the 3.5s
poll still rebuilds/persists the full DM map on empty responses. The web bundle is
also 8.59 MB raw / 1.90 MB gzip because the 10.14 MB source catalog and 43 screens
are eagerly imported. First patch should be a **quiet-poll batch**: no state write
or persistence on unchanged feed/comment/DM responses, two-comment feed previews,
cursor-based paged post comments, seed DM cursors from cache, and gate/jitter the
feed refresh to the visible tab. **This recovery batch completed the no-op feed,
comment, and empty-DM state bailouts; changed feed previews from 400 rows to 2;
added a 30-second comment-load TTL; and reduced open-post polling from 4s/400 rows
to 15s/50 rows.** Cursor deltas, visible-tab feed gating, DM hydration, the bundled
catalog, lazy screens, and Context splitting remain. Measure again after each.

Acceptance criteria:

- Capture a repeatable desktop + mid-range mobile trace for cold load, feed
  scroll, route changes, opening the player/viewer, and a long DM thread. Record
  bundle, request count/bytes, JS/render time, memory, and slow API queries before
  changing architecture, then compare after.
- Virtualize/paginate long feed, discography, playlist, notification, and message
  lists; lazy-mount heavy charts/media; keep only the active video/YouTube engine;
  batch media-reaction/comment/user hydration instead of one request per card.
- Serve thumbnail/poster derivatives and defer originals. Split/lazy-load screens
  and heavy dependencies where the measured bundle proves it useful. Remove
  duplicate timers/listeners and memoize stable cards/selectors.
- Establish measurable budgets (for example, responsive taps/route changes with
  no multi-second main-thread stall and documented p95 API targets) and add basic
  client/API timing, error, and queue-depth observability.
- Scale phase: replace 3.5s/12s polling with realtime fan-out plus the existing
  cursor catch-up contract; remove DM/thread N+1 reads; move beyond single-process
  SQLite only when measured concurrency requires managed relational storage,
  pub/sub, workers, and CDN processing.

Dependencies: the media derivative/transcode pipeline above, profiler access to
a production-like dataset, and an explicit performance baseline before a broad
rewrite.

### P1 - finish the core music-social experience

#### 4. Separate polished status and concert-review composers + YouTube attachment

**Current reality: PARTIAL / REOPENED.** `05118d8` introduced `kind=status`; the
current recovery batch completes the safe YouTube attachment UI/API/storage/card
and exact-video player path for both post types. The status and review modes are
visually distinct, but the owner's requested purpose-built composer polish,
cancel confirmation, media ordering/progress, and playlist attachment remain open.

Acceptance criteria:

- "Create" first presents two clear choices: **Post an update** and **Review a
  concert**. Each opens a purpose-built, uncluttered composer; shared text/media
  controls may be reused internally, but review-only artist/venue/date/ratings/
  setlist fields never clutter a regular post.
- Drafts, edit mode, media order/removal, visibility, upload progress, validation,
  cancel confirmation, and retry behavior work for both types. The resulting feed
  cards look intentionally different: social post versus concert review/ticket.
- A user can paste only a supported YouTube/youtu.be/Shorts URL, see verified
  title/channel/thumbnail, remove or replace it, and publish it on either allowed
  post type. Arbitrary iframe/embed HTML and non-YouTube URLs are rejected.
- Clicking the YouTube card hands the exact video ID to the existing visible Pit
  player, preserves compliant YouTube controls/attribution and minimum sizing,
  and never opens a second competing hidden audio engine. Define whether a tagged
  item joins the music queue or is a one-off video before implementation.
- API create/edit/read validation, malformed/private/deleted video behavior,
  browser/mobile rendering, and player handoff all have regression coverage.

Remaining dependency: decide whether song shares should be one-off playback or
seed the recommendation queue, then finish native/private/deleted-video behavior.

#### 5. Reliable playlists and shareable playlist posts

**Current reality: COMMITTED FOUNDATION / REOPENED.** `52bd491`/`9314756` provide
server-backed playlists, add-one-song, save-session, profile display, and playback.
The owner reports that playlists "don't really work," and explicit sharing,
reorder/remove, and playlist posts remain open.

Acceptance criteria:

- Create, rename, add, remove, reorder, delete, and play-from-any-row work after
  reload and on another signed-in device. Duplicate/provider-neutral tracks have
  stable identity and the tapped track starts first with the expected queue order.
- Every playlist has an owner-controlled public/unlisted/private state and a
  stable share/deep link. Block/privacy rules apply on direct routes.
- The regular-post composer can attach one of the user's playlists. Feed/profile
  cards show cover mosaic, name, owner, track count/duration, and a Play action
  into the existing player. Define and test whether old posts show a live playlist
  or an immutable published snapshot.
- Empty, deleted, private, partially unavailable, and mixed-provider playlists
  fail gracefully. Add API/store/UI tests and a cross-device browser walkthrough.

#### 6. Listening-session panel and previous-play history

**Current reality: COMMITTED FOUNDATION / REOPENED.** Server plays, saved sessions,
recent history, and "record only after PLAYING" logic exist (`52bd491`, `3746d87`,
and the persistent-player batch). The owner still cannot reliably see previously
listened songs in the listening session.

Acceptance criteria:

- Opening the player/session hydrates recent server history before rendering the
  empty state; newest successful plays appear immediately, survive reload, and
  match across devices. Failed resolves, selections, and autoplay blocks do not
  count as listens.
- Clearly separate **current queue/session**, **recent listening history**, and
  **saved playlists/sessions**. Provide bounded pagination/load-more and a useful
  action to replay or add any history row without corrupting the current queue.
- Dedupe provider-neutral identity correctly while preserving legitimate repeat
  listens and versions. Test signed-out/local fallback, account switch/logout,
  stale requests, and long histories.

#### 7. You tab redesign with Near You integrated into its flow

**Current reality: COMMITTED FOUNDATION / REOPENED.** `643e6d7` added server-backed
listening analytics/gallery/playlists/countdowns and `9032eb5` redesigned the tab.
Earlier work also has `NearbyScreen`, a location-aware right rail, and real tour
dates. The owner still finds You unpolished and says Near You disappeared/feels
detached.

Acceptance criteria:

- Rework You as a clear personal home with a small hierarchy: identity/summary,
  listening, posts/gallery/playlists, upcoming saved shows, and **Near You** as a
  first-class section with a clear See all route to the existing map/list.
- Near You uses saved city/coordinates, shows distance/date/venue and a transparent
  widening fallback, offers location edit/permission recovery, and never silently
  disappears when there are zero local events.
- Remove duplicated entry points and visual clutter; keep Activity/Inbox reachable
  without turning You into a miscellaneous menu. Validate phone and desktop with
  real, sparse, and empty accounts.

#### 8. Discover polish + useful last-five recent searches

**Current reality: COMMITTED FOUNDATION / REOPENED.** DB-backed Discover charts
and the interactive SVG donut exist (`a2f1c8f`, `26fc879`, `8793d32`), but the
owner rejects the current pie-chart presentation. Search remains typeahead and
does not provide a useful last-five history.

Acceptance criteria:

- Redesign Discover around a small number of understandable music/discovery
  modules. Replace or substantially restyle the donut/pie if it remains; labels,
  totals, selected state, color contrast, keyboard access, list fallback, and
  mobile layout must make the data understandable without hover or animation.
- Keep region/genre/chart data server-backed and truthful; no blank top-song rows,
  misleading global totals, or janky chart rerenders. Near You lives primarily in
  You, with at most a deliberate cross-link from Discover.
- Before typing, Search shows the last **five** meaningful searches/selections
  (query plus artist/person/venue context), newest first. Selecting reruns/opens
  it, duplicates move to the top, Clear removes all, and blocked/private entities
  are filtered. Persist per account where practical with a signed-out device
  fallback; never log raw private message content.

#### 9. Messenger-like DMs and professional Activity notifications

**Current reality: COMMITTED ALPHA / REOPENED.** DMs have server persistence,
requests-vs-friends, cursor catch-up, bounded state, retry-safe sending, and live
polling. Notifications are server-backed and route likes/comments/follows/DMs to
their targets. The owner rejects both current presentations.

Acceptance criteria for DMs:

- Inbox rows show avatar/name, last message, timestamp, unread badge, request
  state, and a useful empty/loading/error state. Threads have familiar grouped
  bubbles, day/time separators, sticky composer, sending/failed/retry state,
  automatic follow only when near the bottom, and explicit older-history loading.
- Unread/read state is server-backed; request accept/decline, blocking, account
  deletion, moderation tombstones, reconnect/catch-up, keyboard avoidance, and
  phone/desktop responsive layout behave predictably. Realtime transport may
  replace polling only while preserving cursor recovery.

Acceptance criteria for notifications:

- Activity rows use actor avatar, concise human text, target preview, relative
  time, clear unread styling, grouped/repeated-event treatment, Mark all read, and
  correct destination behavior. Likes/comments/follows/messages/system notices
  are visually distinguishable without looking like an admin log.
- Counts reconcile across devices; blocked/deleted/private targets degrade safely;
  pagination, loading, empty, and retry states are professional and accessible.

#### 10. Fix existing themes and add the previously discussed themes

**Current reality: PARTIAL.** Eight themes are committed (Stage, Neon, Forest,
Ember, Daylight, Ice, Rose, Mint), with account persistence and some shadow fixes.
Historical notes still leave per-theme art and four additional themes open. The
latest message does not contain the names/palettes of those four, so recover that
specification from the prior conversation or confirm it with the owner; do not
invent and silently ship replacements.

Acceptance criteria:

- Audit every existing theme across feed, composer, player, viewer, You, Discover,
  search, DM, Activity, dialogs, charts, focus/pressed/disabled/error states, and
  light/dark system chrome. No unreadable text, invisible shadows, hard-coded
  colors, stuck theme, or full-page reload that interrupts playback.
- Centralize semantic tokens and chart/media overlays; switching persists to the
  account and applies live across mounted screens. Add screenshot/contrast checks
  for representative desktop and phone surfaces.
- Add the agreed new theme names, palettes, artwork, and light/dark classification
  only after the missing specification is recovered, with the same acceptance
  matrix as the existing eight.

### Shared definition of done for this backlog

For every item: preserve migrations and privacy/block/moderation rules; add focused
server/store/UI tests; keep `npm run check` green; test narrow phone + desktop web;
then perform a production smoke test against real provider/media data. Update this
section with evidence and move an item out only after the owner-visible behavior,
not merely an API or isolated component, meets its acceptance criteria.

## NEXT SESSION: mobile navigation overhaul (owner-requested, DEFERRED on purpose)

The owner asked for a full mobile-nav rearchitecture in the same message as Clips
mode. Clips + chart depth shipped; **this nav rework was deliberately left for its
own focused session** because half-shipping navigation breaks the whole phone
experience. Do this as one contained batch, mobile-only (`!wide`), and keep the
existing desktop shell (the persistent 25% player column + `DesktopTopNav`)
untouched. Verbatim asks, decoded:

1. **Kill the bottom tab/action bar on mobile; replace it with a slide-away side
   menu.** The menu picks the "function" (Feed / Search / Discover / You / Clips
   / etc.). It can be swiped away so the content owns the full screen. This
   replaces the current bottom tab strip only on narrow widths.
2. **When the music player is playing, the content area switches from vertical
   tile scroll to a page-turning (horizontal paged) method**, and the side menu
   can be slid away to "enjoy the full bottom half of the screen." Read: while a
   song plays, the mobile feed becomes a paged/card experience rather than a long
   scroll, with the player owning a persistent region.
3. **Expandable / collapsible player detail** ("more info on player"). The owner
   flagged this as "more of a computer aspect", i.e. the desktop column already
   has the rich detail; the MOBILE player bar needs a collapse/expand for song
   info without eating the screen. (Mobile already collapses the video stage to
   0-height when no video is on screen (see the Donut/idle-rail batch), so build
   the expandable INFO on top of that, do not regress it.)
4. **Clips already pause the music** (`playerObscured` on `nav.clips`). But the
   owner's phrasing ("both music and videos should be able to play at the same
   time … swipe menu to change song … this pauses the feed song") is ambiguous
   and worth a quick clarify before building: current behavior fully pauses music
   in Clips; the owner may instead want music to keep going UNTIL they change the
   song via an in-Clips control. **Confirm the intended interaction with the
   owner** rather than guessing. A per-Clips mini music control (change/skip the
   background song from inside the reel) is the piece that is NOT built.

Wiring notes for whoever picks this up: mobile vs desktop split is `wide` in
`App.js` (`Platform.OS === "web" && width >= 1200`); the bottom tab strip and
`mobilePlayerSlot` are the mobile-only render branches; `ClipsScreen` is the
reference for a full-screen paged/scroll-snap surface; the music player pause hook
is `playerObscured`. Do NOT touch the desktop column.

## Status posts + social feed + YouTube sourcing gate (2026-07-18, Claude)

Four owner asks in one batch. `npm run check` green (56 tests, web export). The
status-post half was verified end to end in a real browser (server on a temp DB:
posted a status, it rendered as a social card, commented inline from the feed,
confirmed `kind='status'` in `/api/feed`); a review still posts and shows the
ticket stub. The two YouTube pieces are covered by unit tests but need a prod
spot-check because the local server has no `YOUTUBE_API_KEY` (falls back to Deezer
preview, so no real video mounts locally).

1. **"Wrong artist / wrong song" YouTube results.** Root cause: the candidate
   scorer (`scoreYouTubeCandidate` in `server/musicProviders.js`) only *added*
   points for artist/title and could accept a flawless-title upload by a totally
   different act on "official audio" alone. Added two hard gates that reject
   (score `-Infinity`) before scoring: an **artist gate** (token coverage ≥ 0.6,
   OR the spaceless artist key is a substring of the channel/title so VEVO/official
   channels like `taylorswiftvevo` still pass) and a **title gate** (the requested
   title's words must actually be in the video title, with an exact-substring
   rescue). Also widened the search pool 5 → 10 (search quota is flat, videos.list
   is one cheap unit), so the correct official upload is in the set more often.
   Tests: `musicProviders.test.mjs` "gates on the artist and the song".
2. **Video "cropped / doesn't fit" on the computer.** The YouTube IFrame was sized
   only by pixel `setSize()`, so any lag/rounding vs the host let the frame overflow
   its `overflow:hidden` 16:9 stage and read as cropped/zoomed. Now the iframe is
   pinned to `position:absolute; width/height:100%` of the host in
   `src/lib/youtubePlayer.js` (onReady, via `getIframe()`), and `PlayerBar`'s
   `videoHost` lost its `minWidth/minHeight:200` (they could force the host bigger
   than the stage). CSS now owns fit; the video letterboxes instead of cropping.
   **Needs a prod look with the real key to confirm on a live video.**
3. **Post anything, not just reviews.** New post `kind` column (`'review'` default,
   `'status'` for a plain update; additive migration in `server/db.js`). `POST
   /api/posts` branches on `kind==='status'`: text and/or photos only, no
   artist/venue/rating (`overall` stored 0 so it never touches a chart). The
   composer (`LogScreen`) gained a "Share something / Log a show" toggle; the
   "Make a post" FAB + desktop nav default to status, get-started + artist prefills
   default to show. `store.addLog`/`editLog` carry `kind`. Tests:
   `post.edit.test.mjs` "status posts carry text/photos".
4. **Feed reads like Facebook/Twitter with the comment section preloaded.** Status
   posts render as a social card in `TicketStub` (avatar/name/@handle/time, big
   text, hero photo, like/comment) with no ticket stub or score. New
   `src/components/AfterpartyPreview.jsx` shows the latest ~2 comments + a one-line
   "Write a comment..." composer inline on **every** feed card (reviews and status);
   `PostScreen` passes `showComments={false}` since it has the full thread.
   `loadComments` got an in-flight guard so per-card previews don't double-fetch.

Files: `server/{api,db,musicProviders}.js`, `server/{musicProviders,post.edit,clips}.test.mjs`,
`src/lib/youtubePlayer.js`, `src/components/{PlayerBar,TicketStub,AfterpartyPreview}.jsx`,
`src/screens/{LogScreen,PostScreen}.jsx`, `src/store.js`, `App.js`.
Also fixed a **pre-existing flaky test** (`clips.test.mjs` newest-first assertion
tied on `created_at` and resolved on the random `uid`; now stamps distinct
timestamps). Open follow-ups: status posts don't tag an artist yet (artist=''),
and the desktop persistent-column layout couldn't be exercised in the preview
harness (it rendered the mobile shell regardless of width).

## Clips mode + deeper artist charts (2026-07-17, Claude)

**Clips mode** (the TikTok-style vertical swipe, but for traditional HORIZONTAL
concert videos). New `GET /api/clips`: the same feed ordering, cursor-paginated,
but only public posts carrying a real video (`.mp4/.webm/.mov/.m4v`), each row's
full post projection plus a `clips` array of just the video urls. New
`ClipsScreen`: a full-screen scroll-snap reel, one clip per page, only the ACTIVE
page mounts an expo-video `VideoView` (never every video at once), with its own
play/pause + mute + like/comment overlay. Opening it sets `playerObscured` so the
app's music player PAUSES (clip audio + music don't fight). Entry points: a Clips
button in the mobile feed header and the desktop top nav. Store `loadClips`.
Tests: `server/clips.test.mjs` (video-only filter, image stripping, private
exclusion, newest-first cursor). Verified live: real .webm clip auto-plays at
854x481, scroll-snap on, only one `<video>` mounted.

**Deeper artist song charts** (fixes the "cut off at ~10" complaint). The Deezer
discography response now includes a 25-deep `topTracks` chart (resolved live for
ANY artist, not just seeder-enriched ones; discography cache bumped to v3). The
seeder's `/top?limit` went 10 -> 25. `ArtistScreen` shows the deep chart
collapsed to 10 with a "Show all 25 songs" toggle. Verified live on Drake.

**Still open** (explicitly deferred, its own session): the mobile nav
rearchitecture the owner asked for - replacing the bottom action bar with a
slide-away side menu + page-turning content, and the second per-clips player bar
tied into that mode. Not started this batch to avoid half-shipping navigation.
Also still open: the expandable/collapsible desktop player detail, and video
posts still need the picker verified on a real device (web upload path is wired).

Validation: npm run check green (54 tests, web export).


## Video posts are live end to end (2026-07-17, Claude)

The missing half of "photos or videos". One shared media array, type carried by
the server-assigned object extension, so every existing surface kept working:

- server/media.js: MP4 / WebM / MOV accepted for post, review, and venue
  purposes with their own 100 MB cap (photos keep 12 MB); avatars and banners
  stay image-only. Pinned by tests (accept, oversize reject, purpose reject,
  and the photo cap not loosening).
- src/lib/mediaUpload.js: video mime/extension maps + a 5-minute upload timeout
  for clips (a 100 MB PUT does not fit the 45 s photo timeout).
- LogScreen picker now offers images AND videos.
- SmartImage renders any clip URL as a play tile (dark tile, amber ring), which
  covers the feed strip, profile wall, You-tab wall, and artist gallery with
  zero call-site changes. The full-screen viewer plays clips via expo-video
  (a real <video> with native controls on web), keyed by URL so leaving a clip
  releases its player. Per-media likes work on clips exactly like photos.

Verified end to end: real WebM uploaded through createMediaPresign to R2
(PUT 200, public read video/webm), posted via the API, CLIP tile rendered on
the feed, viewer played it in-browser (readyState 4, currentTime advancing).
npm run check green (52 tests, web export).


## CURRENT: persistent 25% player column + desktop top navigation (Codex)

This completes the layout request that stopped mid-session in Claude. **The old
"top PlayerBar + separate body-fixed YouTube dock" design is obsolete.** Do not
restore it, and treat the older "YouTube player docked" section farther down as
historical context only.

### What changed

- Desktop web (`>=1200px`) is one stable shell: a left player column and a routed
  app surface. The expanded player is `clamp(356px, 25vw, 460px)` (25% at normal
  desktop widths); only the remaining content changes during navigation. The
  player stays mounted across Feed/Search/Discover/You and overlay screens.
- The old left menu rail is no longer used by `App.js`. `DesktopTopNav` in
  `src/components/Rails.jsx` now owns PIT home, Feed, Search, Discover, You, Make
  a post, Activity, Inbox, Menu, login/signup, and the account control. It becomes
  icon-compact below 1500px. The local Feed activity/inbox/menu buttons hide on
  desktop to avoid duplicate navigation.
- The right Artists / Trending venues / Upcoming events rail is preserved when
  there is room (`>=1480px`) and deliberately collapses below that so it cannot
  crush the feed. Nothing was deleted from those discovery data flows.
- `PlayerBar.jsx` now has a purpose-built Apple-style column presentation with
  artwork/video, source status, transport, scrubber, volume, playlist/save
  actions, full queue controls, recent history, and a coming-up card. The queue
  no longer cuts off after ten rows. Narrow web keeps a compact player and a
  16:9 video surface capped at 480x270.
- Minimize is explicit and honest: it pauses first, collapses the column to 82px,
  and labels the state PAUSED. Restore expands it and rebuilds YouTube at the
  captured playback position (the same preservation applies across the 1200px
  responsive host swap). Closing ends the session.
  Normal logout, account gates, landing exit, and account deletion now share the
  same cleanup path and remove `pit.player` plus `pit.playpos`, so another user
  cannot inherit the previous queue.
- Provider-neutral tracks now use `src/lib/playback.js::trackKey` (`artist|title`
  when no durable provider ID exists). Same-titled songs by different artists no
  longer collide in queue selection or resume identity.
- Play history/analytics now records only after YouTube or preview audio actually
  reports PLAYING; failed resolution, blocked autoplay, and queue selection no
  longer inflate plays. Title+artist-only songs are valid history entries.
- Provider-neutral songs also survive saved-session snapshots and profile
  playlist playback. Discover no longer refuses a song just because Deezer has
  no preview, and artist album Play/Shuffle buttons no longer disappear when the
  track list has titles but no pre-attached preview URLs; the unified player is
  allowed to resolve YouTube first.

### YouTube engine / compliance behavior

- `src/lib/youtubePlayer.js` no longer appends a draggable/fixed window or custom
  controls to `document.body`. React owns one stable host and YouTube owns only
  its child iframe. The native YouTube controls remain unobstructed; all Pit
  controls sit outside the iframe.
- The iframe engine mounts lazily only after a real video ID resolves. Scripted
  load/play is gated on document visibility, >50% intersection, an explicitly
  visible host, and at least 200x200. It pauses on tab hide, pagehide, minimize,
  hiding, undersizing, or leaving the visible viewport and never auto-resumes
  from the background.
- At the 1200px desktop cutoff the measured host is 355x200; at 1520px it is
  379x213. (YouTube's hard minimum is 200x200.) The server retains the strict
  referrer policy required by embeds.
- YouTube candidates marked `madeForKids: true` are rejected before caching or
  playback. Terms now link YouTube's Terms of Service; Privacy now discloses the
  YouTube API/embedded player and links Google Privacy. `PolicyScreen` renders
  those as real accessible links.
- Errors 100/101/150 still invalidate the bad match and fall back to a fresh
  preview. A browser autoplay permission block is recorded diagnostically but
  no longer throws an alarming failure toast; the visible Play button is the
  intended recovery.

### Verification and next-agent warnings

- Verified locally in the actual browser at 1520x900, 1280x720, 1200x800, and
  390x844. Confirmed navigation persistence, minimize/restore, full 37-track
  queue, right-rail breakpoint, and the measured video-host sizes above.
- `npm run check` must remain green before shipping. Production already has
  `YOUTUBE_API_KEY`; the local server used the Deezer fallback because that key
  is intentionally not in the tracked/local browser environment.
- Keep the two owner-requested full builds below as separate work: (1) You-tab
  server-backed listening analytics, and (2) Facebook-style per-photo viewer and
  likes. They are **not** implemented by this player batch.

### Media bucket runbook (Cloudflare R2, chosen 2026-07-21)

R2 was picked over S3 because egress is free, and this app serves a lot of photos.
The upload is a **direct browser PUT to a presigned URL** (`src/lib/mediaUpload.js`
asks `POST /api/media/presign`, then PUTs the file straight to the bucket). That
means the bucket's own CORS policy has to allow it. Credentials never reach the
client; the server signs with SigV4 (`server/media.js`).

Steps, all in the Cloudflare dashboard:

1. **R2 > Create bucket**, name it `pit-media`.
2. **Account ID** is on the R2 overview page. `MEDIA_ENDPOINT` is
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (no bucket in the host, the
   signer uses path style and appends it).
3. `MEDIA_BUCKET` = `pit-media`.
4. `MEDIA_REGION` = `auto` (R2 always uses `auto`).
5. **R2 > Manage R2 API Tokens > Create API token**, permission **Object Read &
   Write**, scoped to `pit-media`. It shows an Access Key ID and a Secret Access
   Key **once**. Those are `MEDIA_ACCESS_KEY_ID` and `MEDIA_SECRET_ACCESS_KEY`.
6. **Public access**: on the bucket, enable the **r2.dev** subdomain, then
   `MEDIA_PUBLIC_BASE_URL` = `https://pub-<hash>.r2.dev`. A custom domain
   (`https://media.mshpit.com`) also works and is nicer long term. It must be
   HTTPS with no query, hash, or credentials in the URL or the config is rejected.
7. **CORS policy on the bucket** (required, this is the step people miss: without
   it the browser PUT is blocked and uploads fail even though every key is right):

   ```json
   [
     {
       "AllowedOrigins": ["https://www.mshpit.com", "https://mshpit.com", "http://localhost:8081"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

8. Put all six on the **Render web service** env, then let it restart.

Verify: `/api/health` should report `mediaStorageConfigured: true`, then post a
photo. CSP needs no edit, `connect-src` derives the bucket origin from
`MEDIA_ENDPOINT` at boot (`mediaConnectOrigin()` in `server/index.js`), so the
endpoint must be set **before** the process starts. If a PUT fails in the browser
with a CORS error, step 7 is wrong or missing. Presigned PUTs are valid 10 minutes.

## Feature batch: seen counter, review template, countdowns, edit lockdown, song pins — 2026-07-22 (Claude)

Five owner asks in one pass. All server changes are additive (one new table, one
new posts column); `npm run check` green (46 tests) and every flow was verified
live in the browser plus curl before pushing.

1. **"Seen them before" counter.** `GET /api/artists/seen?name=` counts the
   signed-in user's logged posts for an artist; the artist header shows "You've
   been in the pit with them N times · last DATE" (verified live). Every feed
   post also carries `seen`, the author's ordinal for that artist at that post
   (`SEEN_ORDINAL_SQL` in `server/api.js`), and the card shows "3rd time in the
   pit" next to the artist name when it's above 1.
2. **Review template (score analytics + tags).** Posts have a `tags` column: up
   to 5 short word-art descriptors entered in the Log sheet (chips, enter/comma
   to add), validated server-side (`cleanPostTags`). A post with tags and no text
   renders the tags as the review, so posting without writing is a real mechanic.
   Tapping the star score on ANY card opens the analytics panel: a twirling gold
   star (`src/components/SpinStar.jsx`, coin-spin via scaleX, our own drawn star),
   per-dimension bar graph (`src/components/RatingBars.jsx`, band/room/night
   color-coded, falls back to band+room for old posts), and the tag chips.
   Hovering the score (web) previews the tags. Works on feed, profile walls, and
   the PostScreen since they all render `TicketStub`.
3. **Calendar + countdowns.** The calendar was never broken, it was EMPTY (zero
   tour dates in prod until `TICKETMASTER_KEY` is set, and demo dates were
   correctly purged); it now says exactly that instead of a wall of blank days.
   Profile "GOING TO" rows now tick a live T-minus ("12d 04:32:11 until doors",
   Clock-app style, one shared 1s interval, targets 8pm on the show date).
4. **Edit lockdown + mod flag.** Post editing is the author's alone now: the
   server PATCH 403s admins (regression test flipped to pin this), the store and
   card no longer offer admin edit. Verified live: admin sees Edit only on their
   own post. Mods/admins instead see a red "REPORTED · N" chip on feed cards
   with open reports (staff-only `open_reports` subquery on `/api/feed`).
5. **Song video pins + wrong-version reports.** New `track_overrides` table:
   `GET /api/youtube/track` returns a pinned video before ever consulting the
   search resolver (proven by curl: pin wins, spelling-insensitive via
   `trackOverrideKey`). `video_id NULL` = admin confirmed no correct video, so
   the player honestly falls back to the Deezer preview instead of guessing.
   Every song row on an artist page has a small flag: report the wrong version,
   optionally pasting the correct link (`POST /api/tracks/report`, rate-limited,
   dedupes per reporter). Track reports render specially in the admin Reports
   tab with a link input + "Pin this video" / "No correct video" actions
   (`POST /api/admin/tracks/override`, closes the reports, busts the yt cache,
   writes a moderation record). `parseYouTubeVideoId` accepts watch/youtu.be/
   shorts/embed/music links and bare ids; tests cover it.

Files: `server/{api,db,musicProviders}.js`, `server/{post.edit,musicProviders}.test.mjs`,
`src/components/{TicketStub,RatingBars,SpinStar}.jsx`, `src/screens/{LogScreen,ArtistScreen,ProfileScreen,CalendarScreen,AdminScreen}.jsx`, `src/store.js`.
Open follow-ups: the player bar could surface "confirmed unavailable" copy when a
pin says no video exists (today it just says "preview"), and PostScreen could
default the analytics panel open.

## Deploy failures fixed: tests were running inside the Render build — 2026-07-21 (Claude)

Every deploy from `556c6c0` onward failed with "Exited with status 1 while
building your code", each dying within the same minute it started (a real Expo
export takes 5+ minutes, so the build was dying at the first step).

**Root cause:** the 2026-07-12 stabilization batch changed `render.yaml`'s
`buildCommand` from `npm ci && npm run build:web` to `npm ci && npm run check`,
which runs the whole Node test suite during the production build. The test files
import `server/db.js`, which opens SQLite at `PIT_DATA_DIR` **on import**, and on
Render that is `/data`, the persistent disk, **which is not mounted during
builds**. The import throws, `node --test` exits 1, the deploy dies in seconds.
Reproduced locally: pointing `PIT_DATA_DIR` at an unwritable path makes
`npm test` exit 1 in 1.4 seconds, the exact failure signature.

**Fix (both directions):**

1. `render.yaml` `buildCommand` is back to `npm ci && npm run build:web`. The
   test suite is a local/pre-commit gate (`npm run check`), not a production
   build step; a build container has no data disk and never will.
2. `npm test` is now hermetic: `scripts/run-tests.mjs` always runs the suite
   against a fresh throwaway temp `PIT_DATA_DIR` and cleans it up. This both
   makes the suite immune to hostile environments AND stops a bare `npm test`
   from writing test rows into the real dev database in `server/data`, which it
   was silently doing before.

**Outcome, confirmed live:** Render auto-applied the `render.yaml` change on the
push, no manual blueprint sync was needed. The `2fa5077` deploy went green (new
bundle hash live ~2 min after push), and prod now serves the whole backlog that
had been stuck behind the failures: the 07-15 ALPHA batch (post edit, live chat,
provider identity) plus everything after. Verified on prod after the restart:
`/api/health` 200, `/api/admin/catalog/runs` 401 (route exists, admin-gated),
`/api/time` 200. Health still shows `tourProviderConfigured`, `mailConfigured`,
and `mediaStorageConfigured` all `false`: those keys are still not on the Render
dashboard (see OWNER ACTIONS above).

Validation: `npm test` passes with no env, AND with `PIT_DATA_DIR` pointing at a
nonexistent drive (both 45/45); full `npm run check` green including the web
export; no temp dirs left behind.

## You tab redesigned + artist gallery actually shows fan photos (2026-07-17, Claude)

Owner feedback: the analytics You tab was "bar graphs and a menu", and fan
photos were missing from artist profiles even though attaching them to the
artist's rolling gallery is a core loop.

**Artist gallery, root causes.** (1) artistFanPhotos scanned the viewer's FEED
CACHE, so a photo vanished the moment its post left the first feed page. Fixed
with GET /api/artists/photos (every public post photo for the artist, newest
first, with poster name) which the store loads on artist-page open and merges
with the feed for instant freshness. (2) Gallery tiles used plain Image, so
iPhone HEIC shots rendered blank; they now use SmartImage (HEIC proxied to
JPEG) and tap into the full-screen viewer with per-photo likes. Gallery cap
raised 5 -> 12. Verified in-browser: GALLERY · 3 with every image decoded.

**You tab, real design pass.** Profile-first like prime MySpace/Facebook:
- Hero identity card: stage-light glow banner (user's own banner when set),
  overlapping avatar, badges, points pill, 4 real stats, one-line Wrapped.
- YOUR SOUND: springy genre DONUT (SoundDonut, lifted from Discover's arcs,
  reusable in src/components/SoundDonut.jsx) with tap-to-highlight slices +
  legend; top-3 MOST PLAYED ARTISTS as a medal podium with art; remaining
  artists and MOST PLAYED SONGS as bars that SWEEP IN (Animated width).
- Photo wall: feature-first layout (big lead photo + 2x2 side grid), "See all".
- TOOLS: one compact tile grid replaces the stacked menu rows (the "menu'd to
  death" complaint); badges on Activity/Inbox tiles.
- Staggered fade-up entrance per section (Reveal wrapper).

Validation: npm run check green (50 tests, export). Browser-verified: donut
drawn (16 arcs), podium buttons live, photo wall HEIC decoded via proxy
(naturalWidth 1600), artist gallery all images decoded.


## Donut hover, idle player rail, mobile footprint (2026-07-17, Claude)

Three interaction fixes, all browser-verified:

- **Both genre donuts respond to HOVER on web** (Discover + You tab): one
  mousemove listener on the container, hit-tested by angle and radius, because
  react-native-svg only forwards click. Slices light up as the cursor sweeps
  the ring and the center shows the hovered genre + count; clicking still
  selects (Discover loads that genre's chart). Verified live: center flipped
  to "Hip Hop · 2 plays" on hover with no click.
- **The player column stays out of the way when idle.** It already started
  collapsed (82px rail) and auto-expands on play; closing playback now returns
  it to the collapsed rail instead of expanding an EMPTY column (the old
  setPlayerMinimized(false) in stopAndClearPlayback was backwards). Collapsing
  while a song plays still pauses it (the engine is gated on !minimized), which
  is also the YouTube-terms behavior.
- **Mobile player footprint: 11% of the screen, was ~40%.** The compact layout
  always reserved a 200px+ video stage even for preview audio or paused video.
  The stage now collapses to zero height while no video is on screen (the host
  div stays mounted so the engine survives pause/resume; a PLAYING video still
  always shows at full size per YouTube's terms). The volume slider also hides
  under 700px width - phones have hardware volume. Measured live at 375x812:
  the whole playing player block is 91px.

Validation: npm run check green (50 tests, export); measured/tested in the
browser at mobile and desktop sizes.


## You tab is a real analytics page (2026-07-17, Claude)

YouScreen rebuilt as the user's own analytics dashboard, everything DERIVED from
real activity (the old screen hardcoded "7 artists / 5 venues" and a fake
Wrapped line "punk / 5.0", which violated the no-fabrication rule):

- Stats row: shows logged, DISTINCT artists seen, DISTINCT venues, from the diary.
- Wrapped: real shows-this-year, most-seen live genre, best-rated night; honest
  empty copy when the year is blank.
- YOUR SOUND: total plays, top-genre chips (case-folded so Pop/pop is one
  genre), MOST PLAYED ARTISTS and MOST PLAYED SONGS with count bars scaled to
  the #1 row; artist rows open the artist page, song rows play in the player.
- YOUR GALLERY: every photo the user posted, grid opens the full-screen viewer
  (per-photo likes included) at the tapped photo.
- PLAYLISTS (tap to play the whole list) and GOING TO with live countdowns
  (shared src/lib/showTime.js); both sections hide when empty.
- SOCIAL / ACCOUNT / DIARY unchanged below.

Play history is now CROSS-DEVICE: on login the store hydrates playHistory from
GET /api/me/plays (server truth; every play already wrote through), so a fresh
device shows real charts instead of an empty page. Device-local history stays
as the logged-out fallback. Store also exports genreOfArtist.

Validation: npm run check green (50 tests, export). Browser-verified live:
2 shows / 1 artist / 2 venues (real dedupe), Wrapped from real logs, 36 plays
charted with correct genre merge, gallery opens the viewer.


## Images fixed (HEIC) + Facebook-style photo viewer with per-photo likes (2026-07-17, Claude)

**"Images not loading on the platform," root cause.** iPhone photos upload as
HEIC; storage was healthy (200, image/heic, verified end to end) but no browser
except Safari can DECODE HEIC, so most real posts rendered nothing. Fix:
src/lib/img.js gains isHeic/displaySrc, and SmartImage renders known-HEIC URLs
straight through the wsrv.nl transcode (output=jpg, verified against a real
production photo: 1MB HEIC -> 112KB JPEG). Non-HEIC still loads direct with the
existing proxy-on-error ladder. No stored data was touched; every already-broken
photo displays as-is.

**Facebook-style media viewer.** PhotoViewer rebuilt: SmartImage rendering (so
HEIC works INSIDE the viewer too), arrows + keyboard nav + Esc/backdrop close,
photo credit, and a per-photo like. Feed thumbnails now open the viewer at the
tapped photo (TicketStub MediaStrip -> onOpenPhotos, threaded through
FeedScreen/PostScreen/ProfileScreen); the +N tile opens the set.

**Per-photo reactions are durable and follow the photo.** New media_reactions
table keyed by the photo's object URL (unique per upload, so likes survive post
edits/reordering and surface in the artist rolling gallery, which reads the
same URLs). Routes: POST /api/media/react (auth, toggle, canonicalizes the URL,
https-only) and POST /api/media/reactions (batch counts, public; `mine` for the
signed-in viewer). Store: mediaReactions cache + optimistic toggle w/ rollback.
Regression test: server/media.reactions.test.mjs.

expo-video (GPT's install) is committed as a dependency only; video upload and
playback remain the NEXT media batch, nothing references it yet.

Validation: npm run check green (50 tests, web export). Browser-verified against
a real production HEIC: feed thumbnail renders via wsrv, JPEG direct, viewer
opens from the tap, like toggles to "1 like" and persists server-side.


## YouTube player docked + ToS compliance (2026-07-16, Claude)

The left rail's DISCOVER shortcut list is gone (all destinations exist
elsewhere); that bottom-left space is now the permanent dock for the YouTube
player window. Compliance drove the design: YouTube's API terms prohibit
hidden/background playback, so the minimize-to-audio mode was REMOVED, hiding
the video (window close or the bar's Video toggle) now PAUSES playback, and
pressing play always re-shows the dock first. Player bumped to 356x200, above
YouTube's 200px minimum player size. Do not reintroduce any state where audio
plays with the video hidden.

Validation: npm run check green (46 tests, web export).


## Song flags on every row + video autoplay fix (2026-07-16, Claude)

Two owner-reported bugs. (1) The wrong-version flag only existed on POPULAR
SONGS rows; album tracklist rows had none. The report box is now one shared
renderer used by every song row on the artist page. (2) "Video won't play /
greyed out": the resolver works fine in prod (real ids, good confidence); the
cause is browser autoplay policy. Our resolve is async, so by the time
loadVideoById runs, the user's tap gesture is gone and YouTube loads CUED
(a dark thumbnail that looks dead). The player now records the play intent on
every load and retries playVideo() once on the CUED state; if the browser still
blocks it, the bar honestly shows the play button and one tap starts it.

NEXT UP (owner-requested, needs a dedicated session each, do NOT half-ship):
1. You-tab analytics page: move most of Discover's user-facing stats to You.
   Real listening analytics (top songs/genres/most played from the server plays
   table, not device-local), own gallery, playlists, going-to. Server work:
   plays aggregation endpoint.
2. Facebook-style photo viewer: PhotoViewer.jsx exists (fullscreen + arrows).
   Add per-photo likes (new table photo_likes keyed post_id + photo index,
   POST route, like counts in the photos projection), open it from TicketStub
   photo taps, show the poster + like button per photo. Public post photos
   already flow to the artist rolling gallery (artistFanPhotos -> artistGallery).


## Performance-page identity + crash fix, durable Songs moderation (2026-07-16, Claude)

Owner feedback: features were landing demo-grade (state that dies on refresh, no
dedicated home, entry points that crash on real data). This batch closes those.

**Calendar crash (PIT-APP-001), root cause.** ShowScreen assumed a logged review:
`log.overall.toFixed(1)` and `log.setlist.length` threw on any bare tour date
opened from the calendar. Fixed by normalizing the event shape (venue/place,
missing city) and guarding every field.

**Performance page is now its own thing (vs the venue page).** Ticket-style hero
(amber stub edge, perforation, THE ROOM / THE DATE strip) and two honest modes:
UPCOMING = live until-doors countdown (shared src/lib/showTime.js, also used by
the profile GOING TO list), Get tickets, Going + lounge, no fabricated score and
no review CTA; HAPPENED = community score card + setlist, "No score yet" state
when nobody logged it. Verified in-browser on a real Ticketmaster date (The
Weeknd, live countdown ticking).

**Song reports are durable and have a real home.** New admin **Songs** tab (mods
too): open wrong-version reports (with the reporter's suggested link prefilled)
+ a PINNED LINKS list. The moderation queue re-pulls from the server every time
the Reports/Songs tab opens (store loadModerationQueue) instead of trusting the
login-time absorb, so reports survive refresh and devices. New GET
/api/admin/tracks/overrides + DELETE /api/admin/tracks/override (unpin, resolver
takes over). Verified end to end by API: report -> queue -> pin -> resolver
returns status "pinned" -> report auto-actioned -> unpin.

Also confirmed while auditing: profile-wall post editing was already wired
(onEditPost -> TicketStub), and the feed analytics pill renders live.

Validation: npm run check green (46 tests, export ok), browser walkthrough of
calendar -> show page, API cycle above on the running server.


## Catalog job now tells the truth — 2026-07-21 (Claude)

**Finishes the 2026-07-14 incident repair that was left half-done.** The server side already detected an exhausted crawl and recorded durable run history, but nothing surfaced either, so the admin console still had the misleading button that caused the incident.

### Root cause recap (unchanged, for context)

"Grow by 10k" added **zero** artists (all 76 genre cursors had reached the end of their results) yet reported success, and still fell through into a full Deezer re-enrichment of 5,599 existing profiles. That pass rewrote ~46,676 short-lived preview URLs, which expired ~15 minutes later and progressively broke playback. The catalogue itself never shrank — the "243 artists" reading was Discover showing a region+genre-filtered count as the global total.

### Completed this batch

1. **The admin console can no longer lie.** `AdminScreen` renders the `exhausted` phase explicitly ("Nothing left to add (CATALOG_CRAWL_EXHAUSTED)") with the server's note; previously that phase rendered **nothing**, so a no-op grow looked like a success. Error rows now include the stable `errorCode`.
2. **Durable run history is visible.** New `GET /api/admin/catalog/runs` (admin-only, bounded to 20) exposes the `seed_runs` table that already existed but was written and never read. The Catalog tab shows the last five jobs with mode, status, added/filled counts, error code, and date — a record that survives restarts.
3. **The false claim is gone from the code and the UI.** The `startCatalogSeed` comment asserting it "always adds and is never a no-op" was the inverted truth; it and the Catalog tab copy now state that an exhausted crawl adds nothing and that enrichment never touches already-complete profiles.
4. **The incident logic is now pinned by tests.** Extracted two pure helpers, `growOutcome()` and `shouldEnrichAfterCrawl()`, used by the live job, and covered them in `server/catalogSeed.test.mjs` (7 tests): zero-added reports `exhausted` not `done`, a satisfied target is not misreported as exhausted, an operator stop outranks both, and enrichment never runs when the crawl added nothing.

### Validation

`npm run check` green: 45 Node tests pass, syntax check passes (48 files), Expo SDK 56 web export succeeds.

### Still open

- Deleting a post is still not implemented (soft-delete + tombstone; see the post ALPHA note below).
- Chat/feed live sync is 3.5s/12s polling — an ALPHA bridge, not the end state. See the scale follow-ups below.
- `perTag` crawl depth can be raised to reach genuinely new MusicBrainz results; the crawl is exhausted only *at the current depth*. A new source (or deeper paging) is what actually grows the roster past ~10k.

## Post create/edit and live feed ALPHA — 2026-07-15 (Codex)

**Owner request:** keep the existing review-forward layout, make posts editable and cross-device fresh without manual reloads, and remove prototype-only state gaps.

### Completed

1. `POST /api/posts` now returns the canonical server post. Six-factor review dimensions are persisted in the additive `posts.dims` column, so hydration no longer removes the Night score or other rating detail.
2. `PATCH /api/posts/:id` explicitly whitelists and validates editable fields, preserves banned/suspended checks, allows the author or an administrator, rejects stale versions with `CONFLICT`, and records administrator edits in `moderation_actions`. IDs, authorship, timestamps, removal state, and counters cannot be edited. Photo visibility now requires a real boolean/0-or-1 instead of accepting truthy strings.
3. `LogScreen` is reused in Edit post mode with the existing layout, photo controls, autocomplete, ratings, and failure feedback. Failed/conflicting saves keep the form open. Existing ratings are not recomputed unless the user actually changes them.
4. Feed cards expose an author/admin Edit control and an `edited` label. Open post details resolve the current feed row by ID, so a saved edit is visible immediately instead of showing the navigation snapshot.
5. The public feed refreshes every 12 seconds while the app is active. Refreshes do not overlap, abort on unmount, pause in the background, resume on foreground, back off to two minutes after failures, reject responses older than a local create/edit/like, and never reset the older-page cursor after initial hydration.
6. Profile opening now hydrates that account's bounded server post wall (`GET /api/users/:id/posts`) rather than showing only posts already present in the first global feed page. Server timestamps are normalized into the relative label expected by `TicketStub`.
7. Focused regression coverage lives in `server/post.edit.test.mjs`: canonical create/dim persistence, strict visibility validation, author/non-owner/admin permissions, immutable fields, optional-field clearing, stale-edit conflict, audit recording, suspended-account enforcement, and missing posts. Focused post tests, API integrity tests, syntax checks, and Expo SDK 56 web export passed during implementation.

### Scale follow-up

- The 12-second first-page poll is an ALPHA bridge. At large scale, replace it with WebSocket/SSE fan-out plus durable pub/sub while retaining cursor catch-up; add feed upsert/removal tombstones so moderation and deletion propagate without rereading windows.
- Owner post deletion is still not implemented. Use a soft-delete/audited route rather than erasing the post graph, then add an idempotent client action and tombstone sync.
- The current profile post endpoint is capped at 100 and needs cursor pagination before high-volume accounts.
- Comment polling remains merge-only; moderated/deleted comments need tombstones or authoritative-window reconciliation.

## Group-chat ALPHA integrity and live sync — 2026-07-15 (Codex)

**Owner request:** fan clubs and concert lounges must receive new messages without a browser refresh, keep failed drafts available, and enforce the membership/attendance gates they advertise. This batch changes behavior only; it does not redesign either chat.

### Completed

1. **Forward live cursors.** DM, fan-club, and lounge GET routes retain their existing `before` history cursor and now also accept an exclusive `after` cursor. Responses include `syncCursor` and `hasMore`; ties are stable on `(created_at,id)`. The client catches up in bounded pages instead of downloading the full newest window every 3.5 seconds.
2. **One safe polling lifecycle.** `src/lib/useLiveChat.js` starts immediately, prevents overlapping reads, drains short bursts, pauses in the background, resumes on foreground, and cancels/cleans up when the room unmounts. Intentional caller cancellation no longer creates a false `PIT-NET-002` diagnostic; genuine timeouts still do.
3. **Deterministic client state.** Store loaders retain server timestamps, upsert/deduplicate by ID, sort chronologically, cap device memory (600 shared-chat messages / 750 DMs), and reconcile staff-removed message IDs. Optimistic messages adopt the server ID without briefly duplicating when a poll and send response cross.
4. **Messages are visible as they arrive.** Fan clubs, concert lounges, and DMs start at the newest message and follow new content while the reader remains near the bottom. Scrolling up to read history disables that automatic movement until the reader returns near the bottom. The lounge gate also hydrates its real message count before entry.
5. **Truthful retry behavior.** Chat inputs clear only after the server confirms the write. Failed sends remove the optimistic bubble but keep the typed draft for a retry; the existing feedback host presents the corresponding themed diagnostic. Send buttons prevent duplicate submissions while a write is in flight.
6. **Fan-club membership is enforced.** Joining/leaving waits for server confirmation, closing the former join/send race. `POST /api/fanclubs/:artist/messages` rejects non-members with `FAN_CLUB_MEMBERSHIP_REQUIRED`, mapped to `PIT-CHAT-001` ("Join the crowd first"). Direct API calls can no longer bypass the Join gate.
7. **Lounge attendance is enforced.** Entering a lounge idempotently saves `going: true` before opening the composer and never toggles an existing attendee off during retry. `POST /api/lounges/:key/messages` rejects accounts outside that show's Going list with `LOUNGE_ATTENDANCE_REQUIRED`, mapped to `PIT-CHAT-002` ("Save your spot first"). Guests may still inspect the public lounge after entering but cannot post.
8. **Regression coverage.** `server/api.integrity.test.mjs` covers forward pagination/catch-up, `before`/`after` conflict rejection, moderation tombstones, membership and attendance rejection, idempotent gate writes, and a successful retry after satisfying each gate. Focused API, error-catalogue, request-control, and syntax checks pass.

### Scale follow-up

- Polling is an appropriate ALPHA bridge, not the millions-user end state. Before broad scale, move shared chat to a horizontally scalable realtime service (WebSocket/SSE gateway plus pub/sub), managed relational storage, durable queues, server-side unread/read cursors, delivery acknowledgements, and observability. Preserve the current cursor contract as reconnect/catch-up fallback.
- The UI currently keeps only a recent bounded window and has no "load older messages" control even though the API's `before` cursor exists. Add explicit history pagination before long-running rooms need more than that window.
- Moderation tombstones are returned as a bounded recent list. A durable deletion/event cursor should replace that list when chat volume becomes material.

## Rewards, local discovery, moderation, and blocking - 2026-07-13 (Codex)

**Owner request:** preserve the current layout while repairing the empty right rail, badge correctness, admin actions, and blocking. This batch does that without changing navigation or page structure. All earlier YouTube/player, error-catalogue, upload, account, and stabilization notes remain below.

### Completed

1. **Right rail is server-backed and location-aware.** New `GET /api/discovery/sidebar` returns real DB-ranked artists, upcoming provider events, and venue counts. Shows/venues rank by the signed-in account's saved city and coordinates, then widen through 75 km, province/state, 250 km, country, and global results rather than leaving the cards blank. `RightRail` uses this response and shows themed loading/provider/error copy. Production no longer depends on stripped demo reviews for its Top Artists list; the bundled real artist catalogue remains a safe visual fallback while the request is loading.
2. **Tour ingestion now covers member cities.** `server/tourdates.js` still refreshes named artists, but now also requests real music events for the 50 most-used account cities through Ticketmaster's official `city + classificationName=music` search. The first refresh starts 5 seconds after boot. `TOURDATE_CITY_LIMIT=50` is in `render.yaml`. Health now exposes `services.tourProviderConfigured` and `services.tourDates` without exposing any provider key.
3. **Badges use authoritative server history.** New `user_achievements` is an append-only, idempotent SQLite ledger. `GET /api/users/:id/rewards` calculates shows, written reviews, received likes, photos, unique cities/artists, follows, and fan-club memberships from non-removed server records; it records each earned badge once. Profiles and the badge board hydrate this data, the hard-coded `/10` was removed, and tier progress now measures progress inside the current tier.
4. **Moderation buttons change the server or report failure.** `POST /api/admin/content/:type/:id` removes/restores posts, comments, fan-club messages, lounge messages, and venue reviews. The client waits for server success before changing the screen. Report action/dismiss, bans, suspensions, role changes, verification, and sponsor changes no longer silently claim success after failure.
5. **Moderator permissions are real and bounded.** Moderators can load reports/members, remove/restore content, suspend accounts, and lift suspensions. Administrators retain bans/unbans, role/verification/sponsor changes, artist approvals, analytics, and catalogue control. Moderator screens no longer offer Ban. Administrator targets cannot be banned/suspended/role-changed through ordinary admin routes.
6. **Append-only admin audit trail.** `moderation_actions` records actor, action, target, reason, prior/next state, request ID, and timestamp without storing content bodies or credentials. Report actions are transactional; unsupported user/message report targets remain open for manual review instead of being falsely marked actioned. Duplicate open reports from one reporter are coalesced.
7. **Blocking is enforced across direct routes.** Either-direction blocks now close direct profiles, posts, rewards, playlists, follows/following lists, likes, comments/replies, DM history, fan-club messages, event attendees, venue reviews, and blocked notification counts. Feed block filtering happens in SQL before pagination. A successful block purges already-cached posts, comments, shared chat entries, DM thread, and notifications from the browser.
8. **Regression coverage.** Tests now prove local-first discovery, permanent one-time badge awards, block enforcement across reads/writes, and real audited moderator changes. `npm test`, syntax checks, Expo SDK 56 web export, and `git diff --check` passed before commit.

### Database/deployment behavior

- No manual migration command is required. `user_achievements` and `moderation_actions` are created idempotently at server boot on the existing persistent SQLite disk.
- A valid Render `TICKETMASTER_KEY` or approved `BANDSINTOWN_APP_ID` is still required for real dates. A configured-but-invalid Ticketmaster key produces zero rows; check `/api/health`: `tourProviderConfigured` must be true and `tourDates` must rise above zero after the first refresh. Never restore fabricated `g_t_*`, `ca_t_*`, `ct*`, or `t1`-`t4` rows merely to fill the cards.
- The older note below says the local Ticketmaster key returned `Invalid ApiKey`. Treat that as unresolved until production health shows a non-zero date count. Ticketmaster keys can require activation; replace the Render secret if it remains at zero.

### Deliberately remaining work

- Add badge-earned notifications, definition-version migration rules, quality/anti-farming thresholds, and a profile badge showcase. The ledger foundation is present; do not move badge authority back into `src/store.js`.
- Add an admin Audit/Case UI, required action-reason forms, evidence snapshots, report grouping, appeals/reversals, cursor pagination/server search, an `owner` role, and step-up authentication/MFA for dangerous actions. The audit data exists but has no screen yet.
- Finish SQL-level blocked-user predicates on every high-volume comment/community query before those tables become large. Correct filtering exists now, but some community endpoints filter the returned page in memory.
- A public signed-out visitor can still see intentionally public content; account blocking cannot prevent the same person from logging out. Keep user-facing wording accurate.

## Production rollout — 2026-07-13 (Codex)

- `codex/stabilize-core` was fast-forwarded into `master` and deployed by Render at commit `4150a0d`.
- The GitHub production quality job passed. The live homepage and `/api/health` returned HTTP 200 after the Render restart.
- `YOUTUBE_API_KEY` is now configured as a Render-only secret. Production health reports `database: true` and `youtubeConfigured: true`. The key is not stored in Git, the Expo bundle, or this handoff.
- Recovery email and durable photo storage remain intentionally unavailable until their private Render configuration is completed. Production currently reports `mailConfigured: false` and `mediaStorageConfigured: false`.
- Playback testing should cover a previously uncached artist/title, visible pop-out video, minimize-to-audio, navigation while playing, queue advance, and the Deezer fallback. Check Settings → Diagnostics for a `PIT-*` reference if a track fails.

## Reliability, media, and feedback batch — 2026-07-12 (Codex)

**Branch:** `codex/stabilize-core`
**Visual contract:** preserve the existing information architecture and page layout. The owner authorized a restrained polish pass: rounder type, softer corners, clearer focus states, and tactile depth inspired by Duolingo. No navigation or content hierarchy was redesigned.

### Completed in this batch

1. **One themed failure language across the app.** `ERROR_CATALOG.md`, `src/lib/errorCatalog.mjs`, and `src/lib/diagnostics.js` define stable `PIT-*` support codes, safe messages, retry guidance, failure points, request IDs, a 75-entry device history, deduplicated feedback, and privacy-safe route templates. Failed mutations show a themed toast; routine read failures are recorded without interrupting the user. Settings now links to the new Diagnostics screen, and the render error boundary uses the same catalogue.
2. **Safe server error envelopes.** `server/errors.js` and `server/index.js` add stable server codes, HTTP status, retryability, and an `X-Request-Id`/body request ID without returning raw stack traces or internal 5xx messages. Client calls have bounded deadlines and preserve caller cancellation.
3. **Durable direct media uploads.** `server/media.js` issues AWS Signature V4 presigned PUT URLs for S3-compatible storage. `src/lib/mediaUpload.js` uploads the selected file before any profile, artist, post, or venue-review URL is saved. Device-local `file:`, `blob:`, and `data:` values are rejected. Avatar limit is 5 MB; post/banner/venue media limit is 12 MB; accepted types are JPEG, PNG, WebP, GIF, HEIC, and HEIF. Expo Image Picker is installed and declared for SDK 56 with photo access only.
4. **Truthful social writes.** Profile, artist profile, posts, venue reviews, follow/block, like, fan-club membership, attendance, comments, lounge messages, fan-club messages, DMs, and ratings now resolve success/failure instead of silently pretending a failed write worked. Existing optimistic interactions roll back or reconcile from the server, and forms/drafts remain available after failed saves.
5. **Stable pagination paths.** The main feed uses `(created_at,id)` cursors on the server and can load later server pages from the current feed UI. DMs, comments, fan-club messages, lounges, notifications, and venue reviews expose server cursors for incremental client adoption. Matching composite SQLite indexes avoid re-sorting those parent/time/ID paths. Offset feed compatibility remains temporarily available.
6. **Account deletion and broader export.** Settings has a two-step password-confirmed delete flow. The server deletes the relational account graph in one immediate transaction and clears the session only after success; an ambiguous lost response is verified through `/api/me` before the client clears data or invites a retry. Export includes major user content and relationship categories while excluding secrets, network metadata, and session material. Web downloads JSON; native writes an SDK 56 `expo-file-system` cache file and opens the `expo-sharing` sheet. Banned/suspended accounts remain blocked from social use but can still export or delete through `AccountGate`. Very large exports and object-storage cleanup remain background-worker work.
7. **Playback and device-storage failures are visible.** Preview/YouTube fallback failures and persistence failures now enter the same diagnostic catalogue. A successful preview fallback does not show a frightening toast; it records why YouTube failed for later support review.
8. **Subtle visual polish, no layout rewrite.** Shared theme tokens, buttons, rails, ticket cards, and headers now use rounder system display fonts, consistent radii, keyboard focus rings, soft elevation, and a small pressed state. Expo web's deprecated shadow/text-shadow/pointer-events syntax was isolated to native or replaced with current web styles so future console signals stay useful.

### Deployment requirements

- Configure `MEDIA_ENDPOINT`, `MEDIA_BUCKET`, `MEDIA_REGION`, `MEDIA_ACCESS_KEY_ID`, `MEDIA_SECRET_ACCESS_KEY`, and `MEDIA_PUBLIC_BASE_URL` on the Render web service. `MEDIA_PUBLIC_BASE_URL` must serve the same keys written to the bucket.
- Set bucket CORS to allow `PUT` from `https://www.mshpit.com` and the explicitly supported development origin, with the `Content-Type` header. Do not use `*` origins for credentialed site traffic.
- The current presign path validates the declared type and size. Before broad public uploads, add a finalize endpoint/job that verifies the stored bytes, sniffs content, strips metadata, creates bounded thumbnails, moderates/quarantines files, and deletes orphaned or account-owned objects.
- No manual database migration is required for this batch. Idempotent cursor indexes are created on server boot. The media provider is intentionally unconfigured until the above secrets and CORS policy exist; users will receive `PIT-UPLOAD-001` rather than saving a broken local URL.

### Verification performed

- `npm run check`: Node regression tests, server/script syntax, and Expo SDK 56 production web export.
- `git diff --check`.
- `npx expo config --type public` confirmed SDK 56, the Image Picker photo-only permission text, and the Sharing plugin. Installed versions match the exact SDK 56 references: `expo-image-picker ~56.0.20`, `expo-file-system ~56.0.8`, and `expo-sharing ~56.0.21`.
- Desktop and 390x844 in-app browser smoke: guest feed, mobile navigation, and sign-in surface; no horizontal overflow at 390 px. The development server's React Native Web deprecation warnings found during this pass were corrected in source.

### Remaining scale and launch risks

1. Configure object storage, then build upload finalization, image derivatives, malware/content scanning, moderation, object inventory, orphan cleanup, and delete-account object cleanup.
2. Move SQLite, in-process rate limits, and background ingestion to managed Postgres, shared cache/rate limits, durable workers/queues, observability, and tested off-host backups before claiming readiness for millions of users.
3. Replace synchronous capped export with an authenticated asynchronous archive job for large accounts.
4. Wire the new server cursors into long conversation/review screens and remove thread-summary/count N+1 reads. The feed is the first client cursor consumer, not the end of pagination work.
5. Split `src/store.js` incrementally by domain behind its existing public facade; do not pair this with a visual/navigation rewrite.
6. Introduce canonical Performance, Artist, Venue, and Media IDs and migrate concatenated display-string identities.
7. Choose and verify a supported native YouTube path. The current iframe player is web-only; native preview audio and focused Expo DOM/video behavior need device testing.
8. `npm audit --omit=dev` currently reports the Expo toolchain path `expo -> @expo/config-plugins -> xcode -> uuid` for GHSA-w5hq-g745-h8pq. The app does not call the affected UUID buffer APIs, and `xcode` calls `uuid.v4()`; `npm audit fix --force` would incorrectly downgrade Expo to 46. Monitor Expo's dependency update instead of forcing a breaking downgrade.

## Stabilization batch — 2026-07-12 (Codex)

**Branch:** `codex/stabilize-core`
**Visual contract:** no layout, theme, spacing, typography, or component redesigns in this batch.

### Completed in this batch

1. **Profile crash fixed.** `ProfileScreen` now calls every hook before its missing-user return. An uncached profile that resolves after the first render no longer changes hook count.
2. **YouTube/player dead ends fixed.** Artist+title-only tracks remain valid queue entries. Provider resolution, iframe API loading, and player initialization have terminal 12-second paths. Initialization/embed/playback failures fall back to the existing preview/unavailable behavior instead of spinning forever. A failed video is scoped to its own ID. Hidden video DOM is `aria-hidden` and inert.
3. **Authentication made authoritative.** `/api/me` returning 401 or no user clears the cached session. Bundled plaintext login/signup fallback now requires both a development build and `EXPO_PUBLIC_ENABLE_DEMO_DATA=true`; production network failures cannot create a fake logged-in state.
4. **Production demo data isolated.** Demo users/feed/messages/notifications/ratings/fan clubs/requests/fabricated tour dates start empty in production. Bootstrap removes exact known prototype IDs from persisted browser state while retaining server-created records. The explicit demo flag cannot enable demo content in a production build.
5. **Upcoming events corrected.** All upcoming/nearby/recommended/venue-count paths now require a valid today-or-future calendar date. Legacy generated event IDs (`g_t_*`, `ca_t_*`, curated `ct*`, and `t1`–`t4`) are rejected in production.
6. **Ingestion stopped fabricating social proof.** Venue/Canada jobs no longer invent concerts, sold-out status, ratings, reviews, or setlists. They remove their legacy generated rows. Provider imports now prefer Ticketmaster/Bandsintown event IDs and exact requested-artist attraction matches. MusicBrainz search tags are stored as `genreHint`, not published as the primary genre until enrichment verifies one. The bundled JSON still contains legacy rows for development compatibility, but production runtime policy excludes them.
7. **Backend profile integrity fixed.** User-controlled `extras` cannot overwrite trusted public identity/role/verification fields. Malformed stored JSON recovers safely. Oversized/non-object extras are rejected atomically instead of being truncated into corrupt JSON.
8. **Newest social content restored.** DMs, comments, fan-club messages, and lounges select the newest capped records and reverse only the returned page for chronological display. This fixes new messages disappearing after the old cap was reached. Cursor pagination is still the required scale follow-up.
9. **Feed hydration now upserts.** Existing server post IDs are replaced with current server values instead of remaining permanently stale.
10. **API/server reliability improved.** Native API requests now have a production origin fallback and can be overridden with `EXPO_PUBLIC_API_URL`. Authenticated route limits are keyed primarily by account instead of forcing users behind one network into the same action bucket. Health now reports database readiness plus mail/YouTube configuration. YouTube search requires embeddable + syndicated results and returns a diagnostic status. Password recovery uses a fixed production origin and never logs email addresses, tokens, or reset links when mail is unavailable. Static assets stream instead of blocking the Node event loop, HEAD responses send no body, and fatal uncaught errors drain/exit for a clean Render restart.
11. **Quality gates added.** `npm test`, `npm run check:syntax`, and `npm run check` are available. GitHub Actions runs the full test/syntax/Expo production-build gate on PRs and master, and Render now runs the same gate before accepting a deploy. Regression tests cover health/database readiness, profile projection spoofing/corrupt JSON, newest capped messages, demo-data gating/cleanup, and calendar filtering.
12. **Claude guide refreshed.** `CLAUDE.md` now describes the real server-backed codebase, data rules, file boundaries, required checks, and handoff expectations instead of the obsolete “no backend” prototype.

### Validation required before merge

- `npm run check`
- `git diff --check`
- Local server smoke: `/api/health`, GET `/`, HEAD static asset
- Browser smoke: guest feed/search, login/session expiry, uncached profile, title-only track, YouTube unavailable/preview fallback, mobile viewport

### Deployment/configuration notes

- Do **not** set `EXPO_PUBLIC_ENABLE_DEMO_DATA` in production.
- Keep `YOUTUBE_API_KEY` server-side. `/api/youtube/track` now reports `unconfigured`, `quota_or_forbidden`, `provider_error`, `not_found`, `cached`, or `resolved` alongside `videoId`.
- Set both `RESEND_API_KEY` and a verified `MAIL_FROM` in Render before advertising password recovery. `PUBLIC_ORIGIN` is pinned to `https://www.mshpit.com` in the Blueprint.
- Native builds may set `EXPO_PUBLIC_API_URL`; otherwise they use `https://www.mshpit.com`. Expo public variables are build-time values and must never contain secrets.
- No database schema migration is required for this batch.
- GitHub CLI was unavailable in the Codex environment. Git branch/commit/push can proceed, but draft PR creation may need the GitHub website or `gh` later.

### Next stabilization priorities (preserve the current visuals)

1. Choose durable object storage/CDN and replace every persisted `file:`/`blob:` media URI with validated uploads.
2. Replace remaining silent optimistic writes with idempotent desired-state APIs, pending/failed state, retry, and reconciliation.
3. Add cursor pagination and thread summaries; remove the DM thread N+1 query.
4. Split `src/store.js` by domain behind the same screen-facing API. Introduce a server-state query cache incrementally rather than rewriting every screen at once.
5. Add canonical `Performance`, `Artist`, `Venue`, and media IDs, then migrate attendance/reviews/posts away from concatenated display strings.
6. Complete immutable consent versions, object-file deletion, asynchronous large-account exports, the remaining SQL-level block filters, moderation case/appeal UI, and recovery-mail readiness. Core block enforcement, bounded moderator permissions, and append-only audit records are implemented.
7. Before serious growth, migrate the single-instance SQLite/data jobs to managed Postgres, object storage/CDN, a shared rate-limit/cache service, background workers, observability, and tested off-host backups. That backend work does not require a visual redesign.
8. Decide the supported native playback path: SDK 56 `expo-audio` for previews/audio and a focused Expo DOM component for YouTube embeds. The current YouTube player remains web-only.

**PLAYBACK = YOUTUBE NOW, SPOTIFY REMOVED (2026-07-12).** The Spotify Web Playback SDK is gone (it needed Premium + a dev-mode allow-list per tester and was the source of the playback problems). Every song now streams the FULL track/video through the **YouTube IFrame Player** for everyone, no account. `src/lib/youtubePlayer.js` is a persistent, body-mounted player driving the existing scrubber/volume/auto-advance transport. **Pop-out video window (2026-07-12):** the video is a real draggable mini-window (drag by its header, **minimize-to-audio** collapses it to a header bar while the iframe stays rendered so sound keeps going, hide/close, and its own prev/play/next wired to the same queue). It's body-mounted so it **keeps playing as you navigate the whole app**; position persists across reloads; the top bar's "Video" button shows/hides it. Verified live (drag persists, minimize 274->44px with audio continuing, expand restores, title tracks the song). Gotcha found + worked around: under react-native-web's global CSS, setting a child div's `height` is ignored, so the collapse clips at the WINDOW (its `overflow:hidden`) instead of the video wrapper. `PlayerBar.jsx` was rewired onto it; when YouTube has no match (or no key/quota) it falls back to the **Deezer 30s preview** mp3 — so playback never dies. Server: `GET /api/youtube/track?title=&artist=` resolves a videoId via the **YouTube Data API** and caches it FOREVER in a new `yt_cache` table (a cached null miss gets a 6h TTL). All Spotify routes/OAuth/columns-usage removed; `enrichArtistFromDeezer` no longer needs Spotify. CSP swapped to youtube.com / s.ytimg.com / googlevideo.com. **CONFIG NEEDED:** set **`YOUTUBE_API_KEY`** on the Render web service (console.cloud.google.com → enable "YouTube Data API v3" → API key). Slot added to `render.yaml` (needs a Blueprint re-sync to appear). The free quota is ~100 searches/day, so the id cache fills gradually (top artists first) — until it does, and for any un-embeddable video, everyone hears the Deezer preview, which is a fine default. Build-verified (server boots, endpoints correct, bundle compiles); **in-browser playback pass still pending** (needs the key + the preview classifier, which was down again this session).

**CATALOG DATA FIXED (2026-07-12) — wrong photos/songs + blank top songs.** Two bugs behind "weird profiles / wrong songs / missing songs": (1) the on-demand enricher took Deezer's FIRST search hit with no name check → grabbed a same-named/tribute act's photo+tracks; (2) the 10k seeder's rank phase only wrote popularity+photo, never `topTracks`, so most crawled artists showed a BLANK "top song" on Discover. Fix = one shared **`deezerEnrich(name)`** (`server/catalogSeed.js`, exact-name-preferred match → photo, popularity, followers, topTracks, and a genre from the top album) used by BOTH the on-demand path (`enrichArtistFromDeezer`) and the seeder (`enrichThin`). New **`enrichSongs` backfill** + a **"refresh" job mode**: fills the top song + genre for already-ranked artists that lack one, most-popular first, resumable — run it from the admin **Catalog tab → "Refresh songs & genres"** button (`POST /api/admin/catalog/seed {mode:"refresh"}`). Genre is only FILLED when an artist has none (existing subgenres aren't flattened); Deezer's compound labels (Rap/Hip Hop, Soul & Funk…) added to the Discover canonicalizer. Verified live: Eminem now resolves to Hip-Hop (was "Hardcore") with real top songs + photo. **TODO for the owner:** run "Refresh songs & genres" once in prod to backfill the existing roster's top songs.

**SITE-WIDE CALENDAR + SERVER CLOCK (2026-07-12).** New **`CalendarScreen.jsx`** (reached from the **You tab → Calendar**): a real month grid of every upcoming show + the ones you're going to (flagged), tap a day to list its shows, tap a show to open it (artist/tickets shortcuts). "Today" comes from the new **`GET /api/time`** (epoch ms + ISO + IANA tz + offset) via store `serverTime()`, so it never trusts the device clock. Admin scheduling UI on top of the clock is still open.

**FORGOT / RESET PASSWORD (2026-07-12) — self-serve, token + email.** `POST /api/forgot` emails a 1-hour reset link (always returns a generic `{ok:true}` so it never leaks which emails have accounts); `POST /api/reset` swaps the password, invalidates the token + **all other sessions**, and signs in on this device. Only `sha256(token)` is stored (`users.reset_hash`/`reset_expires`); single-use + expiring. Email goes through a dependency-free **Resend** HTTP helper (`server/mailer.js`). **CONFIG NEEDED to actually send:** set `RESEND_API_KEY` + `MAIL_FROM` (e.g. `Pit <noreply@mshpit.com>`) on the **Render web service** — until then the flow still works and the reset link is **logged server-side** (`[reset] … link for <email>: <url>`) so the owner can complete a reset. Client: **"Forgot password?"** on the login screen → request view (`AuthScreen.jsx`); an emailed `?reset=TOKEN` link opens `ResetPasswordScreen.jsx` as a full-screen modal (App `resetToken` state, read from the URL on load, URL cleaned on done). Verified end-to-end via curl (forgot → reset → login with new pw; reuse/expiry rejected) + both screens render live.

**10K DB SEED (2026-07-11) — `scripts/seed-db-artists.mjs`.** DB-backed roster seeder toward ~10k artists across ~76 genres, keyless (MusicBrainz tag crawl → `artists` table; Deezer fills fan-count popularity + photo + the rank_score that orders search). Roster-only by design: songs/albums are NOT pre-baked because every artist already loads its full Deezer discography (with 30s previews) on demand, so all 10k are playable without a song scrape. Idempotent + resumable (WAL-safe to run while the web service is live; `--enrich-only` re-ranks thin rows). Verified locally: +150 artists crawled and 150/154 Deezer-ranked (names/genre/popularity/photos all correct) in 63s. **Two ways to run it. (a) Admin console (easiest):** Moderation → **Catalog** tab → **GROW CATALOG** → pick +2k/+5k/+10k → "Grow by N" (additive delta: adds that many NEW artists on top of whatever's there, never a no-op). It runs as an **in-process background job** (`server/catalogSeed.js`, `POST/GET /api/admin/catalog/seed`) with a live progress bar; safe to close the tab. No Render shell, no deploy. (b) **Render one-off Shell:** `PIT_DATA_DIR=/data node scripts/seed-db-artists.mjs --add 10000` (same shared code; `--add` grows BY N). Both ~30-45 min. A running job has a **Stop** button (or `DELETE /api/admin/catalog/seed`) that halts cleanly and keeps everything already added. **No double work across runs:** the crawl skips any artist already in the DB, a persisted per-genre cursor (`seed_cursor` table) skips genres it already finished and resumes partial ones at their saved offset (so re-runs don't re-fetch MusicBrainz pages), and the Deezer ranking phase only touches artists still missing popularity. Songs aren't seeded at all (on-demand + 24h-cached), so pages never get re-scraped. So "run again to resume" is cheap and safe. Flags: `--add N` (grow by N), `--per-tag N` (crawl depth/genre, default 600), `--no-enrich` (fast crawl only), `--enrich-only` (skip crawl, rank existing thin rows). This does NOT touch the bundle, so nothing to push for the data itself.

**DISCOVER OVERHAUL (2026-07-11) — DB-backed, was bundle-backed.** Discover computed charts/genres client-side from the frozen bundled catalog (~1.6k), so it looked thin and never reflected DB growth. Now server-driven off the live DB: `GET /api/discover/chart?by=popularity|plays[&genre&country&limit]`, `/api/discover/genres`, `/api/discover/countries` (api.js). **Genre canonicalization** (`canonGenre` + `rawGenresFor` in api.js, 5-min cache) collapses case/format variants + a few synonyms (Hip-Hop/hip hop/rap) into one label but keeps real subgenres distinct; the pie + filters use it. DiscoverScreen: **Popularity vs "On Pit"(plays) chart toggle**, a plain-language note on what the 0-100 popularity score means, each chart row shows the artist's **top song + play button** + a "Check out #1" CTA, and the genre donut is **interactive** (tap a slice or legend row → it pops out and loads that genre's real top artists + playable songs below; region-scoped). Data-quality caveat: a few artists carry a wrong/odd raw genre from the bundle (e.g. Eminem tagged "Hardcore") and many crawled-then-Deezer-ranked artists have no `topTracks` yet (seeder's enrich only sets popularity+photo), so their "top song" is blank; a future seed pass could fetch Deezer top tracks. Endpoints curl-verified; **in-browser visual pass still pending** (preview classifier outage during the session).

**COHESIVITY PASS (2026-07-11) — bugs the owner flagged.** (1) **Live chat everywhere:** fan clubs, DMs, AND the concert lounge now poll (3.5s) and merge by id, so messages appear without a refresh. The lounge got server-backed for the first time (`lounge_messages` table + `/api/lounges/:key/messages`, keyed by concertKey) — it was device-local before. (2) **Comments + post detail:** new `PostScreen` shows a post with a live, threaded, forum-style comment section (reply-to-poster vs reply-to-comment); `comments.parent_id` added; the feed's comment button opens the POST (not the performance). (3) **Notifications route right:** likes/comments open the post; the avatar opens the actor. (4) **Block:** `/api/people` now filters blocked-either-way (search no longer shows blocked users) + client filter for instant effect. (5) **Player:** volume control (SDK + preview, persisted `pit.volume`); the queue panel opens on tap only (no more accidental hover popup); position throttled + the welcome effect de-`nav`-ed to cut lag. (6) **Badges:** hover tooltips + `BadgeLegendScreen` (points/tier/progress), 10 activity-derived achievements (`lib/badges.js`, `activityStats`/`userPoints`/`userAchievements`), and an admin-granted **sponsor** badge (`users.sponsor` + admin toggle). (7) **Spotify:** a failed connect now explains the dev-mode allow-list (owner must add the tester's email in the Spotify dashboard → User Management; full songs need Premium). STILL OPEN from this batch: typing indicators, moving the player to a left sidebar, the Discover genre "weird profiles / wrong songs" refinement, a site-wide calendar + internal clock, and per-theme art + 4 new themes.

**SOCIAL ONBOARDING (2026-07-11) — `WelcomeScreen.jsx`.** First-run modal shown once after signup (armed by an on-disk `pit.welcomePending` flag set in App's auth `onDone`, so it survives the taste-picker's theme reload; consumed by a `session`+`nav` effect once the picker closes) and on login for anyone still friendless / not Spotify-connected. Prompts **Spotify Connect** (full playback) and gives friendless newcomers somewhere to go: one-tap **Join** for fan clubs of their picked artists (or top artists) + **pre-show/afterparty of nearby gigs** (`recommendedShows`). Dismissible. Rendered as a `zIndex:200` fixed modal in `App.js` (`welcome` state). Verified live. Gotcha fixed in the same commit: a stylesheet referenced the component-scoped `web` const, use `Platform.OS==="web"` at module scope.

**LANDING COUNTER (2026-07-11).** Landing stats now read the LIVE DB (`/api/artists` total + `/api/people` members), not the frozen bundle snapshot, so catalog/member growth actually shows (data was always persisting; the counter was stale).

**PLAYER PASS (2026-07-11) — album order, resume, top song.** On top of the rework below: album tracks play IN ORDER from the tapped song (album header has Play + Shuffle; genre recs append so shuffle follows the album); highest fan-rated track per album gets a star; a **Top Song** bar sits on the artist profile; popular-song rows are tap-anywhere-to-play; playback **position persists across reloads** (theme change / F5 resume instead of restart); the **can't-leave-Forest** theme bug is fixed (a device's local `pit_theme` now wins over `/api/me` and heals the account up); a flashing "up next" shows on the bar; queue rows got a11y labels.

**PLAYER REWORK (2026-07-11) — one unified in-app player, no embed box.** The old `PlayerBar` handed Spotify a whole filtered `uris` array + offset; when the tapped track had no Spotify URL (Deezer-only album tracks) it got filtered out and Spotify played whatever sat at that offset — that's why "clicking Beyoncé played Drake." **Fixed:** the bar now plays **ONE track at a time driven by our own queue index**, so the tapped song is always the song that plays. The embedded Spotify `<iframe>` is **gone** from the bar (and the artist page's "LISTEN" artist-embed was removed too — the owner found the Spotify window confusing next to Deezer songs). Two engines only: (1) **Spotify Web Playback SDK** streams the FULL track for Premium-connected users — each track (incl. Deezer-only) is resolved to a Spotify URI via `/api/spotify/track`; (2) otherwise a **Deezer 30s preview mp3** plays through an HTML5 `<audio>` element (`src/lib/audioPreview.js`), so **every song is playable for everyone with no Spotify account**. New keyless `GET /api/deezer/track` + store `resolveDeezerPreview` resolve a preview for any title/artist (so tracks with no bundled preview still play). There's a real **scrubber** (`Scrubber` in `PlayerBar.jsx`): tap/drag to seek, elapsed left, **time remaining** right, works for both engines (SDK via `seek()` + position polling in `spotifyPlayer.js`; preview via the audio element). Auto-advances at track end in both modes. Verified live: tapping different Beyoncé album tracks each played the correct song with a working scrubber; queue auto-advanced Shape of You → Perfect. **Connection reliability:** SDK ready-timeout raised to 12s and no longer latches out on a slow start; if the SDK errors (or isn't Premium) playback falls back to preview instead of going silent. **Still true:** Spotify Connect needs `SPOTIFY_CLIENT_ID/SECRET` on the Render web service to work at all (see below) — without them every listener is on preview-only, which is now a fine default rather than a broken embed. Also fixed a pre-existing `LandingScreen` setState-in-render warning (Animated side effects moved out of the `setIdx` updater into an `idx` effect). Profile blank-screen on opening an uncached user (e.g. a follower from a notification) fixed earlier in the same batch: `ProfileScreen` now `loadUser`s from `GET /api/users/:id` and shows loading / "not available" instead of a blank screen.

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

## This session (2026-07-10, latest) — social graph: notification blank fixed, follow lists, blocks, data export
Owner: "fix the notifications" (tapping a follow notification blanked the screen), "a real follow list people can click", "truly block and unblock", "back up individual profiles". All built, verified end-to-end (18/18 API checks + full UI walkthrough), committed + pushed.
- **Notification blank = unknown-profile blank, FIXED.** `ProfileScreen` did `if (!user) return null` — any profile not in the local cache (a stranger who followed you) rendered NOTHING. Now every profile view calls new store `loadUser(id)` (`GET /api/users/:id`, absorbs the user + real follower counts), with a Loading state and a proper "This account isn't available" screen for deleted accounts. Same fix applied to `ThreadScreen` (DM notification from an uncached user) and `openProfileByHandle` (@mention taps now search the server instead of silently doing nothing). `absorbUsers` also now MERGES fresh data over stale cached entries.
- **Real follow lists.** `GET /api/users/:id/followers` + `/following` (public, 500 cap); store `followersOf`/`followingOf`; new `FollowListScreen` (tap row -> profile, inline Follow/Following buttons); the FOLLOWERS/FOLLOWING numbers on every profile are now tappable. Counts prefer server truth (`userStats` via loadUser) over the device-local follow map.
- **True block/unblock.** New `blocks` table. `POST /api/users/:id/block` (toggle) severs the follow BOTH ways; DMs refused 403 in both directions; blocked users' posts filtered from `/api/feed`; their old+new notifications hidden; threads with them vanish from the inbox; can't re-follow while blocked (403). Client mirrors instantly (`blockedIds`, persisted + hydrated on login): block button (lock icon) on profiles, blocked-profile state with Unblock, and a **Settings -> PRIVACY & SAFETY -> Blocked accounts** manager. `addNotif` also refuses pings across any block.
- **Profile backup (historical note; expanded above).** `GET /api/me/export` returns a bounded portable JSON account export. Web downloads `pit-backup-<handle>-<date>.json`; native shares the same file. See the current batch for included categories, privacy exclusions, restricted-account access, and the remaining asynchronous-archive requirement.
- **Dev gotcha hit again:** Metro's file watcher MISSED an edit to store.js and served a stale split bundle (`blockedIds is not defined` at runtime while the file was correct). `touch src/store.js` forces a re-transform. If the app crashes after edits Metro "didn't see", touch the file or restart expo.

## Earlier (2026-07-10) — preview playback engine + scrubber (play buttons FIXED)
Owner reported artist-page play buttons dead on every artist + wanted a traditional seek bar. Root cause found and fixed; all verified live in the browser.
- **Why play buttons were dead:** playback only knew Spotify (embed/SDK). Album tracks from the Deezer discography have **no Spotify URL**; `resolveSpotifyTrack` needs `SPOTIFY_CLIENT_ID/SECRET` on the server (absent locally + on Render) so it returned null and the tap did nothing. Meanwhile Deezer was already handing us a **30s `preview` mp3 + `duration` for every track** and we threw them away.
- **New preview engine:** `src/lib/audioPreview.js` (`useAudioPreview`) plays those mp3s via an HTML5 `Audio` element. No Spotify account, no Premium, works for everyone. `PlayerBar` priority: **Spotify SDK (Connected+Premium) → preview mp3 → embed**. Preview mode shows "· preview" by the artist and **auto-advances the queue at song end** (verified) — so continuous play now works without Premium.
- **Scrubber (the requested slider):** elapsed / seekable progress bar / time-remaining row under the player bar, in both SDK mode (`player.seek()` + 500ms `getCurrentState` polling in `spotifyPlayer.js`) and preview mode (`audio.currentTime`). On web it binds real DOM mousedown/drag on the track node (RN-web responder events were unverifiable); native keeps the responder API. Click/drag-to-seek verified (elapsed jumped 0:09 → 0:01 on a 3% seek).
- **Wrong-song bug:** playing an album track handed the top-tracks queue to `openPlayer`, which couldn't find it (`findIndex` -1 → index 0) and silently played the queue's first song instead. Now the tapped track is prepended if absent. `preview` is carried through everything: song rows, queue, recs, playlists (server `POST/PATCH /api/playlists` store it), play history, profile playlist playback.
- **Feed crash fix (pre-existing):** server posts with null scores crashed `TicketStub` (`null.toFixed`) and blanked the whole feed behind the ErrorBoundary. Now null-guarded.
- **Local dev note:** artist discography/play buttons need BOTH servers (`npm run server` for :3000). Without the backend the DISCOGRAPHY section (and its tracks) never renders.

## Earlier (2026-07-10) — player autoplay algorithm + build-a-playlist
Fixes for the owner's report that the artist-page player / Listen button / top media bar / playlists were broken. All committed + pushed.
- **Autoplay "up next" now has a real algorithm.** New store engine (`src/store.js`): `favoriteGenre()` (your most-played genre from `playHistory`, falling back to your picked `genres`), `recommendTracks(seed, n)` (same-genre-first, then the rest of the catalog ranked by popularity, max 2 tracks/artist, skips the seed + recently played, works even when Spotify popularity is missing), and `autoplayQueue(seed, base)` (appends a recommended tail so the queue never dead-ends). `App.js` `openPlayer` now runs every play through `autoplayQueue`, so **one tap fills the queue** (verified live: playing one Turnstile track queued 35 recs). This is the "push the next song based on favourite genre / what they listen to" ask.
- **Listen button = play a random song from the artist's catalog** (was: just mounted the artist embed, or bounced to a YouTube search). `ArtistScreen.playRandom()` shuffles the page's playable tracks, plays one, queues the rest (then recs continue). Album/top-track play buttons now prefer a URL already on the page before hitting `resolveSpotifyTrack` (more reliable given Spotify's restricted mode), and feed the song queue.
- **Build playlists one song at a time** (was: could only Save-as-playlist a whole session). New `POST`-friendly `PATCH /api/playlists/:id` (add tracks / rename, dedupes) + store `createPlaylist` / `addToPlaylist` / `myPlaylists` / `loadMyPlaylists`. New `PlaylistPickerScreen.jsx` overlay (pick an existing playlist or name a new one) wired app-wide via `openAddToPlaylist` (auth-gated). **"+" add-to-playlist button** on every ArtistScreen song row (popular songs + album tracklists) and in the player's session panel (per up-next row + "Add song" for the current track). The old "Save as playlist" is relabeled **"Save session"** (snapshots the whole queue — still there, it's the other use).
- **Known limit (not a bug):** in **embed mode** (not Spotify-Connected / no Premium) each track is a separate iframe that browsers won't autoplay-chain, so the queue advances on **next / tapping a row**, not automatically at song-end. Full hands-off auto-advance only happens in **SDK mode** (Connected + Premium), where Spotify plays the whole `uris` list. The up-next queue + recommendations are populated in both modes.

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

## Big feature requests (2026-07-10, owner) - DONE marked; rest ordered by value
**Reviews / logging**
- DONE: review binds to a real ARTIST (Log autocomplete) + tour/occasion presets.
- DONE: **Review drafts** (Save as draft + Resume strip in Log; store.drafts).
- DONE: **Terms section "User inputs & accuracy"** (covers AKA/former venue names, attribution).
- STILL OPEN: **Venue AKA** *function* (relabel a venue renamed/defunct/new-owner, with a post-time confirmation, still attaching to the same venue). Terms cover it legally; the UI + venue-alias data model is not built.
- STILL OPEN: **Attach standout songs** to a review, tied to the real artist + song (listenable on the artist page), with a disclaimer if the artist has no songs on file.

**Player / listening**
- DONE: **up-next queue** panel (hover/tap), reorder (bump/remove), **play history**, **save session as playlist**, and all now **server-side** (plays table, /api/plays, /api/plays/friends) so it's cross-device.
- DONE: **Friends listening** rail on Discover.

**Discover / algorithm**
- DONE: **top artists + top songs per genre AND region** (EXPLORE BY GENRE panel, playable songs).
- PARTIAL (2026-07-10): **listening history drives the algorithm** — the *player autoplay* now uses `favoriteGenre()` (from `playHistory`) + `recommendTracks()` to fill up-next (see this-session notes). STILL OPEN: pushing this same taste signal into **Discover** (personalized genre/artist shelves) and the server `plays` table (currently favorite-genre is computed client-side from local `playHistory`).
- STILL OPEN: **Monthly "your month in review"** snapshot, viewable + postable (build from the plays table).

**Artist coverage**
- DONE: capture searched-but-not-found + thin profiles, **admin Catalog tab** seeds them from Deezer on demand, **"coming soon"** profiles, **purge**. (A scheduled 4x/day auto-seed could layer on `server/tourdates.js`-style in-process timer later.)

**Integrations (STILL OPEN)**
- **YouTube** official-video embeds as a fallback; **connect YouTube Premium + Apple Music** like Spotify for playback fallbacks.

**Playlists**
- DONE (core): create via Save-as-playlist (whole session) AND **build one song at a time** (2026-07-10: `PlaylistPickerScreen` + "+" on song rows / player panel, `PATCH /api/playlists/:id` to append). Persisted (playlists table), shown on the profile, plays the whole set. STILL OPEN: explicit share links + collaborative/curated playlist building; editing an existing playlist (reorder / remove tracks) beyond add.

**Player bugs handled 2026-07-10:** switching artists stopped playback (added 404-retry + clear 403/Premium reporting); Premium-not-active now shows a "Premium needed" note and falls back to the embed; theme switch reloads the page (mitigated by persisting the player queue, but **fully seamless theming needs a runtime-CSS-variable refactor of theme.js**, still open); choppy fonts fixed (antialiasing on every node).

## Older secondary backlog (does not override the owner-priority list above)

The current media/YouTube attachment, mobile polish, Near You, notification, and
scale work is consolidated in the authoritative backlog near the top. Remaining
older requests that are not duplicates of that list:

1. **🛡️ Moderation user-tracking.** Extend the Members tab with users per region
   and a live total count; add granular fan-club/afterparty mute/remove controls,
   not only global ban/timeout.
2. **🔔 Show-near-you push.** Notify when a followed/loved artist announces a gig
   near the member's saved location. The Ticketmaster source is now configured
   and live; this still needs durable notification dedupe, distance preferences,
   opt-in controls, and scheduler coverage.
3. **Sponsored feed slot.** Interest signals exist, but a clearly labelled,
   frequency-capped, privacy-reviewed Sponsored card is not built.
4. **Roster growth.** Prefer the DB-backed seeder over expanding the bundled
   catalogue; current crawl depth/source coverage still limits genuinely new acts.

## Known gotchas
- **Spotify is fully removed (2026-07-12).** Playback is YouTube (see the top note); artist ranking is **Deezer** (fan count → popularity). Ignore any older note below about Spotify Connect / dev-mode / `SPOTIFY_CLIENT_ID` — those env vars and OAuth routes no longer exist. The local `.env` Spotify keys are dead; only `YOUTUBE_API_KEY` (server) matters for playback now. The founder still wants a **Billboard Hot 100** source for the Top-3 pedestal + Top-100 badge (backlog).
- **Hard-refresh** after deploys (bundle cache). Brief **502 right after a push** = normal restart.
- **CSP** blocks new external embeds/scripts on prod (fine in dev) — update `server/index.js` `frame-src`/`script-src`/`connect-src`.
- **Render disks are single-service** — background scrapers must run in the web process (that's why tour dates moved in-process).
- Git shows harmless `LF will be replaced by CRLF` on Windows — ignore.
- `node:sqlite` needs Node ≥ 24. Background processes started in a chat die when the session ends — restart `npm run server` / `npm run pipeline`.
- Don't bulk-edit `.jsx` with PowerShell Get/Set-Content (mangles UTF-8) — use editor tools.

---

## Action log — 2026-07-22 (Claude, session 2)

Standing instruction from the owner this session: **log every batch here and in
`TODO.md` as work happens**, because multiple agents (ChatGPT/Codex included)
work this repo and a previous session's chat was lost outright. In-repo docs are
the only reliable handoff. Never renumber `TODO.md` items: the numbers are the
owner's shared reference across sessions.

### Landed and verified

**Performance dates are canonical ISO** (`src/domain/dates.mjs`). Storage is
`YYYY-MM-DD`, display formatting happens at render. Prior to this the stored
date *was* the display string, so a separator change forked one night into two
performances; a row reached the DB as `2026 <U+FFFD> 06 <U+FFFD> 21` and split
The Fillmore in two. The boot migration in `server/db.js`
(`dates:canonical-iso:v1`) rewrites `posts`, `tour_dates`, `going.concert_key`
and `lounge_messages.lounge_id` in one transaction, merging what the fork split.
Verified on the real DB: 797 tour dates converted, the forked Fillmore rows now
resolve to one performance key.

**Countdowns no longer re-render whole screens** (`src/components/Countdown.jsx`).
The You and profile screens each held a `nowTick` state on a 1s interval to
render one label, re-rendering playlists, going-to, the tools grid and the diary
every second. Verified: countdown still ticks with **1 text node changing and 0
structural mutations** over 3.2s.

**Theme palette is four accents, one shared swatch** (`src/components/ThemeSwatch.jsx`).
The chip was implemented three times (menu, edit profile, onboarding) and had
drifted in every dimension: 96/104/flex widths, 12 or 14pt dots, 4 or 5pt gaps,
`sm` vs `md` corners, and one variant changed border width when selected so
picking a theme resized the chip. Appearance moved out from above the Log out
button into its own section under Edit profile. Verified: 12 chips at a single
104pt width, 4 dots each, Appearance between Edit profile and Log out.

**Tools grid no longer ragged** (`YouScreen`). `flexGrow: 1` made leftover tiles
stretch to fill the last row. Verified: all tiles a single 274pt width.

**Recently-played de-duplicated for display** (`uniqueTracks` in
`src/domain/recommend.mjs`). Play history intentionally records every play (the
You screen counts them), so the fix is at render only.

**Autoplay selection extracted** to `src/domain/recommend.mjs` and **genre
authority** added in `src/domain/genre.mjs`, so a MusicBrainz crawl bucket is no
longer published as an artist's genre.

### Landed, NOT visually verified

**Donut overlap** (item 23) in `DiscoverScreen` and `YouScreen`. Root cause is
real and specific: the legend used `flex: 1`, which means `flex-basis: 0`, so
under `flexWrap` it never reached a wrap threshold and instead shrank past its
`minWidth`, pushing the fixed-size donut SVG outside the card. Changed to
`flexGrow: 1, flexBasis: <minWidth>` plus a non-shrinking donut slot. The fix is
sound in code and all checks pass, but the running app kept restoring to the
menu screen and **the chart was never put on screen to confirm it**. Next agent:
open Discover at a narrow width and confirm the legend wraps below the donut
instead of colliding.

### Not done, and why

- **Store context re-render storm.** `src/store.js` has 33 `useState` and builds
  a fresh ~150-key context value every render, consumed by **44 components**, so
  any state change re-renders all of them. This is the largest remaining cause
  of mobile lag. It needs a split into a stable actions context and a data
  context, which is too large to start at the end of a session.
- **Items 21 and 24** are blocked on owner decisions, not effort. See `TODO.md`.

### Follow-up batch, same day

**Discover's genre count (item 19).** The "8 GENRES" tile was rendering the
length of the chart's own slice array. `/api/discover/genres` caps the donut at
8 slices plus "Other" for readability, and the tile treated that as the
catalogue's genre count. The catalogue holds **68 distinct genres** across 2,658
artists. The endpoint now returns `distinctGenres` alongside `total`, and
Discover keeps the two in separate state: `genreTotal` (artists in region, feeds
the donut's centre number) and `genreKinds` (distinct genres, feeds the tile).
Nearly shipped a bug here by reusing `genreTotal` for both, which would have
corrupted the donut's centre count.

Note for whoever continues: 68 is honest but the *labels* are still mostly
MusicBrainz crawl buckets (item 2). The server-side authority already refuses to
state them as fact, and `catalogSeed.js` writes provenance via `genreFields`, so
running enrichment replaces buckets with provider evidence over time. The client
still counts raw `catalogArtists` genres in `topGenres`, which is the remaining
inconsistency.

**Donut overlap now verified** (closing the gap flagged above). Measured on
Discover at two widths: at 760px the donut ends at x=221 and the legend starts
at x=677, side by side with no overlap; at 375px the donut stays inside its card
(right edge 274 vs card 288) and the legend wraps *below* it (top 2243 vs donut
bottom 2201). No card or viewport overflow at either size. Item 23 is closed.

Getting Discover on screen needs the persisted nav cleared first: the app
restores `pit.tab` / `pit.stack` from localStorage, which is why earlier
attempts kept landing on the menu. Clear those two keys, reload, then click the
Discover tab.

### Item 20 (preview-only playback) — diagnosed

Chased the K-Ci & JoJo report. The local `yt_cache` table is **empty (0 rows)**,
and `/api/health` reports `youtubeConfigured: false` locally, so nothing here
ever resolved a video. More importantly, the health payload shows the real
constraint: `search: { used: 0, limit: 90, remaining: 90 }`.

**90 searches per day, site-wide.** YouTube search costs 100 quota units against
a default 10,000/day allowance. Once that budget is gone, every unresolved song
degrades to a 30-second preview, and that is indistinguishable from "no video
exists" — which is why an obvious, popular song looks like a matching failure. A
missing API key gives the identical symptom.

All of this was already computed by `youtubeProviderStatus()` and returned on
`/api/health`, and **no screen consumed it**. Admin > Overview now shows a
PLAYBACK LOOKUP panel covering the three states: no key, circuit paused, and
budget spent, with searches used/remaining. Note the payload field names are
`limit`/`remaining`, not `budget` — got that wrong on the first pass and caught
it against the live endpoint.

Not fixed: the capacity problem itself. That is item 1's work, and it should be
done before anyone concludes the matcher is picking wrong videos.

### YouTube quota capacity (owner question, 2026-07-22)

Owner confirmed `YOUTUBE_API_KEY` **is** set on Render, and asked what happens at
hundreds of users. Recording the analysis so nobody re-derives it.

**Quota does not scale with users.** The 10,000 units/day allowance is per Google
Cloud project. A second play of a song is a cache hit, so 500 listeners cost what
1 listener costs. What spends quota is *distinct artists never resolved before*,
so the bill tracks catalogue coverage, not traffic.

Costs: `search.list` 100 units; `playlistItems.list`, `channels.list` and
`videos.list` 1 unit each. `getArtistCatalogue` already takes the cheap path,
pulling a whole discography through the uploads playlist for ~13 units and
caching it, which is roughly **760 new artists per day** inside the default
quota. Search is only the fallback for artists with no resolvable channel, and
the 90/day cap exists to stop that path draining everything.

Changed here: match TTL 14 days → 90 (`YOUTUBE_MATCH_TTL_DAYS`), miss TTL 6h → 3
days (`YOUTUBE_MISS_TTL_DAYS`), and the search budget is no longer hard-capped at
100 (`YOUTUBE_SEARCH_DAILY_BUDGET`). The old 14-day match TTL re-resolved the
entire catalogue twice a month for no benefit, since a cached row is already
revalidated with `videos.list` (1 unit) before it is trusted and bad IDs are
remembered. The 6-hour miss TTL retried each unmatched song four times a day,
and a miss is usually structural rather than transient.

Still to do, in order: (1) warm the cache with a background job over the top
artists before traffic arrives, roughly 2,657 artists x ~13 units, a few days of
quota spent once; (2) request a quota increase from Google via the YouTube API
Services audit form, which is free but takes weeks, so start before it is needed;
(3) watch Admin > Overview > PLAYBACK LOOKUP for budget-spent days.

### Menu appearance regression, and why "it isn't live" (2026-07-23)

Owner reported the spacing and You-tab fixes were not live after multiple
refreshes. Checked production rather than assuming: the deploy **had** landed.
The live bundle
(`index-a6e2ffb59853b26efeabdcdd5e583499.js`) contains the ThemeSwatch, the
`uniqueTracks` de-duplication and the admin PLAYBACK LOOKUP panel, and cache
headers are correct (`index.html` is `no-cache`, the content-hashed bundle is
`immutable`). So this was not a caching or deploy problem.

It was a real regression I introduced in a233180. Moving APPEARANCE "under Edit
profile" put the swatch grid *between* the account rows, so Moderation, Post
tour dates and Claim an artist rendered **below** the theme grid, splitting the
Account section in half. It also moved the picker inside the `{session && ...}`
block, so **logged-out visitors lost theming entirely**, which used to work.

Fixed by giving the setting one home. Edit profile already had a dedicated
APPEARANCE section, so the menu now links to it ("Appearance & profile") instead
of carrying a second copy, and the account rows stay together. Guests, who have
no Edit profile to open, keep the picker in the menu.

Lesson for the log: every fix so far was verified against localhost only.
Verifying against production is a separate step, and "is the deploy live" is
answered by fetching the deployed bundle and grepping it for a marker string
from the change, not by reasoning about cache headers.
