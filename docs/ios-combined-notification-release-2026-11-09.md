# Combined Discover and Activity local release checkpoint

## Source and status

Built and validated runtime: `6569968744734f7162b3e828767964c8f6239cf8` on `feat/ios-experience-redesign`.
Runtime tree: `6dc882883502750925c3a538342e27119405882e`.
This documentation-only follow-up does not change the built runtime source.

This local merge includes the reviewed Discover latency correction and the notification reliability candidate. The isolated candidate `60774d6dc5f908454bf4831c37cf232eb6cce0a7` (runtime/test source `c569d3a9ca898366024767fa0b145aa2e1022cab`) and the integrated revision have identical runtime, test, and configuration files. Their sole difference is the prior Discover release receipt, `docs/ios-discover-swipe-latency-2026-11-09.md`. The main checkout was clean before and after the integrated pipeline.

**Status: local build verified, rollout held, uninstalled. This combined artifact is not install-ready.** No deployment, public push, production notification mutation, new permission/provisioning, phone installation, launch, input, or recording was performed.

The [isolated notification receipt](NOTIFICATION_RELIABILITY_2026-11-08.md) and [Discover-only release receipt](ios-discover-swipe-latency-2026-11-09.md) remain historical evidence. Their results are not being substituted for the integrated checks below.

## Integrated validation

The serial pipeline completed at **2026-11-09 02:31:05 UTC**, exit **0**. It used Node 24, the existing installed dependencies, the unchanged test assertions and budget, and unique output directories.

- Catalog split passed.
- Full configured test suite: **8,661 passed; 0 failed, skipped, cancelled, or todo**. Duration: **451,075.8985 ms**. Command: `npm run test -- --test-concurrency=1`.
- Production-only dependency audit: **0 vulnerabilities**. This does not clear mobile/native dependencies.
- Node syntax: **929 files passed**.
- Architecture: **144/144 legacy Store hooks**, including **47/47 state hooks**, and **154/154 inline API routes**. No allowance or assertion was increased.
- Render Blueprint schema, unique names, and cross-service references passed. Live sync and secret presence were not checked.
- Web export and unchanged startup budget passed: **523,910 / 524,288 gzip bytes**, leaving **378 bytes**. Paused music-player labels were absent. The isolated receipt measured 523,912 bytes; 523,910 is the actual integrated measurement. This remains an extremely tight budget and must be rerun after startup changes.
- iOS and Android production exports passed with external source maps. Their Hermes bundle hashes exactly match the isolated candidate receipt.
- Export-source isolation passed with **0 issues**: Android **1 map / 2,216 sources**; web **82 maps / 1,187 sources**. iOS page modules are absent from Android/web maps. Source isolation does not certify physical runtime or gesture behavior.
- Generic-device iOS Release build passed with **2 jobs**, scheme/workspace `MshpitDev`, team `VJDCS86G5Z`, and existing development signing. No dependency, Pod, profile, or credential changes were made. `-allowProvisioningUpdates` was not used.
- Final `git diff --check`, exact runtime HEAD, and clean tracked-source checks passed.

The build/export environment was `CI=1`, `EXPO_OFFLINE=1`, `EXPO_NO_TELEMETRY=1`, `MSHPIT_LOCAL_DEV=1`, `EXPO_PUBLIC_API_URL=https://www.mshpit.com`, and `TMPDIR=/tmp`. Metro retains Expo's minifier safety settings with the reviewed second compression pass; this integrated cross-platform validation covers that configuration.

## Preserved signed artifact

Checkpoint: `.tmp/ios-phone-checkpoints/flagship-6569968/`.

- `MshpitDev.app` contains **52 files / 60,484,671 bytes**. Every file matches the build product at `ios/build/DerivedData/Build/Products/Release-iphoneos/MshpitDev.app`.
- Both the build product and copied app passed strict deep code-signature verification. The existing profile, Info.plist, app config, and 11 privacy manifests are unchanged.
- App identity: `com.mshpit.app.dev`, version `1.0.0` / build `1`; iPhone only, minimum iOS **16.4**, portrait and portrait-upside-down orientations; live backend `https://www.mshpit.com`.
- The existing development profile expires **2026-11-14 at 23:50:01 UTC**. This is not App Store certification.
- `manifest.json` records all app file sizes and hashes. `receipt.json` records source, checks, signing, preservation, rollout, and physical-testing limits. `evidence/` retains the pipeline, gate logs, source evidence, export hashes, budget and isolation reports; `evidence-manifest.json` anchors all 19 evidence files.
- An independent read-only review verified the artifact, both signatures, gate evidence, actual source-map contents, Node 24 web-budget recomputation, and preservation baselines. Both `flagship-8060121` and `flagship-a7a8117` retain all **54 checkpoint files each**, including their apps, manifests, and receipts, unchanged. Relative to either prior app, only the executable, code-signature resource table, and JavaScript bundle differ.

SHA-256 anchors:

- App JavaScript, 9,909,895 bytes: `c0f38fddde1221891f761825c792fc15f841e1cbdce3a490177b79252fa0a1ef`.
- App executable: `69dbce514cf799bedad02883950badfaddbf7515b0c6c2a9726978ca59ff0b97`.
- App manifest: `1804c1fb7898dd1ee5d7568d56d5bbca71221a073401135007db48ea948b314e`.
- Receipt: `edd9c6e898693f533eb1a440b4dfb9d52a54d49b04931187ac4bb91e876d6728`.
- Evidence manifest: `117b31ff511b1241a815d0d73e6ad74acfd959b97bcd603defa1ff61f11d4b0e`.
- iOS exported Hermes: `e7c3091d282fa65b437a407d984880e5a711db96c6535da6713884d7c6f9485d`.
- Android exported Hermes: `d3b1ded57cf5fabdd79c164f984a3d4f532e7cf3b3c03ffbdac55a1b4d62e78c`.

## Mandatory rollout and acceptance holds

**Before publishing or coordinating installation of the combined client, separately approve and complete the scoped-read backend rollout on every serving instance.** New clients require the `notification-ids-v1` capability and distinct `/api/me/notifications/read/scoped` route. Old servers fail safely instead of interpreting a scoped request as their global mark-all command. Upgraded servers make old bodyless `/read` calls a no-op; old clients may temporarily show locally cleared badges until reload. Old clients routed to old backend instances still have the unsafe global-read behavior, so partial rollout is not complete protection. No backend was deployed by this work. Push delivery remains a separate feature.

The installed phone remains at older `a7a8117`, for which the user reported glitchy and laggy Discover swipes and minor Feed lag. Preserved **`8060121` remains the simpler, uninstalled Discover-only retest candidate**. Neither that corrected build nor this combined build has passed physical acceptance. Activity entry/foreground, explicit loaded-ID reads, pagination/error/retry flows, and Discover smoothness, cancellation/reversal, nested rails, tap alternatives, and accessibility still need physical testing when separately authorized and safe. Synthetic scheduler/recognizer tests and source maps do not establish native frame rate or user-perceived smoothness. Initial cold module/native layout still gates incoming motion.

The existing app targets the live backend and is not mutation-blocked. Device Hub input was previously blocked by `-10005 noWindowsAvailable`; no retry or phone action occurred here. Server security changes also remain source-only, and no real database was restored.

Dependency limitations remain open: the existing full audit records **12 findings (3 high, 8 moderate, 1 low)** and **10 SDK 57 patch compatibility mismatches**. The full audit was not rerun or remediated here; production-only audit success is not mobile clearance.

## Local evidence locations

Prefix: `/tmp/mshpit-combined-6569968-20261109T022103Z`.

The `-release.sh` runner, `.exit`, `-finished-at`, `-stages.log`, `-web.log`, `-tests.log`, `-checks.log`, `-ios.log`, `-android.log`, `-isolation.json`, `-page-isolation.json`, `-build.log`, `-source-check.log`, and `-codesign.log` contain the local gate results. `-source-evidence.json` records source equivalence; `-preserved-baseline.json` records both older checkpoints before the run. Copies of the relevant evidence are preserved with the artifact.

Unique exports: `.tmp/web-6569968-20261109T022103Z-regression`, `.tmp/ios-6569968-20261109T022103Z-export`, and `.tmp/android-6569968-20261109T022103Z-regression`. Earlier exports and checkpoints were retained. Temporary artifacts and logs are local evidence, not a deployed or permanent release archive.
