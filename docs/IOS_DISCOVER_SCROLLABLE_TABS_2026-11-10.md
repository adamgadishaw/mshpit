# Scrollable iOS Discover tabs

## Scope

Local branch `ios/discover-scrollable-tabs` starts at `83ed455` on the clean navigation/card candidate. The installed `cc04472` app and its signed checkpoint remain unchanged. This change has not been installed or tested on the phone. No backend, auth, provisioning, notification feature, dependency, web or Android runtime changes are included.

Discover's six existing sections now use a horizontally scrollable version of Feed's native segment aesthetic: the same surface colors, 13/10-point corners, 13-point labels and minimum 44-point targets. The existing Discover route keys and page lifecycle remain authoritative.

## Motion and ownership

The section pager passes a fixed navigation render hook through the existing iOS rail. The header remains outside the page gesture detector and its context provider, preserving the existing ancestor horizontal-scroll exclusion. It is never mounted as a preview. The strip consumes the actual rail's UI-thread x, measured viewport width and atomic page origin. Its measured selection background and synchronous scroll position follow the visible page during drag, readiness pinning, reversal, return and settle. There is no target-based timing approximation or per-frame React update.

Native tab frames drive position and width interpolation. Font-scale and window-width changes remount only the strip's measurement generation, not the current or preview page. Selection auto-scroll uses the moving frame's center with bounded native offsets; it does not subscribe to the strip's own scroll offset. Manual drag suppresses auto-scroll immediately on the UI thread and retires outstanding page intent through the existing tap revision. Idle manual browsing is not recentered. Re-admission reveals the selected item even if measured while disabled.

Accessibility selection remains the committed route, never the preview. Labels scale without a line cap and keep stable font weight so selection does not change measured widths. The existing reactive Reduce Motion hook suppresses interactive label displacement and live changes retire the rail gesture. Existing VoiceOver tab actions remain available. The app's existing pager uses physical left/right order, so this strip explicitly keeps that same LTR coordinate order even under inherited RTL; this is not a new RTL localization or mirrored-pager implementation.

## Focused validation

Passed 185/185 tests, zero failed, skipped, cancelled or TODO, across:

- `src/components/NativeSwipeRail.ios.test.mjs`
- `src/components/discover/DiscoverBrowse.ios.test.mjs`
- `src/screens/retainedFeedLifecycleIOS.test.mjs`
- `src/domain/discoverProgramme.test.mjs`
- `src/domain/primaryTabLazyLoading.test.mjs`
- `src/domain/iosDiscoverTabGeometry.test.mjs`

Run with Node 24 and `TMPDIR=/tmp` through the repository's hermetic `npm test` runner. Receipt: `.tmp/discover-scrollable-tabs-20261110/focused-tests.log`, SHA-256 `9b53493ad06b72ebbedbd74cb34e3972297c26f1c88995740bf08db81dc25bff`.

Tests load the actual Discover owner, section pager, rail and new strip, including the production Festival, City and Photo resource paths. Dedicated cases cover unequal/wide labels, selected accessibility state during motion, readiness pinning, cancellation/reversal, delayed atomic promotion, far taps, manual scrolling, disabled/current-route/inherited-preview ownership, font/width remeasurement, re-admission and live Reduce Motion. Existing nested-scroll, reserved-edge, repeated-tap, stale callback and preview side-effect checks remain intact. The installed Expo 57 preset compiles the new UI worklets, and their compiled function bodies/closures are executed against measured geometry. The focused harness now tracks mounted reaction lifetimes rather than guessing the last two callbacks.

Node syntax checks on changed/new MJS files and `git diff --check` pass. Expo 57 versioned SDK/Reanimated documentation was read before implementation; no dependency or Babel configuration changed.

## Remaining gates

The parent owns final frozen aggregate, exports, platform isolation and native build verification, preferably on the combined candidate. Focused tests use synthetic layout metrics and schedulers. They do not certify native glyph fit, real scroll ref dispatch, VoiceOver presentation, physical-finger animation quality, gesture latency or native RTL rendering. No simulator or phone interaction is claimed for this change.
