# Nearby show finder: local review, 2026-10-15

**Follow-up:** [focused scroll profile](NEARBY_SCROLL_PROFILE_2026-10-15.md) records 69 passing tests, the measured date-formatter fix, equivalent before/after scroll runs, an independent native control, and the remaining browser-control blocker.

Review branch: `codex/nearby-show-finder-20261015`, based on `f658570`, in `D:\Development\Apps\mshpit`. No push, deployment, production test posts, enrollment, purchases, signing changes or new dependencies. The original website checkout and separate font-CSP review worktree were preserved. The shared website/app change is available for local review only.

## Behavior

Nearby opens upcoming shows first, followed by the venues tab. Filters are All dates, Tonight, This weekend, Pick a date, manual city and 25/50/75/150 km where a qualified coordinate exists. Results open existing artist, venue and event pages. Ticket URLs use the existing ticket-link safety flow. Directions open an external URL containing only the venue destination; the app supplies no origin or device location. Nearby imports no embedded map and makes no geolocation request. Other Maps features were left in place.

The finder uses the existing graphite/warm-text/orange theme, real data, and genuine HTTPS event images when provided. The tested Toronto feed has no eventImage values, so the rows omit photos. No neighbourhood was supplied in the tested venue projection. Missing details are not invented. Cancellation, release time, venue timezone, multi-day events, date boundaries and empty/error states are handled. Account-scoped city/filter selection survives detail Back navigation in memory.

Manual-city testing uncovered an existing name-only venue-coordinate fallback that could center Toronto on Rochester. Nearby now uses the legacy city coordinate catalog only if the picker contains exactly one matching country/state/city identity. Ambiguous names such as London use exact qualified city results and explicitly say distance is unavailable. No venue-coordinate average or cross-city guess is used for manual selection. A qualified city-coordinate catalog remains a future data improvement.

## Actual verification

- Final focused regression: **66 passed**, plus **2 native read-only guard tests**. Logs: `.tmp/show-finder/final-regression.log` and `review-guard.log`. Coverage includes Nearby routing/entry, date filtering, ambiguous cities, destination-only directions, raw provider coordinates, venue indexes/Unicode normalization, lifecycle, member access, analytics and news links.
- Final web and Android JavaScript exports passed. Logs: `.tmp/show-finder/export-web.log` and `export-android.log`. The existing x86_64 Android debug APK was reused; this change adds no native dependency. This JavaScript repository has no standalone TypeScript check.
- Emulator `emulator-5554`, API 36, `com.mshpit.app.dev`: manual Toronto returned **155 shows / 52 venues at 75 km**; manual London, Ontario returned **10 shows / 2 venues**, with no distance controls. Counts reflect the live read-only feed at test time.
- Earlier controls exercised in this review: Tonight, weekend, a picked October 15 date, combined 25 km/weekend, and venue/artist/event details with Back restoration. The external Directions intent reached the installed browser activity. No ticket purchase or production write was performed. Existing authenticated session retained.
- Short four-swipe scroll smoke check completed without a crash, but emulator graphics were poor: **62/78 janky frames**, p90 **85 ms**, p95 **97 ms**. This is a development emulator diagnostic, not a release/phone performance result. Existing playback/scroll jank remains unresolved. Bounded Nearby provider computation remains fast (warm localVenues ~33 ms, regionShows ~63 ms); these timings are not full-screen latency.
- Local web `/nearby` rendered at desktop and 430px screenshot widths. Read-only browser diagnostics found **0 embedded Google Maps scripts / 0 Maps SDK requests**, and no route error. Browser selected-city/filter UI interactions were not tested because supported browser-control surfaces were unavailable; Android interaction evidence does not replace that check.

Screenshots are actual captures in `.tmp/deliverables/`: `mshpit-show-finder-android.png`, `mshpit-show-finder-filters.png`, `mshpit-show-finder-city.png`, `mshpit-show-finder-web.png`, `mshpit-show-finder-web-mobile.png`, plus artist/venue/event detail captures. None were generated.

## Reproduce the local review

PowerShell terminal for the existing AVD/device and native review:

```powershell
. 'D:\Development\Tools\Use-Android.ps1'
cd 'D:\Development\Apps\mshpit'
adb devices
adb reverse tcp:8081 tcp:8081
$env:EXPO_PUBLIC_API_URL='https://www.mshpit.com'
$env:MSHPIT_APPROVED_LIVE_API='1'
$env:EXPO_PUBLIC_PRODUCT_ANALYTICS='0'
node scripts/mobile-dev.mjs start --port 8081 --max-workers 2
```

This is the previously owner-approved live **read-only** review mode. The runner selects the separate dev app identity and enables `EXPO_PUBLIC_NATIVE_READ_ONLY_REVIEW`; the guard blocks product writes while permitting authentication. Open **Mshpit Dev** on the emulator and connect to `http://127.0.0.1:8081`. If necessary:

```powershell
adb shell am start -a android.intent.action.VIEW -d 'mshpit-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' com.mshpit.app.dev
```

The local web preview is `http://127.0.0.1:4140/nearby`. Start it again with `node .tmp/show-finder/preview.cjs` after the web export. Its localhost-only proxy forwards GET/HEAD to the canonical public API, strips cookies/authentication and Set-Cookie, and rejects writes with 405 before forwarding. The helper/export are ignored local review artifacts, not production server changes.

```powershell
$env:EXPO_PUBLIC_API_URL='http://127.0.0.1:4140'
$env:EXPO_PUBLIC_PRODUCT_ANALYTICS='0'
npx expo export --platform web --output-dir .tmp/show-finder/export-web
node .tmp/show-finder/preview.cjs
```

Stop Metro before exporting if Windows Metro cache contention stalls a build. Restart it after exports finish. No Android SDK download or additional license acceptance was needed for this review.

## Windows / iPhone boundary

The existing free Windows Android development path is now running, superseding the initial emulator blocker recorded in `WINDOWS_MOBILE_DEVELOPMENT.md`. Its x86_64 debug APK compiled react-native-share 12.3.1; successful compilation does not prove sharing into target apps.

With a matching SDK 57 Expo Go and compatible iOS, ordinary welcome/auth UI, feed/search/discover, artist/venue/city/event/calendar, profile and menu/settings screens are source-assessed preview candidates. No iPhone was tested. `react-native-share`, native social handoff/target-app detection, app identifiers, permissions, splash and deep-link configuration require a custom native build. No production code was rewritten to fit Expo Go. The safe default localhost API is not reachable from an iPhone; approved secure connectivity is still required for loaded data. Do not treat a blank/offline Expo Go preview as end-to-end validation.

Android does not certify iOS. Windows cannot run Apple's local simulator. An unsigned simulator compile requires a suitable Mac; remote EAS Simulator access was not assumed. Real signed iPhone/TestFlight testing remains for later Apple Developer enrollment.
