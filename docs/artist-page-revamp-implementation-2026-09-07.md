# Artist page revamp — implementation notes

Implemented locally on September 7, 2026. The original brief records the baseline diagnosis; its old source line numbers are historical, not current navigation links.

## Page and data changes

- Compact photo/identity header and concert reputation, with Overview, Shows, Community, and About directly underneath. Desktop places imagery beside the summary; mobile uses a compact identity row. Existing themes, artist imagery, attribution, and gallery ownership are retained.
- Overview previews three upcoming shows, one top review, and three gallery items. Shows uses server pagination, all-location/country/city filters, explicit empty/error/coverage states, and accessible ticket rows. Community retains reviews, public media, updates, and existing actions. About contains biography, sourced facts, and the existing music catalog without enabling disabled playback.
- Artist schedules no longer depend on the 30-day global feed snapshot. Verified billed-artist identities include the Usher/Chris Brown joint attraction without replacing either artist's canonical identity. Existing authenticated profile reads continue to enqueue bounded refresh demand; empty results do not claim that an artist is not touring.
- A database-backed reputation is used across tabs and public SEO. Only eligible in-person ratings contribute, with newest-vote rules and current privacy/moderation/block checks. The count is labeled ratings, not written reviews. No viewer-specific aggregate is shared across account scopes or cached by a CDN.
- Birth, group formation, and career start are separate, validated, sourced facts. Ambiguous old `formed` values stay stored but are not presented as career starts. Staff corrections have audit history and optimistic concurrency; they survive enrichment but require re-review if canonical artist identity changes. Invalid chronology is rejected.
- Staff can edit these facts in the artist-page editor. Artist biography and media retain their existing editing controls. New schedule labels are centralized and override-capable; a moderation-backed editor for every navigation/status label is **not** included.
- Legacy profiles remain educational: no upcoming dates, live ratings, music playback, new photo/video uploads, or fan clubs. Failed status verification keeps live features unavailable rather than guessing.
- Provider failures retain partial results, preserve the strongest error, respect rate-limit backoff, and do not advance a partially fetched date window.
- The release audit fixed a past-show archive failure that could appear as empty history. Initial loads, refresh failures, successful empty responses, and unopened archives now stay distinct. Failed reads offer retry; pull-to-refresh includes visible past-show history, and shared archive screens project first-load pending state immediately.
- An additive schedule-revision table and six native SQLite triggers invalidate the shared billed-artist candidate index. Only event IDs are cached; current rows are still checked for release dates, blocking, account state, memorials, and provider visibility. Source/identity changes, other database connections, and transaction rollbacks are covered. Existing artist, venue, post, and event records are not rewritten by this schema addition.

## Verification

- Exported application exercised with local synthetic API fixtures at 320, 390, 768, and 1280 pixels. Tested Overview/Shows/Community/About, true second-page requests, location filtering, retry after a simulated 503, unchanged reputation across tabs/filters, keyboard navigation, and no horizontal overflow.
- Additional exported-app cases cover no dates, failed memorial/status verification, and protected legacy artists. No uncaught runtime errors in the seven completed scenarios. Browser images use an explicitly synthetic local photo fixture; they are not evidence of production artist-image coverage.
- The schedule component separately passed light/dark checks at all four widths, with no row overlap or clipping and action targets at least 44 pixels.
- Added a binding regression test after the full-app check caught an obsolete state setter left in an effect. The defect was removed before delivery.
- Release-audit `npm run check` passed: 3,280 tests passed, zero failures; production dependency audit reported zero vulnerabilities; syntax passed for 491 Node files; architecture passed without increasing existing budgets; production web export passed at 477.1 KiB initial JavaScript against the 512 KiB budget. `git diff --check` passed. Exported-app browser scenarios include archive failure/retry in addition to schedule failures.

### Large-catalog timing

An isolated in-memory fixture with 20,004 artists, 30,000 events, and 30 matching co-headline events measured roughly 389–430 ms per read for the initial scan-based implementation. The final indexed implementation measured about 1.3–1.6 ms for warm reads, with a 200–217 ms initial build and about 190–212 ms after an identity revision. These are local query timings, not production page-load or concurrent-traffic guarantees. Cold rebuilding remains synchronous.

The regression limits billing checks to matched candidates rather than every catalog event. Builds stream records and have explicit capacity limits; an oversized index fails visibly rather than silently dropping dates. Migration tests confirm that old-schema upgrades restore the revision safeguards and that another SQLite connection can invalidate them without registering application-specific SQL functions.

## Release limits

No production database was reset, seeded, backfilled, or migrated manually. No provider refresh was triggered against production. The release audit prepares this work for the existing master/checks-pass Render deployment. Deployment must retain the database backup and startup safety checks. Public production verification is read-only; staff editing still needs an authenticated post-deployment check. Deployment completion is reported separately after the matching commit is confirmed live.

Actual Safari/iOS and Android devices were not available for this verification. Browser tests used local Chromium with mobile/touch viewports; they do not prove native-device behavior or complete provider coverage.
