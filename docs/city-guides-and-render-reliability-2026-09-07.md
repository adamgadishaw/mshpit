# City guides and Render reliability — 7 September 2026

## What is implemented

- City directory and public guide URLs, linked from city search, Discover, review locations, and the post-signup welcome card.
- Moderation → City pages: editable introductions, music history, influence, local artists, sources, one city image, and shared interface/welcome copy. Revision checks prevent overwriting another moderator's changes; changes are audited.
- Twenty-one source-backed initial histories and city photographs, plus one shared concert-crowd welcome image. Photos are licensed, credited, optimized WebP files served by Mshpit. Unfilled cities still use real catalog venues/shows and remain editable: **this is not a claim that every catalog city already has a researched history and stock photo.**
- Public gallery eligibility requires opt-in public photos, an active public profile, verified image derivatives, no open report, and no block between viewer and author. Exact venue/city checks protect against unrelated photos. Public SEO reads use anonymous eligibility.
- Server-rendered city content, canonical URLs, sitemap entries, structured collections, and noindex for empty shells. City collections do not emit incomplete Event objects.

## Confirmed incident findings

### City presentation and search-copy refinement

- City guides use the existing Mshpit ticket trim, perforated stubs, bold display type, photo-led headers, date-stamped show cards, and programme-style history. City directory tiles and the signup welcome follow the same visual language.
- The 21 initial guides have concise concert/venue introductions and independent search titles/descriptions. Moderation can change these SEO fields without changing the visible heading or introduction; shared labels remain editable.
- Default-copy upgrades require exact known prior values and untouched moderation metadata. Custom or moderator-edited copy is not replaced.
- Public city HTML has one primary heading, artist-led event links, linked public review photos, real photograph alt text, region-aware location schema, and source citations. It does not invent event, rating, or review structured data.
- Existing city venue/concert directories link to a verified canonical city guide. Ambiguous or nonexistent city identities do not create guessed links.
- Local visual fixtures use synthetic concert listings and bundled city photos; they do not access production accounts, private photos, or the live database.

### Retired catalog cron

The user identified Render job `pit-catalog-refresh` (`crn-d97dj9ok1i2s73dee530`) as failing with exit 1. Its script is a retired entry point; active refresh is in the web service. The old entry point now exits successfully with explicit `SKIPPED / RETIRED_CATALOG_CRON` and `dataChanged:false`. It does **not** pretend to refresh data.

The actual obsolete Render job still needs to be suspended. Browser control failed locally before it could read the authenticated dashboard, so no remote scheduler change was made. Confirm the in-process catalog watcher is running before suspending the old job.

### Memorial watcher

`musicbrainz_unavailable` means MusicBrainz returned HTTP 500+, not that artists were deleted. Some other requests bypassed the existing shared throttle; all discovered MusicBrainz paths now use it. The watcher uses bounded response reads, longer request deadlines, Retry-After, durable exponential cooldown, and progress preservation. Moderation shows the next check and prevents forced requests during provider cooldown.

### International event counts

Discover had counted a truncated global page instead of the country-wide catalog. It now receives cached complete country totals, reloads the selected country, and leaves unknown counts unknown. Catalog rotation no longer skips a country batch when every country request failed. Ticketmaster's stable Music segment ID is recognized even with translated labels; sports remain excluded.

Read-only live probes found events in France, Germany, Italy, Singapore, and South Africa. Japan and Portugal returned no events in the tested 90-day window. These are real catalog gaps; the code fixes do not prove those gaps are fully resolved. Review subsequent country-ingest outcomes before buying another API. Standard Bandsintown artist keys are not a general worldwide discovery feed.

### Failed deployment

Render deployment `dep-dae43g97lnhs73egufug` references commit `899b8cf`. A temporary historical checkout passed 3,085 tests, syntax/architecture checks, and production web export. The deployment failure did not reproduce locally. Its actual first failing build/startup log is still required; no database repair or bootstrap override was guessed.

## Validation and release notes

- City refinement verification: full isolated test suite, syntax (479 Node files), architecture checks, and production web export passed. Initial JavaScript is 474.2 KiB gzip against the 512 KiB budget.
- Crawler/no-JavaScript guide fixtures passed at 390, 768, and 1440 pixels with loaded photos and no horizontal overflow. Isolated React Native Web component layouts were inspected in Stage and Daylight themes; image adapters were used for static rendering, so this is not a claim of an on-device Safari test.
- Tests use isolated temporary databases; no production database was modified.
- Source photos: `server/features/cities/cityPhotoSeeds.js`. Run `node scripts/sync-city-stock-photos.mjs` to verify bundled images; `--apply` downloads only missing/invalid allow-listed source images.
- City benchmark: `node scripts/benchmark-city-guides.mjs`; synthetic local results are not a production traffic-capacity guarantee.
- Run `npm test`, `npm run check:syntax`, `npm run check:architecture`, and `npm run build:web` before release.
- After deployment, check `/cities`, `/city/ca/toronto`, shared copy save/reload, signup welcome, country coverage, watcher cooldown, and Render startup logs.
- Do not enable empty-database bootstrap to work around an unexplained production startup failure.
- Existing uncommitted SEO changes were preserved and included in validation. This task does not itself commit, push, deploy, or suspend Render jobs.
