# Android fullscreen and replay repair - 15 October 2026

This supersedes the open player verification gap in OWNER_UI_REPAIR_REVIEW_2026-10-15.md. The owner app remains com.mshpit.app.dev, signed in, with the read-only production review guard. No content/account mutations, deployment, Apple signing or paid service was used.

## Change

Expo Video 57.0.5 manually resets its fullscreen icons without resetting Media3's toggle state or accessible description. The version-checked scripts/patch-expo-video-android.mjs uses the supported setFullscreenButtonState API with navigation listeners detached while state changes (the setter itself calls its listener). The local mobile:android/mobile:prebuild entrypoints apply this idempotent workaround. package.json opts only Android expo-video into buildFromSource; SDK57 otherwise uses its prebuilt binary and ignores Kotlin edits. Expo/iOS/web source is not patched.

Android completed clips now pause and rewind to zero after recording completion analytics. This paints a real first frame when a new fullscreen surface opens and keeps native Replay ready. It does not autoplay or enable background playback. Other platforms retain existing end behavior.

## Verified on the actual owner clip

The actual 20.633-second Feed clip was exercised through fresh accessible controls (not guessed coordinates). Three complete cycles passed paused-to-fullscreen, playing-to-fullscreen, Back with an advancing clock, inline Home/resume pause, fullscreen Home/resume pause and return to MainActivity. The final cycle also ran to completion, entered fullscreen paused at zero with an actual visible first frame, replayed to 5.881 seconds and paused. Viewer close released every player, preserved Feed offset2686.476dp and retained the owner session. Evidence: .tmp/overnight/owner-fullscreen-accessible-verification.json, complete:true, cycles:3,72 observations. Streaming rebuffering was observed and recovery verified; loading was not incorrectly counted as a user pause.

Native controls auto-hide, and the debug inspector connection can become stale across activity transitions. The final runner uses fresh accessibility ACTION_CLICK targets, native paused timeline observations, confirmed foreground activity, actual video captures and fresh inspector connections after returning to MainActivity. Earlier interrupted attempts are retained as superseded attempts, not passes. A separate final fullscreen capture shows the native Pause control, 00:02 timeline and actual video while FullscreenPlayerActivity is foreground; this replaces an inline transition frame in the Library evidence.

## Checks and reproduce

- Full tests:6357 total,6356 passed,zero failed,one skipped (.tmp/overnight/owner-fullscreen-full-tests.log).
- Focused player regression:9 passed, including Android-only end rewind and preserved iOS/web behavior.
- Source-compiled local APK: BUILD SUCCESSFUL,521 tasks; final incremental build17seconds. No SDK licence acceptance or new tooling required. Standard AndroidX/Kotlin project dependencies missing from cache were resolved, then the final build passed offline.
- Architecture baseline and git diff --check passed. Syntax gate includes the new patch script.

```powershell
Set-Location 'D:\Development\Apps\mshpit'
. 'D:\Development\Tools\Use-Android.ps1'
$env:EXPO_PUBLIC_API_URL='https://www.mshpit.com'
$env:MSHPIT_APPROVED_LIVE_API='1'
npm run mobile:android -- --port 8081
npm run mobile:start -- --port 8081
```

Use the existing emulator and one Metro server; do not start a second8081 server. For a direct Gradle rebuild, apply patchExpoVideoAndroid() first. The actual final APK is android/app/build/outputs/apk/debug/app-debug.apk; install -r preserves data. No native iPhone result or Android release/performance certification is implied.

## Library after evidence

- Paused fullscreen:libfile_16a5b97a9d988191bc216521534e8bc5.
- Playing fullscreen:libfile_a39f45808aac81918c0a9f6b7641e575 (version1 replaces transition frame).
- After completion, fullscreen first frame:libfile_b408166e934c81919ab5f166db9f3e78.
- Home-return paused:libfile_ed8acfb4a300819189ebee577e2c2362.

The separate iPhone client compatibility and conditional LAN commands are recorded in IPHONE_PREVIEW_FINDING_2026-10-15.md. No LAN/tunnel server or firewall/security change was started.
