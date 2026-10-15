# City/detail recovery, extended media reuse and Android fullscreen

Continues the clean `84a45cd` mobile review in the isolated checkout. The owner's session, theme and other checkouts were preserved. The canonical API remained behind the native read-only guard with analytics disabled. No production posts/reactions, account action, deployment, paid service, new credentials or dependency upgrade was used.

## Bounded City and detail recovery

An ephemeral debug-runtime fetch wrapper affected only public GETs for Toronto's guide and public event resolution. It delayed selected reads by 2–4 seconds or rejected them locally after about 1.2 seconds. Other requests retained their normal transport; credentials and headers were neither logged nor changed. Windows/emulator networking settings were untouched. The wrapper was removed after the cases below.

| Case | Actual Android result |
| --- | --- |
| City slow initial load | Loading state displayed, followed by the populated guide. The intentionally delayed request completed in 4,622.7 ms including a 2,000 ms fixture delay. |
| City cancel while delayed | Hardware Back returned to Discover; the delayed read aborted before forwarding. No late City screen appeared. |
| City initial offline / Retry | Explicit error and Try again appeared, rather than an empty guide. Restoring transport and invoking the real Retry handler loaded the guide. |
| City failed refresh / Retry | Existing guide stayed mounted during refreshing and after failure, alongside error/Retry. Retry recovered and cleared the error. |
| Public show slow initial load | Loading changed to populated public event details; the intentionally delayed resolution took 2,139.6 ms including the fixture delay. |
| Public show cancel while delayed | Hardware Back returned to City; the delayed detail read aborted before forwarding, with no late Show screen. |
| Public show initial offline / Retry | The real panel entered error with no event, then loaded the event after transport restoration and Retry. |
| Public show failed refresh / Retry | The event stayed available while refreshing and after failure. Retry restored ready state. |

These are targeted application-transport fixtures, not a complete airplane-mode or device-network certification. Timing includes intentional delay and is not a new baseline. Local diagnostics contain the expected simulated failures; no production failure report was submitted. Fresh accessibility bounds and a physical Back tap confirmed the City header remained available; no clipping change was needed.

Receipts: `.tmp/overnight/network-review/` (`city-cancel`, `city-slow`, `city-offline-retry`, `city-stale-retry`, and matching `detail-*` JSON files). Actual screenshots under `.tmp/deliverables/` include `mshpit-city-offline-initial.png`, `mshpit-city-offline-retained.png`, `mshpit-city-offline-recovered.png`, `mshpit-detail-offline-initial.png`, `mshpit-detail-offline-retained.png` and `mshpit-detail-offline-recovered.png`.

## Thirty-cycle local media reuse

The same native viewer opened/played/closed the verified local copy of the earlier public concert clip **30 times**, with no post association or reaction fetches. File: 22,564,474 bytes, SHA-256 `f9c8ab2464022adfd6caeb8ff37ab4a69a5c46aab8118ae297e110efef096052`. Reusing the fixture avoided repeatedly downloading the clip. This checks native reuse, not CDN behavior.

- Every cycle mounted one primary viewer player, advanced past one second and released that player on close.
- Home/background samples at cycles 3, 15 and 30 paused with zero sampled clock advance; returning stayed paused.
- Settled media resource-manager clients for the app were zero; Activity count returned to one and view count was 675 → 676.
- Baseline → eight-second-settled PSS: **814,177 → 822,068 KiB (+7.7 MiB)**. Native heap PSS: **516,034 → 522,150 KiB (+6.0 MiB)**. This is a bounded sample, not a leak-free certification or a release memory budget.

Logs: `.tmp/overnight/media-resources-long-local/`. A later memory snapshot taken while the share chooser was open is separately named `during-share-chooser-meminfo.txt` and is excluded from the idle comparison. This 30-cycle run preceded the fullscreen fix below; the corrected code was separately verified for inline and fullscreen Home/Back behavior.

## react-native-share runtime check

The installed 12.3.1 module was initially uninitialized/lazy. Calling its reviewed `open` API with diagnostic text and no file/recipient opened Android's actual system text chooser. Hardware Back resolved **`dismissedAction: true, success: false`**. No target was selected, no message was sent, and no storage permission was requested. The first observer expected an older Android activity-field name; current activity/window evidence and the cancellation result confirmed the outcome.

Receipt: `.tmp/overnight/native-share-chooser.json`; actual screenshot: `.tmp/deliverables/mshpit-native-share-chooser.png`. This establishes native module loading, chooser opening and cancellation on this Android emulator. It does not test the app's share-card server path, Instagram/Story/target-app delivery or iOS. Custom native sharing remains outside Expo Go support; no production code was rewritten to fit Expo Go.

## Corrected Android fullscreen pause

The extended check exposed a real transition bug. A playing clip entered `expo.modules.video.FullscreenPlayerActivity`, then paused automatically before/after Back. A temporary JS pause observer recorded a React passive-effect call at the stopped clock position. Suppressing that JS call restored continued playback, while the SDK still paused real Home/background transitions. The observer/override was removed after this controlled experiment.

Expo SDK 57's installed Android `VideoManager` pauses background video when `staysActiveInBackground` is false, explicitly exempting fullscreen. `FullscreenPlayerActivity.onPause` handles actual backgrounding, while its intentional finish/Back path reattaches the player without pausing. The app's unconditional JS AppState pause mistook the internal activity transition for leaving the app.

`MshpitVideoPlayer` now delegates that decision to Android's native SDK, retaining `staysActiveInBackground = false`. iOS and web keep their previous explicit JS pause path. No automatic restart or background playback setting was enabled. The change is one platform condition plus its explanation; no native dependency or APK permission changed.

| Verification | Result |
| --- | --- |
| Observed original behavior | Playing before entry; stopped on return. JS observer recorded the automatic pause from the component's effect. |
| Controlled JS-pause suppression | Playback continued through fullscreen/Back; native Home remained paused on return. |
| Actual corrected code, no override | Playback advanced 7.670 s across the fullscreen/return sample and was still playing after Back. The sample includes handoff stalls; no real-time/frame-rate claim is made. |
| Home from inline after fullscreen | Clock stayed exactly 10.000 s across the background samples; return stayed paused. |
| Home directly from fullscreen | Returned to inline paused at 6.202 s; a later sample stayed at the same position. |
| Viewer close | Player released in both corrected native cases. |

Receipts: `.tmp/overnight/fullscreen-js-pause-observe/`, `fullscreen-js-pause-suppressed/`, `fullscreen-fixed-native/` and `fullscreen-fixed-home/`. Current SurfaceFlinger output did not yield usable fullscreen frame samples; no fullscreen FPS result is claimed. Actual corrected fullscreen pixels are in `.tmp/deliverables/mshpit-native-fullscreen-fixed.png`.

Twenty-five focused production-component/player tests pass, including the Android delegation/configuration regression, unchanged iOS/web inactivity behavior and timer/listener cleanup. The fixture now executes the real player setup callback once so the native background flag is covered. Final full-suite/export checks are recorded below after completion. The updated development client remains the previously verified x86_64 SDK-patched APK; this fix is JavaScript-only.

## Advisory and Library handback

See [the exact advisory ledger](ADVISORY_LEDGER_2026-10-15.md): **two distinct advisories inherited by 19 affected package-level entries**, with exact GHSA/CVE IDs, URLs, dependency paths and exploit prerequisites. Neither has a published fix; no broad dependency change was made.

The four confirmed Library saves are unchanged; no duplicate images were uploaded:

| Screenshot | Library ID | File ID |
| --- | --- | --- |
| Discover before, 360 dp / 130% text | `libfile_6e3b2dff3e4c81918504d8d8eedbbf32` | `file_000000007b0c820c811b5efa8dde61cb` |
| Discover after, whole labels | `libfile_5536c9852fa08191b5cb4a6b41b13197` | `file_00000000a09481f7aadd8bb4b41f71be` |
| Settled recovered Discover | `libfile_b3e4fafbc960819187f415870a10f0ab` | `file_00000000f1e081f784a03b8c8b8e0385` |
| Verified native fullscreen | `libfile_f2551f1a0eb08191ac4b26341f360c47` | `file_00000000e0d481f7b9691a8ec53fc514` |

The receipt remains in the task workspace's `overnight-direct-library-receipts.json`. The saved fullscreen image is from the earlier visual check; the new lifecycle correction is evidenced separately above. Android results do not establish native iOS behavior. No Apple simulator, signed iPhone/TestFlight or real target-app sharing result is claimed.


## Final regression gate

- **6,332 tests: 6,331 passed, 0 failed, 1 skipped**, 84.288 s; `.tmp/overnight/fullscreen-fix-full-tests.log`.
- Syntax passed for 854 Node files; architecture passed at the unchanged 144/144 Store-hook ceiling. No TypeScript project check is claimed.
- Android, iOS and web exports all passed with external maps; `.tmp/overnight/export-results.json`. Final Android/iOS graphs retain 2,040/2,043 sources and contain neither advisory package. No native iOS compile/runtime result is inferred from an export.
- The guarded development server was restored after exports. No native dependency, permission, signing or production deployment changed.
- Main web checkout remains `f7fda62` with only its original untracked audit; the separate font/CSP checkout remains clean at `dd3a412`.
