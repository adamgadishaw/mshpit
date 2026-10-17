# Native usability audit, 2026-10-15

Scope: the existing Windows Android development app (`com.mshpit.app.dev`, API 36 x86_64 emulator) on `codex/nearby-show-finder-20261015`. Owner session and current Stage theme retained. Production reads were guarded against posts, likes and reports. No website checkout, server, workflow, deployment, account setting or signing change.

## Reproduced defect and correction

Independent review executed the actual App.js native News effect in a synthetic VM: an unchanged News launch URL navigated twice across an authReady false/true cycle. A late initial result could also override a newer warm intent. This could unexpectedly pull the user away from another destination; the free-account boundary was not bypassed.

The native listener now remains subscribed while authentication settles. A ref retains a single initial read for this Root lifetime, buffers the latest valid News frame until ready, and clears it before navigation. Any newer native intent supersedes pending launch News, including account links handled by the existing account gateway. Cleanup prevents late unmounted navigation. Web does not subscribe. All navigation still passes through the existing member gate.

Eight actual-effect regressions cover initial replay, readiness transitions, latest warm News, account/unrelated-intent precedence, StrictMode effect replay, unmount, web and initial-read rejection. Independent read-only review found no blockers; its 19 focused tests and diff check passed.

## Actual running journeys

- Discover opened from Feed with populated Toronto events and Shows/Festivals/Artists/Venues/Cities/Photos navigation. No settled empty page or loop observed.
- Search opened Drake's artist profile. Biography, release artwork, upcoming show and explicit no-ratings state rendered. Vertical scrolling worked; Back returned Search.
- Discover Festivals opened the rendered ILESONIQ 2027 two-day edition through its actual card callback. Hero image, Montreal venue and August 7–8 dates rendered; lineup/review empty states were explicit. Scroll and Android Back restored Festivals.
- Discover Cities opened Toronto through its visible button. Hero/photos, upcoming-show and venue content rendered. Scroll and Back restored Cities.
- Near You opened from its Feed banner. The hierarchical North America/Canada/Ontario/Toronto picker completed without changing account home. At the sampled time All dates returned 151 shows / 50 venues at 75 km. Tonight returned 12 shows. A visible Event details button opened Ricky Nelson Remembered at the Avalon Theatre; absence of verified venue photos was explicitly stated. Android Back restored Tonight and 12 rows. All dates was restored before leaving.
- Signed-in News opened through FeedScreen's actual onOpenNews callback, rendered real stories and images, and Android Back returned Feed. NewsScreen has no RefreshControl; no News pull-to-refresh success is claimed. Feed's actual RefreshControl callback ran and returned a populated eight-row list. A physical horizontal swipe in suggested people remained on Feed; vertical detail scrolling above did not switch main tabs.
- Guest News access was tested with synthetic memberAccess fixtures, without signing the owner out. Native guests are directed to a free-account gate with a bounded read-only return; public web News remains accessible. No production mutation or signed-out owner test was performed.

Some immediate snapshots caught lazy screens before they painted; settled receipts were used. An early Coldplay attempt did not settle and is excluded. App.js hot refresh reset the navigation stack during the audit, so the final Near You detail/return journey was repeated after editing. The development build displayed a blue native `Refreshing...` overlay during captures although React screens remained interactive; these captures do not establish release behavior or physical-device performance. Historical emulator jank remains unresolved.

Screenshots and sanitized runtime receipts are retained in the Windows task folder: `usability-discover-entry.png`, `usability-drake-loaded.png`, `usability-festival-loaded.png`, `usability-toronto.png`, `usability-nearby-show-final.png`, `usability-nearby-return-final.png`, `usability-news-before-refresh.png`, and matching JSON receipts. The misleadingly named `usability-nearby-settled.png` captured Feed after hot refresh and is not evidence of show details.

## Website identity comparison

Read-only public source comparison, not an interactive browser audit: https://www.mshpit.com/artist/drake, https://www.mshpit.com/discover, https://www.mshpit.com/news and https://www.mshpit.com/festival/ile-soniq. Drake identity/upcoming-release information and ILESONIQ dates/venue agree with the sampled app. City web fetch was unavailable; no claim of web City render verification. No redesign or additional source labels were introduced.

## Validation

- Aggregate: 6,462 tests; 6,461 passed, one skipped, zero failed (117.9 s). Isolated test SQLite; no production mail or writes.
- Syntax: 857 Node files passed.
- Architecture: passed; unchanged legacy thresholds, 83 silent catches.
- Android Hermes export: 2,207 modules, 9.5 MB bundle, 36.9 s; no new native dependencies or APK rebuild required.
- `git diff --check` and independent focused review passed.

Logs: `.tmp/overnight/usability-full.log`, `usability-syntax.log`, `usability-architecture.log`, `usability-export.log`; export `.tmp/overnight/usability-android`. This JavaScript repository has no standalone TypeScript check. Android emulator evidence is not iPhone/iOS certification. No signed iPhone, TestFlight or Apple simulator validation was performed.
