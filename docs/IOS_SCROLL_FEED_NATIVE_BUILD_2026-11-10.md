# Signed iOS scroll/feed candidate — 2026-11-10

Status: ready as a signed development Release artifact. Independent review passed all 53 required checks, with no artifact blockers. The app has not been installed, exercised on a physical device, or deployed.

## Artifact and source

Candidate: `.tmp/native-scroll-bcd30cb/scroll-feed-bcd30cb-candidate/MshpitDev.app`, relative to `/Users/adamgadishaw/Documents/Codex/2026-11-10/task-2/scroll-titles-feed`.

The adjacent `receipt.json` records build provenance and verification; `manifest.json` covers all 52 files (59,162,068 bytes). The external Hermes build source map is `.tmp/native-scroll-bcd30cb/native-main.jsbundle.map`. It provides provenance for the embedded bundle; it is not embedded in the app.

- Frozen source commit: `fda780130c797638c6d12aad40194ca35c109fa0`.
- Runtime commit: `bcd30cbf1df64b7f5b725fd80196d62c2dc50543`.
- Profile base: `b1c9514f8acbc1f5db8d2f192b85be8807e6e57b`; notification ancestor: `641730901a588905de5e34a7a45ce4bf19bac658`.
- Session fixes: `4ee6288` and `a29e796`, clean cherry-picks of `84923bb` and `5cff18f`.

This handoff changes documentation only after verification of the frozen source. The build made no runtime, native project, dependency-version, or signing-configuration changes.

## Verification

Xcode 27.2 completed a generic-device iOS Release build using the existing development signing configuration. The arm64 app has bundle identifier `com.mshpit.app.dev`, version 1.0.0, build 1, and minimum iOS 16.4. Team `VJDCS86G5Z`, certificate, provisioning profile, entitlements, and privacy manifests match the current baseline. The provisioning profile expires **2026-11-14 at 23:50:01 UTC**.

Independent review verified strict/deep code signing, architecture, all 52 artifact files, receipt/manifest/bundle/source-map hashes, and all 809 application module sources against the frozen source and final iOS export. API configuration remains `https://www.mshpit.com`; Expo Updates remains disabled. The build log and native verification evidence are in `.tmp/native-scroll-bcd30cb/evidence/`.

The combined runtime previously passed all 9,240 tests, syntax/architecture checks, and iOS/Android/web exports. Those results remain applicable because the build did not change source. See [the integration report](IOS_ENDLESS_FEED_INTEGRATION_2026-11-10.md).

Independent review evidence is outside the worktree at `/Users/adamgadishaw/Documents/Codex/2026-11-10/task-2/evidence/native-review/`: `review-summary.json` and `verified/candidate-review-final.json`. The final report supersedes intermediate summaries in that directory.

| Item | SHA-256 |
| --- | --- |
| Embedded main.jsbundle | `10e7b68750b147d99052932e7d9248b2f547eb9e249c8316fd9101968ccb21a4` |
| External source map | `6aa987b868868ad9732b716f8742339ca682b93af58baf190ac42bfa5f881e87` |
| Artifact manifest | `5a18b5576dab7ba8f8a94a1411c5410e3afb5088fecbb835211456a0b9fbd2e5` |
| Independent final report | `fcca60767d22d4f9a55f2cb012a217e71b79da6ddc482b55947929020b74e287` |

## Preservation and remaining acceptance

All three saved candidates—profile `b1c9514`, notification `6417309`, and polish `296ce4b`—remain byte-for-byte unchanged. Original native inputs and dependencies were also preserved. The new app's Info.plist matches the profile and notification baselines exactly. The oldest polish candidate has two Expo Dev Launcher local-network keys absent from those newer baselines; this historical difference was recorded and no old artifact was modified.

The build initially encountered sandboxed Xcode host-service access and stale absolute paths in copied compiler caches. Approved host execution and regeneration of only task-local build caches resolved them. The final build succeeded; no alternative toolchain, prebuild, dependency upgrade, or original-cache deletion was needed.

No phone interaction, installation, upload, push, or production deployment occurred. Physical scroll/animation, VoiceOver, gesture, and session-resume acceptance remains pending. Existing backend/profile rollout and authenticated notification checks remain separate release gates. The existing signing certificate's naming concern was not changed by this build.
