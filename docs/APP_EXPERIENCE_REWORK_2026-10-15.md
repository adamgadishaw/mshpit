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
