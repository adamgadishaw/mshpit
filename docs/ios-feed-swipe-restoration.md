# Restore the Feed filter swipe path

The earlier chrome revision (`e26c87a`) replaced `NativeFeedFilterPager` in the iOS Feed owner with parked views. The subsequent activity-bar tabs restored tap navigation, but the existing native swipe controller remained disconnected. This repair reconnects that same retained pager beneath the current activity bar. The bar's layout and disappearing behavior are unchanged.

Following, Local, For You, and News again use the existing finger-tracked page motion, adjacent previews, cancellation and release settling. Visited lists retain their native instances, offsets and pagination state. The shared account-scoped selection drives both the header and pager. Every accepted explicit selection advances its gesture revision, so tapping the selected tab also cancels a queued release. Same-tab taps avoid redundant persistence; batched away-and-back taps persist the final selection.

Only three runtime files change: `FeedScreen.ios.jsx`, `useIOSFeedSelection.ios.js`, and the header tab's `onPress` in `NativeAppHeader.ios.jsx`. The existing pager, native gesture controller, scroll chrome, refresh boundary, endless pagination, title layout, and native dependencies are unchanged. The restored behavior is body swiping, as before; no new header gesture is introduced.

## Verification

- Read the exact Expo SDK 57 reference before editing.
- The same real Feed/header/shared-selection/pager/scroll regression test fails with the exact installed `dd02271` runtime modules and passes with the repair. Evidence: `.tmp/native-feed-swipe/evidence/regression-proof.json` and paired logs. Baseline source and artifacts were not modified.
- Focused native swipe, real Feed retention, selection, and chrome tests: 180/180 passed. Historical drag/preview/promotion/cancellation coverage is restored and exercises the actual shared header and measured chrome. Only the selected pane owns scroll chrome; previews cannot register another owner.
- Refresh, Feed return, accessibility, and retained Back regressions: 78/78 passed.
- Independent parent-run gesture policy, geometry, scroll chrome, endless pagination and feed pagination domain tests: 36/36 passed. Total: 294 distinct tests.
- Syntax and architecture checks passed. Independent production review found no blockers.

Tests include slow pending reads during promotion, cancellation aborts, same-tab interruption, stale route/account/background callbacks, live VoiceOver, Reduce Motion, retained lists, and immediate data/refresh behavior. Native layout, scheduling and touch events are simulated; physical gesture feel still requires device acceptance. Artifact evidence is kept under `.tmp/native-feed-swipe/evidence`; any signed QA repack reuses the verified native runtime rather than compiling native code again. No phone or backend action was taken for this repair.
