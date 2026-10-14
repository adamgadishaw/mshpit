# Authenticated Windows review — October 14, 2026

## Running review

Isolated branch codex/windows-android-dev-20261014 in D:\Development\Apps\mshpit. Existing x86_64 Android development APK/emulator; no new native dependency or signing change. Metro uses https://www.mshpit.com and the owner remains signed in. Runtime projection verified destination https://www.mshpit.com/api/login, nativeReadOnlyReview=true, POST /api/posts rejected, user-operated login allowed. No credentials, tokens or cookie values were inspected; no login retry, logout, content write, push or deployment occurred.

Continue/restart using the commands in NATIVE_LIVE_REVIEW_2026-10-14.md. Windows mobile:start now sets EXPO_NO_METRO_LAZY=1 for the dev-client runner only. Web/release exports and normal production loading retain their existing configuration. Final eager startup compilation was 18,972 ms; compilation is paid upfront. This is not authentication response latency.

## Verified fixes

- RN 0.86 removed StyleSheet.absoluteFillObject. A native fallback to StyleSheet.absoluteFill restores single-media grid tiles and poster/player overlays. Existing web style values remain preferred. Live feed mapping contained two video posts with descriptors, MP4 delivery URLs and JPEG posters intact. The blank rectangle was a collapsed child tile, not proof of missing posts.
- Metro lazy loading previously failed to require a viewer module. Eager Windows development compilation resolved the reproduced viewer mount failure. Native playback was readyToPlay at 1080x1920, duration 25.175 s; playing=true and time advanced from 0.086 to 14.590 s. One bounded MP4 range and poster range returned 206 in 416/243 ms. This does not certify every uploaded video/codec or iOS playback.
- Native news requires an account at navigation/restoration boundaries and before known story fetches. Artist news does not mount for native guests. Known news IDs and owned news links are covered by guest/member tests without signing the owner out. Web public news and server policies are unchanged. No new account was created. The live review intentionally blocks signup and content writes; ordinary account flows remain in the app.
- Android rejected article as accessibilityRole on NewsStoryCard. Web retains article; native retains child controls without that unsupported container role. The signed-in full NewsScreen rendered actual story text, image and controls.
- Nearby's catalog scans and coordinate searches produced a blank screen with ~96% JavaScript CPU. Bounded CPU profiles identified normalizeVenueKey -> resolveVenueCatalogKey/venueCoord repeated scans. Native-only catalog/coordinate indexes and bounded identity caching preserve exact canonical precedence, aliases, collision rejection and rated-first coordinate precedence. Local venue counts now use one events pass after distance filtering; native region shows calculate genre after distance filtering. Existing web resolution paths remain unchanged. No map provider/server/GPS permissions/settings were changed.

## Measurements and smoke checks

- Fully hydrated Nearby: 52 venues and 157 shows at the current 75 km context. First venue calculation 4278 ms, warm repeat 23.39 ms; show calculation 46.47 ms first, 37.02 ms warm. These are calculation timings, not total screen-ready timings. The earlier 956 ms sample used a partially hydrated cache and must not substitute for the full-dataset result. Nearby rendered and Back returned.
- London city guide GET /api/cities/gb/london: 200, 370 ms. Actual guide photo, 22 today/1429 upcoming/172 venue counts and show cards rendered; three scroll gestures and Back worked.
- Four-second city scrolling sample: 240 JavaScript frame intervals, median 16.64 ms, p90 18.22 ms, maximum 23.95 ms. Development/emulator sample only; no controlled before/after or production FPS claim.
- Drake signed-in opening earlier produced bounded initial work: 14 commits, nine distinct artist-related GETs once each (excluding Search catalog GET), all 200. Idle tracing showed no ongoing request loop. Cold lazy compilation was a substantial separate delay; no speculative artist-refresh-loop rewrite was applied.
- Owner's login delay has no retained authentication request timing. Metro retained AuthScreen 8652 ms and HomeShowCountdown 6364 ms compilations around the handoff. These cannot be added together or presented as a measured login duration.
- Native mshpit-dev://news reached app news but the dev launcher also interpreted its reserved scheme as project loading. The review was recovered using the normal dev-client Metro URI. Owned link parsing and guest/member gating tests pass; OS-level release deep-link behavior is not certified. Full news was verified through the existing FeedScreen.onOpenNews navigation callback. Some taps during a development refresh were unreliable; do not claim exhaustive touch-flow validation.

## Validation and evidence

72 focused tests passed: media layout/descriptor/poster/viewer, native guest/member news routing, link parsing, web navigation, live-review guards, analytics, venue identity/index/coordinate/count contracts. Final Android production/Hermes export passed (2096 modules, 27671 ms bundling); final web export passed (1060 entry modules, 4879 ms bundling). No native code changes required an APK rebuild in this pass.

Logs and measurements are under .tmp/validation: final-focused-tests.log, final-native-export.log, final-web-export.log, nearby-final-timings.json, nearby-final-warm-timings.json, city-scroll-frames.json, city-guide-settled.json, review-state-safe.json, media-delivery-check.json, video-playing-first/second.json and sanitized city-cpu-profile-with-parents.json. Actual pixels: news-full-final.png, city-guide-verified.png, nearby-index-verified.png and .tmp/deliverables/mshpit-video-playing.png.

Playback screenshot saved to Library: libfile_b8f8ece536b08191abdebe84e1a4a050, version 0; file_00000000078481f5825eaffc35ff7e33. Upload receipt retained separately; Windows xattrs were not claimed.

Remaining limits: Nearby first-use indexing still costs several seconds; drawn/static map behavior remains as implemented. No broad provider/server optimization undertaken. Not all media, festivals, devices or authenticated workflows were certified. Android testing is not iOS certification; Windows cannot run Apple's local simulator. Apple enrollment, signed iPhone/TestFlight checks and unsupported Expo Go native sharing remain deferred.
