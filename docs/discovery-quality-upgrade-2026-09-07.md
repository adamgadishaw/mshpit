# Discovery and reliability upgrade — 7 September 2026

## User-visible changes

- Discover has five focused sections: Shows, Artists, Venues, Cities and Photos. Area and date controls expand when needed; the existing destinations and concert artwork remain available.
- Photos and avatars no longer lose a working fallback when a duplicate or late image error arrives. Retry state is component-local, with no new persistent or cross-account cache.
- City discovery shows loading, empty and error states, with a retry and an awaited pull refresh. Changing sections cancels the previous refresh without reporting an intentional cancellation as a failure.
- Feed pages cannot replace a newer refresh's cursor, and a prior account's profile response cannot change the current account's cache. This includes access-denied responses, not only successes.
- Top-rated show country results look up the actual reviewed event identities. A newer event catalogue no longer displaces older shows' location records from that lookup.

## Verification

The full suite contains 3,204 tests. The release check includes dependency auditing, syntax, architecture and the exported web bundle. A second full run uses the hosted flags from `.github/workflows/quality.yml`, including `CACHE_WARM_ENABLED=false`, which previously caused the Render build failure. Tests own disposable databases; they do not use the production data directory.

Local browser checks exercise the exported app at 320, 390, 768 and 1,280 pixels in Stage and Daylight themes: all five sections, area/date selection, keyboard navigation and focus restoration, city failure/retry, and an empty city response. All requests are intercepted with synthetic fixtures. These checks do not claim an iOS-device or production-network test.

An additional 32 React Native Web layout renders found no horizontal overflow or broken/zero-sized fixture images. The first concert image moved upward by 410, 318, 409 and 277 pixels at those respective widths compared with the previous Discover screen. These are fixture layout measurements, not page-load timings.

## Reproducible server benchmark

Run `node scripts/benchmark-discover-shows.mjs`. It creates and removes its own temporary database with the application's schema: 50,000 events, 5,000 reviews, and ten countries. It never opens the site's database.

- Previous lookup: 20 database reads over ten countries. Older reviewed shows were absent when newer provider entries filled its 5,000-row window.
- Updated lookup: 2 reads, with all 100 reviewed shows found in their countries.
- Independent local repeat: 56 ms for the country sweep; later countries accounted for about 1.3 ms. Hardware and fixtures affect timings; this is not a production capacity estimate.

The shared snapshot contains public show aggregates only, not reviewer IDs or review text. Country switches do not extend its original 60-second deadline. Tests cover removed/inactive accounts, private dates, online-review exclusion, clock rollback, query failure, the existing indexes, and 5,000 distinct identities without exceeding SQLite's binding limit.

## Release boundaries

No schema migration, dependency upgrade, production-data write, provider-attribution change or persistent image cache was introduced. This record describes local verification; a successful Git push or CI run does not by itself confirm that Render has deployed the revision.
