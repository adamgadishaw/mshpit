# Artist pages: Astra implementation brief

Status: implemented from `eab93e2` after approval and audited for release. See `artist-page-revamp-implementation-2026-09-07.md` for verification and release limits. This brief preserves the original diagnosis; the release follows the existing master/checks-pass deployment with no manual production data changes.

## Goal

Make every artist page answer three questions immediately: Who is this artist? What do people think of their concerts? Where can I see them next?

Keep Mshpit's concert-ticket identity, real photography, bold titles, and existing themes. Use short, natural language. This is a cohesive page and data correction, not additional sections stacked onto the existing screen.

## Confirmed problems

- Navigation is buried below the identity, facts, reputation, gallery, and action blocks. `src/screens/ArtistScreen.jsx:1283` renders the section navigation after them. The overview combines previews without establishing a clear first action.
- Artist upcoming dates come from the global startup snapshot, not a complete artist schedule. `src/features/discovery/tourDateRangeApi.mjs:22` requests 30 days with bounded global/home-country results; `src/store.js:6027` selects only exact primary-artist names from that snapshot. The client ignores other billed performers.
- The upcoming section disappears if that array is empty (`src/screens/ArtistScreen.jsx:1354`). Expanding the list only reveals cached rows. Artist pull-to-refresh does not refresh the schedule (`:793`). The archive response already contains upcoming data, but this screen does not use it for its upcoming list.
- Combined attractions can fail individual artist matching in `server/tourdates.js:542` and `server/artistTourDateDemandRefresh.js:294`. A combined-only Usher Raymond & Chris Brown attraction is a regression case. The rule is confirmed; the exact production provider payload causing this user's case has not been inspected.
- Reputation switches between a device-feed-derived overview and a server archive calculation on the Live tab (`src/screens/ArtistScreen.jsx:325`). Those are different populations, so the visible score/count can change across tabs.
- MusicBrainz lifespan beginnings are copied to `beginYear`, stored as `formed`, then labeled Started regardless of artist type. The same label appears in SEO. Entry points: `server/catalogSeed.js:97`, `server/api.js:2936`, `server/db.js:2706`, `src/domain/artistPageSections.mjs:78`, and `server/features/seo/publicDocumentRenderer.js:227`. Existing catalog rows also contain this ambiguity; fixing only future imports is insufficient.

MusicBrainz defines a person's begin date as birth and a group's as formation, not a universal career-start date. See [MusicBrainz Artist documentation](https://musicbrainz.org/doc/Artist).

The user's tour example is supported: [Allegiant Stadium lists Usher and Chris Brown on September 18, 2026](https://www.allegiantstadium.com/events/detail/the-randb-tour-26), a future date at this review's September 7 date.

## Page structure

1. **Identity first.** Real artist photo, name, genre, short introduction, and Follow. On desktop, put a compact concert-rating summary beside the image; on mobile, stack it with deliberate spacing. Include the rating count and distinguish no ratings from a failed request. Do not make fans scroll past a large gallery to understand the page.
2. **Navigation immediately below identity.** Use Overview, Shows, Community, About. Keep biography and the existing music catalog in About with clear subheadings; do not re-enable disabled playback. Preserve old deep links through an explicit mapping if any exist.
3. **Overview is a useful introduction.** Show the next three scheduled shows, one representative review, and up to three public concert photos/videos with clear links to their full sections. Surface the next nearby show when available, without hiding dates elsewhere. Keep the first screen focused on identity, reputation, and the next show.
4. **Shows means shows.** Upcoming dates come first, sorted by event-local date. Use ticket rows with venue, city, date, status, and a real ticket/event link. Offer explicit location filtering with an all-locations option. Put Past shows and tour history below a clear divider or secondary control; do not mix them into the upcoming list.
5. **Community is for people.** Reviews, public media, artist updates, and existing community actions belong here. Keep in-person concert ratings distinct from online/video reviews. Preserve privacy, blocking, moderation, and original-post links. Use bounded previews and functional See more actions.
6. **About contains trustworthy facts.** Brief biography, origin, verified career information, and sources. Do not put an ambiguous Started chip in the hero. Use Career began only for a verified career-start year and Formed only for verified group formation. Birth information, if retained, belongs under an explicitly labeled Born field, not concert history.

## Data and reliability requirements

- Provide an artist-specific, server-backed schedule independent of feed startup limits. Audit reuse of the existing archive endpoint before creating another path; avoid loading an unbounded archive just to display three upcoming tickets.
- Associate canonical events with every verified billed artist through identity-aware relationships. Handle aliases, co-headliners, and festival lineups without merging distinct artists or duplicating events. Do not solve this with unrestricted substring matching.
- Distinguish initial loading, successful empty results, partial coverage, stale data, and request failure. Never imply an artist is not touring because ingestion or a network request failed. Keep usable last-successful data during transient refresh failures.
- Make refresh revalidate schedules. Server pagination must fetch additional results, not only reveal a capped local array. Preserve cancellations, reschedules, local dates, release permissions, and legacy restrictions.
- Use one authoritative reputation summary across overview, other tabs, and public rendering. Do not base the public aggregate on whichever feed pages a device happened to load. Keep viewer-specific/private contributions scoped correctly.
- Separate artist type, birth date, formation date, and career-start year. Retain provenance and verification status. Hide ambiguous old values pending classification; do not guess dates from biography text or silently relabel all existing formed values.
- Add authorized, auditable moderator correction fields for these facts; the current profile editor only covers bio/media/feed settings. Corrections must survive provider enrichment. Wire new editorial copy into the existing moderation-editable content mechanism where applicable.
- Keep server-rendered public facts, titles, and structured data consistent with the visible page. Preserve canonical artist identity and existing search URLs.
- Keep legacy profiles educational with their current restrictions. Do not reopen tours, playback, uploads, live ratings, or fan clubs for protected legacy artists.
- Preserve existing artist images, ownership, source attribution, reviews, and event associations. Any repair/backfill must be additive, reviewable, restart-safe, and preceded by an appropriate backup. No database reset or catalog replacement.

## Delivery and acceptance

Implement in this order: typed facts and corrections; artist schedules and shared summary; page hierarchy; responsive polish; verification.

- Tests demonstrate that a person's birth year never becomes a career-start year, a verified group formation is labeled correctly, unknown dates stay hidden, and staff corrections survive refresh and appear consistently in public rendering.
- Schedule tests cover beyond-30-day events, dense global catalogs, both co-headliners, aliases, festival lineups, cancellation/rescheduling, pagination, partial provider failure, and retry.
- The same artist's score/count stays consistent across tabs and different amounts of feed history.
- Artist/account changes cancel or ignore stale requests; private and moderated media never leak through caches or summaries.
- Check active artists with many dates, artists with no confirmed dates, thin profiles, bands, modern memorials, and protected legacy profiles. Use Chris Brown and Usher as dated integration examples, not hard-coded production fixtures.
- Check 320px, 390px, tablet, and desktop in light/dark themes. No overlaps, clipped tabs, dead See more controls, or decorative blank photo blocks. Verify keyboard navigation and accessible names. State explicitly whether actual Safari/iOS was tested.
- Run relevant regression tests, the full quality check, and a production web build. Report any deployment verification separately from a successful push. Do not claim deployment or complete provider coverage without evidence.
