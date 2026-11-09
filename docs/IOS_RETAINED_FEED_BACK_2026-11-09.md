# iOS retained Feed Back reveal

## Historical candidate record

This audit records the original combined-runtime candidate and its original verification. The current clean branch starts from `8060121` and excludes the notification feature; its original backend-first hold does not apply here. See [the clean integration receipt](IOS_NAVIGATION_WITHOUT_NOTIFICATIONS_2026-11-09.md) for current source, gates and device limits. Historical test counts below are not a substitute for clean-branch validation.

## Scope and release status

Isolated local branch `ios/retained-feed-back`, based on `942e1f3` (the combined runtime checkpoint is `6569968`). This candidate is not installed, pushed or deployed. The existing phone, main checkout, signed app checkpoints, dependencies, native project and backend are untouched.

This is a bounded first slice: a readable detail opened directly from a signed-in Feed can reveal that same Feed beneath a cancellable edge drag. Examples include member profiles, artists, venues, posts and event/show details. The one Feed also remains mounted through an uninterrupted chain of readable details or photo viewers. Only a detail whose actual immediate parent is that retained Feed can reveal it.

Detail-to-detail navigation and departures from Search, Discover or You do not yet reveal a live previous detail. Protected editors, authentication, moderation and other unreviewed destinations keep their existing unmount boundary. No screenshot, reconstructed page or hidden duplicate detail is used.

The inherited combined-client rollout hold still applies: the separately approved scoped-read notification backend must be deployed to every serving instance before publishing or installing this combined client. This work does not authorize that rollout. Preserved `8060121` remains the separate Discover-only retest candidate.

## Behavior and ownership

- The current detail follows the finger up to the viewport width over the real Feed. A committed release settles offscreen before Root Back; cancellation or a clear reversed release returns to the same detail.
- Feed list identity, filter and native scroll position survive direct detail navigation. Unchanged resources retain loaded rows and cursors. A matching Follow/Repost mutation while covered marks Following dirty without reading, then reconciles on return rather than preserving stale rows. Read admission and foreground work otherwise remain disabled until the Feed is again active.
- Hidden Feed controls are unavailable to touches and accessibility. Existing explicit Back remains available, VoiceOver does not acquire the gesture strip, and Reduce Motion avoids interactive translation.
- Gesture permission is retired on account/route changes, inline editors, app inactivity, width changes, screen-reader changes and layout disconnects. Reconnection reads current AppState, including changes missed while suspended.
- A Feed layer mounted while already covered cannot advertise itself as the old visible Feed. A base-frame replacement or account/epoch key reset also revokes that capability.
- The extended Feed lifetime requires separate guards for resource suspension, media, queued actions, refreshes and timers. These are part of the candidate, not assumed to follow from opacity or touch blocking.

## Root cause and implementation

The previous gesture translated a detail only partway across an opaque container after its predecessor had unmounted. It could not reveal the actual previous page. Simply retaining the Feed would also preserve its effect owners and queued native callbacks, which previously relied on unmounting for cleanup.

- `nativeFeedRetention.ios.js`, `NativeFeedMediaLayer.ios.jsx` and `App.js` establish bounded retention, prove prior visible presentation, and protect hidden header/tab controls. The default retention policy is unchanged.
- `IosDetailNavigation.ios.jsx` uses the real backdrop only when that proof applies. Motion runs on the UI thread, with generation-fenced completion and recovery when Root rejects or defers Back. No per-frame JavaScript callback was added.
- `FeedScreen.ios.jsx`, `NativeTabPages.ios.jsx` and `useFeedPresentation.ios.js` propagate hidden/foreground state through the real nested pager. Each layout admission, including first mount, Back and Suspense reconnect, publishes a fresh action token. Old callbacks never regain authority.
- Feed resources, live coverage and countdown timers gain iOS lifecycle variants. Pages are retained without background polling. Following records scoped local invalidations while covered and reconciles them on re-entry, including expanded histories over 30 rows.
- `TicketStub`, `RetainedPostSwipeActions.ios.jsx` and the iOS News action/card variants fence native sheets, pending saves, navigation, media, authentication callbacks, conversion retries, tag actions and share controls. Generic hooks are inert outside iOS; the original Android/web News and social components remain unchanged. The native swipe controller is byte-identical to baseline; the extra stale-action guards live only behind its iOS wrapper.
- `SmartImage.ios.jsx` and campaign image ownership issue native stop/start commands, because SDK 57's autoplay prop alone does not stop an animation already assigned to the image. News's three editorial/artist image paths explicitly remain static. Detached image cleanup cannot interrupt navigation.
- Already-earned dwell is closed at layout departure exactly once using the same account/base lease. Hidden time, retired callbacks and privacy-scope changes cannot add stale measurements.

No API, server, database, dependency, native project, signing or migration change is included.

## Verification

- Independent source review cleared the final source after fixing real News actions, animated images, Following invalidation and fresh-admission integration findings. Focused independent runs passed 107 and 71 tests respectively; the final affected matrix passed 168/168, including actual iOS swipe-wrapper resolution and exact default-native parity.
- Production-component tests cover the full Feed owner → pager → Feed content → real Ticket/News controls, not only stubs: initial interaction, immediate Back usability, exact retained list identity, nested route boundaries, native sheet/save completions, privacy changes, Strict Mode, Suspense reconnect, reduced motion, app suspension and queued gesture dispatch.
- Local iOS and Android Hermes production exports pass. The exported source maps match all changed runtime modules they contain (24 iOS, 5 Android).
- Source-map isolation passes with zero issues across the Android map and all 82 web chunk maps. No application `.ios` implementation leaks into those platforms.
- The unchanged web initial-JavaScript gate passes at **524,214 / 524,288 bytes gzip**, leaving 74 bytes. No budget, minifier or validation rule was relaxed.
- Dependency audit reports zero vulnerabilities; all 929 Node files pass syntax; architecture, Render Blueprint schema/reference checks and whitespace checks pass.
- The complete check chain passes: `split:catalog`, **8,782/8,782 tests** (zero failed, skipped or cancelled), dependency audit, syntax, architecture, and the production web export/budget. This executes the same steps as `npm run check`, with the repository-supported `npm test -- --test-concurrency=1` replacing its default-parallel test invocation. The test phase completed in 447.8 seconds. The final local chain exited 0.

An earlier run used macOS's default temporary directory and failed six fixture startup assertions that explicitly require `/tmp`; rerunning with `TMPDIR=/tmp` resolved them. Two subsequent default-parallel aggregate runs each passed 8,780/8,781, failing different unchanged React fixtures: Clips recovery (missing FlatList after synthetic settlement), then Lounge eligibility after capacity recovery. The Clips suite passed all six isolated reruns, 43/43 each; the community composer suite passed 92/92. Fixed synthetic settlement makes timing contention plausible, but the cause was not conclusively reproduced. Neither fixture or its production code was changed, and no test was excluded. Final acceptance runs every step of the check chain with the repository-supported `--test-concurrency=1` option; do not interpret it as a passing default-parallel run.

Synthetic React/native-recognizer tests and exports verify ownership, identity and compilation. They do not establish real iPhone frame rate, gesture geometry, visual timing or VoiceOver behavior. No simulator/native Xcode build or physical-device acceptance has been performed for this candidate.

## Remaining device acceptance

When separately authorized and safe, test Feed filters (Following, Local, For You, News) to profile/event/artist, short cancellation, reversal, successful Back, nested detail return, repeated swipes, background/resume, inline editor blockers, media pause, native scroll continuity, Reduce Motion and VoiceOver. No phone installation, launch, input or recording was performed for this candidate.
