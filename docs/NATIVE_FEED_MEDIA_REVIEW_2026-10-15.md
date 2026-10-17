# Native Feed/media retention and measured runtime checks

Continues [the SDK patch review](SDK_PATCH_RESOURCE_REVIEW_2026-10-15.md) in the isolated mobile checkout. No deployment, main web checkout change, production mutation, paid service or credential operation was performed.

## Corrected behavior

Opening a photo/video directly from the signed-in native Feed previously unmounted the entire Feed. Closing the viewer rebuilt the list and lost its position: a measured native list offset of approximately 1,105.5 returned to zero. Repeated media visits also recreated the list's native views and image work.

The native Feed now stays mounted under its direct media viewer. Its invisible underlay blocks input and accessibility traversal; Feed view qualification and media generation are inactive while covered. Closing the viewer removes its player and restores the same Feed/list instance. The layer is keyed to the account. Guest screens, web layouts, other tabs and media opened over a detail/auth/composer frame keep their previous routing boundary. There is no new persistent cache or retained account data across sign-out.

Actual Android validation opened an existing public photo and used the hardware Back event. The same FlatList object had offset **1,099.4286 before, while covered and after Back**; Feed `visible` was true → false → true, and viewer count was 0 → 1 → 0. Evidence: `.tmp/overnight/native-feed-media-back-and-offset.json`. The change is in `NativeFeedMediaLayer.jsx`, its narrow routing policy, App integration and native Feed activity gating.

## Navigation and scrolling measurements

These are development-build measurements on the existing visible API 36 x86_64 emulator with host graphics, normal native audio and no concurrent builds during sampling. Component navigation callbacks were invoked through the local debug inspector; scrolling and the Back verification used Android input events. Request logs retain endpoint categories/timing/status only. The temporary fetch wrapper and probe globals were removed afterward.

| Route | Content committed plus two animation frames |
| --- | --- |
| Toronto, first measured visit | 4,988.6 ms; guide request 2,701.5 ms, copy request 3,842.5 ms |
| Toronto, repeated visits | 1,664.5 and 1,627.5 ms; guide requests 319.0 and 323.4 ms |
| Real public show from Toronto | 1,057.8, 782.5 and 806.4 ms |

Polling resolution was about 150 ms. The readiness condition checks the committed CityGuideContent or populated PublicEventSnapshotPanel, then two requestAnimationFrame callbacks. It does **not** measure completion of every native image decode or establish a release-device startup SLA. Settled screenshots were checked independently. This retention change does not claim to improve city-network latency. The selected show had no canonical social show document (404); its valid public event snapshot still rendered, preserving the app's existing fallback.

Eight native swipes (four down, four up) were sampled with `adb shell dumpsys gfxinfo com.mshpit.app.dev reset` and `framestats`, without inspector polling during the swipe interval:

| Screen | Frames | Android deadline-janky | Legacy janky | Frame p50 / p90 / p99 |
| --- | --- | --- | --- | --- |
| Toronto City | 358 | 10 / 2.79% | 231 / 64.53% | 23 / 26 / 40 ms |
| Feed | 307 | 26 / 8.47% | 268 / 87.30% | 25 / 36 / 61 ms |

Both counters are retained because the modern deadline and legacy 16.7 ms criteria differ. These results do not establish steady 60 fps; the Feed still deserves release/device profiling. Emulator GPU timing included a 4,950 ms histogram bucket and is not used as a reliable GPU-tail estimate. Raw logs are `scroll-city-framestats.txt` and `scroll-feed-framestats.txt` under `.tmp/overnight/`.

## Bounded media/resource checks

Before the retention change, two six-cycle runs opened the existing 25.175-second public clip, played past one second and closed it. A photo-only six-cycle control mounted no MshpitVideoPlayer. The owner session and settings were preserved; there were no uploads, reactions, account actions or test posts.

All viewer players became unusable/released after close. Each run's third cycle used Android Home: playback stopped, its clock stayed unchanged across the background sample, and returning kept it paused. Android's media resource manager had no remaining app codec clients after settling. A temporary codec pair seen during early thumbnail work also cleared; immediate and settled snapshots are retained separately.

The original warm video run still grew in native memory; the photo-only control grew similarly. Hermes used about 30 MB of JS heap, and an explicit diagnostic collection reduced that to 26.9 MB without clearing native growth. This did not support blaming an accumulating active video decoder alone.

After retaining the Feed, another six-cycle run repeated play/close and Home/return checks. The primary player released in all six cycles, and settled codec clients again numbered zero. Memory readings below are within-run comparisons; absolute readings across warmed/HMR states are not comparable:

| Six-cycle run | Baseline → settled PSS (KiB) | Baseline → settled native heap PSS (KiB) |
| --- | --- | --- |
| Original warm video | 752,710 → 790,092 (+36.5 MiB) | 467,798 → 495,778 (+27.3 MiB) |
| Original photo-only control | 787,413 → 827,421 (+39.1 MiB) | 495,514 → 529,202 (+32.9 MiB) |
| Retained Feed video | 878,668 → 865,601 (−12.8 MiB) | 568,126 → 565,890 (−2.2 MiB) |

The corrected run's post-close native heap readings stayed between 564,438 and 567,546 KiB rather than adding several MiB per visit. This supports retaining the list to reduce repeated native allocation and preserve user context. A six-cycle sample does not prove leak-free operation or establish the release app's memory budget. Longer low-memory and physical-device tests remain useful. Logs are in `.tmp/overnight/media-resources/`, `media-resources-warm-repeat/`, `photo-control/` and `media-resources-retained-feed/`.

## Validation and limits

Fourteen focused tests pass, including the production layer's hidden input/accessibility behavior, native-only policy, unrelated/guest/auth/detail rejection, unchanged web activity policy and existing Feed row memoization. The native hardware Back/list identity check and six post-change video cycles passed. Full regression/export results are recorded in the final checkpoint below.

The SDK-patched native APK remains installed; this change is JavaScript/UI-only and runs from the guarded Metro development server. Updated APK ZIP alignment and all 26 x86_64 ELF load-segment checks pass. It is not an ARM release or iOS validation. No native iPhone, Apple simulator, TestFlight or external target-app sharing result is claimed.

Actual screenshots include `mshpit-sdk-patches-running.png`, clean `mshpit-sdk-toronto-scrolled.png` and `mshpit-retained-feed-native-player.png` in `.tmp/deliverables/`. The last is a settled native viewer with Play shown, not standalone proof of playback; playback is evidenced by the clock/resource receipts. Earlier four selected screenshots are already saved to Library; no duplicate upload was needed.


## Final checkpoint

- Full suite: **6,331 tests; 6,330 passed, 0 failed, 1 skipped**, 86.323 s; `.tmp/overnight/native-feed-media-full-tests-final.log`. The first full run exposed a second old source-text assertion of the previous media visibility expression. Both affected assertions now require the inactive-native gate; the final full run passes.
- Syntax: passed, 854 Node files. Architecture: passed with the unchanged 144/144 Store-hook ceiling. No TypeScript project check is claimed.
- Android, iOS and web exports: all passed with external source maps; `.tmp/overnight/export-results.json`. Android/iOS graphs now have 2,040/2,043 sources; the two vulnerable host-tool packages remain absent. No web deployment was performed.
- SDK-patched native APK installation, ZIP alignment and all 26 x86_64 ELF checks passed. UI-only retention code was smoke-tested through the existing development client.
- Temporary runtime probes were removed and the guarded live read-only Metro server was restored. Final guard and screen receipts are under `.tmp/overnight/native-feed-media-final-*`.

Reproduce the free local development path using [the Windows run commands](NEARBY_SHOW_FINDER_REVIEW_2026-10-15.md). For a bounded resource comparison, capture `adb shell dumpsys meminfo com.mshpit.app.dev` and `adb shell dumpsys media.resource_manager` before and after repeated open/play/close operations; compare within one warmed process and retain an idle-settled sample. For scrolling, reset gfxinfo before a fixed swipe sequence and collect `dumpsys gfxinfo com.mshpit.app.dev framestats` afterward. Keep the development analytics/read-only guard enabled against the canonical API.

Next useful measurements are release-like profiling on a physical Android device, longer low-memory reuse and cold city/detail behavior under a bounded slow/offline transport fixture. External native sharing and real iOS checks remain separate device gates.
