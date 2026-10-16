# Native app review and recovery fixes — 2026-10-16

An independent **GPT-6 Astra, ultra reasoning** review examined local commit `52da95b1ca46e9433145a99f46df8a25a6e4f22c`, the earlier app branch changes against `42a36c0aec17a8a43c8e9057585634adaecaef75`, actual Android screenshots, installed Expo Video source, and the playback/reload evidence. Reviewers used separate real-source Node fixtures; they did not operate the owner's emulator, credentials, or account. The implementation worker applied and validated the fixes below, followed by a second review of the resulting diff.

## Confirmed defects and corrections

| Trigger and previous result | Corrected behavior and evidence |
| --- | --- |
| A native reset flow becomes a guest after an uncertain authentication result. The guest theme branch ran before the sensitive-flow guard and could reload the app, discarding recovery. | Guest and member theme reconciliation both wait until sensitive account recovery closes. A synchronous activity reference also protects an intent delivered before its next render. Actual Root-effect/native-theme fixtures demonstrate the old write/reload and the guarded result; ordinary settled guest reconciliation remains covered. |
| A newer News link arrives while sign-in is already open. Duplicate-auth suppression discarded its destination. | The existing sign-in frame keeps its form/mode and updates only the bounded read-only News return destination. Real `commitGo`/`finishAuthentication` tests cover successive links, generic News, invalid slugs, mutation exclusion and unchanged web duplicate-auth behavior. |
| A newer warm News URL arrives before a delayed initial account URL. Only recognized account URLs marked the warm ingress, so the stale initial reset could cover the newer destination. | Any newer platform URL supersedes the delayed initial account URL; valid later account links remain available. No capability is submitted automatically. |
| A native festival edition has a poster in a light theme. Its normal-flow text used white over the theme's white elevated background. | The native hero inherits the existing dark poster surface. The rest of the selected theme stays unchanged. Actual Android Daylight before/after captures demonstrate the correction; real component contrast tests additionally cover Android/iOS Daylight and Ember. |
| The native Discover event carousel timer fires during a press. The card can change before release. | Native interaction holds the carousel's timer so the event under the finger remains the action target. Timer/press and cancellation regressions cover the actual components. |
| Nearby has a manually selected city without reliable coordinates, and 50 other matches share its city name. Filtering after the search cap could hide every venue in the chosen state/country. | The qualified location predicate runs before the existing 50-result cap. A real screen/Store/index fixture places a London, Ontario venue after 50 London, UK matches and verifies its rendered row; coordinate-based discovery and ordinary search retain their existing paths. |

The synchronous activity reference was also reviewed for a new edge: an account link can be invalidated before its form ever paints. The gateway must clear activity synchronously on that invalidation rather than waiting for a false-to-false visibility effect. The accompanying actual gateway regression covers that correction and retained reset interruption.

## Player decision and actual runtime evidence

Keep the installed Expo Video player. Both the minimal supported player and MSHPIT stalled with normal audio in the long-running AVD, then recovered after the same preserved-data cold restart; replacing MSHPIT's wrapper is not supported by that comparison. The earlier matched measurements and exact restart command are in [Player cold-start recovery and News continuity](PLAYER_COLD_START_NEWS_RECOVERY_2026-10-15.md).

A fresh owner-app check at 23:57 UTC on October 15 used the same existing app-private clip, the actual Play control, rate 1, volume 1 and unmuted audio. It advanced **10.031 seconds in 10.024 seconds**, with every sample ready/playing, the full clip buffered and zero status transitions. It was then paused and closed. No new emulator restart, media download, upload or associated post was involved. Receipt: `astra-player-ten-seconds.json`; actual screenshot: `astra-player-paused.png` in the Windows task folder.

Review of the installed SDK confirmed that its picture-in-picture/background manager also pauses nonfullscreen players, including buffered/preparing cases. The fullscreen exemption is needed for the native fullscreen Activity; adding an indiscriminate Android JavaScript background pause would reintroduce that earlier failure. The review found no demonstrated reason to replace the engine or mute playback. Fullscreen analytics still use the older AppState visibility gate and may undercount watched milestones; that is a separate measurement follow-up, not evidence of failed playback.

The host's earlier process-scoped output-meter signal and these media-clock samples **do not certify audible fidelity, AV sync, every displayed frame, or physical-device performance**. No subjective listening result is claimed.

## Appearance and development reload limits

The earlier Ember to Stage to Daylight observations remain unexplained. A runtime snapshot showed guest/auth-ready during the stuck reload, but there is no captured authoritative API response or theme writer linking that transition to a cause. The captured 23:43 receipt had no active account-link flow; the independently reproduced defect does not establish the cause of the earlier theme transitions. Cross-snapshot identity continuity remains unverified. No prior preference was silently restored.

The review started with signed-in Daylight. The actual owner session, owner-bound stored Daylight and production write guard remained present after the reviewed app edits. Development edits caused navigation reloads; intermediate captures showing Feed/Discover or the blue Refreshing banner are excluded from festival after evidence. The prior gray loading overlay was recovered by restarting Metro and reconnecting without clearing app data. Loading recurred after a development reconnect near 00:10 UTC. A second targeted Metro restart at 00:12 and explicit development-client reconnect built a fresh bundle in 15.517 seconds and recovered the app without clearing its data. Stable final Festival and populated Feed captures followed at 00:17-00:18 UTC. A permanent Metro/emulator root cause is not established.

## Validation and handoff

Final local checks on the reviewed source:

- Full suite: **6,494 passed, zero failed, one skipped** (6,495 total; 93.2 seconds). The first aggregate run exposed one outdated source-shape assertion for the newly forwarded search filter; that assertion was corrected, independently reviewed, and the full suite rerun successfully.
- Independent Astra changed-path checks: **80/80**, plus **15/15** after the assertion correction. Root also verified the new navigation/theme regressions **11/11**.
- Browser fixtures: News **6/6**, festivals **2/2**, Discover events **2/2**, navigation **67/67**. These use synthetic loopback APIs with external requests blocked; no production writes were exercised.
- Android JavaScript/Hermes export: **2,207 modules, 9.5 MB**, successful.
- Web build and initial JavaScript budget: **511.6/512.0 KiB gzip**, successful; the remaining margin is small.
- Syntax: **857 files**. Architecture: passed with unchanged legacy thresholds (Store 144 keys, 47 local states, 156 routes, 83 silent catches). Whitespace validation passed.

Logs are under `.tmp/overnight/`: `astra-full-final.log`, `astra-export-android.log`, `astra-build-web.log`, `astra-syntax.log`, `astra-architecture.log`, and `astra-browser-{news,festivals,discover-events,navigation}.log`.

Actual Windows-task screenshots: `astra-festival-before.png` demonstrates the defect; `astra-festival-final.png` is the verified corrected Android screen. Its title, dates, location and controls remain readable on the dark hero within Daylight. `astra-feed-final.png` shows the populated Feed after returning. Sanitized receipts `astra-festival-state-final.json` and `astra-owner-final.json` confirm signed-in/auth-ready, Daylight active/stored/account, a matching stored owner, an empty sensitive-link flow and the production write guard (post/like/report blocked). No theme setter, authentication action or write control was invoked. Intermediate screenshots containing Feed/Discover or Refreshing are excluded as festival after evidence.

The independent Astra ultra review and follow-up found no remaining blocker in the reviewed working diff after the six fixes and the synchronous activity invalidation correction. The structured review receipt is `astra-native-review-2026-10-16.json` in the Windows task folder. This is local validation; the draft PR and final handoff record the subsequent exact-commit CI result.

## Reproduce local checks and resume the app

Use the existing checkout and terminal-only tool setup:

```powershell
. 'D:\Development\Tools\Use-Android.ps1'
Set-Location 'D:\Development\Apps\mshpit'
npm test
npm run check:syntax
npm run check:architecture
npm run build:web
```

The browser scripts are `npm run verify:news-browser`, `verify:festivals-browser`, `verify:discover-events-browser` and `verify:navigation-browser`. This run used the already installed Chrome and task-local Playwright 1.62.1 via `PIT_BROWSER_EXECUTABLE` and `PIT_PLAYWRIGHT_MODULE`.

The owner-authorized read-only review server is already running on port 8081; reuse it. Its wrapper PID is 35016, actual Metro CLI PID 28592, and log is `.tmp/overnight/astra-owner-metro.log` at this checkpoint. If it later needs restarting, stop only that identified server, then run in a dedicated terminal:

```powershell
$env:MSHPIT_APPROVED_LIVE_API = '1'
$env:EXPO_PUBLIC_API_URL = 'https://www.mshpit.com'
$env:EXPO_PUBLIC_PRODUCT_ANALYTICS = '0'
node scripts/mobile-dev.mjs start --port 8081 --clear
```

In a second configured terminal, reconnect the already booted emulator:

```powershell
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 shell am start -W -a android.intent.action.VIEW -d 'mshpit-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' com.mshpit.app.dev
```

The script enforces the native production write guard for this approved origin. For disposable local development, use the normal backend/start commands in [Windows mobile development](WINDOWS_MOBILE_DEVELOPMENT.md) without the live-review environment variables. Do not clear app data or restore an old emulator snapshot as a loading workaround.

The native APK did not require rebuilding for these JavaScript changes. Android export checks JavaScript/Hermes compilation; the earlier x86_64 native development build remains the emulator host. There is no established TypeScript project check. No iPhone, physical Android, signed build, native iOS compile, domain association, real email flow, production post/upload, store submission, merge or deployment was performed.
