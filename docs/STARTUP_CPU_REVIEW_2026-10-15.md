# Native startup CPU and navigation review — 2026-10-15

Continues from clean `b22e02b` on the isolated mobile branch. The owner account and theme remained intact. All live use stayed behind the existing native production-write guard with analytics disabled. No login/logout, credential change, content mutation, push, deployment, native dependency upgrade or paid service was performed.

## Demonstrated app-side stall

Temporary React Profiler and synchronous compute spans identified a venue-search index build inside StoreProvider as the dominant main-thread cost. The detailed baseline spent **13,290.62 ms** cumulatively in that initializer, with one build taking **10,834.23 ms** after the tour-date snapshot arrived. StoreProvider's total measured compute was 13,390.74 ms. JSON parsing across the startup reads took only 9.04 ms.

The existing identity handshake dispatched the account hydration reads in parallel. Feed loading started from the confirmed-session effect. The profile did not justify bypassing either identity validation or its account/privacy fences.

Native Hermes measurements on 200 existing venue names isolated a concrete cause: explicit English locale lowercasing took **229.26 ms**, while Unicode `toLowerCase()` took **0.14 ms**, with identical outputs for those names. Sorting those same names with repeated `localeCompare` took 25.24 ms; one reused `Intl.Collator` took 1.84 ms and produced the same order.

## Targeted correction

- `unifiedLocationSearch.mjs` uses equivalent Unicode lower/uppercase operations for its explicit-English search/provider tokens and ISO country codes. One default-locale Collator is reused within each venue-index build.
- `venueListingIdentity.mjs` preserves its explicit-English provider identity using equivalent Unicode lowercasing.

Index inputs, bounds, provider/venue alias decisions, search matching, account-scoped snapshot ownership and cache invalidation are unchanged. No new personalized cache or delayed identity publication was introduced.

Five compatibility tests cover multilingual English casing, default-locale ordering, accent/case search, provider separation and ISO country-code identity. The full focused set of venue identity/search tests passed, **22/22**.

A separate differential check loaded the exact `b22e02b` implementations. Both the zero-event and 1,000-event synthetic multilingual/provider fixtures, combined with the existing public curated venue catalogue, produced identical complete venue projections and identical queries before/after. This was a Node compatibility check, not a native latency benchmark (`venue-index-differential.json`).

## Comparable native CPU measurements

The detailed baseline and both final trials used the same temporary entry wrapper, React Profiler, Store initializer spans, API/body timing and heartbeat observer. No test suite or export ran concurrently with these measurements. The native dataset checks showed **978 tour-date rows and 716 indexed venues**.

| Metric | Detailed baseline | Final trial 1 | Final trial 2 |
| --- | ---: | ---: | ---: |
| Cumulative venue-index compute | 13,290.62 ms | 358.82 ms | 367.07 ms |
| Worst single venue-index build | 10,834.23 ms | 288.72 ms | 301.38 ms |
| Largest React render commit | 11,584.05 ms | 1,069.48 ms | 911.14 ms |
| Worst 100-ms heartbeat delay | 11,676.73 ms | 1,433.65 ms | 936.00 ms |
| First confirmed member UI | 4,713.31 ms | 2,380.86 ms | 2,417.08 ms |
| First populated Feed | 6,578.51 ms | 4,061.45 ms | 4,469.07 ms |

The worst index build was about **97% shorter**. The observer's total commit-walk cost was 11.38 / 13.99 / 10.97 ms respectively. App import execution stayed around 810–827 ms; JSON parsing stayed around 8–11 ms. The lower main-thread cost is independently demonstrated, rather than inferred from request duration.

After every compute probe was removed, a direct native rebuild from the currently mounted account's inputs took **321.33 ms** and returned a projection identical to the current index. Only counts, timings and the equality result were saved; no index contents or private response bodies were exported (`final-native-index-check.json`).

## Timing origins and variability

The profiled timings begin before the temporary `require('./App')`, after Expo/React setup. They exclude native process launch and Metro compilation. One recovered cold Metro bundle in this phase took **10,895 ms** for 2,227 modules; later warm incremental bundles were approximately 93–98 ms. These timings cannot be added into a precise release-startup number.

The API observer recorded fetch resolution and body-read elapsed time without headers, credentials or payload content. Fetch elapsed time includes transport, origin work and callbacks waiting for the JS thread; it is **not an independent origin-server processing measurement**. Synchronous parse and render spans separate the demonstrated app computation from those waits. No origin-server CPU timing or production server change is claimed.

The earlier lightweight observer began after static App imports. Its original baseline reached confirmed member UI at **4.68 s** and a populated Feed at **6.15 s**. With the same lightweight observer after the correction, two runs reached member UI at **2.68 / 1.77 s** and populated Feed at **7.60 / 4.00 s**. The first after-run's slower Feed result is retained in the evidence. End-to-end loaded-content timing remains variable; the evidence does not establish a universal startup deadline or a release-performance result.

Removing the temporary multi-file probes triggered a Metro incremental graph error (`Got unexpected undefined`). That failed lightweight attempt was discarded. Restarting only the recognized local Metro server and reopening the existing development app recovered it. The successful measurements above were collected after recovery. All temporary entry, App, Store, API and Feed changes were restored exactly before final validation.

## Repeated navigation on the unprofiled final source

The same earlier bounded protocol produced:

- Radiohead, Radiohead, Coldplay, Radiohead: **1,885 / 1,810 / 1,766 / 1,869 ms** to confirmed page; observed Artist-family read counts **11 / 10 / 11 / 10**; zero added requests during each idle check.
- Three Toronto visits: **1,837 / 1,390 / 1,661 ms** to populated guide; one guide read plus one wording read per visit; zero idle requests.

These remain within the earlier warm-navigation range. The demonstrated improvement removes the large startup/data-refresh index stall; it does not establish a broad improvement in every Artist/City round trip. Actual Android/iOS release responsiveness and every reported Artist loop remain separate validation work.

Evidence is under `.tmp/overnight/startup-profile/`: `detailed-baseline.json`, `detailed-after-2.json`, `detailed-after-3.json`, native string benchmarks, compatibility comparison, `plain-after.json`, `plain-after-2.json`, `repeat.json` and `city-repeat.json`. The earlier baseline remains at `.tmp/overnight/startup-review/baseline.json`.

## Final regression gate

The full suite passed: **6,350 total, 6,349 passed, zero failed, one skipped**, 86.291 seconds (`.tmp/overnight/startup-profile/full-tests.log`). Syntax passed for 854 Node files. Architecture passed at the unchanged 144/144 Store-hook ceiling. Android, iOS and web exports all passed with external maps. No TypeScript project check is claimed. The guarded local development server was restored after export. No native iOS compile, signed device/TestFlight test, Apple enrollment or store certification is claimed.
