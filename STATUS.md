# Pit current status

Last production reconciliation: **2026-08-13**. Local working-tree review:
**2026-09-02**. This is the source of truth for current code, release, and
production state. See `AUDIT_AND_REMEDIATION_2026-08-13.md` for the deployed
remediation evidence and `TODO.md` for the longer backlog. `HANDOFF.md` and the
August 4/5 audit/session log are historical journals, not current status.

## 2026-09-26 independent application/database integrity review

Reviewed completed production work at `7a3b7d2`; unfinished `pit-newsdesk`
changes remain untouched. See `APPLICATION_INTEGRITY_AUDIT_2026-09-26.md` for
reproductions, test evidence, release requirements and residual risks.

Hardened artist-authority revocation, durable video account/budget checks,
stale-editor media preservation, bounded decoder geometry, news visibility and
pagination, draft-safe optional page preloads, video-gallery consent and paid
research accounting. Research receipts have 35-day retention; Crew remains off.
Local read-only database audit now has 44 checks, all passing. Production backup
reported structural integrity OK, but a full live relational audit and off-host
restore proof remain outstanding. Owner requested a new private R2 backup bucket;
creation is blocked by unavailable Cloudflare access, not marked complete.

## 2026-09-26 Search Console: image metadata and indexing

Search Console reported "Missing field copyrightNotice" on 10 image items (5
venue pages, the venue photo appears twice per page) and a page indexing
summary: 50,556 discovered not indexed, 1,183 crawled not indexed, 836
noindex, 366 duplicate canonical, 266 not found, 173 redirects, 9 server
errors.

- Image metadata: venue photo ImageObjects now carry `copyrightNotice`
  ("© photographer"; every catalogued venue photo is CC BY or CC BY-SA, so
  the photographer keeps the copyright). Fan photos on posts and the fan
  photo that represents an artist page carry "© member" and a credit line,
  since the Terms say members keep ownership. After deploy, press Validate
  fix in Search Console.
- Sitemap audit on production: 613 sampled URLs across all eight sitemaps
  returned 200 with a matching canonical. The one exception was `/news`,
  listed while it is still noindex (under 3 items); it now joins the sitemap
  only when the page is indexable, using the same read as the page.
- Findings, no change needed: missing pages return a real 404 with noindex
  (not a soft 404), most likely events Ticketmaster removed or relisted under
  new ids. The noindex bucket is mostly deliberate (directory pages 2 and up,
  app-only routes). Redirects include `/news`, which redirected until
  2026-09-25. "Discovered, not indexed" is about the size of the events
  sitemap (47,703 URLs); that is crawl budget on a young site and improves
  with page quality and internal links (the 2026-09-25 related-shows pass).
- From the owner's Search Console exports (404, 5xx, redirect, duplicate):
  - 202 of 266 not-found URLs were `/venue/<name>` addresses. The name
    resolver treated older Ticketmaster rows (no venue id or city, only
    "New York, New York, United States Of America") as a second venue and
    returned 404, even for Madison Square Garden. It now compares the city
    part of a place, and several Ticketmaster records for one name in one
    city count as one building (the record with the most shows is used).
    Names in different cities still stay unresolved. On a local catalogue
    copy this turned 68 of the 202 into redirects to the venue page (was 16).
  - `/venues/ca/montreal` and `/venues/mx/ciudad-de-mexico` returned 404
    because Ticketmaster spells the city with and without accents and the
    city lookup gave up on two spellings. Spellings that differ only by
    accents or capitals are now one city, in the pages and the sitemap.
  - City pages linked "Concerts in <city>" and "Venues in <city>" even when
    that page did not exist (Barcelona's venue page linked a 404). The link
    now appears only when the page exists.
  - 53 of 55 event 404s are events Ticketmaster removed or relisted; 404 is
    right. The 9 server errors all answer normally now; 8 were crawled on
    2026-09-20, which points at a restart or outage that day.
  - The 348 duplicate event pages are nightly runs and two shows on one day
    (ABBA Voyage at ABBA Arena, Putti Plutti Pott twice on Nov 28). Google
    keeping one page per run is expected.
- Background jobs: `ARTIST_NEWS_ENABLED`, `ARTIST_PHOTO_DEEZER_ENABLED` and
  `PROVIDER_PROFILES_ENABLED` had never been set on the live service (Render
  does not apply new `render.yaml` values), so the news feed, the Deezer photo
  filler and the Ticketmaster web profiles had not run. The owner added all
  three in the dashboard on 2026-09-26 (live 13:19 UTC). Within 25 minutes
  Discover's top 24 had photos for 23 artists (was 7) and `/news` had 8 new
  releases.
- Drake stayed without a Discover photo because the owner's admin account
  had claimed his page by mistake and uploaded an avatar; the photo filler
  never overrides an owner's picture. New admin action: Admin > Artist
  identity safety > find the page > "Return to catalogue page" (tap twice).
  It removes the owner, bio, feed switch and the photos that owner uploaded
  (art seeded by someone else stays) and is logged as
  `artist_return_to_catalogue`. `POST /api/admin/artists/:key/return-to-catalogue`.
- Checked on production after deploy: of the 202 reported `/venue/<name>`
  404s, 169 now redirect to the venue page and 2 load directly (31 remain);
  `/venues/ca/montreal` and `/venues/mx/ciudad-de-mexico` load.

## 2026-09-26 Owner-approved: page transitions and Discover Artists redesign

Both review branches were approved by the owner and merged.

- Page transitions (`design/page-transitions`): pages slide in 16px from the
  side you are heading (forward or back, 220ms) and tab switches fade up
  (180ms), as CSS keyframes that never leave a page invisible. The loading
  spinner waits 250ms so quick loads do not flash it, and the five most
  visited screens preload 4 seconds after start. Privacy, Terms and the
  artist picker now load lazily, which took the first load from 511.8 to
  about 500 KiB.
- Discover > Artists (`design/discover-artists`): the donut chart and text
  rows are gone. Artists are square photo cards (colour wash with initials
  when there is no photo) in 2 to 4 columns, genres are one scrollable row of
  chips, most popular first, and "Top rated live" only shows when there are
  qualifying ratings. Photos come from the Deezer filler.

## 2026-09-25 Discover slideshow uses artist photos when an event has none

After the picture-only change the slideshow was hidden on production: almost
no upcoming event has a fan photo or credited Ticketmaster artwork, and it only
looked at the four events shown in the list.

- It now picks from every event loaded for the chosen range and area, and an
  event with no picture of its own may use its performer's catalogue photo, the
  same one the artist page and Discover chart show, labelled "Artist photo ·
  Deezer". Only Deezer-hosted images qualify: Spotify artwork has to stay
  uncropped beside a Spotify link, and the slideshow crops to fill. Fan
  photos of the show come first, then event
  artwork, then the artist photo; one artist photo is not repeated for a
  second date. Up to 5 slides.
- `GET /api/tourdates` range responses (what Discover calls) add
  `artistPhoto: { uri, credit }` for rows bound to a public catalogue artist
  with a Deezer-credited, Deezer-hosted photo; removed profiles and unpublished
  member-created artists never lend one.
- Production check: the Spotify photo job is live (Drake, Coldplay, Ed
  Sheeran and Eminem have Spotify photos), so the Deezer filler had stood
  down and Discover still had almost no usable pictures. Spotify artwork is
  stored as `spotifyPhoto` and may only be shown uncropped beside a Spotify
  link, so it cannot fill Discover's cards or slideshow. The Deezer filler now
  runs alongside Spotify. For an artist whose page shows a Spotify photo it
  stores a Discover-only `data.discoverPhoto` (Deezer, credited) and leaves
  the artist page alone; otherwise the Deezer image becomes the artist's
  photo as before. An artist with a stored Deezer id is looked up by that id
  (the name must still match) instead of by name search.
- The filler also skipped every chart artist whose `photo` column still holds
  a legacy Spotify URL (Drake, Coldplay, Ed Sheeran and most of the top 24),
  because it only looked at empty photos. Those now count as having no
  croppable photo, get a `discoverPhoto`, and keep the Spotify URL. Run for
  real against Deezer on a local catalogue copy: all 24 current chart artists
  got the right picture (30 checked, 30 filled).
- Artist photos are square portraits, and cropping one into the wide desktop
  banner cut off faces. On desktop an artist-photo slide now shows the whole
  portrait beside the text over a blurred copy of itself; the phone banner is
  close to square and still crops.
- Discover chart rows now follow the same rule as artist pages: a
  Spotify-hosted image never goes in the generic `photo` field, so artist
  cards and lists cannot crop Spotify artwork.
- Checked with a local build on production data (photos from a local
  catalogue copy): 69 of the loaded events had an artist photo and the
  slideshow showed 5 picture slides on desktop and phone. Coverage grows as the
  Deezer photo filler works through Discover's artists.

## 2026-09-25 Discover event Back check (no app change)

- Report: a guest who opens /discover, taps the first event card and presses
  Back lands on Intro ("/"). Checked on production at 1280 and 390 wide: the
  event page's own Back arrow ("Leave ... event page") returns to /discover
  with Upcoming events showing. The only control that lands on "/" is the
  desktop "Back to intro" button, which does that on purpose (the deep-link
  cases cover it). The event page has no button named "Go back".
- New browser regression case `discover-event-back` (390 and 1280): guest opens
  /discover, opens the slideshow's event card, presses the page's Back arrow,
  lands on /discover with Discover visible, browser Forward/Back agree, and the
  same holds for the first event in the list. The fixture event carries
  credited artwork (served locally) because the slideshow now needs a picture.
  The case fails when in-app Back is forced to Intro.
- Checks: `npm run check`, `git diff --check`, and all 57 navigation browser
  cases pass. `server/catalogPhotoIntegrity.test.mjs` failed once in the full
  run ("trigger ... already exists") and passed alone and on rerun; noted in
  `TODO.md`.

## 2026-09-25 SEO pass: related shows, discography, Deezer artist photos

Production audit before this change: event pages had about 100 words and 4
internal links, and an artist page with no tour (Drake) had 62 words and 2
links. Canonicals, robots, sitemaps and JSON-LD were already fine.

- Event pages (crawlable HTML) now list the artist's other upcoming dates, the
  venue's other nights, and other concerts in the same city (same country
  code, next 90 days, one show per artist), each show once across the three
  lists, all through the same public event rules as the event pages
  themselves. The WebPage JSON-LD carries them as `relatedLink`. On a local
  catalogue copy a typical event page went to about 300 words and 25 links.
- Artist pages list albums, EPs and live albums from MusicBrainz release
  groups (newest first, up to 12, credited), only when the stored release list
  was fetched for the artist's own MBID. Groups also get them as `album` in
  structured data. Drake's page went from 62 to 139 words locally.
- Artist photos: the Spotify photo pipeline is off, so most Discover artists
  had no picture. A Deezer (keyless) filler now runs every 15 minutes
  (`ARTIST_PHOTO_DEEZER_ENABLED=true`; see the slideshow entry above for how
  it works beside the Spotify photo job): Discover's
  artists first, then artists playing in the next 30 days, then popular acts.
  It takes a photo only from an exact-name match with 1000+ fans that clearly
  dominates any namesakes (20x the runner-up), skips Deezer's blank
  placeholder, credits "Deezer", never replaces an existing photo, an owner's
  avatar or a hidden profile, and does not retry a miss for 14 days. Pausing
  catalog upkeep pauses it.

## 2026-09-25 Discover first impressions: slideshow and agent priority

- The Discover event slideshow only shows events that have a picture (fan
  photo or credited Ticketmaster artwork); with none it is hidden and the event
  list carries the section. The Pause button is gone at the owner's request:
  autoplay rests while the slideshow is hovered, focused or touched, stops once
  someone uses the arrows, and never runs with Reduce Motion. Each slide now
  stays up 9 seconds instead of 6.5.
- The Ticketmaster web profile worker fills Discover first: performers with a
  show in the next 30 days (Discover's default range), then popular acts, then
  everyone else; venues hosting shows in that window before venues with more
  shows later. Many Ticketmaster events still have no picture because the feed
  sends images without credit details, which we deliberately do not publish.

## 2026-09-25 Artist news hub, tour titles and photo credit (SEO)

The owner wants Mshpit to be an information hub as well as a social network:
new tours and new albums for the artists people follow, and more reasons to
follow artists and share photos.

- News engine (`server/features/artistUpdates/`): every 15 minutes it records
  public tour dates Mshpit sees for the first time (one "N new tour dates
  added" item per artist per day) and checks up to 30 followed or touring
  artists a pass for new albums, EPs and singles on Deezer (keyless). The first
  look at the catalogue and at each artist is a quiet baseline. Releases are
  used only when the stored Deezer id still names exactly this artist with at
  least 500 fans; a first sighting of a whole tour for an artist Mshpit had
  never seen is recorded quietly. Tour dates go through the same public rules
  as event pages, re-checked on every read. `ARTIST_NEWS_ENABLED=true` in
  render.yaml; pausing catalog upkeep pauses it.
- Alerts: followers (Follow button favourites and fan club members, not
  banned) get an `artist_update` notification that opens the artist, at most
  one per artist every 12 hours.
- Pages: `/news` (app screen and crawlable page with MusicAlbum structured
  data, in the sitemap and site nav, indexed once it has 3+ items), a "Latest
  news" block on artist pages (app and public page) with a Follow prompt, a
  "New this week" strip on Discover, and News in the menu.
- Titles: artist pages with upcoming dates are now "<Artist> Tour 2026: Concert
  Dates & Tickets" (or with reviews, "Dates, Tickets & Concert Reviews"),
  naming the years the dates fall in.
- Photos: fan photos on artist pages are credited ("Photos by ...", linked to
  profiles), with an "Add photos" prompt, and the fan photo used as an artist
  page's image carries creditText and creator in structured data so search
  results can credit the photographer.
- News UI lives in one lazy module (`src/components/news/NewsViews.jsx`), so
  the first page load does not grow.

## 2026-09-25 Visual polish, the little things (owner approved and merged)

No flow, copy or layout changes; only how things look.

- Stage (default theme) moves from blue-slate to neutral graphite so the
  amber is the only warm thing on screen. Other themes are unchanged. The
  contrast test still passes for every theme.
- Fonts: headings use each platform's display face (SF Pro Display, Segoe UI
  Variable Display); the old rounded stack fell back to Trebuchet MS on
  Windows. Monospace labels prefer SF Mono or Cascadia Mono.
- Buttons are flat and crisp: no thick 3D bottom edge, a hairline top light,
  a quiet hover and a small press-in. The same edge is flattened on the
  header back button, sheet headers, the top bar and a few one-off buttons.
- Focus rings only show for keyboard users, and headings or alerts that the
  app focuses for screen readers no longer grow a box on screen.
- Selected toggles (Near you / Worldwide, Top / A-Z, Near / World) are a raised
  neutral chip instead of solid orange, so orange means "do something".
- The orange, pink and blue bars on the Discover header and the login card
  become one short amber tab. The ticket card keeps its band.
- Hard-edged decorative circles become blurred stage light on the web, and the
  no-photo event banner shows a quiet music mark instead of a calendar blob.
- Artist initials come from one helper (`src/domain/artistInitials.mjs`), so
  the hero and avatar agree ("LR", not "LR" and "LI").
- Checks: `npm run check` and all 9 CI browser suites pass on the branch.
  Initial JavaScript is 510.8 of 512 KiB gzip.
## 2026-09-25 Crew reworked as show swipe + Lounge plans (still switched off)

The owner chose to keep the swipe only for shows and move meeting people into
each show's existing Lounge as group plans, so nothing works like a
swipe-on-people app or gets promoted to members under 18.

- Show swipe (`CrewScreen`, `/crew` when on): flip through upcoming shows,
  right for Going, up for Interested, left to skip. It only saves your own
  attendance, so it is for every age. After "Going" it offers the Lounge.
- Lounge plans (`server/features/crew/showPlansService.js`,
  `src/components/crew/LoungePlans.jsx`): inside an open Lounge, adults with a
  confirmed email see a Plans bar. A plan is a kind (ride, meet before doors,
  hotel, spare ticket, pit, other), up to 140 characters and 1 to 8 spots.
  Others tap "I'm in"; the host and members see who's in and share a plan
  chat; nobody outside a plan sees its members or chat. Hosts can remove
  people and close the plan, staff can close any plan, and members can leave
  or report the host. Plans use the Lounge's own gate (going, Lounge open) and
  close with it. Blocks keep people out of each other's plans; every reason a
  plan cannot be joined gets the same answer. Joining notifies the host
  (`plan_join`), which opens "Your plans".
- Members under 18 (and unknown age) never see plans, "Your plans", or any
  plan request; the browser suite checks this.
- Removed: person cards and swiping, matches, the match notification, the
  rule that let a match stand in for DM consent, the public `/crew` page, the
  event-page "Going alone?" section and the show-page invite.
- Tables: `show_plans`, `show_plan_members`, `show_plan_messages` (created at
  startup, unused while off). The old `crew_seekers`, `crew_swipes` and
  `crew_matches` are no longer created or read; any rows from the one day Crew
  was live stay in the database untouched.
- Checks: `server/features/crew/crew.test.mjs` (6 tests) and
  `verify:crew-browser` (adult at 375 and 1280, teen at 375) pass against a
  flag-on export in `.tmp/crew-dist`; the suite stays out of CI while off.

## 2026-09-25 Crew switched off (back burner)

The owner liked the idea but not the environment: Mshpit needs far more
members before strangers can find each other for a show, and swiping on
people brings privacy risks and dangers for members under 18 that Mshpit
should not invite or promote the way apps like Yubo do. Crew is now a future
addition, to be reworked to feel like Mshpit before it returns.

- `CREW_ENABLED = false` in `src/domain/crewAvailability.mjs`, read by the
  app, the API, the public page renderer and the sitemap builder. Off means:
  no `/api/crew/*` routes, `/crew` is not a page (it falls through like any
  unknown path), no sitemap entry, no "Going alone?" section on event pages,
  no Discover banner, no show page card, no menu item, and a saved navigation
  stack pointing at Crew reopens on the home tab. A crew no longer counts as
  DM consent. Two tests fail if it is switched on without a deliberate change.
- Kept for later, untouched: the Crew tables (created at startup, unused while
  off), service, screens, swipe deck, tests, and `verify:crew-browser` (out of
  CI while off). Crew was live for about a day with no promotion; any rows
  from that day stay in the database, unused.

## 2026-09-24 Crew: swipe to find people to go to shows with (now switched off)

The owner asked for a hook that keeps people coming back between concerts,
like Tinder or TikTok, without changing what the site is. They picked "swipe
to find show buddies" over a daily game (the Headliner game is parked in
`git stash` on `feat/headliner-game`, not deleted).

- Three opt-in steps (`server/features/crew/`): swipe upcoming shows in your
  home city (or any city) to say going, interested or skip; turn on "Looking
  for a crew" for a show with up to four purposes (meet before doors, ride,
  hotel, spare or needed ticket, pit) and a 160 character note; then swipe
  other people looking for a crew for that same show. Two yeses make a crew.
- Safety lives on the server: adults (`18_plus`) with a confirmed email only
  for seeking and people swiping; you are shown only to others seeking for
  the same show; one-sided yeses are never revealed; blocks hide people both
  ways; stopping hides you at once; every invalid swipe target gets the same
  404 so nobody can probe. A crew counts as consent for direct messages
  between the two adults (`crewMatched` in `directMessageSafety.js`), except
  when the recipient closed messages to everyone. Teens are never reachable.
- Client: `CrewScreen` (show deck, people deck, "Your crews", match sheet,
  block/report sheet), `SwipeDeck` (drag or buttons; honours reduced motion),
  entry points on Discover (banner), each upcoming show page ("Going alone?
  Find a crew" with public counts), and the menu. A `crew_match` notification
  opens the chat with that person.
- SEO: `/crew` is a crawlable page (how it works, FAQ structured data, and up
  to 24 upcoming public shows with counts only), in the sitemap and reserved
  as a slug. Upcoming event pages gain a "Going alone?" section linking to it.
- New tables (created at startup, no backfill): `crew_seekers`, `crew_swipes`,
  `crew_matches`, `crew_show_passes`. No new keys or environment variables.
- Checks: `server/features/crew/crew.test.mjs` (gating, visibility, blocks,
  hidden one-sided likes, matches and DM consent, the public page) and a new
  CI browser suite, `npm run verify:crew-browser`, which drags a card away by
  touch at 375px and by mouse at 1280px, says going, sets up a crew, crews up
  and checks the match. It caught a web bug fixed here: letting go of a drag
  also clicked the card and opened the show. Initial JavaScript is 510.4 of
  512 KiB gzip (Crew adds 0.2 KiB; the rest loads with its screens).

## 2026-09-24 web profile agents (no AI): Ticketmaster records + Wikidata

The owner prefers agents that pull from the web over AI research, because
MusicBrainz alone holds pages back. Root cause found: artists created from
Ticketmaster shows (`source='ticketmaster-attraction'`, up to 10,000) have no
MusicBrainz ID, and the Wikipedia biography worker only runs on artists with
one, so those pages could never fill. The Ticketmaster attraction behind each
show already lists the performer's MusicBrainz ID, Wikipedia page, official
links and genre; the importer kept only its id.

- `server/features/providerProfiles/`: a scheduled worker (every 10 minutes,
  at most `TICKETMASTER_PROFILE_DAILY_REQUESTS`, default 1,500 of the 5,000
  daily Discovery calls) reads `/attractions/{id}` for mapped performers
  (empty pages first, most recently seen first) and `/venues/{id}` for venues
  with the most shows.
- A MusicBrainz ID is stored on an artist only when the artist has none, no
  other artist has it, and Wikidata has exactly one item with that ID whose
  English name or alias is the performer's name (or, from a Wikipedia link,
  whose single ID and name match). Provenance goes in `data.mbidEvidence`.
  The existing Wikipedia worker then fills the biography and country.
- Ticketmaster's genre becomes a `ticketmaster` genre claim (rank 3, like a
  direct provider statement), so it outranks crawl and tag guesses but never a
  staff decision.
- Pages: `GET /api/artists/:key/links` (official site, Instagram, YouTube,
  Wikipedia and so on, restricted to each service's own host) shown as
  "Official links" in the artist About section; `GET /api/venues/:key/details`
  (box office, pickup, payment, parking, accessibility, entry rules, ages)
  shown under "Plan your visit", only when the Ticketmaster venue id belongs
  to a show at a venue with that name. Images are not used.
- `PROVIDER_PROFILES_ENABLED=true` in render.yaml; runs on the existing
  `TICKETMASTER_KEY`. Pausing catalog upkeep pauses it. The admin catalog
  screen has a Web profiles section. The Claude research agent stays off
  unless `ANTHROPIC_API_KEY` is added.

## 2026-09-24 web research agent for empty artist and venue pages

The owner noted many artist and venue pages stay empty because MusicBrainz and
Wikidata run dry, and asked for an AI agent with web search to fill them.

- `server/features/catalogResearch/`: a background worker that asks Claude
  (default `claude-sonnet-5`, Messages API with the `web_search_20250305`
  server tool and a `record_findings` tool) to research one page at a time.
  Artists with no biography and no claimed owner or staff profile text, and
  venues identified by name plus city, go in order of shows on file, then
  artists by popularity. Artists and venues alternate.
- Publishing rules (`catalogResearchFindings.js`): only a `confident` match; a
  2 to 4 sentence summary that names the subject, has no links, no em dashes,
  and cites at least one page; each fact must cite a page that appeared in
  that run's own search results, so sources cannot be invented. Unsure and
  not-found results are stored but never shown. A failed or unsure refresh
  keeps the last good result. Image suggestions are limited to Wikimedia
  Commons file pages and stored for the licence-checked photo pipeline; they
  are not displayed yet.
- Pages: `GET /api/artists/:key/research` and `GET /api/venues/:key/research`
  (venue research only for the matching city). Artist pages without a
  biography and venue overviews show a short "About" block with facts and
  "Summarised from" source links; pages without research look as before.
- Controls: needs `ANTHROPIC_API_KEY` (Render secret, owner to add) and
  `CATALOG_RESEARCH_ENABLED=true` (in render.yaml). Spending stops for the day
  at `CATALOG_RESEARCH_DAILY_USD` (default $5, about 40 to 100 pages). Pausing
  catalog upkeep pauses research. Staff can hide a wrong result with
  `POST /api/moderation/catalog-research/hide` (audited). The admin catalog
  screen shows spend, pages filled and the last error.

## 2026-09-24 posting no longer waits on video conversion

The owner reported a TikTok clip stuck in a "processing" loop and asked for
posting to be fixed properly, with nothing removed. Production logs were not
available to this session, so the fix covers every path that could produce the
loop and adds the logging needed to see the next failure.

- Post while converting: once a clip's original is uploaded and the server has
  recorded its conversion, the composer attaches it ("Converting" tile) and the
  post can go out. The clip is linked to the post but hidden until ready, then
  joins the post's media list in the slot it was posted in, with its objects
  bound to the post so orphan cleanup never takes them. Only the author sees a
  "still converting" note under the post, which refreshes the feed when the
  clip is ready and offers "Try again" if conversion stopped. Editing the post
  never detaches a converting clip. A clip the converter cannot read stays on
  the post (never deleted) and the author is told.
- Durable conversions: new `media_processing_jobs` table. Every conversion is
  recorded; a restart makes interrupted ones due, and a scheduler
  (`/startup/video-processing`) retries temporary failures on a growing
  schedule (30 s up to 1 h, nine attempts, about 2.5 h) without the member
  keeping a screen open. A busy converter costs no attempt; unreadable files
  and repeated conflicts stop. `POST /api/media/assets/:id/processing/retry`
  lets the owner ask again after a final failure.
- One conversion at a time on the site too: clips from an album or two members
  queue in `videoFinalizeJobs.js` instead of racing the single-slot converter
  and failing as busy. A converter that missed one health check keeps the
  formats it last reported, so finalize no longer refuses clips during a blip.
- Fast path: web-ready H.264/AAC MP4/MOV clips (TikTok, Instagram, most phone
  video) with no rotation, square pixels, up to 1920x1080 and 60 fps are
  repackaged instead of re-encoded, which takes seconds on the one-CPU
  converter. The copy passes the same strict probe and full decode; anything it
  fails is converted in full, so the shortcut cannot refuse a clip. The build
  self-test now includes a portrait H.264/AAC sample that must take this path
  and an anamorphic one that must not.
- Converter logs: each job logs its format, size, every step's time and how it
  ended, including FFmpeg's last lines on failure (no keys or signed URLs).
  A tolerant decode that prints many warnings no longer fails on the 64 KiB
  output cap; only the tail of stderr is kept.
- Real bug fixed: storage-key checks (`server/media.js`,
  `server/mediaDeletion.js`, `src/domain/mediaUploadTicket.mjs`) only allowed
  `.mp4/.webm/.mov` for video, so MKV, AVI, MPG, TS, WMV, FLV, 3GP, 3G2, M4V
  and OGV uploads failed at creation although the site advertised them. All
  three now build from `MEDIA_OBJECT_EXTENSIONS` in `mediaMime.mjs`. The web
  picker and client type detection also recognise every container by
  extension, so a typeless MKV is no longer treated as a 30 MB-limited photo.

## 2026-09-24 video converter now takes every format (live)

- Live since about 14:20 UTC: `/api/health?mediaPipeline=private-derivative-v1`
  lists all thirteen source types, and the converter reports `universal-v1`.
- Why it took several pushes: the push carrying the converter change failed
  GitHub's `browser-regressions` check (the tests expected the old landing and
  You screens), so Render's `checksPass` trigger skipped it; the fix-up push
  touched no file in the converter's build filter, so Render did not rebuild
  it. A converter-file commit triggered the build, whose new `--self-test`
  then failed because FFmpeg 9 removed the `-top` encoder option used for the
  interlaced MPEG sample (`setfield=tff` replaces it). The AVI, Matroska and
  WebM samples had already converted. Each failed build left the previous
  converter running.
- The self-test now reports the exact FFmpeg command and error text.
- Lesson: when a converter change lands with failing checks, the next green
  push must touch a build-filter path (or use Manual Deploy) to ship it.

## 2026-09-24 design makeover (owner reviewed, merged to master)

Built on `design/opus-makeover` and held for the owner's review, which
approved it on 2026-09-24 after seeing it locally. It was fast-forwarded onto
`master` (no other commits had landed) and pushed. `npm run check` passed on the
branch and on `master`.

- Landing logo: the community mark sits above the headline with its two rings
  turning against each other, ten turns one way and ten back, ending upright
  and holding still between runs. Only the logo is drawn; the owner rejected a
  version with ticks, a centre star and sparks. It is decorative, ignores
  pointers and stays still with Reduce Motion.

- Landing: one headline, one sentence, two buttons. The proof tiles, live rail
  and slogan kicker are gone, and the server-rendered home page matches.
- You tab: it is now your own profile, with Inbox, Activity, Calendar and
  Settings as icons and your memories above the stats. Moderation and "Create
  or claim an artist page" moved to Settings; taste management moved to
  Discover.
- Posting: every post starts as a plain post. "Add a show you went to" turns it
  into a review in place, and "Remove show" turns it back without losing text.
- Gallery: photos swipe sideways between items and pull down to close. Videos
  keep their arrows so a swipe never fights the scrubber.
- Share cards: both Instagram Story cards keep all text inside y 250 to 1560,
  where Instagram does not draw its own bars. The review card has drawn stars and
  the reviewer's name; text-only reviews get a gradient instead of a grey block.
  The going card has a GOING or INTERESTED stamp on the stub. The share sheet
  prints the card in with one sweep of light, and skips it with Reduce Motion.
- Search titles and descriptions: no em-dashes, no slogan descriptions. The
  default description, app description and About page match the landing.
- Copy: slogan headings and the small capitals above screen and section titles
  are gone or sentence case at 12px or larger.
- Clips in any common format: production video publishing was already live
  (checked 2026-09-23: `/api/health?mediaPipeline=private-derivative-v1` reported
  `ready`), but the converter accepted only MP4/MOV with H.264 or HEVC and a
  long list of exact stream rules, so WebM, MKV, AVI, VP9, interlaced, anamorphic,
  10-bit H.264, multi-audio and similar clips were refused. The converter now
  advertises `universal-v1` in separate health fields. When it does, the site
  skips the MP4-only structural pre-check and the converter reads the file with
  the demuxer its declared container calls for (never format guessing), picks the
  first decodable picture and audio, and always re-encodes to the same strict
  H.264/AAC MP4 with metadata stripped and a server-made cover. Budgets are
  unchanged: 500 MB, ten minutes, 4096 by 2160, 240 fps. An older site ignores
  the new fields and an older converter never receives a universal job, so the
  web and converter deploys can land in either order. The converter image build
  now converts real AVI, Matroska and interlaced MPEG clips (`--self-test`); a
  failure stops that build and Render keeps the running converter.

Not in this branch, and why:
- AV1 clips are still refused: software AV1 decoding needs libdav1d in the
  converter image, which is not added yet.
- Rejected photos need a real failing file from the owner to reproduce.
- About 72,800 sitemap URLs are provider event and catalogue pages against
  about 109 member-made pages. Removing the thin ones from Google is an owner
  decision because it changes search traffic.

## 2026-09-12 upstream provider alerts

- `GET /api/artists/resolve` returned 502 `PROVIDER_UNAVAILABLE` twice on
  2026-09-12. MusicBrainz was answering 503 "currently busy" to plain requests
  from an unrelated network at the same time, so the failure was upstream. The
  lookup already throttles and sends a contact user agent.
- The alert cause chain now carries the upstream HTTP status, for example
  `ProviderError [http_error, status 503]`. That separates a busy provider from
  one that refused Pit, which the sanitized cause name alone cannot do.
- A transient provider fault (`PROVIDER_UNAVAILABLE` caused by `http_error` or
  `network`) is held out of the alert email until it reaches
  `ERROR_ALERT_PROVIDER_MIN` occurrences since the last alert (default 10). It
  stays in the admin console the whole time, and rate limiting, refusals and
  unreadable payloads still alert on the first occurrence.
- Still open: a visitor looking up an artist outside the local catalogue sees a
  502 while MusicBrainz is down. Caching, a catalogue or Deezer fallback, and a
  single retry all need `server/api.js`, which carries another agent's
  uncommitted work.

- `GET /api/artists/resolve` now remembers each successful MusicBrainz
  resolution in `provider_cache` for 90 days and serves that answer while the
  provider is unavailable, marked `stale: true`. A name this catalogue has never
  resolved still fails with 502, which is honest: Pit does not know that artist.
- The lookup retries once on a transient provider failure (a provider 5xx or an
  unreachable host). The retry re-enters the shared MusicBrainz queue, so the
  one-request-per-second rule still holds and a struggling provider is not
  hammered.
- Three tests cover it: a remembered artist during an outage, one retry
  absorbing a single 503, and an artist never seen before still failing.

## 2026-09-11 credibility audit and user-base audit script

- `docs/mshpit-soundcheck-2026-09-11.md` records a layer-by-layer audit of the
  database, user base, codebase, and public site, and the running order that
  supersedes the older improvement lists as the plan of record.
- `npm run audit:userbase` (`scripts/audit-userbase.mjs`) opens the database
  read-only and prints counts, shares, and sizes only. Its test plants emails,
  names, handles, cities, IPs, and review text in a partial schema and proves
  none appear in the output and the database file is unchanged. Production
  numbers are pending the owner running it in the Render Shell.
- Decisions needed from the owner: noindexing event, venue, and city pages
  without member content (83 of 65,205 live sitemap URLs were made by members)
  and hiding features outside the core loop.
- The local `backups/pit-20260813-195945.db` appears to be early production data
  with raw session IPs and user agents. It is git-ignored but should be deleted
  or encrypted.

## 2026-09-11 production outage: full data disk

- mshpit.com returned 502 from about 14:43 to 15:25 Toronto time (18:43 to
  19:25 UTC) while `2098442` deployed. Render's origin reported
  `x-render-routing: dynamic-paid-error`, and Render's status page showed no
  incident.
- Root cause: `scripts/start-production.mjs` runs `scripts/backup-db.mjs`
  before the server starts. Its `VACUUM INTO` copy failed with
  `database or disk is full` because the 1 GB `/data` disk also holds up to
  `BACKUP_KEEP=7` local snapshots. The launcher refuses to start without a
  verified backup, so Render restarted it in a loop and nothing listened.
- Not the release code: the exact commit booted locally in production mode in
  about 3 seconds, and again in about 1 second after running the same
  pre-migration backup and integrity check against a throwaway database.
- Recovery: the owner raised the disk to 5 GB. The service came back on the
  previous build (`index-c5c4de...` bundle, September 7 privacy page), so
  `2098442` did not reach production that day.
- Fix: before copying, the backup measures free space and deletes the oldest
  completed snapshots only when that makes the copy fit, always keeping the
  newest verified one. If the disk still fills during the copy, it keeps only
  the newest snapshot and retries once; a second failure still refuses to
  start. `render.yaml` now declares `sizeGB: 5` to match the live disk.
- Verification: five new backup tests cover space planning, preflight
  pruning, the disk-full retry, refusal when nothing can be pruned, and
  production ignoring the test fixtures.
- Committed-scope gate: this fix applied to `2098442` in an isolated worktree
  passed `npm run check` with **4,179/4,179** tests, dependency audit, syntax (557
  files), architecture, web export with 54 source maps, and the bundle budget
  at **495.2 / 512.0 KiB** gzip.
- Remaining risk: off-host backups are still not configured, so pruning under
  disk pressure can remove the only older local recovery points. Every deploy
  on this persistent-disk service is still unavailable while the startup
  backup and boot run.

## 2026-09-10 founder error diagnostics

- Alert emails now say where and why. Each grouped error keeps its latest detail
  in a founder-only `error_event_details` table (`server/errorDetails.js`): the
  first application stack frames made repo-relative, the redacted message and
  cause chain, and the release commit. The `error_events` grouping identity is
  unchanged, so existing history does not split.
- Every `recordError` call site in `server/index.js`, including process-level
  fatals, now passes the error object. A `DOMException` abort's stack points at
  the code that constructed it, so an unhandled abort names its source instead
  of recording only `AbortError/20`.
- Browser crashes send a message redacted on the device and again on the server
  (`src/domain/errorRedaction.mjs`). URL query strings and userinfo, emails,
  bearer tokens, `key=value` secrets, JWTs, long hex and mixed tokens, IP
  addresses, and quoted free text are removed; property names, build asset hashes
  and request ids are kept.
- The web build emits external source maps. `server/staticPolicy.js` refuses
  every `.map` request with 404, and
  `server/features/clientErrors/clientSourceLocation.js` reads them server-side
  with Node's built-in `SourceMap` to turn a minified location into
  `src/...:line:column in name`. A lookup is accepted only when the generated line
  matches exactly, because `findEntry` otherwise returns an earlier line's
  mapping. Parsing is capped at 20 maps per 10 minutes per process.
- Crash locations now resolve for WebKit `global code@` and `module code@`
  frames (every iPhone browser) and for `public/mshpit-web-boot-v1.js`. Window
  errors with no error object (cross-origin scripts, extensions, `ResizeObserver`
  notices) are no longer filed as fatal crashes or emailed.
- Alert detail is frozen into the persisted batch, so a retried send stays
  byte-identical under its idempotency key. It is trimmed from the oldest rows to
  keep the batch under 22,000 characters, below the 24,000-character
  `pending_payload` CHECK that would otherwise stop alerting.
- Verification: complete `npm run check` on the working tree passed with
  **4,237/4,237** tests, dependency audit, syntax (563 files), architecture, web
  export with 55 source maps, and the bundle budget at **498.4 / 512.0 KiB**
  gzip. An in-process check against the real build resolved
  `index-3775ab4b...js:549:495` to `src/screens/FeedScreen.jsx:17:1` through the
  real crash route, redactor, resolver and error log, and refused its `.map`.
- Committed-scope gate: this change alone, including the privacy policy update,
  applied to `4603cb3` in an isolated worktree without the unrelated uncommitted
  work in the checkout, passed `npm run check` with **4,174/4,174** tests,
  dependency audit, syntax (557 files), architecture, web export with 54
  source maps, and the bundle budget at **495.2 / 512.0 KiB** gzip.
- Privacy policy: the crash section (`CRASH_MONITORING_DISCLOSURE` in
  `src/domain/privacyDisclosures.mjs`) said crash reports contain no error
  message, which this change would have made false. The change was held until
  the owner approved new wording on 2026-09-11: reports include a shortened,
  redacted message and, on the web, a code position; server problem records keep
  the code location, message and release; staff get alert emails through the
  email delivery provider; alert emails stay in the staff mailbox until deleted;
  and a message can occasionally still contain on-screen text. The privacy and
  Terms dates move to September 11, 2026 and `LEGAL_ACCEPTANCE_VERSION` to
  `2026-09-11`, because tests keep the pair aligned; the Terms text is unchanged.
  Existing members are not asked to accept again. A signup page opened before
  the deploy must be refreshed, because `/api/signup` rejects an older version.
  `ERROR_CATALOG.md` now documents this as the one persisted diagnostic exception.
- Deployment: no environment changes. Render's `check:deploy` runs `build:web`,
  so production emits and keeps maps on disk. Release identity comes from
  `RENDER_GIT_COMMIT`.
- Not yet in the admin console: `GET /api/admin/errors` projects fields
  explicitly in `server/api.js`, which had unrelated uncommitted work at the
  time. Detail currently reaches the alert email only.
- Remaining risk: unquoted prose that application code writes into an error
  message cannot be detected and will appear in the founder email. Source maps
  add build output on disk and an occasional bounded synchronous parse during
  crash ingestion.
- An alert batch that cannot be emailed keeps its frozen detail in
  `error_alert_delivery` until a send succeeds, so a long email outage keeps that
  detail beyond the 30-day problem-record window.

## 2026-09-02 native runtime remediation

- The project is aligned to Expo SDK 57.0.19, React Native 0.86.3,
  React Native Reanimated 4.5.1, and Worklets 0.10.1.
- `expo install --check` reports compatible dependencies and Expo Doctor passes
  **21/21** checks. The earlier SDK 56 Hermes V1 memory-regression blocker is
  removed from the dependency graph.
- Physical iOS and Android device acceptance remains required before submitting
  a signed native build; a passing dependency check or web export is not that
  acceptance test.

## 2026-08-21 pre-push audit (historical)

- The accumulated feature branch passes the exact `npm run check` gate:
  **880/880 tests**, **135** Node files in the syntax sweep, and a fresh web
  export with **43 chunks**. Fresh iOS and Android JavaScript exports are also
  green at approximately **6.5 MB** each.
- Expo SDK 56 dependencies pass `expo install --check`. Expo Doctor is **21/22**
  only because Expo 56.0.20 / React Native 0.85.3 remains on the documented
  Hermes V1 memory-regression line; that remains a native-distribution gate.
- `npm audit --omit=dev` reports **17 advisories: 9 moderate and 8 high**, all in
  the Expo/Metro/Xcode build graph. It reports no critical issue and proposes an
  incompatible Expo 53 downgrade rather than a safe SDK 56 remediation.
- This audit targets the feature branch. Production remains on the separately
  reconciled release until an intentional merge/deploy and live smoke check.

## 2026-08-14 release candidate

- This section records the exact candidate verified before the direct-master
  rollout. At that checkpoint production remained on `c9d86eb9b8b2`; the
  release is complete only when both the custom domain and Render origin report
  the resulting release commit and preserve the public-data baseline below.
- Mobile now has an independent 44-by-44 Stop/Close control plus a dedicated
  `SWIPE UP TO CLOSE` rail on both expanded and minimized player surfaces. The
  gesture belongs to the player rail only--never the feed, transport controls,
  title, queue, or scrubber--and requires a deliberate dominant upward motion.
  The 44-dp rail claims its single touch at touch-down so React Native cannot
  discard the opening movement when responder ownership is granted.
  Closing pauses playback, clears the account-owned queue and resume position,
  unmounts the playback engine, and restores the feed's full height. The
  verification banner moves below an active mobile player instead of covering
  either close path.
- Email verification now adopts the confirmed state immediately for the exact
  matching signed-in account instead of leaving `session.emailVerified` stale
  until reload. Confirmation and resend are no-store, ambiguous responses use
  bounded idempotent receipts and identity-bound reconciliation, an already
  verified stale banner self-heals, and guest/different-account tokens cannot
  disclose or adopt the token owner's private self projection. A consumed token
  is removed from the visible URL while the completion state remains on screen.
- The logged-out hero remains stock-first but can now rotate in separately
  opted-in community review photos. Homepage consent defaults off, is owner-only,
  survives drafts/edits/export/idempotent retries, and never inherits the older
  artist-page photo toggle. Eligibility requires a confirmed active account, a
  PIT-owned HTTPS JPG/PNG/WebP under that author, public photos, no open post
  report, and no relevant block. The response exposes only a bounded credit,
  artist, venue, post id, and media URL; per-author SQL and projection caps keep
  one account from monopolizing the reel.
- The hero renders one bundled stock frame immediately, mounts at most the
  current/outgoing layers, prefetches the exact first community frame before an
  early transition, preserves deterministic stock fallback, resets the full
  seven-second deadline after every transition, and honors reduced motion.
  Existing rows migrate opted out, so production will remain stock-only until
  verified owners explicitly enable the new control on eligible reviews.
- Final local gates: **514/514** tests, **118** Node files in the syntax scan,
  Expo dependency alignment, Expo Doctor **21/21**, fresh SDK 56 web export,
  fresh Android export (**926 modules**, approximately **4.5 MB** Hermes), and
  fresh iOS export (**930 modules**, approximately **4.5 MB**).
  The web entry is **2,348,998 bytes raw, 641,523 gzip, and 529,579 Brotli**;
  it remains inside the executable raw/compressed budgets. Isolated browser QA
  passed at 390-by-844 and 1440-by-1000 with community and stock-only paths,
  two or fewer mounted hero images, no horizontal overflow, and no console errors.
- Credential-free App Store preparation now pins `com.mshpit.app`, version
  `1.0.0`/build `1`, phone-only initial scope, export-compliance and
  required-reason privacy declarations, EAS preview/production profiles, and a
  real native version label in Settings. No Apple/Expo credential, cloud build,
  TestFlight upload, or App Store Connect write occurred. Final Pit-owned icon
  and splash artwork, public support/privacy URLs, non-post UGC report controls,
  physical iPhone acceptance, reviewer access, and owner store metadata remain
  explicit blockers in `APP_STORE_READINESS.md`.
- Before broad traffic, add owned responsive image derivatives/CDN transforms:
  prefetch prevents a blank transition but a community hero can still be an
  original upload up to 12 MB. Durable per-photo suppression or a curated
  homepage approval workflow is also still needed; current safety filters are
  reactive, and whole-post moderation is the durable removal path. Real-device
  acceptance of the player stop/release lifecycle remains required.

## Release state

- Remediation commit `1e2ba65` was fast-forwarded to `master`, pushed, and
  deployed through the explicitly recorded direct-master path on 2026-08-13.
  The declared staging hostname still had no service, so this was not a staging
  rehearsal.
- Render build-gate fix `2ec2679` was then pushed and deployed successfully; this
  status update is its documentation-only descendant. GitHub Quality run
  `31742684092` passed. The custom domain and Render origin both reported commit
  `2ec267978e37`, HTTP 200, the configured database file present, bootstrap
  disabled, backups enabled, and matching uptime at 106 seconds.
- Both public endpoints returned the same 13 post IDs. The J. Cole/Bas post,
  three other J. Cole posts, and the attached 3,909,908-byte R2 image remain
  intact. The earlier claim that a free-tier restart erased that content was not
  supported by the evidence.
- Feature-branch and merged-`master` gates pass. The release ran **350/350**;
  the Render-environment follow-up now runs **351/351**, plus the
  100-file syntax scan, fresh web and Android exports, Expo dependency alignment,
  and Expo Doctor **21/21**. Physical-device acceptance remains open below.
- Final live checks retained the 2,253,157-byte immutable entry with zero venue
  gallery arrays/server split references, a 12-photo bounded venue response,
  and a missing-chunk 404 with `Cache-Control: no-store`. The J. Cole/Bas image
  remained HTTP 200 at 3,909,908 bytes.

## What this batch changes

- Production performs a read-only preflight before migrations and refuses a
  missing mount/database, zero-byte file, wrong schema, or structurally empty
  legacy Pit database instead of silently creating or migrating a healthy-looking
  empty site. Only an explicit first-boot bootstrap bypasses initialization
  checks; health also checks the configured storage identity.
- Venue galleries load one venue at a time through a bounded API/client cache.
  The final release-candidate export entry is **2,253,157 bytes raw, 615,705
  gzip, and 504,824 Brotli**, down from the 4,402,225-byte live baseline. No literal venue gallery
  arrays or server split-file reference occur in client JavaScript.
- Feed responses embed the latest two visible comments per post, removing the
  one-comments-request-per-card mount fan-out. Full threads still load on demand.
- The release implements account-scoped native draft durability, dirty/busy Back
  guards, late-response ownership, Android picker-result recovery, and iOS media
  permission preflight. Fresh web and Android exports pass; physical-device proof
  remains a release-acceptance gap.
- Create retries compare canonical stored meaning, legacy missing hashes are
  healed only after equivalence, and ambiguous edits read canonical server state.
- Filtered feed paging reveals loaded matches before fetching; hosted job flags
  fail closed; heavy jobs serialize; missing hashed chunks return `no-store`.
- Render builds now run the full test/syntax/export gate in isolated temporary
  storage instead of exporting web only. The first Blueprint-controlled build
  exposed that the test subprocess inherited Render's one-build bootstrap flag,
  which made the health-policy assertion fail. It also isolates staging's
  recipient-suppression policy from campaign tests. The runner now pins its own
  test/runtime-policy environment and bootstrap-disabled policy; the exact
  production- and staging-like Render commands pass the complete **351/351**
  gate.
- Production now schedules a verified daily SQLite snapshot under `/data/backups`
  and retains seven by default. A complete, separate private `BACKUP_S3_*`
  configuration additionally uploads off-host; without it, backups remain on the
  same persistent disk and are not disaster recovery. A snapshot remains under
  a `.partial-*` name until verification and any requested upload succeed, then
  publishes atomically. Partial files do not suppress retries, and bounded child
  and upload deadlines prevent a stuck run from holding all maintenance work.

## Known release and operating gaps

- The unused Render staging service was retired on 2026-09-04. It carried no
  distinct code and its uninitialized disk generated failed-deploy noise.
  Releases are direct from `master`; do not claim a staging rehearsal. Require
  the complete local/CI gate, a verified recovery point, and post-deploy checks.
- Health confirms the production backup scheduler is enabled, but no post-change
  snapshot, off-host upload, restore, or rollback has been independently
  observed. Off-host configuration is currently false. Configure private backup
  credentials, observe a scheduled snapshot/upload, and rehearse restore before
  relying on it for disaster recovery.
- Real Android/iOS acceptance remains mandatory for activity recreation,
  permissions, poor-network publish/retry, browser/hardware Back, memory, and
  interaction latency.
- `src/store.js` remains a broad Context. Comment fan-out is fixed, but domain
  provider/selector splitting and profiler-based rerender work remain open.
- Provider enrichment jobs remain deliberately disabled on hosted services until
  capacity and database pressure are observed one job at a time.
- `npm audit --omit=dev` reports **17 advisories: 9 moderate and 8 high**, in the
  Expo/Metro/React Native/Xcode dependency graph. npm's automated fix proposes
  incompatible Expo 53/React Native 0.72 changes. Do not use
  `npm audit fix --force`; track compatible SDK 56 patches or plan a deliberate,
  device-tested SDK upgrade.

## Release checklist

1. Keep the passing feature-branch and merged-master evidence (`npm run check`,
   `npm run integrity`, isolated production boot, web/Android exports) attached
   to the release.
2. Confirm a verified production backup/restore point and keep the last-known-good commit
   (`1c6d91f`) available for code rollback.
3. Record releases as direct-master and require the complete local/CI gate,
   verified recovery point, and post-deploy checks before calling them complete.
4. Post-deploy read-only proof covers custom/origin commit and data parity,
   durable-storage health, J. Cole post/photo presence, missing-chunk behavior,
   venue-cache behavior, exact live bundle size, and health beyond 60 seconds.
5. Complete a real-device authenticated create/edit/poor-network retry pass. The
   production smoke deliberately made no public test post or other data write.
