# Focused native speed pass — October 14, 2026

Based on clean local commit `143feea`; theme/layout preserved. Signed-in live review remains read-only, with analytics disabled. No production deploy, account/credential operation, Google investigation or security change.

## Proven Nearby bottleneck and fix

Hermes CPU profiling of the first **fully hydrated** Nearby calculation showed 3,576.45 ms for 52 venues and 41.39 ms for 157 shows. Of 306 CPU samples, 295 were in `stringPrototypeToLocaleLowerCase`, called by venue identity normalization. An earlier six-venue / zero-show partial hydration sample was excluded from the comparison.

Native Hermes now uses Unicode default lowercase, which has the same semantics as the existing English lowercase operation. Web and Node retain the original `toLocaleLowerCase("en")` path. Canonical aliases, typography normalization, collision rejection and coordinate precedence are unchanged.

After an Activity restart, the first fully hydrated call returned the same 52 venues / 157 shows: venue calculation **82.81 ms**, show calculation **40.79 ms**, 12 CPU samples with zero locale-lowercase samples. Venue computation fell by about **97.7%** in this matching diagnostic scenario. These are computation timings, not full-screen-ready or release-device timings. The prior 4.28-second observation is historical; this pass supplies its own matched before/after.

Tests include contextual Greek final sigma, dotted I, accents, supplementary-plane letters, full-width letters, typography, and every Unicode code point that changes under lowercase. Identity/index/count contracts pass.

Evidence: `.tmp/speed/nearby-before-full.json`, `nearby-after-full.json`, `identity-tests.log`.

## Playback diagnosis

At the original 1080x2400 / density 420, actual playback advanced from 0.468 to 8.093 seconds. Only **three React commits** occurred across eight seconds; **519/525 Hermes CPU samples were idle**, with no sampled GC or recurring JavaScript hotspot. Android nevertheless reported 41/57 UI deadline misses, p50 34 ms, p90 42 ms and 37 slow draw-command frames. This points to work outside the sampled React/JS path; it does not prove a specific GPU or decoder defect.

SurfaceFlinger confirms the app uses the native SurfaceView video presentation. Android's `media.codec` diagnostic service is unavailable on this AOSP image, so decoder identity/drop counts were not established. Memory was about 655 MB PSS / 815 MB RSS, zero swap; earlier paused-state memory was about 673 MB PSS. This bounded run does not show a JavaScript allocation/GC loop, and is not a memory-leak certification. Raw names/counts were sanitized; no media URL or account data was persisted.

Evidence: `.tmp/speed/player-1080.json`, `player-1080-gfx.txt`. Android gfxinfo measures app UI frame deadlines; it is **not decoded-video FPS**. The previously reported 35/59 misses and 77 ms p90 remain a separate unprofiled sample. Small samples, profiler/input overhead and the Windows emulator limit all comparisons. No playback smoothness improvement is claimed from the casing fix.

A temporary 720x1600 / density 280 comparison preserves logical layout while reducing display pixels. The initial attempt had no mounted player and was discarded. The valid result, if obtained, is appended below. Original display settings are restored before handoff.

## Smallest next test

Use the existing Android development build on a physical Android device if one is available, with the same clip and bounded Play/Close/scroll scenario. A release-JS comparison on that device would distinguish dev/emulator costs without purchasing services; preserve review write/analytics protections explicitly before any live-API benchmark. No release certification or iOS certification is claimed here.

Run commands and the existing APK/emulator path remain in `WINDOWS_MOBILE_DEVELOPMENT.md` and `NATIVE_SITE_THEME_RESTORATION_2026-10-14.md`.

Valid same-clip / same-logical-layout resolution comparison: 1080x2400, density 420: 41/57 deadline misses, p50 34 ms, p90 42 ms, 3 React commits, 519/525 idle samples. 720x1600, density 280: 41/56 misses, p50 34 ms, p90 44 ms, 3 commits, 525/532 idle samples. Playback advanced to 8.049 s in the lower-resolution run; it was actually playing at both endpoints. No demonstrated pixel-resolution improvement. Memory 623 MB PSS / 784 MB RSS, zero swap. These results suggest native presentation/control/compositor costs rather than a sampled React/JS loop, but do not isolate decoder from UI renderer. Original physical display 1080x2400 / 420 restored and verified. Evidence: player-720-valid.json and player-720-valid-gfx.txt. No player source change or speculative renderer replacement was committed.

Final verification: 81 targeted regressions passed; Android production/Hermes and web exports passed (.tmp/speed/export-android.log and export-web.log). Node syntax and diff whitespace checks passed. Real optimized Nearby rendered 52 venues / 157 shows at restored 1080x2400, with theme intact. Runtime public guard projection still reports approved https://www.mshpit.com API, readOnly=true, content POST denied and user login allowed. Existing native APK reused; no native dependency/signing change.
