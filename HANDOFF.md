# PIT / mshpit.com — Handoff

> **Living doc.** Whoever works on this next: read this first, and UPDATE it before you end a session (move things between "Done" and "Backlog", note anything running). Point a fresh Claude Code chat at this file to get up to speed without re-explaining.
>
> Last updated: **2026-07-17** (clips mode + deeper artist charts, live on prod)

> **Working agreement (owner's standing instruction):** ALWAYS `git commit` **and** `git push` after a verified batch. Stabilization work uses a review branch; do not merge/push directly to `master` until the branch checks pass. A master push auto-deploys and briefly restarts Render.

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

## Open backlog (what to do next)
**User-requested, not yet done:**
1. **📱 Mobile polish.** User says mobile "feels like old-gen Pit, not easily accessible." Needs iterative visual work — get a phone screenshot of the feed (or resize narrow) and fix header density / touch targets / spacing on real pixels. Browser tools (claude-in-chrome / preview) have been **flaky all session** — a full screen-by-screen visual audit is still open; do it with a working preview.
2. **🛡️ Moderation user-tracking.** Extend the Members tab: **users per region + a live total count**; **granular Discord-style mutes** — remove/mute a user within a specific **fan club** or **afterparty** (not just global ban/timeout). Self-contained; buildable without a browser.
3. **🎬 Video embeds (in-app).** CSP is ready for YouTube. Two paths: (a) scrape a top **YouTube video ID** per artist (needs a free YouTube Data API key) → embed a WATCH section; (b) let users attach **video clips** to posts and play inline. Music (Spotify) is done; video is the remaining "keep them in-app" piece.
4. **🔔 Show-near-you push.** Notify when a followed/loved artist announces a gig near the user's city. Depends on a **working tour-date source** (see below). This answers "what to push besides DMs."
5. **Tour dates need a valid key.** Set `TICKETMASTER_KEY` on the Render **web service** (the current key is invalid — likely still activating; re-test per Secrets). Or add **SeatGeek** as a source (free instant key; ~10-min wire-up next to the TM/Bandsintown fetchers in `server/tourdates.js`).
6. **Sponsored feed slot.** The analytics collect ad-interest signals (top genres/artists/searches); the actual targeted "Sponsored" feed card keyed to a user's taste is **not built**.
7. **Roster growth**: the DB path now exists — `scripts/seed-db-artists.mjs` seeds ~10k artists straight into the DB (see the 10K DB SEED note up top; run it in a Render one-off shell against `/data`). The old bundled-catalog path (`npm run pipeline` locally → push) still works for small curated additions but bloats the web bundle; prefer the DB seeder for scale.

## Known gotchas
- **Spotify is fully removed (2026-07-12).** Playback is YouTube (see the top note); artist ranking is **Deezer** (fan count → popularity). Ignore any older note below about Spotify Connect / dev-mode / `SPOTIFY_CLIENT_ID` — those env vars and OAuth routes no longer exist. The local `.env` Spotify keys are dead; only `YOUTUBE_API_KEY` (server) matters for playback now. The founder still wants a **Billboard Hot 100** source for the Top-3 pedestal + Top-100 badge (backlog).
- **Hard-refresh** after deploys (bundle cache). Brief **502 right after a push** = normal restart.
- **CSP** blocks new external embeds/scripts on prod (fine in dev) — update `server/index.js` `frame-src`/`script-src`/`connect-src`.
- **Render disks are single-service** — background scrapers must run in the web process (that's why tour dates moved in-process).
- Git shows harmless `LF will be replaced by CRLF` on Windows — ignore.
- `node:sqlite` needs Node ≥ 24. Background processes started in a chat die when the session ends — restart `npm run server` / `npm run pipeline`.
- Don't bulk-edit `.jsx` with PowerShell Get/Set-Content (mangles UTF-8) — use editor tools.
