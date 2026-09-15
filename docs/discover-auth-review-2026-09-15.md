# Discover and returning-account review — September 15, 2026

This is a dated implementation/verification record, not a claim of production deployment.

## Returning-account navigation

The saved account theme can require a document reload. It previously ran from the session effect while contextual sign-in was still navigating Back, reopening the credential page. Theme reconciliation now waits for confirmed identity and a settled destination. Confirmed members entering login/signup, including browser Forward, recover to the signed-in destination rather than another credential form.

A concert discussion's public presentation choice survives the reload through an allowlisted history enum. No post content, drafts, credentials, or account data are persisted by this hint; the current URL identifies the post and the application reads it again with current permissions.

## Discover

- Venues now combines city/venue search, numbered map pins, an equivalent selectable venue list, selected-room dates, and a city calendar. The directory remains available.
- The existing memoized public venue index is reused in a bounded linear pass; there are no provider requests per venue or per click. Dates are described as currently loaded listings, not fabricated popularity.
- Complete place/provider identity prevents same-name rooms in different cities from sharing concerts. Null/blank/corrupt coordinates remain missing instead of becoming a Gulf of Guinea pin.
- Maps reuse the configured static-map provider. Selecting an existing pin does not require a new provider query. Attribution remains visible. A failed/unconfigured basemap produces an explicitly labeled location plot and keeps the venue list functional; no decorative street map is passed off as geographic evidence.
- Photos now reads a dedicated bounded gallery, not the member-only feed. It honors consent, account audience/restrictions, blocks, mutes, reports and verified owned media. Private originals are never gallery fallbacks. Worldwide has no inherited nearby-event city filter.
- Loading, failed/retry and confirmed-empty photo states are distinct; late account/country responses cannot repaint another scope.

## Catalog upkeep

The existing source-backed artist worker is not an LLM editor. This release fixes stale success reporting when work pauses and exposes privacy-safe progress/cooldown/disk-pause evidence in protected health reporting and the daily digest. See [catalog automation audit](catalog-automation-audit-2026-09-15.md) for exact artist/venue/event coverage and remaining editorial gaps.

No paid AI, service, subscription, production credential, or storage destination was created or changed. Live worker progress/deployment still requires an authorized Render inspection. No claim is made that thousands of pages are now editorially complete.

## Verification

- Full automated suite: 4,801 passed.
- Exported-browser checks: 60 authentication, 39 navigation, 6 public-photo and 4 venue scenarios (mobile/desktop).
- Isolated real-server authentication: 12 passed, including concurrent authenticated reads and old-cookie rejection.
- Dependency audit: zero reported vulnerabilities. Syntax, architecture and patch checks passed.
- Exported initial JavaScript remains within the 512 KiB compressed budget (508.8 KiB).
- Venue visuals inspected at mobile and desktop widths; compact map/list spacing and selected-control accessibility are asserted in browser tests.
- Both Discover browser suites are now part of the required Quality workflow. Browser fixtures use only synthetic records and intercepted maps; these tests are not a production load test or live map-provider availability proof.
