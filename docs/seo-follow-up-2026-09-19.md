# SEO follow-up — September 19, 2026

## Scope and baseline

This continues the September 16 crawl investigation. It does not treat all
Search Console exclusions as errors or expose private/thin pages to increase a
URL count. No database migration, provider crawl, paid service, or new worker is
part of this change.

The supplied Search Console screenshots are historical, not a fresh export.
They reported 52,022 discovered-not-indexed URLs, 662 crawled-not-indexed URLs,
261 Google-selected alternate canonicals, and 4 indexing-report server errors.
The separate crawl-request table had 91 examples; these are different metrics.

Read-only production baseline, release `42edfba27cb2`:

- The existing public SEO verifier passed 8 child sitemaps, 71,209 distinct
  URLs and 24 sampled HTML pages across 8 sitemap classes. Sampling did not
  establish that every URL was healthy.
- The catalog verifier passed 23 bounded requests, including 8 stratified event
  samples from 49,514 event URLs, 48 collection links and 3 later directory pages.
- `/artist/drake` was indexable with its clean canonical, but
  `/artist/drake?utm_source=google` returned `noindex` without a canonical.
  The homepage with `gclid` had the same defect.
- `/cities/` returned 404 although `/cities` was a valid collection.
- The clean Russ page was itself `noindex`; attribution handling must not
  promote a page that fails the existing content/identity policy.
- The latest observed September 19 request 502s clustered around Render
  deployment transitions. No 500/502/503/504 request entries were returned for
  18:47 UTC through September 20 01:05 UTC, after the previous release settled.
  This is an observed window, not a guarantee of continuous availability.

## Changes

### Canonical identity and browser navigation

A shared, bounded allowlist recognizes attribution-only query parameters
(`utm_*` known fields and common click IDs). Server HTML and client metadata use
the clean page's existing policy and canonical. Unknown, functional or
credential-bearing queries remain `noindex`, without canonical promotion;
functional HTML remains `no-store`.

Hydrating the same public page no longer erases its query before the metadata
controller evaluates it. Actual navigation still changes the URL, Back restores
the correct entry, and consumed account-action tokens retain their separate
cleanup. Query values are not copied into history state or page-head API calls.

Concert keys are rebuilt from the resolved archive identity, eliminating
self-canonical duplicates caused by legacy city fields or alternate JSON/base64
encodings. Aliases redirect only when the full target projection is public and
valid. Malformed, unknown, withdrawn or conflicting-location records remain 404.
City-collection case/trailing-slash aliases redirect to `/cities`.

### Sitemap and public-page agreement

- Qualifying city venue directories retain ongoing, bounded multi-day events
  until their effective end date, matching public HTML.
- Ordinary status mentions and restricted-profile reviews cannot make an empty
  artist page sitemap-eligible. Published, exact-identity memorial memories
  preserve their established exception.
- Invisible control characters cannot qualify an otherwise empty artist or
  member biography as substantive content.
- Existing, independently useful concert/rating evidence remains eligible even
  when its accompanying review text sanitizes to empty.
- Snapshot policy revision advances from 8 to 9 for one rebuild. Existing
  isolated generation, row limits, persistence and last-good-snapshot fallback
  remain in place. No per-visitor sitemap rebuild is introduced.

### More accurate venue and city documents

- An unknown event/concert venue URL is omitted from structured data instead of
  incorrectly pointing to the site's homepage.
- Authorized historical rows can preserve a venue's known address and validated
  coordinates after the last upcoming show. Exact provider identity, public
  visibility, artist holds and removal restrictions still apply. Conflicting
  current locations must not inherit old building coordinates.
- Venue calendars request just one extra row (normally 9, maximum 17) to label
  an eight-show preview honestly rather than presenting it as the total.
- City HTML includes existing venue show counts and capacity where known.
  Default city search titles use country when no region exists; editorial copy
  is not overwritten. There is no invented venue history or generated filler.

## Verification and release gates

Regression coverage includes attribution/functional/private queries, canonical
aliases and rejected targets, multi-day eligibility, public-author/memorial
boundaries, historical venue relocations, coordinate validity, bounded previews,
and city metadata. The public SEO verifier now checks tracking variants and
functional-query cache policy on every run.

Required release gates: complete test suite; syntax and architecture checks;
production dependency audit; budgeted Expo web export; desktop/mobile navigation
and authentication browser checks. After push, confirm the exact commit passes
GitHub checks and becomes Render's live release, then rerun public SEO, catalog,
and core verifiers and inspect post-settlement logs. Release observations are
reported separately so this source document does not claim a pending deploy is
already live.

Local results: all 5,293 automated tests passed under hosted settings after the
final location guard; all 72 targeted document/location tests passed. Navigation browser
checks passed 49/49 and authentication checks 60/60 against the final web export.
Initial JavaScript is 506.1 KiB gzip, within the existing 512 KiB budget.
Syntax, architecture and production dependency checks passed with zero reported
dependency vulnerabilities. CI repeats these gates on the pushed commit.

## Remaining limits and priorities

1. The persistent-disk web service cannot overlap old/new instances during a
   deployment. Removing that availability gap requires a separately planned
   stateless-web/database/storage migration, including restore validation and
   costs. This release does not change billing or weaken backup checks.
2. Google's indexing and selected canonical are decisions to measure after
   recrawling, not outcomes code can guarantee. Recheck the historical examples
   in URL Inspection and compare new 5xx occurrences with deployment times.
3. The two reviewed Rebel provider identities are consolidated in Discover
   presentation, not merged into one public guide in this release. A correct
   guide merge must retain both event inventories and exact reviewed identity;
   a name-only redirect could hide shows or merge the wrong venue.
4. Shared standalone-post quality rules still merit a separate review of
   control-only/online post text. This pass preserves the existing concert and
   rating policy rather than removing legitimate archive evidence.

## References

- [Google canonical consolidation](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google crawl-budget guidance](https://developers.google.com/crawling/docs/crawl-budget)
- [Render persistent-disk limitations](https://render.com/docs/disks#disk-limitations-and-considerations)
- [Exact Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/)
