# Windows native functionality and performance checkpoint — 2026-10-14

Work is isolated in `D:\Development\Apps\mshpit`, branch `codex/windows-android-dev-20261014`, based on `ab967d8`. Original web checkout, production, accounts, signing and system settings were not changed by this pass. Shared UI changes retain web role/keyboard semantics and web screen warmup; country-code normalization and memoization preserve returned data.

## Completed

- Fixed Discover's six unsupported native `accessibilityRole="tabpanel"` containers. Web keeps its role and labelled-by association. Native leaves panel descendants individually accessible; existing tab labels and selected state remain. Android accessibility tree inspected; TalkBack/VoiceOver session not performed.
- Added Android bottom safe-area inset. App tabs previously overlapped the three-button system navigation bar; all tabs are now above it. Early measurements contaminated by system navigation were discarded.
- Hermes sampling identified repeated locale-aware uppercasing in country-filter construction (191 of 624 CPU samples). ISO country-code conversion now uses locale-independent casing, and country choices are memoized. The comparable after profile contained 0 locale-uppercase samples out of 649.
- Native avoids the five simultaneous background detail imports four seconds into startup. Web warmup is unchanged. First native detail navigation can still wait for Metro's development chunk compilation.
- Native event empty state offers “Browse artists” only when the actual overview has artist rows. No events or posts were fabricated. The isolated backend reports 1,637 artists, with real Drake/Coldplay catalog records; upcoming events are empty. Toronto's venue section also rendered its five existing directory venues.
- Added opt-in native React Profiler/next-frame probe. Disabled by default and absent from production rendering.

## Measurements

Same AOSP API 36 x86_64 emulator, WHPX, host GPU, 4 cores/3072 MB, 1080×2400, Metro development mode, local API. Navigation is the timestamp immediately before adb input through the first committed screen's second animation-frame callback; it includes adb/input latency and is not a claim that all network content is ready. Profiling was enabled for both before and after. Small samples are diagnostic, not a benchmark certification.

| Check | Before | After | Interpretation |
|---|---:|---:|---|
| Repeated Search → Discover | 1,542 / 1,573 ms | 640 / 660 / 519 ms | Median 1,557 → 640 ms, about 59% lower |
| Repeated Discover → Search | 787 ms | 773 / 840 ms | No demonstrated improvement |
| First Search after app restart | 2,022 ms | 1,658 ms | Metro cache differences; do not attribute this to the app fix |
| Cold Android Activity `am start -W` | 2,225 / 2,349 ms | 2,122 / 2,130 ms | Activity start only; not full JS/content readiness; no strong improvement claim |
| Four 450 ms swipes, frame p50 / p90 | 23 / 31 ms | 23 / 38 ms | Scrolling did not improve |
| Same swipe run, Android deadline jank | 5/118 (4.24%) | 6/115 (5.22%) | Small sample; unresolved rendering/emulator overhead |

The measured country conversion cost is an app defect. Development React work and Metro compilation also consume time; emulator GPU/UI timing is not physical-phone or release timing. No production/release native APK was benchmarked. React Native guidance: https://reactnative.dev/docs/0.86/performance . Exact Expo SDK docs used: https://docs.expo.dev/versions/v57.0.0/ .

## Verification and evidence

- 71 focused Node tests passed: accessibility, native Intl startup, country aliases, discovery filters/cache/ranges/programmes, guest access and screen transitions.
- Android production Hermes JS export passed: `.tmp/performance/export-android` (9.3 MB HBC). Existing native APK was reused; no signing/build-service work.
- Real device UI: guest Discover Shows and Artists, Search repeated navigation, Toronto Venues, Drake detail (bio/location/sections), Android Back restoring Artists. Also Back while a lazy detail was loading returned safely. No new ReactNativeJS/AndroidRuntime exception in final checked log; existing SafeAreaView deprecation remains.
- Final screenshots: `.tmp/deliverables/mshpit-discover-working.png` and `.tmp/deliverables/mshpit-guest-artists-working.png` (pixels inspected).
- Raw timings: `.tmp/performance/before-renders-valid.json`, `after-renders.json`, `before-cpu.json`, `after-cpu.json`, `after-scroll.txt`; before scroll `.tmp/validation/perf-before-scroll.txt`.
- Test/build logs: `.tmp/performance/regression.txt`, `export.log`. Accessibility trees and detail/back evidence are in `.tmp/performance/*.xml`.

## Reproduce locally

```powershell
. D:\Development\Tools\Use-Android.ps1
cd D:\Development\Apps\mshpit
# Use the existing processes if still running. Otherwise, in separate terminals:
npm run mobile:backend
npm run mobile:start -- --port 8081 --max-workers 2
adb -s emulator-5554 reverse tcp:3000 tcp:3000
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 shell am start -n com.mshpit.app.dev/.MainActivity -a android.intent.action.VIEW -d 'mshpit-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'
```

For an intentional measured run, stop only the existing Metro process, then start it with `$env:EXPO_PUBLIC_NATIVE_PERF='1'` and the same command. Reload the app. At this emulator resolution, `node scripts/native-performance-probe.mjs tap search-1 324 2190`, then `... tap discover-1 756 2190`, and `... save .tmp/performance/new-renders.json`. Remove that environment variable and reload Metro/app when done. The probe has a 30-second watchdog. The local CPU sampling script used is `.tmp/performance/profile.mjs`.

Scroll reproduction from settled Shows: `adb shell dumpsys gfxinfo com.mshpit.app.dev reset`; alternate `adb shell input swipe 540 1850 540 700 450` and its reverse twice, then save `adb shell dumpsys gfxinfo com.mshpit.app.dev`. Device serial should be specified if more than one is attached. Pull-to-refresh/empty-data effects and small samples limit interpretation.

## Handoff

Processes preserved: emulator qemu 16676, Metro 12000 (127.0.0.1:8081), safe backend 23296 (127.0.0.1:3000). App left on the working Artists section, profiler disabled. Logs: `.tmp/validation/metro-detached.log` and `backend-detached.log`.

No blocker remains for this checkpoint. Search responsiveness, scroll smoothness, first-use development chunk waits and a release-JS/physical-device comparison remain useful follow-ups. Local provider ingestion is intentionally blocked, so empty upcoming events do not establish production data availability. Authenticated feeds/posts, sharing, all detail sections, iPhone/Expo Go, TalkBack and iOS are not certified by this pass. No layout redesign was started; tile density and the empty event-first impression are recorded for the owner's requested later social-layout phase.
