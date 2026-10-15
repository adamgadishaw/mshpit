# Native gestures: Android verification, 15 October 2026

Scope: existing mobile checkout on `codex/nearby-show-finder-20261015`. No website files, production content, account credentials, or deployment changed. No dependency added. Existing SDK57 Android development client runs the new JavaScript locally.

## Purpose and boundaries

| Region | Gesture | Result |
| --- | --- | --- |
| Feed post action rail | Deliberate right release | Like once; repeating does not unlike |
| Feed post action rail | Deliberate left release | Repost once; explicit Undo remains available |
| Own profile management strip | Left slide | Reveal Delete; tap then confirm before the existing delete callback runs |
| Visible bottom tab rail | Left/right | Adjacent Feed, Search, Discover, You page; no wraparound |
| Full-size photos | Left/right | Existing circular gallery navigation |
| Full-size photos | Down | Existing dismiss policy; upward movement does not dismiss |
| Feed at top | Platform pull and release | Refresh; native progress indicator and existing single-flight guard |

Post text, images, video surfaces and native player controls sit outside the post/tab pan detectors. Start positions within24dp of the screen edges are reserved. Clear horizontal intent and distance are required; velocity alone does not commit. Returning below the threshold cancels. Shared values and transforms run on the UI thread; React updates occur at threshold crossings and completion. Reduced motion removes drag translation. Custom swipes disable when a screen reader is enabled; existing buttons remain available. Website fallbacks preserve its existing controls and layout. News cards retain their buttons; they do not gain the regular-post action rail.

## Actual emulator checks

API36 AOSP x86_64 emulator,1080x2400,density420. Mutation tests ran only in `com.mshpit.app.dev.perfdebug` with synthetic `local-perf-post-*` IDs. The fixture intercepts every API call and cannot forward writes to production. No real account identity was copied.

| Check | Outcome | Evidence in `.tmp/overnight/` |
| --- | --- | --- |
| Like/repost, tiny flick, threshold-return cancel, repeated actions, explicit Undo,503 failure and retry |10 checks passed | `gesture-action-device-qa.json` |
| Feed→Search→Discover→You and reverse on the tab rail |6 passed; no writes | `gesture-navigation-device-qa.json` |
| Next/previous photo and circular wraparound |3 passed; no post writes or tab change | `gesture-media-device-qa.json` |
| Delete reveal, confirmation, Cancel, failed request rollback, successful confirmed retry |5 passed; dummy owner post only | `gesture-delete-device-qa.json` |
| Short pull, mid-list pull, deliberate top pull, second pull during an active request, successful completion, failure retention, recovery |7 passed | `gesture-refresh-device-qa.json` |
| Native video scrubber and modal close cleanup |2 passed; paused seek to19.642s; no post/tab action | `gesture-video-device-qa.json` |

The original gallery PanResponder did not advance reliably during the audit. Native photos now use a dedicated gesture-handler detector inside the Modal's gesture root. The video branch remains outside that detector. Clean reload was required after Fast Refresh registered duplicate native gesture views; clean-launch checks passed. An early Delete assertion confused an offscreen restored row with a missing row; mounted-row inspection plus scrolling verified recovery. The video cleanup check waits for the native close transition rather than assuming cleanup completes within500ms.

The fixture's repost success payload was corrected to match the real server's `ok:true` contract; the final action run verifies visible Reposted and Undo feedback. Earlier misleading fixture screenshots are superseded by `gesture-reposted-with-undo.png`.

## Regression/build checks

- Full suite:6368 tests,6367 passed,0 failed,1 skipped.
- Architecture: passed; legacy Store hooks144/144, state47/47, inline routes156/156; no new baseline allowance.
- Syntax:855 Node files passed. Whitespace check passed.
- Android release JavaScript/Hermes export: passed,9.5MB bundle, `.tmp/gesture-android-export`; no deployment.
- No new native dependency or Android licence acceptance was required. The existing installed development APK and Metro served the actual checks.

Reproduce code checks from the mobile checkout:

```powershell
npm test
npm run check:architecture
npm run check:syntax
git diff --check
npx expo export --platform android --output-dir .tmp/gesture-android-export
```

Use the documented Windows Android startup in the existing setup notes (`D:\Development\Tools\Use-Android.ps1`, `npm run mobile:start -- --port 8081`). The owner's review build must retain the read-only production guard. Never test Like/Repost/Delete against live posts in this review session.

## Cleanup and limits

All prepared fixture files were restored through the hash-guarded harness restore command. `mshpit-perf` is clean at `558382fd73e690f209b21101b0140a5fae601686`. Only its localhost8082 process and ADB reverse were stopped; ignored evidence and APKs remain. Owner app data was not cleared. Owner session and write guard were checked again: session present; Like/Post/Report blocked; exact feed-revalidation POST allowed as a read-only visibility query.

Screenshots show actual emulator rendering; fixture screenshots are deliberately synthetic, including the Expo icon standing in for gallery photos. Native video uses the existing bundled diagnostic clip. They are not iPhone or production-content mutation evidence. TalkBack, physical-phone responsiveness, two-finger/system-edge navigation mode, maximum text sizing and iOS execution remain unverified. Gallery downward/upward semantics and accessibility/reduced-motion callbacks have source/unit coverage; the device gallery run covers horizontal navigation. Android is not iOS certification.
