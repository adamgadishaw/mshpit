# Guest, member and store-readiness review — October 15, 2026

Local app checkout: `D:\Development\Apps\mshpit`, branch `codex/nearby-show-finder-20261015`. This continues the [player review](PLAYER_RECOVERY_REVIEW_2026-10-15.md) and [Nearby review](NEARBY_SHOW_FINDER_REVIEW_2026-10-15.md). No push, production deployment, store submission, production post, new account, enrollment, purchase or credential creation occurred. The original web application and separate font-CSP worktree were preserved.

## Changes made

- `7471b79` preserves a bounded, read-only native News destination across confirmed login. Previously the guest gate discarded the destination, so completing login returned to the previous screen. News and validated live-coverage slugs can resume; composer/moderation payloads cannot. Cancel/Back retains the public parent. Ordinary web News access is unchanged.
- `8dcf133` makes Discover's visible Retry use the coordinated refresh. A controlled native test found that retrying only the overview restored data while leaving the page-level failure warning visible. The corrected retry clears both warnings after successful recovery and continues to report a failed retry honestly.

## Isolated guest installation

The second debug APK uses `com.mshpit.app.guestreview` with its own Android storage. The owner app remains `com.mshpit.app.dev`; its session was never signed out or copied. The guest APK was built **offline in 2m 58s**, with 501 Gradle tasks (36 executed, 465 up-to-date), using the existing debug key. No native project source was changed: a local Gradle initialization script temporarily overrides the application ID through `androidComponents.finalizeDsl`.

Artifacts under `.tmp/overnight/guest/` include `guest-review.apk`, `guest-review.init.gradle`, `build.log` and `owner-dev-original.apk`. The normal `android/app/build/outputs/apk/debug/app-debug.apk` was restored after the build; both original copies have SHA-256 `66eedc89d2eb35329f08e2115cfa4f2323adee81cbbb4be9baa66ad1f955befc`. The guest APK was installed alongside it. Both launcher labels say Mshpit Dev; use explicit package commands to distinguish them.

```powershell
. D:\Development\Tools\Use-Android.ps1
adb -s emulator-5554 install .tmp/overnight/guest/guest-review.apk
adb -s emulator-5554 shell -n am start -a android.intent.action.VIEW -d 'mshpit-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' com.mshpit.app.guestreview
```

Metro's first guest bundle stalled before React mounted. Restarting the local server with the same approved read-only configuration resolved it; the fresh bundle completed in 13.880 seconds. Expo's first-use development-menu help was dismissed. No app storage was cleared. These development-server stalls were not counted as successful app tests.

## Actual Android coverage

Public navigation callbacks were exercised against mounted production components; Search input, keyboard and the repeated Back chain also used actual Android input. This is not a claim that every callback was tested through a physical tap.

| Surface | Observed result |
| --- | --- |
| Guest entry | Intro, public Discover and sign-in affordances rendered without an account. |
| Discover artists | Real public chart loaded; missing chart artwork used readable initials. |
| Drake | Biography, contributed artwork, genre, empty ratings and upcoming-show count rendered. No Follow action was submitted. |
| Cities | Public London/Las Vegas cards loaded; Toronto guide rendered real photos and counts. |
| Events | Existing moondoggy show opened from a city ticket, showing date/time, venue and honest missing-photo state. No Going, tickets or external directions action was invoked. |
| Venues | The Mod Club page rendered address, upcoming preview and a guest community gate. No review or account mutation occurred. |
| Back | Venue → Show → City → Discover passed with each destination checked before the next Back. Evidence: `guest/back-chain.json`. |
| Festivals | Public listing and an actual Rolling Loud edition opened. Empty lineup/reviews were explicit. External catalogue date accuracy was not independently certified. |
| Search | Android typing of Drake returned two artist matches and show, venue and fan-club matches. Keyboard and category navigation remained usable; no-cities result was explicit. |
| Guest News | Native owned News link opened AuthScreen. No credentials or new account were used. |
| Login return | The actual App completion callback was tested with a confirmed-account fixture, safe/invalid slugs, prior parent and missing confirmation. No live fresh-login claim is made. |
| Error/retry | Guest-only transport rejection of `/api/discover/overview` retained real last results and displayed an error. Transport was restored; the actual Retry handler recovered. The runtime fixture was removed. |
| Member News | The owner's retained session opened NewsScreen directly; content rendered without the guest gate. No reactions, report, repost or share were submitted. |
| Member Settings | Settings and deletion warning rendered; inspection stopped before Continue/password confirmation. Theme, preferences and account remained unchanged. |

The final owner runtime again returned `{ readOnly: true, postAllowed: false, loginAllowed: true }`. The visible emulator window remained open on the signed-in Feed. The local server is started through `scripts/mobile-dev.mjs`, with the approved canonical API, analytics disabled and the real native read-only guard enabled. See the earlier review for reproducible run commands. Do not use a release-mode bundle as the live read-only review runtime: that review guard is development-only.

## Validation

| Check | Result |
| --- | --- |
| Full suite after both fixes | **6,325 tests: 6,324 passed, 0 failed, 1 skipped**, 98.281 s; `.tmp/overnight/full-tests-navigation.log`. |
| Focused navigation tests | 34 passed. |
| Discover retry/pull-refresh tests | 7 passed, including real callback failure → success → failure. |
| Syntax | Passed, 854 Node files. No TypeScript project check is claimed. |
| Architecture | Passed at unchanged 144/144 legacy Store hooks. |
| Android JS export | Passed; 9.3 MB Hermes bundle in `.tmp/overnight/export-android/`. |
| iOS JS export | Passed; 9.3 MB Hermes bundle in `.tmp/overnight/export-ios/`. |
| Expo Doctor | 20/21 passed; only SDK patch-alignment check failed. |
| Existing debug APK ZIP alignment | Passed `zipalign -v -c -P 16 4`. |
| Existing debug APK ELF alignment | 26/26 x86_64 shared libraries passed 16 KiB load-segment alignment inspection. |

Exports were sequential with Metro stopped to avoid Windows cache contention; the guarded development server was restarted afterward. The APK remains an x86_64 emulator debug APK. Alignment inspection does not establish ARM release compatibility or successful execution on a 16 KiB device. No signed release binary was built.

### Dependency assessment

Installed Expo 57.0.28 and React Native 0.86.3 remain unchanged. Expo recommends four patch updates: `@expo/metro-runtime` 57.0.16 → ~57.0.17, `expo` 57.0.28 → ~57.0.29, `expo-asset` 57.0.19 → ~57.0.20, and `expo-constants` 57.0.21 → ~57.0.22. This review did not broadly upgrade the SDK or suppress the diagnostic.

Full `npm audit` reports 19 high entries inherited from two root advisories: [braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [node-forge signature verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv). Both advisories list no patched version; registry latest remained braces 3.0.3 and node-forge 1.4.0 when checked. Their installed paths are through Expo/Metro/CLI. This does not demonstrate an exploitable mobile-runtime path, and these findings remain unresolved. Do not apply npm's proposed Expo 44 downgrade. The production-server-only `npm audit --omit=dev` reports zero findings; this repository deliberately keeps mobile tooling in development dependencies, so that narrower result does not clear the mobile/build graph. Logs and dependency paths are in `.tmp/overnight/`.

`react-native-share` 12.3.1 compiled in both local Android debug APKs. The app loads it lazily when needed; no source was rewritten to fit Expo Go. Native Story/target-app handoff remains untested without target apps and appropriate native builds.

## Store readiness: engineering evidence and remaining gates

1. **Public policies work, operational approval remains.** Unauthenticated GETs of `/privacy`, `/terms`, `/support` and `/account-deletion` returned 200 with standalone headings. This proves reachability, not monitored support or completed legal review. The existing Settings deletion entry and warning were inspected; actual deletion/storage cleanup must be rehearsed on disposable staging data. [Google's deletion guidance](https://support.google.com/googleplay/android-developer/answer/13327111) requires an accessible in-app and external request path where applicable.
2. **UGC controls need operational evidence.** Existing report/block/filter/moderation surfaces and the earlier operations draft remain relevant. Actual report handling, removal timing, backup/storage deletion and support coverage were not exercised against production. [Apple's UGC rules](https://developer.apple.com/app-store/review/guidelines/#user-generated-content) and [Google's UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937) make those release concerns, not items to infer from code alone.
3. **Confirm published child-safety standards/contact.** Explicit CSAE/CSAM/child-safety language was not found in the four checked public pages. For a Social-category listing, [Google's child-safety guidance](https://support.google.com/googleplay/android-developer/answer/14747720?hl=en) calls for published standards, an in-app feedback mechanism and a designated contact. The owner must confirm the listing category and supply/approve the actual standards and operational contact; no legal policy or named responsibility was invented here.
4. **Release device/configuration validation remains.** The installed APK targets API 36, matching the [current Play target requirement](https://developer.android.com/google/play/requirements/target-sdk). The inspected debug manifest has no camera, microphone or device-location permission; debug overlay/legacy storage/network permissions are recorded in `debug-permissions.txt`. Audit the merged signed release manifest separately. [Android's 16 KiB requirements](https://developer.android.com/guide/practices/page-sizes) still need ARM and device-runtime evidence. Verify denied photo access, external sharing, deep links, offline/background lifecycle, accessibility/font scaling and smaller/larger phones on release candidates.
5. **iOS remains a separate gate.** Ordinary source-assessed Expo Go preview candidates include welcome/auth, Feed, Search/Discover, entity/detail pages and Settings with a matching SDK 57 client. No iPhone was tested. Custom sharing, app IDs, permission/config plugins and target-app integration require a native build. Windows cannot run Apple's local simulator; no Xcode compile, EAS Simulator availability or signed iPhone/TestFlight result is claimed. A suitable Mac can later perform an unsigned simulator compile; signed real-device/TestFlight work remains for later owner enrollment.

Existing release documents also retain owner decisions about brand/media rights, privacy/data-safety declarations, moderation coverage, permanent identifiers, review access and signing. This audit does not authorize any purchase, account enrollment, publication or production change.

## Screenshots and morning review

Actual pixels were inspected locally. Selected public UI evidence under `.tmp/deliverables/` includes:

- `mshpit-guest-drake.png`
- `mshpit-guest-toronto.png`
- `mshpit-guest-show.png` and `mshpit-guest-venue.png` (honest missing-photo states)
- `mshpit-guest-festival-detail.png`
- `mshpit-guest-search-drake-results.png` (keyboard visible)
- `mshpit-guest-discover-error.png`
- `mshpit-native-fullscreen-final.png`, `mshpit-player-slow.png`, `mshpit-player-retry-recovered.png` from the preceding phase

The requested Library batch was unavailable before upload. **No new Library attachment is claimed.** The images remain local for attachment from a working Library context. The `mshpit-discover-retry-fixed.png` capture contains a transient development refresh banner; use its runtime JSON plus a later settled capture for final recovery evidence. Internal Settings/deletion screenshots are not selected for Library. Expo's floating gear visible in some guest captures belongs to the development client.
