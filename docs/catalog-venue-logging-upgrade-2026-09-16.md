# Catalogue, venue and logging upgrade — 2026-09-16

## What was actually slowing enrichment

Read-only production logs on September 16 showed the three-lane knowledge
worker repeatedly reporting `budgetPaused=true`, with no disk, memory or
provider pause. Its daily artist-attempt allowance was exhausted. The separate
artist-photo worker was active: the four passes ending at 21:13 UTC saved
78 photos. These are observed pass counts, not a claim that all artist pages
are complete.

Catch-up now has ten bounded logical lanes inside the existing web service.
It does not create ten Render instances or paid AI subscriptions. The daily
attempt ceiling is 10,000 instead of 3,000, while provider requests remain
capped at 12,000/day and globally spaced at least 1,100 ms apart. Existing
configured lower limits, durable counters, leases, cooldowns and the storage
growth baseline are preserved. Maintenance returns to one knowledge lane.
One pass still handles at most 40 artists over 45 seconds, every two minutes.

Validated partial identity/source results can survive a pass timeout in a
process-local, identity-keyed cache: 128 entries, 8 KiB per entry, fixed one-hour
expiry. Country-label cache entries are also bounded. Neither stores raw page
archives or member data. Restarting loses only this optional cache, not the
durable progress ledger. Interrupted work is resumed before fresh work in its
priority group, reducing repeated provider calls.

## Artist and venue photos

Artist photos keep the existing 20-per-pass / 15-minute default (maximum 40),
with a 3:1 Discover-priority / ordinary-catalogue selection. The ordinary cursor
is not advanced by priority picks. A provider response can update only its photo
fields after re-reading current identity and editorial state; it cannot restore
a deleted artist or overwrite a newer photo, biography or staff edit.

Venue photos now have an automatic background path using verified Commons
images and the existing public R2 media destination. Limits are fixed:

| Resource | Limit |
| --- | --- |
| Candidate checks | 3 per pass, 100 per UTC day |
| Cadence / pass deadline | 15 minutes / 45 seconds |
| Mirrored output | 1 MiB per photo |
| Image writes | 20 MiB/day, 256 MiB lifetime reservation ceiling |
| Metadata ledger | 20,000 venues |

Each upload reserves space before writing. Verified success settles unused
reserved bytes; uncertain writes remain charged. No source image archive is
kept on the Render disk. Memory, disk headroom, cancellation and the shared
Pause upkeep control are checked before publication. Commons response size,
rate-limit cooldown and retry hints are bounded. Identity, city, source host,
architecture relevance and a supported licence are required; an unavailable
or ambiguous source does not become invented venue information.

The worker uses `VENUE_PHOTO_ENRICHMENT_ENABLED` when explicitly set; otherwise
it follows the existing explicit `ARTIST_KNOWLEDGE_ENABLED` opt-in. An explicit
disabled value remains disabled. Public media storage must already be configured;
this change does not create buckets, credentials or paid services. Bundled photos
and rights-removal records remain authoritative. Runtime revocation is durable.
Photo identity reads have a targeted index and are revalidated if venue facts
change.

Moderation → Catalogue upkeep now reports knowledge lanes, budget reset time,
artist-photo pass counts and venue-photo progress/storage reservations separately.
Status reads do not create schema and fail safely when optional state is absent.
Pausing upkeep stops subsequent fetches and publication across these workers.

## Venue discovery and duplicates

The explorer has clearer city and venue steps, a filter shared by map and list,
nearby selected-venue details, truthful unmapped counts and map-to-row scrolling.
REBEL's two provider IDs represent the same Toronto room and are grouped for
discovery, preserving both sets of shows in a local Show all / Show fewer
preview with their original event links. NOIR remains separate. This is a
presentation identity correction, not a destructive database merge or blanket
canonical redirect of every provider URL.

## Shorter logging with honest unknowns

Date, tour, address and detailed scores can remain unknown. One experience
rating is the initial path; extra ratings/details are disclosures. A remembered
city can stand in for a forgotten venue. Draft restoration preserves those
choices, people tags and input through mode changes and failed submissions.
Published score summaries omit unscored categories and average only the scored
night dimensions. An experience-only 5 is no longer displayed as 2.5 with false
Band/Room zeros.

A review still needs an artist, a venue or city, and one rating. Unrated memories
use Share; incomplete work can be saved as a draft. No guessed dates or ratings
are inserted just to satisfy validation.

## SEO, cost and remaining boundaries

Verified venue photos are available to public venue HTML/schema/API reads after
publication. The existing successful sitemap rebuild (normally every 15 minutes)
can then include them; a persisted last-known-good sitemap can temporarily lag.
Google's crawl/index decisions remain external and are not reported as completed
by these workers. Existing source and identity gaps can still leave pages empty.

This release adds no paid service and does not change Render plans or provider
subscriptions. Actual usage charges still depend on the account's allowances;
it is not a guarantee of a particular monthly bill. The previously unconfigured
private off-host database backup is separate and is not repaired by public-photo
storage.

## Verification

- Final full isolated suite: 5,143 tests passed, including cancellation,
  concurrent edits, identity checks and optional logging details.
- Production web build: 510.9 KiB initial gzip JavaScript, below the unchanged
  512 KiB ceiling. No dependency additions; production audit: zero vulnerabilities.
- Discover browser scenarios at 320/375/1280 px; quick-log scenarios at
  375/1280 px; existing location flow at 390/1280 px.
- Moderation browser scenarios: eight passed at 390/1280 px, including retries
  and permission loss. Quick-log browser regressions now run in the existing CI
  release gate as well as locally.
- Browser fixtures never post to real accounts. Fixture-only map-key exports
  live under `.tmp` and are not deployed.

Provider guidance: [MediaWiki API etiquette](https://www.mediawiki.org/wiki/API:Etiquette),
[image metadata](https://www.mediawiki.org/wiki/API:Imageinfo), and
[Wikidata data access](https://www.wikidata.org/wiki/Wikidata:Data_access/en).
