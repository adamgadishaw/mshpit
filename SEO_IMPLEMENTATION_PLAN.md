# Mshpit SEO Implementation Plan

> **Planning gate:** This file was written before any production SEO implementation change. It records the approved architecture, current evidence, privacy boundaries, eligibility rules, migration order, and release tests. Implementation must not begin until this plan is reviewed.

## 1. Outcome and operating principles

The goal is to make Mshpit's real public value discoverable: artists, individual ticketed events, historical concerts, fan reviews, verified photos and videos, venues, and qualified city discovery. The work must improve crawlability without producing thin pages, leaking private activity, inventing facts, or creating competing canonical identities.

The system will follow these principles:

1. One durable canonical URL per public entity.
2. Server-rendered, useful HTML with ordinary crawlable anchors; JavaScript is enhancement, not the only content source.
3. Index only pages with meaningful, visible, current content.
4. Structured data must describe exactly what a signed-out visitor can see.
5. Reviews, ratings, setlists, media, and attendance must come from real eligible records, never generated filler.
6. User media appears only after verification and under the applicable publication/gallery consent.
7. Privacy takes precedence over page count. Attendee identities are never exposed for SEO.
8. Sitemaps advertise canonical, indexable URLs only and are generated outside the request path.
9. No work in this plan guarantees first-page placement. It creates the technical and content foundation Google requires.

## 2. Audited baseline before implementation

The read-only audit used `server/data/pit.db` on August 26, 2026. The database was 20.9 MB with 69 tables and was migration-stale relative to the working tree.

| Dataset | Exact local baseline |
| --- | ---: |
| Artists | 2,658 |
| Artists with public slug | 2,658 |
| Artists with MusicBrainz ID | 2,658 |
| Artists with a photo | 2,063 |
| Artists with biography of at least 80 characters | 63 |
| Approximate currently qualified artist pages | 101 |
| Tour dates | 1,230 |
| Valid upcoming tour dates | 244 |
| Valid past tour dates | 986 |
| Tour dates with ticket URL | 1,230 |
| Distinct tour-date artist names | 686 |
| Distinct tour-date venue names | 377 |
| Distinct free-form places | 194 |
| Catalog artists with a future date | 43 |
| Posts | 24 |
| Active/public posts | 21 |
| Posts with review text of at least 40 characters | 0 |
| Posts with `photos_public=1` | 12 |
| `post_media` rows | 1 |
| Ready media assets | 0 |
| Verified media variants | 1 |
| Legacy photo references | 6 |
| Comments / eligible public comments | 6 / 5 |
| Active profiles | 28 |
| Profiles with biography of at least 60 characters | 0 |
| Approximate currently qualified profile pages | 1 |
| Historical concert-page candidates | 0 |
| `going` rows / distinct people / concert keys | 2 / 2 / 2 |
| Posts with a nonempty setlist / songs | 1 / 2 |
| Posts with a tour label / distinct labels | 0 / 0 |
| Venue reviews | 1 |
| Venue reviews with at least 40 characters or photos | 0 |
| Artist-owned profiles / artist posts | 0 / 0 |
| Published memorials | 0 |

The split seed catalog contains 1,633 artists, 1,008 venues, 71 shows, and 156 tour dates. Seed counts are not evidence that every row deserves a search landing page.

### Baseline performance evidence

On the local dataset, 20-run read-only SQLite benchmarks measured:

| Query | p50 | p95 | Observed plan problem |
| --- | ---: | ---: | --- |
| Artist/tour update aggregate | 510 ms | 521 ms | Artist scan plus repeated `idx_tourdates_visibility` lookup |
| Artist directory eligibility | 499 ms | 502 ms | Correlated tour-date lookup for each ranked artist |
| Upcoming events | 0.281 ms | 0.300 ms | Visibility index plus temporary sort |
| Artist-by-name resolution | 0.362 ms | 0.419 ms | Covering index scan and temporary sort |

`LOWER(TRIM(td.artist))=LOWER(TRIM(a.name))` does not match the existing `LOWER(artist)` index. The current sitemap snapshot also repeats the all-post/media candidate work across posts, profiles, artists, concerts, and venues.

### Migration gap found by the audit

The local database does not yet contain the current code's `tour_dates` provider identity, structured venue, status, or local/absolute time columns, and does not contain `users.profile_updated_at`. Its `post_media` table still permits positions 0 through 7 rather than 0 through 19. The release sequence must prove migrations against a production-shaped copy before any sitemap is submitted.

## 3. Canonical public information architecture

### Existing canonical leaf routes to preserve

| Canonical route | Meaning | Rule |
| --- | --- | --- |
| `/artist/:publicSlug` | One catalog artist | Immutable public slug; redirect legacy vanity aliases once |
| `/event/:id` | One scheduled/provider performance | Preserve provider/owner event identity |
| `/concert/:archiveKey` | One historical artist + venue + date archive | Preserve the existing normalized archive key |
| `/post/:id` | One fan post or concert review | The source UGC document |
| `/venue/:slug` | One durable venue identity | Prefer provider-scoped slug; allow name-only only when unambiguous |
| `/u/:handle` | One opted-in member profile | Respect profile search-indexing preference |

There will be **no competing `/show/:id` canonical**. Legacy `/show` references, if accepted at all, must 301 to `/post/:id` or the appropriate existing canonical and must never appear in metadata, anchors, schema, or sitemaps.

### New qualified discovery routes

Use deterministic path pagination rather than crawlable arbitrary query combinations:

- `/artists` and `/artists/page/:page`
- `/events` and `/events/page/:page`
- `/venues` and `/venues/page/:page`
- `/venues/:countryCode/:citySlug` and `/venues/:countryCode/:citySlug/page/:page`
- `/concerts` and `/concerts/page/:page`
- `/concerts/:countryCode/:citySlug` and `/concerts/:countryCode/:citySlug/page/:page`

Page 1 is always the clean collection URL. A request for `/page/1`, an empty page, an out-of-range page, or a malformed page number redirects or fails closed; it must not create another indexable URL.

City identity may be created **only** from a validated structured `venue_city` plus ISO country code. `place`, `posts.city`, IP location, user home city, or comma-splitting is not sufficient evidence for a canonical city page. Region may disambiguate display, but country code and normalized city are the stable key.

### Bounded artist show experience

The main artist page remains concise:

- up to 3 upcoming events;
- up to 3 highest-quality historical concerts, ranked by distinct eligible raters, valid average rating, review depth, verified media, and recency as deterministic tie-breakers;
- up to 3 top fan reviews;
- an ordinary anchor to the full archive when more exists.

The full archive uses `/artist/:publicSlug/concerts` and `/artist/:publicSlug/concerts/page/:page`, with a stable sort and 12 concerts per page. It links back to the artist and each `/concert/:archiveKey`. It does not duplicate concert-page review bodies beyond short excerpts.

## 4. Indexability and `noindex` policy

All eligibility checks must be shared by document resolution, directory queries, internal links, and sitemap generation. A route that fails eligibility may remain usable inside the app, but its server document must be `noindex` or return 404/410 as appropriate and must not enter a sitemap.

### Global requirements

An indexable entity must:

- resolve to one self-canonical URL;
- be visible to a signed-out visitor;
- have an active, non-banned, non-suspended owner where an owner exists;
- not be removed, private, unreleased, or search-opted-out;
- contain meaningful visible content under the thresholds below;
- avoid unverified or legacy raw media URLs;
- render a useful title, description, heading, body, and ordinary internal links;
- return 200 without depending on client-side rendering.

### Entity-specific thresholds

| Page | Indexable when |
| --- | --- |
| Home/trust pages | Approved static public document |
| Discover | At least one eligible artist, event, or review and a substantive server-rendered hub |
| Search | Always `noindex,follow`; never in sitemap |
| Artist | Published identity-bound memorial, biography >=80 normalized characters, eligible fan review/verified gallery media, upcoming event, or eligible historical concert |
| Event | Released public event with valid artist, venue, and strict calendar date; provider row must be active unless it is a durable historical record |
| Concert archive | Past valid date plus at least one eligible review, verified public/gallery media item, or valid 1-to-5 rating from an eligible distinct person |
| Post | Eligible owner plus review/body >=40 normalized characters or at least one verified public attachment |
| Member profile | Active account, search indexing not opted out, plus biography >=60 normalized characters or eligible public post/gallery evidence |
| Venue | Durable provider venue identity, or one unambiguous structured venue identity, plus an eligible event, review, concert, or verified gallery item |
| Artist archive page | Artist is indexable and the page contains at least one eligible concert in its requested page window |
| City concert directory | Structured city/country identity plus at least 3 eligible public events/concerts across at least 2 venues |
| City venue directory | Structured city/country identity plus at least 2 eligible venues and at least 3 total eligible event/concert/review items |
| Pagination page | Valid page number, nonempty unique rows, and an ordinary anchor path from the preceding collection page |

Thresholds are minimum publication gates, not ranking claims. They must be constants in one policy module and tested at `threshold-1`, `threshold`, and `threshold+1`.

## 5. Reviews, ratings, media, setlists, tours, and attendance

### Reviews and ratings

- Only unremoved reviews by active accounts count.
- A review excerpt shown in schema must be visible in HTML.
- Ratings outside 1 through 5 are ignored.
- One person contributes at most one rating to a concert; the latest valid rating wins. A newer invalid legacy value cannot erase an earlier valid rating.
- `AggregateRating` appears only when `ratingCount >= 1`, the average is within 1 through 5, and the reviewed Event is fully represented on the page.
- Artist pages must not claim an artist `AggregateRating`; Google does not support generic artist ratings as a review-snippet target.
- Venue reviews can contribute visible venue content after they meet the same account, removal, text/media, and consent rules. They do not create a separate review URL until a durable review identity and moderation contract exists.

### Verified media

- Standalone post pages may show attachments published with that post.
- Artist, member, venue, city, and concert galleries additionally require the applicable gallery/public consent.
- Only verified stable derivatives with a live storage ledger are crawlable or emitted in image/video sitemaps and JSON-LD.
- Legacy raw URLs, private source objects, incomplete video posters, failed variants, and unsupported external URLs stay out.
- Sitemap and `VideoObject` thumbnails must use the same stable poster URL.
- Alt text/captions must come from user-visible content or approved descriptive metadata, not invented keyword text.

### Setlists

Current setlists are JSON arrays on posts. Phase one renders eligible setlists visibly on their existing `/post/:id` and `/concert/:archiveKey` pages with ordered songs. A concert setlist merges only after deterministic agreement/provenance rules are defined; conflicting fan submissions remain attributed rather than silently combined.

No standalone setlist page is indexable until songs, order, concert identity, provenance, and moderation have normalized storage and sufficient content.

### Tours

Current `posts.tour` is a free-form string and is not a canonical identity. Tour pages require a normalized tour entity linked to one artist and at least two distinct eligible events or historical concerts. Until that migration exists, tour text may be visible but cannot generate a canonical route, sitemap URL, or `EventSeries` claim.

### Attendance privacy

`going` identities never appear in crawler HTML or schema. An aggregate attendance count may be displayed only when:

- it includes at least 5 distinct eligible active accounts;
- blocked, banned, suspended, deleted, and private records are excluded;
- the visible HTML and schema show the same aggregate;
- no attendee list, profile link, or small-cell subtraction can reveal membership.

Counts below 5 are omitted, not displayed as zero. Attendance must not influence indexability by itself.

## 6. Structured data and visible-data parity

### Site and collections

- Home: `WebSite` and `Organization` with verified logo/contact details.
- Directories and city hubs: `CollectionPage` with a bounded `ItemList` matching visible anchors.
- Every hierarchy with at least two meaningful levels: `BreadcrumbList` matching visible navigation.
- Profiles: `ProfilePage` with a visible `Person` main entity and the member's indexing preference enforced.
- Posts: `DiscussionForumPosting`/`SocialMediaPosting`, visible author/date/text/media/comments, and no hidden comment or reaction counts.

### Artists

Add a catalog `artist_type` only from an authoritative classification:

- solo person -> `Person`;
- band/ensemble -> `MusicGroup` or `PerformingGroup` as appropriate;
- unknown -> conservative `Thing`.

Do not infer type from a name. Preserve MusicBrainz/official identity links only when identity-bound.

### Events and historical concerts

Google Event rich-result markup is stricter than page indexability. Emit `MusicEvent` only when all required facts are visible and validated:

- unique `/event/:id` or `/concert/:archiveKey` URL;
- descriptive name;
- ISO 8601 DateTime with time and appropriate offset/timezone;
- venue name and detailed `PostalAddress` from structured provider data;
- visible performer linked to the canonical artist when identity is known;
- accurate status;
- visible ticket Offer only when still purchasable;
- crawlable relevant image when one is available.

Date-only or address-incomplete events remain useful indexable WebPages but do not make an incomplete Google Event rich-result claim. Never invent price, currency, organizer, end time, address, or performer type.

Historical concerts may carry real `Review` and `AggregateRating` nodes only when an address-backed Event entity exists. Otherwise reviews remain visible forum/community content without a misleading rich-result claim.

### Escaping and security

Continue JSON serialization that escapes `<`, `>`, `&`, U+2028, and U+2029. All HTML attributes and visible text remain escaped. Add adversarial parity fixtures for `</script>`, quotes, Unicode separators, invalid URLs, and deeply nested comments.

## 7. Database and provider migration sequence

1. Take and verify a production SQLite backup using the repository backup workflow.
2. Run schema migration against a disposable production-shaped copy.
3. Verify `post_media` capacity 0 through 19 and all additive tour/profile columns.
4. Add a canonical `tour_dates.artist_key` foreign identity where the provider record resolves confidently to `artists.norm`; retain the display artist string.
5. As an interim/query-proof measure, add the exact deterministic expression index required by any remaining `LOWER(TRIM(...))` lookup. The query-plan test must name that index. The long-term query uses `artist_key` and avoids expression joins.
6. Add/index structured city identity: normalized `venue_city`, ISO `venue_country_code`, provider venue identity, date, visibility, and stable id.
7. Backfill provider identity, status, absolute/local time, timezone, and detailed venue address from authoritative provider payloads.
8. Do not derive structured city/country from free-form `place` or old `posts.city`.
9. Backfill in bounded, resumable, idempotent batches with checkpoints and dry-run counts.
10. Record unmatched/ambiguous artists and venues for review; do not guess.
11. Re-run integrity, foreign-key, uniqueness, visibility, and rollback/forward-compatibility checks.
12. Build a sitemap snapshot from the migrated copy and compare counts to source eligibility queries before production rollout.

Required backfill metrics include scanned, updated, unchanged, ambiguous, invalid date, missing address, missing timezone, missing artist identity, and failed rows. Logs must not include private user content or signed provider URLs.

## 8. Sitemap architecture

### Last-known-good asynchronous snapshots

Replace synchronous request-time rebuilding with a dedicated snapshot service:

1. Load the last-known-good snapshot at process start.
2. Serve it immediately for `/sitemap.xml` and shard requests.
3. Start refresh asynchronously after readiness and on a bounded schedule/revision signal.
4. Build a new snapshot in isolation from one consistent database read view.
5. Validate XML, canonical origin, unique URLs, byte counts, URL counts, and representative page indexability.
6. Atomically swap only after every dataset passes.
7. On failure, retain the prior snapshot, emit a sanitized health event, and retry with backoff.
8. Never return a partial index, block a crawler request on a full rebuild, or replace good data with an empty/error snapshot.

The snapshot may be persisted under the configured data directory so a restart has a last-known-good artifact. Write to a uniquely named temporary file, validate it, then atomically rename it. The persisted format must contain no user secrets or raw private fields.

### Dataset generation

- Materialize each base eligibility dataset once per snapshot.
- Reuse the post/media projection across post, profile, artist, concert, venue, and city maps.
- Remove both hidden 10,000-row venue candidate limits.
- Read large datasets with deterministic keyset pagination, not `OFFSET` and not an unbounded in-memory query.
- Continue 50,000 URL and 50 MiB uncompressed shard ceilings.
- Index only actual shards and canonical URLs.
- Keep deterministic ordering so unchanged data produces byte-identical XML.
- Retain accurate source-derived `lastmod`; never stamp generation time as content modification.
- Retain bounded negative-shard caching and crawler-file rate limiting.
- Provide snapshot age, generation duration, row counts, shard counts, failure count, and last success as health metrics.

### Query-plan proof

CI must run `EXPLAIN QUERY PLAN` on production-shaped fixtures and fail when:

- artist/tour association scans both full tables;
- canonical artist slug lookup misses its dedicated index;
- provider venue lookup misses its identity index;
- city/date visibility lookup misses its structured composite index;
- post/concert eligibility loses its partial indexes;
- a correlated per-artist tour scan returns.

Set an explicit snapshot performance budget on a scale fixture, including maximum SQL statement count and wall time. The budget must be based on production capacity testing, not the current 24-post database.

## 9. Ordinary internal-link graph

Every public page must be reachable through normal `<a href>` links without interaction handlers:

- Home -> Discover, Artists, Events, Venues, Concerts.
- Discover -> qualified artist, event, venue, concert, and review leaves.
- Directories -> entity leaves and next/previous path pages.
- City concert hub -> event leaves, historical concert leaves, city venue hub.
- City venue hub -> venue leaves and city concert hub.
- Artist -> upcoming events, top historical concerts, fan reviews, bounded archive.
- Event -> artist, venue, city concert hub, related eligible fan posts.
- Concert -> artist, venue, city hub, source review posts.
- Venue -> city hub, upcoming events, historical concerts, eligible venue reviews.
- Post -> author, artist, venue/event/concert when identity is known.
- Profile -> eligible public posts only.

Do not add crawler-only hidden links. The server-rendered link and the visible interactive destination must agree.

## 10. Implementation phases

### Phase 0 — migration and measurement gate

- Production-copy migration smoke.
- Provider completeness report.
- Canonical route inventory and redirect test.
- Query-plan baseline and scale fixture.
- No Search Console submission yet.

### Phase 1 — correctness and performance

- Shared eligibility policy.
- Canonical `tour_dates.artist_key` and structured city indexes.
- Remove venue 10,000-row truncation.
- Strict date/DateTime validation.
- Async last-known-good sitemap service.
- Sitemap health metrics and runbook.

### Phase 2 — crawl graph and pagination

- Paginated Artists and Events.
- Qualified Venues and Concerts directories.
- Structured city hubs.
- Bounded artist concert archive.
- Ordinary anchors and breadcrumbs.

### Phase 3 — content depth

- Venue reviews in venue documents.
- Visible attributed setlists on post/concert pages.
- Verified media galleries with consent parity.
- Privacy-thresholded attendance aggregates.
- Artist type classification and performer schema.

### Phase 4 — tours only after normalization

- Canonical tour entity and membership migration.
- Qualified tour page eligibility.
- Optional `EventSeries` only when visible data supports it.

## 11. Required test matrix

### Migration and rollback

- Start from the audited pre-column schema and migrate successfully.
- Preserve row counts and foreign keys.
- Migrate `post_media` positions 0 through 19.
- Re-run migration idempotently.
- Exercise every SEO document and sitemap dataset after migration.
- Prove an older compatible process fails safely or ignores additive data as documented.

### Eligibility and privacy

- Threshold-1/threshold/threshold+1 for every page type.
- Banned, suspended, deleted, removed, private, unreleased, and opted-out rows never appear.
- Verified media included; raw/private/failed media excluded.
- Gallery opt-out affects aggregate galleries but not the authorized standalone post.
- Attendance at 4 is omitted; attendance at 5 is aggregate-only; no identities leak.
- Zero-only, null-only, and invalid-only ratings emit no `Review` or `AggregateRating`.
- Latest valid rating per person wins.

### Canonical routes and pagination

- `/event`, `/concert`, and `/post` remain distinct and stable.
- No generated `/show` canonical or sitemap URL.
- Legacy aliases perform one 301 to the final canonical.
- Page 1 canonicalizes to the clean directory.
- Pagination has no gaps or duplicates under stable fixture data.
- Empty/out-of-range pages are noindex 404 or canonical redirect, never soft 200 duplicates.
- Every sitemap leaf is reachable by at least one ordinary anchor in the qualified graph or an explicitly documented sitemap-only exception.

### City and venue identity

- Only structured city + ISO country creates city routes.
- Same city name in different countries produces different canonicals.
- Ambiguous name-only venues fail closed.
- Provider venue identity remains stable through display-name changes.
- Free-form `place` cannot populate a canonical city.

### Structured data and metadata

- Visible-data parity for every JSON-LD property.
- Event fixture with complete address, offset DateTime, status, performer, image, and valid Offer.
- Address/time-incomplete event emits WebPage but no incomplete `MusicEvent`.
- Invalid months, days, leap dates, timezones, and offsets fail closed.
- Cancelled/postponed/rescheduled behavior follows provider evidence; no purchasable Offer when inappropriate.
- Self-canonical, unique title/description, OG, Twitter, image dimensions/types, and breadcrumb consistency.
- JSON-LD injection fixtures including `</script>`, ampersands, angle brackets, quotes, U+2028, and U+2029.
- Rich Results Test fixtures for Event, ProfilePage, Breadcrumb, DiscussionForumPosting, VideoObject, and eligible Event Review markup.

### Sitemap and scale

- 50,000 URL boundary and 50 MiB uncompressed boundary.
- More than 10,000 venues retains the first and last eligible identities.
- At least 50,000 artists, events, posts, and media associations under the agreed statement-count/time budget.
- Deterministic shards and no duplicate canonical URLs across datasets.
- Snapshot refresh occurs off-request.
- Failed refresh serves the previous last-known-good snapshot.
- Empty accidental refresh cannot replace a nonempty good snapshot.
- Atomic persistence survives process interruption.
- Stale-age alert and recovery test.
- `EXPLAIN QUERY PLAN` assertions name the intended artist, venue, city, visibility, and post indexes.

### Live release verification

- Production host redirect resolves in one hop.
- `robots.txt` is production-safe and advertises the canonical sitemap index.
- Every nonempty sitemap class contributes a sampled 200, self-canonical, indexable, semantic HTML page.
- No sitemap sample is a JavaScript-only shell.
- Search and app-only screens remain noindex.
- Media URLs sampled from sitemap/schema are anonymously fetchable and stable.

## 12. Google and Schema.org release checklist

Use primary documentation as the acceptance source:

- [Google sitemap construction and 50,000 URL / 50 MiB limits](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google canonicalization guidance](https://developers.google.com/search/docs/crawling-indexing/canonicalization)
- [Google JavaScript SEO and server HTML guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google robots.txt specification](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec)
- [Google general structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Google Event structured data](https://developers.google.com/search/docs/appearance/structured-data/event)
- [Google Review and AggregateRating eligibility](https://developers.google.com/search/docs/appearance/structured-data/review-snippet)
- [Google ProfilePage structured data](https://developers.google.com/search/docs/appearance/structured-data/profile-page)
- [Google discussion-forum and social-post structured data](https://developers.google.com/search/docs/appearance/structured-data/discussion-forum)
- [Google video structured data and thumbnail consistency](https://developers.google.com/search/docs/appearance/structured-data/video)
- [Google Breadcrumb structured data](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)
- [Schema.org MusicEvent](https://schema.org/MusicEvent)
- [Schema.org MusicVenue](https://schema.org/MusicVenue)
- [Schema.org AggregateRating](https://schema.org/AggregateRating)

Before Search Console submission:

1. Run the repository SEO verifier against production.
2. Validate representative types in Rich Results Test.
3. Inspect rendered HTML and a live URL in Search Console.
4. Confirm canonical host, robots, sitemap index, child maps, status codes, and cache headers.
5. Submit the sitemap index once.
6. Monitor Page Indexing, Crawl Stats, Core Web Vitals, structured-data reports, and query/page performance.
7. Compare indexed pages to eligible source counts; investigate spikes and drops rather than increasing page volume blindly.

## 13. Observability and operating ownership

Expose sanitized health facts to administrators and the founder health digest:

- last successful sitemap build and age;
- current snapshot URL/shard counts by class;
- generation duration and SQL statement count;
- last failure code, without raw content or URLs containing secrets;
- eligible vs excluded counts by reason;
- provider address/time completeness;
- canonical redirect and 404 rates;
- Google verifier result and last run time.

Alert when no last-known-good snapshot exists, snapshot age exceeds the agreed maximum, eligible counts fall unexpectedly, a dataset becomes empty, generation exceeds its budget, or sampled public URLs cease returning semantic 200 HTML.

## 14. Explicitly rejected ideas

- **No guaranteed first-page promise.** Search placement is earned and controlled by Google.
- **No `/show` canonical.** It would compete with `/post`, `/event`, and `/concert` identities.
- **No indexable internal search or arbitrary filters.** `/search` stays `noindex,follow`.
- **No page for every database row.** Thin artists, cities, venues, tours, profiles, and pagination remain excluded.
- **No city inference from free-form text.** Only structured `venue_city` plus ISO country qualifies.
- **No attendee names or small aggregates.** Attendance is aggregate-only at the privacy threshold.
- **No artist star schema.** Ratings remain attached to actual concerts/events.
- **No invented performer type, organizer, ticket price, address, time, tour, or setlist consensus.**
- **No unverified legacy media in public SEO.**
- **No crawler-only hidden link farm.** Use the same visible ordinary anchors people use.
- **No synchronous full sitemap build in a crawler request.** Serve last-known-good while refreshing asynchronously.
- **No fixed 10,000-row completeness cap.** Use deterministic keyset reads and real sharding.
- **No implementation before this plan and its migration/test gates are reviewed.**

## 15. Definition of done

The SEO implementation is ready to ship only when:

- the production-shaped migration and provider backfill are verified;
- all canonical route and eligibility tests pass;
- directories and city hubs form a crawlable, non-thin anchor graph;
- artist pages remain bounded and link to paginated archives;
- structured data matches visible facts and representative Rich Results tests pass;
- sitemap generation is asynchronous, deterministic, complete beyond 10,000 venues, and serves a last-known-good snapshot on failure;
- query-plan and scale budgets pass;
- privacy tests prove no restricted media, profiles, comments, reviews, or attendee identities leak;
- the live SEO verifier passes on the canonical production host;
- Search Console submission and monitoring ownership are documented.