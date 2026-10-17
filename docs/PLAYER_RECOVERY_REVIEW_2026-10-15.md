# Windows player recovery review — October 15, 2026

This supplements the Nearby review. Local checkout: `D:\Development\Apps\mshpit`, branch `codex/nearby-show-finder-20261015`. The original web checkout and separate font-CSP worktree remain untouched. No push, deployment, production post, enrollment or purchase occurred.

## Verified windowed emulator

The visible `Android Emulator - mshpit-api36:5554` window runs the existing development APK with the owner's session preserved. Launch with:

```powershell
cd D:\Development\Apps\mshpit
.\scripts\Start-MshpitEmulator.ps1
```

The launcher uses the existing SDK/AVD, WHPX acceleration, host GPU, Vulkan disabled, 4 cores and 3072 MiB guest RAM. `QT_OPENGL=desktop` avoids the failed Qt software-OpenGL path observed during earlier restarts. Host microphone input is disabled for this process with `QEMU_AUDIO_IN_DRV=none`; playback audio output remains enabled. Environment overrides are restored in the launching shell. No virtualization, security or persistent Windows setting changes are made. Close an existing emulator normally before launching another; do not wipe the AVD or owner session.

In another terminal, follow the read-only Metro commands in `NEARBY_SHOW_FINDER_REVIEW_2026-10-15.md`. After boot:

```powershell
. D:\Development\Tools\Use-Android.ps1
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 shell -n am start -a android.intent.action.VIEW -d 'mshpit-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' com.mshpit.app.dev
```

Playback in this visible window used the normal native audio renderer. A seven-second sample advanced 6.905 seconds including initial source settling; a subsequent fullscreen sample advanced 7.017 seconds over 7.015 device seconds. SurfaceFlinger recorded a steady fullscreen video sample of 162 frames at 30.383 fps with zero dropped frames; a separate transition sample was slower. These bounded samples establish usable playback in this launch, not a device-wide performance guarantee. Audio audibility was not independently heard or recorded.

## Actual native checks

- Native fullscreen control opened `expo.modules.video.FullscreenPlayerActivity`; the clip rendered there. Android's first-use immersive-mode help appeared and was dismissed. Back returned to the main viewer.
- Native Play/Pause, seek, Home/background pause, return without unintended autoplay, and viewer close/player release were observed. Earlier control JSON is in `.tmp/overnight/player/native-controls.json`.
- A localhost-only server supplied the same 25.175-second clip with an intentional 15-second delivery stall. At 5.222 seconds the player showed `Buffering video…` while retaining its frame; playback recovered, the caption cleared and progress reached 19.933 seconds. Evidence: `recovery-slow.json`.
- A separate localhost HTTP 503 source produced `This video could not play` and `Try again`. Tapping the actual retry control recreated the player with the original clip; progress advanced 7.028 seconds over 7.025 device seconds. Evidence: `recovery-fail.json` and `retry-recovered.json`.
- Diagnostic source replacement was confined to the debug runtime. It did not modify production URLs or app source to use the fixture.

Actual screenshots are under `.tmp/deliverables/`: `mshpit-windowed-player.png`, `mshpit-windowed-fullscreen.png` (includes first-use Android help), `mshpit-player-slow.png`, `mshpit-player-fail.png`, and `mshpit-player-retry-recovered.png`. The older `mshpit-player-fullscreen-verified.png` filename was an unsuccessful early attempt and must not be used as fullscreen proof.

## Code and regression evidence

`6488209` adds the buffering cue and guards asynchronous playback rejection after backgrounding/unmount. `9898e64` removes unsupported native announcement roles while retaining web semantics. `bcb5862` restores regression fixture dependencies for the existing navigation/Nearby/read-only changes and adds an actual transport no-dispatch assertion for review-mode mutations.

Fresh full suite: `node scripts/run-tests.mjs` — **6,321 tests, 6,320 passed, zero failed, one skipped**, 98.118 seconds. Log: `.tmp/overnight/full-tests-rerun.log`. The earlier failing run is retained separately and is not represented as passing. The launcher parses successfully with PowerShell's parser.

## Remaining scope

Guest flows in a separate installation, final platform bundle exports, broader member-flow smoke checks and store-readiness review remain pending. Four Expo patch-alignment suggestions remain recorded in `.tmp/overnight/dependency-alignment.log`; dependencies were not broadly upgraded during this playback investigation. This review does not certify iOS, Expo Go compatibility of native sharing, social-target handoff, or release signing. Windows cannot run Apple's simulator; signed iPhone/TestFlight validation remains for later enrollment.

Architecture follow-up: the three added legacy Store cache hooks were replaced by a weakly keyed derived catalogue cache, following the existing venue-search index pattern. The enforced baseline remains 144/144 hooks. Eight targeted catalogue/coordinate/invalidation tests passed; architecture and syntax checks passed after extraction. A separate full-suite rerun after extraction is recorded in .tmp/overnight/full-tests-final.log. Native fullscreen final evidence is mshpit-native-fullscreen-final.png; the older windowed-fullscreen-clean filename was another viewer-only attempt and is not evidence of fullscreen.

Final post-extraction full suite: **6,322 tests, 6,321 passed, zero failed, one skipped**, 105.067 seconds. Syntax passed (854 Node files); architecture passed at the unchanged 144-hook ceiling. A later fullscreen capture ran alongside the full suite and showed brief loading events, so the clean earlier timing sample must not be generalized to simultaneous heavy build/test workloads.
