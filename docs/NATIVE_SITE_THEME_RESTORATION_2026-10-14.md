# Native website theme and owner feedback — October 14, 2026

Work is isolated in `D:\Development\Apps\mshpit`, branch `codex/windows-android-dev-20261014`. The original website checkout, production hosting, Google Cloud settings and signing are untouched. The owner’s stored sign-in is preserved. The development runner uses the approved `https://www.mshpit.com`, blocks content writes, and disables product analytics.

## Changes

- Native reuses the existing website theme and shared Discover components: graphite backgrounds, charcoal panels, amber controls, rounded responsive cards, existing typography and photo-first artist cards. The header remains uppercase MSHPIT. No invented lime/white theme remains.
- Added the missing Platform import in ArtistScreen. Drake detail, Back and reopen were runtime verified; the bounded initial artist requests completed once with no ongoing loop.
- Native festival panels stack on phone widths. Detail screens display the real poster separately from a compact heading, date, location and actions on a charcoal surface. This avoids competing text over lettering in festival artwork. Empty lineups reflect real API data.
- PhotoViewer applies actual safe-area insets to native modal content. Count, close/report controls and media are below the clock/connection bar, and the footer respects the navigation inset. Native uses an opaque modal; the web modal keeps its original presentation.
- Native Nearby removes the decorative blue blob, large stat cards and invented streets. It is list-first with radius, city, venue/show tabs and a map toggle. Its free coordinate overview uses actual venue positions and labels itself as approximate, not a street map. Selection opens the venue; an explicit link opens the city in Maps. Existing web map behavior is retained. Native local view switches reuse results, and hidden-map mode skips map summary generation.

## Verification

- 79 focused regression tests passed: media tiles/posters/viewer, native guest/member news navigation, owned links, venue identity/index/coordinates/counts, public frame navigation, live review safeguards and analytics suppression.
- Final Android/Hermes export passed, 2,097 modules and 9.3 MB HBC; final web export passed, 1,061 entry modules. Logs: `.tmp/validation/refinement-tests.log`, `refinement-android-export.log`, `refinement-web-export.log`.
- Changed frontend files parse; `git diff --check` passes. There is no established TypeScript project/type-check command. Existing debug APK was reused because these changes require no native dependency rebuild.
- Real signed-in Feed, Discover, Drake, full News, festival detail and native video were observed on the Windows AOSP API 36 emulator. Production write controls were never exercised.

## Performance remains unresolved

A 25.175-second 1080x1920 video advanced from 0.408 to 8.712 seconds in an 8.863-second observation. Android rendered-frame timing reported 39/60 deadline misses (65%), p50 36 ms and p90 73 ms. Repeating with the opaque modal reported 39/57 misses (68.42%), p50 38 ms and p90 57 ms; video reached 8.778 seconds over 8.936 seconds. This is no demonstrated jank improvement. These development measurements included a persistent Fast Refresh overlay and must not be represented as clean release benchmarks or decoded-video FPS. Frozen-source restart and settled screenshots are checked separately. Raw progress and Android gfxinfo are under `.tmp/validation/refined-playback-*`.

Warm Nearby computation was 29.60 ms for 52 venues and 38.73 ms for 157 shows. The prior fully hydrated cold venue computation of 4.28 seconds remains pending; this pass does not claim that delay improved. No overall-smoothness claim is made from JS interval samples.

## Google Maps diagnostic

An isolated public headless browser checked `https://www.mshpit.com/nearby` and the Massey Hall venue, which resolved to `/venue/ticketmaster-kovzpzafnlna`. On the observed venue page there were zero Maps JS scripts, no `window.google.maps`, no watermark, no auth-failure flag and no Google MapError/MapWarning console code. The Directions link was present. This does not diagnose the owner’s reported watermark; the exact affected URL/state is needed to observe its real error. No API key was printed or inspected, and no billing, restriction, API-enable or production changes were made. Native previously used a drawn/static fallback, not Google’s interactive JavaScript map or a native Google SDK. The new Nearby overview needs no provider account/key.

Google’s official troubleshooting/error-message documentation requires the actual code before choosing a remedy: https://developers.google.com/maps/documentation/javascript/troubleshooting and https://developers.google.com/maps/documentation/javascript/error-messages .

## Reproduce

```powershell
. D:\Development\Tools\Use-Android.ps1
cd D:\Development\Apps\mshpit
$env:EXPO_PUBLIC_API_URL='https://www.mshpit.com'
$env:MSHPIT_APPROVED_LIVE_API='1'
npm run mobile:start -- --port 8081 --max-workers 2
# Separate terminal; use the existing emulator:
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 shell am start -n com.mshpit.app.dev/.MainActivity -a android.intent.action.VIEW -d 'mshpit-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'
```

Use the existing server rather than starting a duplicate. The free Windows Android setup, APK/emulator commands and Expo Go limitations remain in `WINDOWS_MOBILE_DEVELOPMENT.md`. `react-native-share` is compiled into the development APK but is not supported by Expo Go and real share-sheet behavior is not certified. Android results do not certify iOS; signed iPhone/TestFlight testing remains deferred until later enrollment. Windows cannot run Apple’s local simulator. No EAS Simulator access is assumed.

Final frozen-source startup bundled in 20,928 ms. The settled player sample (no export, diagnostic browser or Refresh overlay running) advanced to 8.885 seconds over 9.038 seconds, at 1080x1920. Android gfxinfo: 35/59 deadline misses (59.32%), p50 36 ms, p90 77 ms; substantial UI jank remains. This measures UI frame deadlines, not decoded-video FPS. Pixel counts independently confirmed the reference website and settled native Feed both use #09090B, #0F0F12 and #141418; native amber is #FF8C42. Metro now runs from .tmp/validation/metro-refinement-settled.log (PID 18020).

Settled native touch checks: Show map rendered actual coordinate dots and native venue-selection controls; changing 75 km to 25 km changed results from 52 venues / 157 shows to 39 / 127; Hide map returned the list. Existing web LiveMap mounts through ConcertMap only for web, a configured Google provider/key and nonempty valid coordinates; Near you route is /nearby. The failed-to-reproduce public diagnostic requires the owner's affected map URL and selected-city/login state, with its actual sanitized console error code, before any configuration remedy can be proposed.

Library screenshots (all version 0): before white News libfile_4f69584e0df081918c916f1a157b09d3; settled dark News libfile_9f38e8121184819198e83053df97ae23; settled native playback/safe area libfile_8ca36beab51881919396b30952ca1613; settled Nearby list libfile_825fb8b002d081919d334ae847b7d58e. Library retained the uploads successfully; Windows Library xattrs were not applied. Upcoming-tab touch check rendered HARBOUR, Vincent Neil Emerson and Errol Fisher with their existing venue controls. No ticket/reaction/post writes were performed.

Final clean ÎLESONIQ detail and Back verified after frozen-source restart. Screenshot Library libfile_3ccdcdd356a88191ad5b4e195bb0a64e, version 0, 419565 bytes. The shared mobile Popular Artists photo grid was restored in source; no separate settled grid screenshot is claimed by this pass.
