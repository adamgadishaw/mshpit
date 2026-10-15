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
