# Player cold-start recovery and News continuity — 2026-10-15

Review base: `61589487fdba80f22acb5559eab5b5572ec0c365`, app checkout `D:\Development\Apps\mshpit`. This is an implementation checkpoint for independent Astra review, not iOS or physical-device certification. The canonical website checkout, production services and account settings were untouched.

## Normal-audio playback: before and after

Only `emulator-5554` was connected: API36 x86_64, host GPU NVIDIA RTX3070, WHPX, four vCPUs and3072MiB. Both the minimal supported Expo Video `VideoView` and MSHPIT's real `MshpitVideoPlayer` used the same existing local25.175s H.2641080x1920/~30fps clip, normal audio, volume1, playback rate1. No download/conversion or production post was needed.

| Measured scene | Media progress | Device elapsed | Audio |
| --- | ---: | ---: | --- |
| Minimal Expo, long-running AVD | 2.304s | 10.314s | Enabled/unmuted |
| MSHPIT, same long-running AVD | 3.423s | 10.031s | Enabled/unmuted |
| Minimal Expo after cold boot | 9.954s | 10.022s | Enabled/unmuted |
| MSHPIT after same cold boot | 10.014s | 10.035s | Enabled/unmuted |
| MSHPIT repeat/seek | 9.521s | 10.009s | Enabled/unmuted |
| Full owner app, actual Play tap | 10.041s | 10.027s | Enabled/unmuted |

The initial runs include seek/start work; do not interpret their ratios as frame-rate measurements. The full owner-app run began while playing at0.246s, reached10.287s, remained ready/playing in every sample, and recorded no status transition. It uses the existing app-private copy of the same clip, opened through the real viewer with no associated post or analytics identity. Prior public-media range checks remain documented in BUFFER_CONVERTER_REVIEW_2026-10-15.md.

The sole recovery intervention was a graceful AVD shutdown followed by a cold boot with the same audio/graphics/CPU/memory settings and preserved userdata; audio diagnostic logging was enabled. No mute, disabled audio track, driver change, guest-data wipe, snapshot rollback, OS audio/security/virtualization setting, dependency or player-engine replacement was used. The installed emulator lists DirectSound as its Windows speaker backend; available `none` and `wav` alternatives were not used as a playback fix. Before restart AudioTrack repeatedly logged device-stall timestamp correction. This reproduces and recovers the symptom, but does not establish whether the historical fault originated in the guest audio clock, long-running emulator state, host audio stack or another component.

A process-scoped Windows Core Audio meter observed the QEMU render session at volume1/unmuted: paused samples were zero; playing samples were nonzero (maximum~0.023). No microphone or general system-audio recording was made. Meter activity verifies signal in the host render path, not speaker audibility, fidelity, AV sync or absence of distortion. These tools cannot provide a subjective listening judgment.

## Actual recovery/control checks

- Real native fullscreen Activity rendered the clip and progressed from4s to24.948s over21.480s. The internal fullscreen AppState transition was background while playback continued, as intended by the SDK's fullscreen-aware lifecycle.
- Android Back returned to the same viewer. End-of-clip rewound paused for replay.
- A separate ongoing run reached14.829s before Home; background paused at15.030s and returning retained exactly15.030s/paused. No automatic resume; explicit Play remained available.
- In the isolated package, replacing the source with an intentionally missing app-private fixture produced the real error view. Physical Try again remounted the player; physical Play then returned ready/playing. This did not touch a real post, upload or converter.
- Full owner app survived the AVD restart with session/auth ready, stored/current Ember and correct owner binding; account theme remains Daylight. Production Post/Like/Report remained blocked. No preference setter or auth mutation was used.

Native accessibility's generic idle wait sometimes fails while VideoView controls update; those attempts sent no input and are not navigation/player failures. Measurements use supported player state and actual Android Activity checks; screenshots are real, not generated. They do not certify every displayed frame or a physical phone.

## Reproduce the working cold-start path on this PC

Save any in-memory draft before closing the emulator. Persisted app/session data stays in the existing AVD userdata disk. Use the existing terminal environment:

```powershell
. 'D:\Development\Tools\Use-Android.ps1'
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
$emu = Join-Path $env:ANDROID_HOME 'emulator\emulator.exe'
# Confirm the intended AVD before stopping it.
$selectedAvd = & $adb -s emulator-5554 emu avd name
if (-not ($selectedAvd | Where-Object { $_.Trim() -eq 'mshpit-api36' })) {
  throw 'The selected serial is not mshpit-api36; stop and select the intended AVD.'
}
$old = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^(emulator|qemu-system-x86_64)\.exe$' -and
  $_.CommandLine -match '-avd\s+mshpit-api36(?:\s|$)'
} | Select-Object -ExpandProperty ProcessId
& $adb -s emulator-5554 emu kill
# Let the original processes release the userdata lock before launching again.
$deadline = (Get-Date).AddSeconds(60)
while ($old | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }) {
  if ((Get-Date) -gt $deadline) { throw 'Old AVD is still shutting down; do not start another instance.' }
  Start-Sleep -Milliseconds 500
}
Start-Process -FilePath $emu -WindowStyle Hidden -ArgumentList @(
  '-avd','mshpit-api36','-accel','on','-gpu','host','-feature','-Vulkan',
  '-no-metrics','-crash-report-mode','never','-no-snapshot','-no-boot-anim',
  '-cores','4','-memory','3072','-debug','audio'
)
# Wait for sys.boot_completed to report 1 (the measured boot took ~43s).
& $adb -s emulator-5554 shell getprop sys.boot_completed
& $adb -s emulator-5554 reverse tcp:8081 tcp:8081
# Existing Metro must already be running; normal local setup is in WINDOWS_MOBILE_DEVELOPMENT.md.
& $adb -s emulator-5554 shell am start -W -a android.intent.action.VIEW -d `
 'mshpit-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' com.mshpit.app.dev
```

The measured restart included audio diagnostic logging, retained in the command above to match the measured launch. This does not select a different audio mode. The first immediate relaunch was correctly refused because the old process had not yet released the AVD; the procedure above waits for exit. Do not add `-wipe-data`, restore an old snapshot, or substitute `-no-audio` to claim success. The current browser/emulator launcher does not automatically cold-restart or infer driver health from a loading spinner.

## News recovery improvements

Actual-hook/component regressions failed on the review base before implementation:

- Failed pagination retried page one instead of the failed cursor, losing reading continuity.
- Same-turn Show more presses dispatched duplicate/aborted requests.
- Your artists cleared already loaded rows on retry and did not cancel interrupted tab/unmounted requests.

The implementation retains loaded rows, remembers whether retry means append or refresh, serializes appends, and aborts/fences retired requests. Append errors appear beside the loaded page with an in-place retry; refresh failures say that earlier updates remain. The empty News state now uses reader-facing copy rather than internal corroboration/scheduling details. Account/privacy gates and rankings are unchanged. No real signup, reset, verification, email, account write or production content mutation was tested.

## Evidence and review parameters

Windows task folder `C:\Users\Adam Gadishaw\Documents\Codex\2026-10-14\task` holds `deep-minimal-default.json`, `deep-mshpit-default.json`, `deep-minimal-cold-default.json`, `deep-mshpit-cold-default.json`, `deep-mshpit-cold-repeat.json`, `deep-owner-cached-after-cold.json`, `deep-emulator-audio-playing.json`, `deep-fullscreen-playing.json`, `deep-home-paused.json`, `deep-return-stays-paused.json`, and actual player screenshots prefixed `deep-`. Diagnostic fixtures use the separate `com.mshpit.app.dev.perfdebug` UID and synthetic-only API handling, without owner credentials.

Astra should assess the evidence limits and recurrence risk before recommending a player replacement. Review native controls/first-frame behavior, fullscreen exemption versus real background pause, source/error remount ownership, converter retry fencing, data retention and cancellation in both News readers, empty/error copy, startup options and data-preservation procedure. No permanent emulator root cause or subjective sound-quality fix is claimed. Physical Android, signed iPhone/native iOS and real associated-link delivery remain separate checks.

Validation results are recorded in the implementation checkpoint and local logs `.tmp/overnight/deep-full.log`, `deep-syntax.log`, `deep-architecture.log`, and export/browser receipts.

## Final local validation and actual News pixels

Final aggregate: **6,466 passed, zero failed, one skipped** (6,467 total;127.4s). Focused actual News hook/component tests:10/10. Syntax857 files and architecture passed with unchanged legacy thresholds/83 silent catches. Android Hermes export:2,207 modules/9.5MB. Web export and its512KiB initial-JavaScript budget passed (511.5KiB gzip). Existing News browser suite:6/6 at390/1280 widths using installed Chrome and the workflow-pinned Playwright1.62.1 in a disposable task-local folder; project dependencies/lockfile were unchanged and no browser download was needed. All browser APIs were synthetic and external network was blocked.

Actual same-fixture comparison: baseline6158948 retry requested `/api/news?scope=following` again, briefly rendered zero cards and settled at the original two. Working source retained two cards while requesting `cursor=fixture-page-two` again and settled at four unique cards, suppressing the repeated overlap row. Append failure now sits after the loaded cards with one explicit retry action. Empty copy was inspected in the current-source native view.

Final screenshots: `deep-news-final-error.png`, `deep-news-fixed-recovered.png`, `deep-news-fixed-empty.png`. Baseline: `deep-news-before-error.png` and receipts `deep-news-before-retry.json`/`deep-news-before-retry-settled.json`; corrected receipts `deep-news-fixed-retry-pending.json`/`deep-news-fixed-retry-settled.json`. `deep-news-after-error.png` and `deep-news-after-retry-pending.json` came from a stale baseline development reload and are explicitly excluded as after evidence. That fixture-only Metro graph error was resolved by restarting its server and loading a fresh bundle; it was not reported as an app defect or a successful after check.

Final logs: `.tmp/overnight/deep-final-full.log`, `deep-final-export-android.log`, `deep-final-build-web.log`, `deep-final-news-browser.log`; earlier syntax/architecture logs are `deep-syntax.log`/`deep-architecture.log`. No standalone TypeScript project check exists. The new local commit remains pending independent Astra review; no new-head CI pass is claimed before review/push.



## Owner-reported stuck screen and recovery,23:44–23:49UTC

After fixture cleanup the owner reported the emulator stuck. Actual pixels showed the development client's gray `Reloading...` overlay, then `Loading from127.0.0.1:8081...`; the emulator answered ADB, boot-completed was1, and Android reported no ANR since boot. All tests/headless browsers had finished. The temporary fixture app/server were stopped, forward8082 removed, its media copies removed, and its worktree restored clean after hash checks (two duplicate preparation records were corrected against the verified initially clean Git base; index line-ending metadata was refreshed without a staged diff).

Restarting only the owner app initially left the bundle loading. Restarting the long-running owner Metro with the existing approved canonical API, analytics off and native read-only configuration, then reconnecting the owner app, built a fresh bundle in13.5s and returned to a populated Feed. Session/auth were true without any login; POST/Like/Report stayed blocked. Discover navigation responded afterward. This supports a stuck development reload/transport state rather than an observed frozen emulator or Android ANR; a permanent Metro root cause is not established. Current owner Metro is the managed session started by `node scripts/mobile-dev.mjs start --port8081 --clear` (actual CLI child26132; wrapper22152). Reuse it rather than starting a second server. Its log is `.tmp/overnight/deep-owner-recovery-metro.log`.

**Appearance preservation remains unresolved:**23:23UTC showed signed-in Ember;23:43UTC, during the stuck reload, the runtime reported Auth/guest and Stage;23:48UTC after recovery showed signed-in Feed with active/stored Daylight matching the account default. No theme control/setter or auth command was invoked. The saved authentication survived, but appearance cannot be claimed preserved across this interval. These boolean-only receipts do not prove account identity continuity or identify the writer. Do not silently restore a preference or infer a new theme defect from this evidence alone. Astra should specifically review native theme reconciliation around guest/auth-ready/reload transitions and the development reload lifecycle. Receipts: `deep-owner-after-emulator-restart.json`, `deep-owner-final.json`, `deep-owner-recovered-state.json`; actual `deep-owner-unexpected-guest.png` shows the reload overlay, while `deep-owner-recovered-actual.png` shows usable Feed. No diagnostic wrapper remains on the owner runtime.
