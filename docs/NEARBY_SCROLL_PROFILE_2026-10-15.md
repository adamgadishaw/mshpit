# Nearby focused scroll verification, 2026-10-15

Follow-up to `ed1f42e`, on `codex/nearby-show-finder-20261015`. No deployment or push. Only the Nearby date-label helper changes: its two fixed English/UTC `Intl.DateTimeFormat` instances are reused instead of recreated for each row. No new dependency, list replacement, renderer change, security setting or emulator configuration change.

## Browser gap

The supported computer/browser inventory again returned `apps: [], browsers: []`. Trying to open the local route through the supported in-app browser returned `Browser is not available: iab`. Browser city/date/distance interaction and Back/reset verification therefore remain blocked. No alternate browser UI automation was substituted. The earlier actual desktop and 430px local renders remain the visual web evidence.

## Equivalent scroll comparison

API 36 emulator, 1080x2400, density 420; existing debug development APK and Metro, authenticated read-only review. Nearby is Toronto / 25 km / This weekend (30 shows, 39 venues at sampling). Before every run, the same mounted FlatList is reset to offset zero, given 1.5 seconds to settle, and scrolled with four identical gestures from `(540,1900)` to `(540,800)` over 450 ms with 300 ms between gestures, then 1.2 seconds to settle. Android gfx counters are reset immediately before the gestures. Hermes sampling and a temporary React commit hook run in both matched before/after cases; the hook/timer are restored afterwards.

| Run | Android janky frames | p90 frame time | React commits | Sum of recorded render durations |
| --- | --- | --- | --- | --- |
| Before 1 | 102/116 (87.93%) | 77 ms | 45 | 480.6 ms |
| Before 2 | 103/117 (88.03%) | 77 ms | 45 | 466.7 ms |
| After 1 | 101/115 (87.83%) | 77 ms | 42 | 443.9 ms |
| After 2 | 99/117 (84.62%) | 77 ms | 44 | 450.2 ms |

The helper benchmark uses the same 100 date-label inputs for three rounds. Before: **259.1 / 240.2 / 257.5 ms**. After: **4.1 / 3.6 / 3.0 ms**. This establishes the reduced formatter cost; it does not establish smooth scrolling. The small render-duration differences and unchanged p90 frame time do not justify claiming the jank is fixed. Profiler root samples are 79–82% of all samples; no app JavaScript function dominates. Some development React/native host calls remain in the active samples.

## Independent native control

The emulator's Android Settings homepage was opened and its resumed activity verified. Only its list was scrolled; no setting was opened or changed. A fresh launch was used for the second run. The same four gestures, pauses and Android counter reset were used without JS profiling.

| Control | Android janky frames | p90 / p95 |
| --- | --- | --- |
| Nearby without JS profiler | 111/116 (95.69%) | 73 / 77 ms |
| Native Android Settings 1 | 103/109 (94.50%) | 65 / 69 ms |
| Native Android Settings 2 | 103/111 (92.79%) | 65 / 69 ms |

Raw frame-stage medians also show similar waiting in both applications:

| Stage | Nearby before 2 | Native Settings 2 |
| --- | --- | --- |
| Intended vsync to input handling | 26.0 ms | 25.6 ms |
| UI work: input handling to render queue | 5.1 ms | 1.0 ms |
| Render queue wait | 25.6 ms | 30.6 ms |
| Render work before buffer swap | 1.3 ms | 2.6 ms |
| Buffer swap to completed frame | 33.8 ms | 33.6 ms |

These per-stage medians are not additive and use raw frame timestamps; Android's summary frame metric has its own boundaries. Invalid/flagged rows were excluded. The `4950 ms` GPU histogram bucket is not accepted as a meaningful GPU duration. SurfaceFlinger reports the host NVIDIA RTX 3070 OpenGL translator, and the AVD process uses hardware acceleration / host GPU / Vulkan disabled, as already configured. This evidence supports an environment-wide rendering/presentation limitation. It does not isolate a driver, GPU, host scheduling, or emulator cause, and does not prove the app has no remaining rendering cost. No broad rewrite is justified by these measurements.

## Validation and visual inspection

**69 tests passed**, including the new leap-day/multi-day/local-midnight label regression and the existing date, route, index/Unicode, lifecycle, analytics, membership, native news and read-only guard tests. Existing safe areas and the `f658570` index/casing improvements remain unchanged. Both platform JavaScript exports were checked after the fix. Native runtime still reports `readOnly: true`, product POST blocked and login allowed.

Actual screenshots were inspected at the header and while scrolled. Long artist titles and venue/place text wrap, action labels remain visible, and the charcoal/warm-text/orange contrast is readable. A partially visible top/bottom card while scrolling is expected viewport clipping. No photo placeholder or missing-image block is inserted when genuine images are absent. The Android Settings control screenshot was also inspected to verify the independent native screen. The app was returned to Nearby; no Android setting was changed.

Local evidence: `.tmp/show-finder/profile/` contains matched summaries, raw Hermes profiles, Android framestats, benchmark results, and `final-tests.log`. Screenshots: `.tmp/deliverables/mshpit-finder-final-profile.png`, `mshpit-finder-profile-after.png`, and `mshpit-native-control.png` (internal native control).

Local reproduction harnesses are retained as `.tmp/show-finder/profile-nearby-scroll.cjs` and `measure-scroll-frames.cjs`. With the emulator/Metro running, open Nearby and choose Toronto / 25 km / This weekend, then run:

```powershell
node .tmp/show-finder/profile-nearby-scroll.cjs another-sample
```

This is development-emulator evidence. Release Android hardware, iPhone and signed iOS validation remain separate. The browser interaction gap requires a supported connected browser surface.
