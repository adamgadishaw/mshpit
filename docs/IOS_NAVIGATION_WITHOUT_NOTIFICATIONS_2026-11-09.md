# Clean iOS navigation integration without notification rollout

## Final combined build checkpoint

The completed combined candidate is source `cc04472414448621497274e194a2b9c998a5f573` on `ios/navigation-and-cards-clean`. It adds the independently reviewed iOS-only card commit `55333a7` as `45c53c4`, then corrects two production-composition fixtures in `cc04472` to load the actual iOS card and its real Store adapter. The final affected composition/card matrix passed 104/104 tests with no runtime changes or weakened assertions. Navigation-only checkpoint `867e38c` remains on `ios/navigation-only-clean`.

The full unchanged suite passed **8,947/8,947 tests**, zero failed, skipped, cancelled or TODO, across **all 1,041 files** found by Node 24's documented JS/TS discovery. Repeated Mac connection interruptions prevented completion of earlier monolithic runs; those runs are not claimed as passes. The final complete suite used 27 serial, resumable file batches through the repository's existing hermetic runner. Every batch has a source/file/log-hash receipt, and all 2,812 tracked files stayed byte-identical throughout the gates. Fixture storage is fresh for each batch. No assertions or test cases were removed.

Also passed on this exact combined source: **60 Yoga geometry cases** (synthetic text metrics, not native glyph acceptance), production-only dependency audit, syntax for 927 Node files, unchanged architecture ratchets, Blueprint and whitespace checks, fresh web/iOS/Android exports, platform isolation, and exact exported-source verification. Web startup is **523,877 / 524,288 bytes gzip**, leaving 411 bytes. iOS/native maps match 786 project code modules, Android 742, and web 753 across all 81 web maps. Correct iOS/default card resolution is verified. Every added held-notification module is absent.

The isolated Xcode Release build completed at **2026-11-09 23:05:50 UTC**; strict/deep signature verification passed. The copied checkpoint was verified across **52 files, 59,057,124 bytes**. Native source-map contents match the frozen source, including the actual retained stack and iOS card. Bundle ID is `com.mshpit.app.dev`; OTA updates are disabled. The existing development profile includes the intended phone and expires **2026-11-14 23:50:01 UTC**. No provisioning change occurred.

Checkpoint: `.tmp/ios-phone-checkpoints/flagship-cc04472/MshpitDev.app`, with `receipt.json`, `manifest.json` and `validation-evidence.json`. Final gate evidence is `.tmp/resumable-cc04472/`; native evidence is `.tmp/native-cc04472-r3/`. The completed resumable runner exited zero at **23:09:25 UTC**. After the build, all 2,723 main tracked files and 9,935 non-derived native/generated files still match the preflight snapshot; main remains clean at `942e1f3`.

**Build validation is complete. The new app is not installed or launched, and physical acceptance remains open.** Wait for current phone availability before device review. Finger-driven continuity, cancellation/reversal, large-text rendering, VoiceOver and performance are not certified by source, synthetic tests or compilation. The retained-route scope remains bounded as described below; this is not all-route completion.

## Source and boundary

Branch `ios/navigation-without-notifications` starts from the preserved Discover-only `80601219641f7f49bc3df02eb96a834f66480708`. It applies reviewed Feed `48d3bd8` as `34752e9`, then reviewed nested detail `0fd3007` as `7a8c5cfead50d90ac852dac31b0730c0ae75eec8`.

The only conflict was Store mute success. Resolution retains the iOS privacy invalidation after the current-account check and omits notification-summary reconciliation. All 149 navigation-changed files are present; 147 match the original detail candidate byte-for-byte. The two expected overlaps are Store and its mutation test. Independent comparison of all 2,186 added/deleted lines proves that this branch excludes exactly the held `8060121` to `942e1f3` baseline delta.

This clean branch has no new notification runtime, scoped-read capability, summary/pagination route or backend deployment dependency. It preserves legacy notification behavior, including the known global-read limitation; this is not a notification repair. API/server, dependency, app configuration, Metro minifier and architecture baseline match `8060121`. Main `942e1f3`, original navigation commits and preserved signed apps remain unchanged. No push or deployment is included.

Retained scope is the real Feed plus up to six actual Artist, member Profile, Show and Post occurrences. Other routes retain fallback/barriers. Historical implementation audits describe the original reviewed candidates, not the clean branch's rollout requirements or current device acceptance.

## Navigation-only verification before card integration

- Independent review: 375/375 formal tests plus 18 direct production mute/unmute cases passed. These cover iOS/web/Android success, rollback and stale-account receipts, real Root/stack/gesture composition, privacy denial, hidden descendants and legacy notification behavior. No demonstrated runtime regression or notification-feature bleed was found.
- The original navigation-only full run was interrupted and is not certified. The final combined complete suite is recorded above.
- Production-only dependency audit: zero vulnerabilities. This is not a full mobile/development-dependency audit.
- Syntax: 926 Node files. Architecture: 144/144 legacy Store hooks including 47/47 state hooks; existing ratchets unchanged. Blueprint schema/reference and whitespace checks pass; no live deployment sync is implied.
- Fresh web export: 523,877 / 524,288 bytes gzip, 411 bytes headroom. No budget or minifier change.
- Fresh Hermes exports: iOS 2,254 source modules; Android 2,210. Exact source-content checks match 784 iOS, 742 Android and 753 web project code modules. Metro's generated PNG asset module is separately represented in the frozen file manifest.
- Platform isolation passes across Android and all 81 web maps. No application iOS implementation leaks into those platforms. All exported maps exclude every module added by the omitted held baseline delta.

Evidence is in this worktree's `.tmp/clean-navigation-*` logs, exit receipts, source manifest and source-map verification report. The source manifest includes 2,804 tracked files. Exported code is checked against actual clean-worktree bytes, not merely a commit label.

## Native build isolation

The main native project contains absolute generated write paths. This candidate therefore uses independent local copies of `node_modules`, the native project, Pods and generated native inputs, excluding old DerivedData/products. No package installation, dependency upgrade or provisioning update was performed.

Before relocation, 47,669 dependency entries and 23,957 copied native entries matched main byte-for-byte with no shared regular-file inodes. Exactly 1,467 path references across 123 copied generated files were relocated. Exact-boundary path and symlink audits found no references escaping to main, no broken symlinks, and matching Pod lockfiles. Before/after hashes confirmed main's tracked files, dependencies and all 71,494 native/build entries remained unchanged.

Preparation receipt: `.tmp/native-prep-20261109T193055Z/summary.json` and its evidence manifest. Final native Release/signature/source verification and artifact preservation passed as recorded above. No navigation candidate has been installed.

## Phone outcome and acceptance limits

The separately preserved Discover-only `8060121` was verified across all 52 artifact files, passed strict/deep code-signature verification, then installed in place and launched successfully on the connected physical iPhone 16 Pro Max. No uninstall or reset occurred. Discover populated normally. The OS changed the data-container UUID during the update; complete saved-account/data preservation has not been independently established.

Device Hub briefly accepted physical Search/Discover taps and artist Back. Subsequent coordinate taps/drags failed with `noWindowsAvailable`, despite readable live screenshots, including in a fresh supported session. The final scroll execution was uncertain. Continuous gestures, cancellation, reversal, smoothness and Feed-filter acceptance remain unverified. No public content or account mutation was performed.

The separate Apple iPhone Mirroring app was an irrelevant locked window; it was not the working Device Hub route. No credentials were entered. Protected Mac authentication was not bypassed, and no further credential handoff is needed for this task.

The installed `8060121` does not contain the new retained navigation. The final clean combined navigation/card candidate now has a verified signed native build and still requires its own real-device acceptance. Historical combined notification `6569968` remains uninstalled and backend-first held.
