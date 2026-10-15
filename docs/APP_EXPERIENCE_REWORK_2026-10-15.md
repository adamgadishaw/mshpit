# Native app experience: first pass and rework order

The native app should keep the website's concert-memory identity and complete flows, while giving each phone screen a clear primary task. This is an incremental plan, not a completed redesign or performance certification.

## Verified starting point

- The canonical website checkout remains read-only at `D:\Websites\Concert Website\pit`, HEAD `f7fda62`; its pre-existing untracked audit file is preserved.
- Both repositories declare the same Stage palette in `src/theme.js`: background `#09090B`, raised background `#0F0F12`, surface `#141418`, warm accent `#F2A65A`, strong accent `#FF8C42`, text `#F4EFE7`.
- Actual Android screenshot pixels include those exact colours, rather than a global shifted version. In the synthetic Delete screenshot there are743537 background pixels,573267 raised-background pixels,645377 surface pixels, and12164 strong-accent pixels. These counts describe that frame only.
- Read-only Android colour diagnostics show no per-app saturation overrides, colour mode NATIVE/COLORIMETRIC, and unsupported Night Display/white-balance/reduced-brightness controls. Inversion/daltonizer/Night Display settings return null (unset, not proof about the Windows monitor). No display, security, virtualization or accessibility setting was changed.
- Shadows, scrims and borders intentionally produce additional colours. The native Media3 controls shade the picture while controls are visible. That is separate from changing encoded video colour. A specific owner example is still needed to identify whether the reported issue is UI, media, or the host emulator window. No hue/contrast/converter change was guessed.

## First local improvement

The native shell already shows the MSHPIT logo and profile link. Feed repeated another large MSHPIT wordmark and tagline directly below it. Native Feed now has a smaller `Your feed` title and no repeated tagline; Activity, Inbox, Menu, local discovery, onboarding, filters and content keep their behavior. The website branch keeps its original wordmark and tagline. This changes no palette values or stored preferences.

Actual screenshots were inspected after a clean development-client reload, not just Fast Refresh. The fresh Android hierarchy contains exactly one MSHPIT text label, the Your feed title, and all three header actions. Owner session is present and production Like/Post/Report remain blocked. Relevant interaction tests:14 passed; Android/Hermes export passed,9.5MB. The previous gesture commit's full regression suite passed6367/6368 with one skip and zero failures.

Library evidence:

- Before: `libfile_56376cca7f2c8191bf17e1cf1c230207` (`owner-feed-layout-before.png`).
- After: `libfile_b1fdfa67cf588191bd2c235b161b2075` (`owner-feed-layout-after.png`).

## Screen-by-screen next passes

| Screen/flow | Evidence and issue to address | Purposeful change and verification |
| --- | --- | --- |
| Feed | Actual first-visit frame spends much of the viewport on the repeated header, onboarding and suggested people before concert memories. Header duplication fixed in this pass. | Next, compact the first-visit guide without losing Find/Log actions and keep discovery/context secondary to the chosen feed. Compare first-content position, large text, empty/error states, and return-to-scroll behavior. Do not silently change the default feed or recommendation meaning. |
| Review cards | Native View/Compare rows and player repairs are already verified. Repeated swipe hints and multiple outlined containers compete with concert content. | Keep artist, show, review, media and score hierarchy; keep View/Compare explicit. Reduce repeated instructional chrome only after testing discoverability. Like/Repost stay on the action rail; media remains isolated. |
| Search | `SearchScreen.jsx` already separates immediate input from a250ms settled-query debounce and scoped remote results. | Keep one obvious search field, clear category/result hierarchy, stable retained results during loading and failure. Measure typing-to-results separately from networking and debounce; do not remove supported categories. |
| Discover | `DiscoverScreen.jsx` combines charts, genres, venues, photos, festivals, recommendations and local event discovery. | Lead with nearby upcoming shows and location context; make other programmes an explicit secondary choice. Preserve all programmes and location semantics. Test horizontal content rails against tab swipes and vertical scroll. |
| You/Profile | `YouScreen.jsx` deliberately reuses the public Profile with private tools/memories. The synthetic profile exposed a very short gallery tile and rollback changes scroll extent; these need actual-owner reproduction before a source fix. | Give identity, concert history, media and posts clear sections; keep private tools distinct. Verify real gallery dimensions, own/other permissions, history load/error states, deleted-row rollback position and large text. Do not change public/private meaning. |
| Compose/upload | `LogScreen.jsx:887` uses `uploadOriginalMediaAsset`, `postWhileConverting:true`, immediate stage updates and bounded byte-progress publication. | Make Preparing, Uploading, Converting, Ready, Retry and Cancel understandable and accessible. Preserve resumable originals and existing account fencing. Test with local fixtures first; no production test post. |
| Video viewer/player | Actual native playback, fullscreen, Home/return, completion and replay have passed. Native video controls are siblings outside photo/post/page pan detectors. | Keep one clear play action and real native controls. Measure first frame, seek response and transition consistency on the same clip. Compare colour with controls hidden and with the source's HDR/range metadata before changing treatment. |
| Converter | A converter already exists; see below. | Exercise its existing bounded test matrix locally before proposing quality/latency changes. Preserve source ownership, retry, poster, rotation and colour guarantees. No new paid pipeline. |

## Existing converter, not a new service proposal

Native picker: `src/lib/composerMediaPicker.js` uses SDK57 ImagePicker originals. `LogScreen.jsx` calls `src/lib/mediaAssetUpload.js`, which uploads stable originals with account-scoped requests and source IDs. `mediaAssetFinalize.mjs` reconciles detached conversion through owner-only reads, polls every5s and preserves saved uploads for resume. Client-side cover generation is poster extraction, not video transcoding.

The server's media-assets/control plane invokes the existing `server/videoVerifierService.js` FFmpeg/ffprobe worker through its signed protocol. Compatible sources can take a remux path; others transcode to H.264/yuv420p MP4 with AAC audio and faststart, bounded dimensions/frame rate/bitrate, and validated poster output. HDR handling already uses zscale and Hable tone mapping toward BT.709 SDR; SDR range and HDR highlight fixtures exist. Policy currently admits video sources up to500MiB,10minutes and4096x2160, with delivery capped at60fps and1920x1080 bounds. These are code facts; no production converter health or new real transcode run is claimed here. Nothing was deployed or enrolled.

Highest-value converter matrix: portrait/landscape, rotation, SDR full/limited range, HEVC HDR/PQ/HLG, silent and audio clips, compatible remux versus transcode, near-limit sizes, failure/cancel/retry/resume, poster correctness and completion-to-visible-ready delay. Use the existing self-test (`server/videoVerifierService.js --self-test`) only with its verified installed FFmpeg prerequisites and local storage adapters; never point it at production objects for test writes.

## Responsiveness evidence and next gate

Actual warm Feed/Search rail swipes all reached the intended screen with the owner session and guard intact. A bounded Android `gfxinfo` sample recorded293 frames,272 janky frames(92.83%), frame p50=57ms, p90=125ms, p95=250ms and35 high-input-latency events. Evidence: `.tmp/overnight/native-warm-tabs-rendering.json`. The reset sample includes ADB/accessibility/inspector instrumentation on an SDK57 debug emulator; it is not a release benchmark or input-to-photon measurement. The observer's6–8s wall times include slow snapshot and inspector operations and must not be reported as app gesture latency. The emulator's GPU histogram sentinel must not be interpreted as real4.95s GPU work.

This result is a performance concern, not a responsiveness pass. Before broader animation/layout work, compare the same warmed navigation/scroll workload in the existing release fixture and then profile UI-thread drawing, bitmap uploads, shadows/overdraw, JS commits and host/emulator load separately. Retain transformations on the UI thread and avoid per-frame React updates. Do not change virtualization/security settings, turn off accessibility, or change product behavior to hide the measurement. Physical Android and real iPhone validation remain outstanding.

## Gesture closeout

Gesture commit: `21b34dd2c06a44491d5bf9a6ebf2a2fe780bc80d`.33 synthetic device checks passed across actions, tab navigation, gallery, Delete, refresh and video scrubber cleanup. All fixture overlays restored; fixture tree clean at `558382f`, localhost8082 server/reverse removed. Owner post-integration checks cover paused/playing fullscreen and Home-return pausing; an additional known-start check passed replay advance, completion rewind, ended fullscreen zero and final player release (`gesture-owner-player-final-check.json`,4 checks). The earlier full three-cycle player evidence is retained unchanged; a superseded short-remaining-time smoke timeout remains recorded rather than being presented as a pass.

No app-wide redesign, converter-quality change or colour correction is claimed. The next material input is the location/example of the owner's colour issue; the current palette and functional meanings remain the baseline.

## Scoped native refinement verification — 2026-10-15

Native concert cards now keep their action rail on the card's own surface, omit the permanent swipe instruction, use compact icon/count actions with full accessibility labels and 48dp target heights, and place the view tally beside the date. Native card padding is 12dp and its extra shadow is removed. Website markup/sizing is retained through explicit platform branches. Repost Undo, direct action buttons, failures and account fencing remain. Like success uses the existing heart/count plus an accessibility announcement. The own-post management strip says “Manage post”; its text fades before it can clip during Delete reveal, and returns after cancellation.

Native upload progress distinguishes measured byte transfer from indeterminate processing/finishing. Conversion notices check immediately on native mount/foreground, stop in background, serialize checks and abort/ignore retired results. Web keeps its existing interval-first check timing. This is client progress/recovery verification; no real upload, post, FFmpeg conversion or production converter-health check was executed.

Validation: full regression suite 6374 tests, 6373 passed, zero failed, one skipped. The six new executable conversion tests cover immediate/serialized checks, retirement/abort, foreground recovery, unchanged web cadence, measured transfer versus processing and bounded/unknown progress. Source contracts were updated for the already intended native Feed title and extracted progress components; branding, upload retry/cancel and actual interaction assertions remain. Syntax:855 Node files passed. Architecture:Store hooks144/144, state47/47, routes156/156; baseline allowances unchanged. No TypeScript project check is claimed. Final isolated x86_64 release build passed offline in1m42s,875 tasks(24 executed); APK SHA256 `40fa40d6dc4045e54b43aeb31675c8b054d6344de8ba2f0f6fc3b8d68df31f09`,81211681 bytes. Earlier baseline release/debug build passed after one missing official AndroidX AAR was retrieved; no new app dependency, SDK tool, signing credential or licence acceptance was added.

### Matched responsiveness measurements

Fixed clock,20 synthetic posts/1000 events, same API36 emulator/density/font/render settings, two warm seconds after verified Feed readiness, eight alternating400ms swipes with200ms gaps. Three release/debug pairs per source, order alternating. No inspector/accessibility capture, builds or tests inside timing. Release uses embedded Hermes/no INTERNET permission; debug uses localhost8082. Baseline is0511523 with the same hash-tracked fixture overlays; refined is that source plus these changes. Later visual-only fixture preview changes were made after all timing finished.

| Median across three trials | Baseline release | Refined release | Baseline debug | Refined debug |
| --- | ---: | ---: | ---: | ---: |
| Whole-run HWUI janky frames |62.24%|60.19%|67.95%|69.70%|
| Whole-run HWUI p90 |101ms|105ms|109ms|109ms|
| Frame-stage UI-work p90 |11.06ms|14.48ms|18.13ms|17.01ms|
| Frame-stage sync-wait p90 |45.06ms|44.79ms|40.32ms|45.13ms|
| Frame-stage render-before-swap p90 |32.42ms|34.82ms|33.44ms|35.24ms|
| Frame-stage swap-to-complete p90 |41.95ms|41.88ms|41.08ms|42.99ms|

This does not establish a meaningful performance improvement. Jank remains substantial. Actual compressed atrace scheduler/slice analysis shows both extra debug JS CPU cost and graphics submission/buffer costs shared with release:baseline eglSwapBuffersWithDamageKHR p90 about40–41ms and dequeueBuffer about35–40ms. Slice times overlap and cannot be summed. Stage quantiles use the retained frame-stat ring buffer, whereas the whole-run histogram covers a different population. The emulator GPU histogram sentinel is not a real4.95s frame measurement. No single code culprit, physical-device smoothness or iOS performance conclusion is certified. Further isolated profiling/ablation and physical-device measurement remain necessary.

Evidence in `D:/Development/Apps/mshpit-perf/.tmp/performance/`: `ux-baseline-cohort.json`, `ux-refined-cohort.json`, both `*-trace-analysis.json`,12 raw `.atrace` files and corresponding `*-frames.txt`. The bounded orchestration/analysis scripts remain in the task workspace as `measure-ux-cohort.cjs` and `analyze-ux-traces.cjs`; preparing the same hash-tracked overlays is required before rerunning them.

### Actual screenshots and limits

Inspected actual native screenshots show the compact footer and Delete reveal with no clipped instructional remnant. Opening the synthetic Delete confirmation and pressing its fresh CANCEL control left the post present and restored the label. All fixture transport writes remained blocked. Initial screenshots taken before render settlement and a screenshot/accessibility timeout are superseded, not counted as passes. The final settled progress screenshot explicitly says LOCAL SIMULATED UPLOAD STATES — NO UPLOAD; its65% transfer, processing spinner and finishing spinner were inspected.

Library evidence:

- Simulated progress: `libfile_3b7a45437f60819198839dbeb1e08453` (`ux-progress-settled-final.png`).
- Synthetic Delete reveal: `libfile_7dcee8e4f3dc8191845945deb24aa4a6` (`ux-delete-reveal-final.png`).
- Synthetic Cancel return: `libfile_9a0770ad01f08191a28acf1651605169` (`ux-delete-cancel-verified.png`).

### Colour comparison correction

Token equality alone does not establish perceived or selected-theme equality. Independent cloud browser evidence from the parent shows the hydrated signed-out `/events` and Steve Lacy artist wrappers using warm-paper `#FBF7F0`, selected-tab `#F3ECE1` and heading `#1C140C`; the document body `#09090B` and dark concert hero are separate surfaces. That observation does not identify the owner's chosen website theme. The independent artist/video screenshots are desktop1180×757 only; mobile viewport was unavailable, and Community/review access required login. The Steve Lacy gallery's21.078333s portrait clip played in cloud Chrome; it is not the owner's Android20.633s clip or an iPhone test.

Source inspection finds `src/theme.native.js` re-exports `theme.js`, whose initial key isStage and whose saved preference/account synchronization uses web `window.localStorage` plus page reload. Website Daylight defines `#FBF7F0`. Native persistence/account-theme parity warrants a dedicated follow-up; no theme preference or palette is changed here. Do not infer the owner's desired theme from an anonymous browser, document body or matching Stage tokens. Same-account/same-theme rendered comparison remains outstanding.

### Cleanup

Every temporary fixture source/native overlay was restored using the hash-guarded restoration manifest; the fixture working tree is clean at558382f. Fixture packages were force-stopped, verified Metro8082 PID29184 stopped and only its reverse removed. APKs, local media and trace evidence were retained in ignored paths. Owner app data was never cleared and its APK never reinstalled in this phase. The canonical website checkout remains untouched. No deployment, production content mutation, paid service or Apple enrollment occurred. Android evidence remains separate from iOS certification.

Owner runtime confirms a concrete theme mismatch:accountTheme=daylight,activeTheme=stage,localStorageAvailable=false,background=#09090B,surface=#141418 (.tmp/overnight/ux-owner-theme-state.json). This explains a selected-theme discrepancy, though it does not certify encoded media colour. No account preference was changed.

Owner final clean reload recovered after restarting the verified stalled Metro process with the existing Windows EXPO_NO_METRO_LAZY=1 setting. Current guarded localhost8081 Metro PID9560, logs .tmp/overnight/metro-ux-final.log. Auth ready/session present, no temporary globals, Like/Post/Report blocked, exact feed-revalidation POST allowed; actual Feed screenshot inspected. No data clear or owner reinstall.

Final actual-owner screenshots inspected and saved:Feed libfile_8100be8c3b7081918127f9781cec7f42; Steve Lacy review/footer libfile_ae6378c2499881918f7427f74e12e24c. The real footer fits one row without the old permanent swipe hint or a forced raised-background action rectangle. It remains a Stage capture, not a Daylight match. Final Feed offset0, viewer false,players empty,session present. Upload receipts are retained in the task workspace; Windows extended-attribute tagging is unavailable.

## Native account-theme parity fixed — 2026-10-15

The confirmed account preferred Daylight while Android rendered Stage. This pass fixes that preference-loading bug; it does not change the account's selected theme or the website palette. `theme.js` now reads through a platform adapter before module-level StyleSheets resolve. The browser adapter retains the existing verified localStorage theme/owner pair and document reload. Native uses the already installed SDK57 SQLite key-value store, with theme and owner in one JSON value (`pit.native.theme.v1`), verified readback and Expo `reloadAppAsync` using the current bundle. No dependency or native APK change is required for these JavaScript changes.

The website's intended same-account local-choice priority is retained. A different account receives its own valid account choice; an unrelated/guest local choice cannot override it. Sign-out clears the pair and settled guest reconciliation returns to Stage. A valid guest choice is retained while signed out. Invalid, corrupt and inherited-property keys fall back safely. Unavailable/unverified storage cannot trigger a reload loop; a failed reload is reported and the saved choice remains available on next launch. Repeated reconciliation of the same stored pair avoids another write or reload. Like the existing browser, an owned boot cache may render while identity is being established; confirmed identity reconciliation prevents it from being adopted by another account.

Native theme reconciliation is local only and returns before Store's browser best-effort account PATCH branch. No theme-setting request was sent in this pass. The existing explicit choose-theme action retains its existing separate behavior; it was not invoked on the owner's production account. Both actual owner checks and synthetic transitions preserved that distinction.

Verification:

- 23 focused tests passed, executing the compiled theme module plus actual Root/Store reconciliation functions:initial guest/default, account adoption, account change, sign-out, same-account override, guest ownership, process-style relaunch, corrupt/unavailable storage, failed/unverified writes and contained reload rejection. Existing browser navigation/ownership tests remain intact with the new native dependency explicitly mocked as inactive for browser cases.
- Full regressions:6383 tests,6382 passed,zero failed,one skipped (`.tmp/overnight/native-theme-regression.log`).
- Syntax:855 Node files passed. Architecture:Store hooks144/144,state47/47,routes156/156,other allowances unchanged. Removed only the retired `src/theme.js` silent-catch allowance; legacy silent catches decreased87 to83.
- Android/Hermes export passed,2201 modules,9.5MB bundle (`.tmp/native-theme-export`; log `.tmp/overnight/native-theme-export.log`). No new native dependency means the existing development APK remains usable. No TypeScript, new native APK, iPhone or TestFlight certification is claimed in this pass.
- Actual owner runtime after account reconciliation and two clean process launches:accountTheme=daylight,activeTheme=daylight,bg=#FBF7F0,surface=#FFFFFF,localStorage unavailable. The durable native adapter works without installing a global browser-storage shim. Session/auth ready remain present; Like/Post/Report remain blocked, exact read-only feed revalidation remains allowed, no temporary globals. Owner left at Feed offset0 with no player/viewer mounted.
- All17 Daylight palette tokens exactly match the untouched canonical website checkout. Actual clean-launch1080×2400 PNGs were inspected. Feed has827689 exact warm-paper pixels,1211681 white pixels,17567 selected-surface pixels,25449 dark-text pixels and77942 orange-accent pixels. Review has627560 warm-paper,1081976 white,22735 dark-text and12198 orange pixels. These describe those actual frames, not whole-display colour calibration or encoded media correctness. Independent website comparison remains desktop-only; no mobile website screenshot parity is claimed.

Final Library screenshots:

- Feed: `libfile_f1302a7106b881919a17132dc3751369`, `owner-daylight-feed-clean-launch.png`.
- Steve Lacy review: `libfile_a78aa12eb9a4819186fe108731df1451`, `owner-daylight-review-clean-launch.png`.

Task-workspace evidence:`native-daylight-library-receipt.json`, `native-daylight-pixel-proof.json`, `native-daylight-canonical-token-proof.json`. Earlier development-refresh overlay captures are superseded by these inspected clean-launch images. Windows extended-attribute tagging remains unavailable; Library receipts are retained.

Reproduce with the existing guarded localhost8081 Metro, then force-stop/reopen the existing development client without clearing data. `/api/me` supplies the unchanged account choice; its first application can reload once, then a subsequent process launch reads it durably. Fresh signed-out installations default to Stage. Targeted automated command:`node --test src/lib/nativeThemeRuntime.test.mjs src/domain/themeStorage.test.mjs src/domain/accountThemeNavigation.test.mjs`. Normal regression/syntax/architecture commands remain unchanged.

References verified against SDK57: https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/ (synchronous KV APIs), https://docs.expo.dev/versions/v57.0.0/sdk/expo/ (reloadAppAsync uses the current bundle in debug/release). No OS/security setting, account preference, signing credential, paid service, deployment or production content write changed. Website checkout remains read-only with its original untracked audit file, and the performance fixture remains clean/stopped. The earlier substantial jank finding is unchanged and remains a separate open investigation.

## Bounded responsiveness attribution — 2026-10-15

Outcome: no performance improvement is claimed and no speculative product optimization was applied. The release comparison exposes a substantial common graphics/buffer cost even with the app unmounted, plus additional Feed draw-command work. This separates initial touch handling from slow rendering/navigation, but does not certify visible input latency. The remaining gate is a physical Android release trace with real frame-presentation timestamps, followed by an isolated drawing ablation if that device also exhibits the extra cost.

### Controlled release workload

Source `bb9b469bd5cadb7955cd05a6473055df9110aeb1`, including the verified Daylight fix. One existing-tool x86_64 release APK, SHA256 `3029729ccc15e0b4b95ecc23a5c0a37c4676c549097520a510052ecde20a9977`; offline Gradle build passed in1m23s,875 tasks(39 executed). Fixture package only:`com.mshpit.app.dev.perfreview`, no INTERNET permission; all API calls intercepted and all writes blocked. Owner APK/data/preferences were untouched.

Four scenes in the same release APK,three trials each,rotating order:blank native ScrollView over a20000dp spacer;40 native text/stripe rows;20-post text-only Feed;the same Feed with one cached1080×2400 PNG used on alternating posts. That PNG is a previously captured review screenshot used as a large-bitmap workload, not20 unique source photos, a production content fixture, a video decode test or a production-network measurement. The synthetic catalogue remains1000 events. Same API36 emulator,1080×2400,density420,font1,60Hz host-GPU settings. No display,driver,security or virtualization setting changed.

Each scene is verified before timing,then settles2s. Workload:eight alternating400ms vertical swipes with200ms gaps. No inspector/accessibility/screenshots,compiles or tests inside timed scrolling. Twelve compressed atrace files plus HWUI frame records are retained. Frame-stage attribution filters retained records to the actual trace interval; blank third trial retained67 rows but only62 fell inside that interval. All other retained populations are documented in `responsiveness-summary.json`. Later touch/navigation checks run outside the scroll interval. Two harness-only visibility/duplicate-label assertions were corrected; completed native trials were retained and the incomplete text trial rerun. Final cohort is complete12/12,not selected best runs.

| Scene | Median HWUI jank | HWUI p90 range across3 trials | Median of timed UI-work p90 | Median of timed render-before-swap p90 |
| --- | ---: | ---: | ---: | ---: |
| Blank native scroll |66.67%|150–350ms|9.91ms|21.08ms|
| Native rows |68.18%|150–500ms|9.57ms|25.53ms|
| Text-only Feed |66.67%|150–200ms|15.63ms|80.28ms|
| Cached-bitmap Feed |70.69%|150–450ms|16.53ms|78.54ms|

Every scene's median whole-run HWUI p90 is150ms. Wide later-trial outliers show environment variance; this is not proof of equivalent app performance or zero bitmap cost. Whole-run HWUI histograms and timed stage endpoints are different measurements and must not be substituted for one another or summed as independent percentiles. Results are not comparable to earlier differently shaped owner/debug workloads.

### Attributable costs and limits

Native-only scenes already show median timed sync-wait p90 around83–85ms and swap-to-completion p90 around87–90ms. Actual `dequeueBuffer` trace slices have p90 elapsed79–86ms in the first two native trials,while scheduler running time is only about0.74–0.82ms:pacing/buffer waiting is present before Feed,images,gesture rails or account/bootstrap effects are mounted. The later native outliers grow further. Feed has its own additional draw-submission cost:`flush commands` p90 is about63–79ms for text Feed and61–115ms for bitmap Feed,versus12–29ms for native rows. This is concrete drawing work worth profiling; these experiments do not isolate a particular SVG,shadow,text component or renderer command as the cause. Changing those product features without an ablation would be generic tuning.

The graphics path is Android Emulator OpenGL ES Translator on NVIDIA GeForce RTX3070,OpenGL ES3.1/NVIDIA591.74,with60Hz peak refresh. A post-cohort read-only snapshot reports31.95GiB RAM total and about9GiB free. A Citrix display adapter is installed too; there is no evidence here assigning causality to it. No driver,hardware,thermal or host-compositor root cause is certified from these Android traces alone. The old emulator GPU histogram sentinel is still not a real4.95s GPU frame.

### Touch feedback versus navigation/content

Seventy-two physical ADB tap samples exercised the same small feedback control across the four scenes. Native event timestamps and JavaScript performance timestamps share the observed uptime basis;all measured ages were positive and below24ms. Each tap changed a visible orange/dark indicator's width and produced a native layout notification. The final actual release screenshot shows Feedback7 and its orange indicator. Screenshot presence proves that feedback rendered;it does not time its presentation.

| Scene | Native touch→JS receipt median/p90 | Receipt→native-layout notification median/p90 | Native touch→layout-notification p90 |
| --- | ---: | ---: | ---: |
| Blank |15.06/20.10ms|17.85/19.34ms|37.82ms|
| Rows |9.53/17.45ms|16.61/18.34ms|37.91ms|
| Text Feed |13.51/19.65ms|17.48/19.36ms|35.90ms|
| Bitmap Feed |13.13/17.06ms|17.22/19.63ms|36.20ms|

Six actual Feed→Search→Feed round trips also reached their expected React effect markers. From tab touch receipt,the navigation effect median is242ms(text) and252ms(bitmap);Search's first post-commit effect median is453ms(text) and421ms(bitmap),with maxima826ms and588ms. These are passive React effect timestamps,not exact commit,full-data-ready or visible-pixel times. The synthetic API has50ms configured latency;this does not measure production content/network completion. There is no arbitrary delay found in the inspected native switchTab/writeNavigation path,and composer-close protection remains untouched.

All timed frame records expose DisplayPresentTime=0 and InputEventId=0. Therefore this emulator cannot establish native-touch-to-visible-pixel latency using these counters. The layout measurements are explicitly proxies;they must not be advertised as sub40ms visible response or as proof that every swipe is smooth. Scrolling remains visibly/render-statistically janky in the test runtime. No live-video seek/decode latency or iOS result is claimed by this comparison.

Next validation requirement:use an existing physical Android device with the same release fixture and representative media,retain its actual60/90/120Hz refresh context,and capture Perfetto/FrameTimeline/SurfaceFlinger presentation plus input timestamps or a synchronized visual recording. Repeat the native/text/media comparison,then ablate one drawing source at a time if the Feed-specific flush cost persists. This is required to distinguish product drawing cost from the emulator translation/presentation bottleneck and to justify a real code fix. It is not a request to buy a device,alter OS security settings or enroll with Apple.

### Evidence,reproduction and cleanup

Library:`libfile_c9baafa1cb9c81919e63591fcb8bb723` (`responsiveness-summary.json`),and `libfile_a2b622f688208191bea2551dd04933a5` (`responsiveness-feedback.png`). Raw cohort,12 traces,frame dumps,timed analysis,build log and host context remain under `D:/Development/Apps/mshpit-perf/.tmp/performance/responsiveness-*`. Upload receipt is `responsiveness-library-receipt.json` in the task workspace;Windows extended-attribute tagging is unavailable.

Reproduction uses the existing fixture's `prepare.cjs prepare` with the existing debug keystore/source clip/android checkout,then task-workspace scripts `prepare-current-ux-fixture.cjs`, `install-diagnostic-fixture.cjs`,the offline `:app:assemblePerfRelease` command and installation into the isolated package. `measure-responsiveness.cjs` runs the bounded cohort,`analyze-responsiveness-window.cjs` filters timed frames,and `summarize-responsiveness.cjs` creates the report. The measurement script resumes completed trials;archive the previous cohort or choose a new output label for an intentional fresh run. `prepare.cjs restore` must close every temporary overlay,not git reset/clean.

All fixture overlays were hash-restored;fixture tree clean at558382f and both fixture packages stopped. No8082 server/reverse was introduced in this release-only pass. The owner development client was cleanly reopened after a disconnected inspector stub;Daylight/account choice match,auth ready/session present,no temporary globals,Like/Post/Report blocked,exact read-only feed revalidation allowed,and Feed returned to offset0. Owner source is unchanged from the theme fix;the last full source suite remains6382 passed,zero failed,one skipped. This closeout adds evidence only,so no duplicate full-suite run is claimed or needed. Canonical website remains untouched with its existing untracked audit file. No production content write,deployment,new credential,paid service or purchase occurred.
