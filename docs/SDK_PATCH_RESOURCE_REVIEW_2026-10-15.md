# SDK 57 patches and Windows resource review — 2026-10-15

This continues the isolated Android review in `D:\Development\Apps\mshpit`, branch `codex/nearby-show-finder-20261015`. The main web checkout and its unrelated audit file remain untouched. No production deployment, paid build, account enrollment or signing credential operation was performed.

## Compatible dependency updates

The four recommendations from Expo Doctor were installed in the repository's existing `devDependencies`: Expo 57.0.28 → 57.0.29, `@expo/metro-runtime` 57.0.16 → 57.0.17, `expo-asset` 57.0.19 → 57.0.20 and `expo-constants` 57.0.21 → 57.0.22. React Native stays 0.86.3 and `react-native-share` stays 12.3.1. Their existing semver ranges remain patch-constrained. The version assertions in `scripts/app-store-config.test.mjs` were updated to match, without weakening the production dependency/prune checks.

The package tarball diffs and official SDK 57 changelogs were reviewed. Metro runtime changes only package metadata; asset changes include version/artifact packaging; constants includes iOS shell-path quoting fixes. Expo's bundled-version map advances compatible patches. The resulting lockfile changes exactly nine installed versions (43 additions and 43 removals): the four direct dependencies plus `expo-modules-core` 57.0.22 → 57.0.23, `expo-modules-autolinking` 57.0.15 → 57.0.16, `@expo/prebuild-config` 57.0.18 → 57.0.19, nested `@expo/cli` 57.0.29 → 57.0.30 and `@expo/xcpretty` 4.4.6 → 4.4.7. Prebuild config follows the autolinking patch; CLI changes are version metadata; xcpretty adds warning/error lookaheads to its Xcode log matchers. No major upgrade or audit override was applied.

Core 57.0.23 fixes an iOS SwiftUI accessory hierarchy issue; this Windows run does not validate that behavior. Core's listener garbage-collection fix was already present in the previous 57.0.22 baseline, so it is not a newly obtained explanation for a measured memory improvement. Sources: [SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Expo changelog](https://github.com/expo/expo/blob/sdk-57/packages/expo/CHANGELOG.md), [constants changelog](https://github.com/expo/expo/blob/sdk-57/packages/expo-constants/CHANGELOG.md), [Core changelog](https://github.com/expo/expo/blob/sdk-57/packages/expo-modules-core/CHANGELOG.md).

The Expo CLI install handoff initially lost the `--dev` classification and left the old development versions installed. This was detected before verification/commit. Only the four accidental production duplicates were removed, then the official `@expo/package-manager` `addDevAsync` route installed the reviewed ranges. The final production dependencies remain the original three server dependencies. The successful install is logged in `.tmp/overnight/sdk-patch-install-reviewed.log`. `npm ci --dry-run --include=dev --ignore-scripts --no-audit --no-fund` passes; this verifies lockfile consistency, not a fresh physical reinstall. The successful Android build used the resulting installed graph.

## Audit exposure and remaining risk

The full audit still reports 19 high entries inherited from two root advisories:

| Package and path | Issue | Fixed compatible version |
| --- | --- | --- |
| `braces` 3.0.3 through Expo → `@expo/metro` 56.0.2 → `metro-file-map` 0.84.5 → `micromatch` 4.0.8 | Deep recursive brace-pattern stack exhaustion; [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | None published; registry latest is 3.0.3. |
| `node-forge` 1.4.0 through Expo's CLI and `@expo/code-signing-certificates` 0.0.6 | RSA PKCS#1 v1.5 signature verification weakness; [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | None published; registry latest is 1.4.0. |

Neither package nor micromatch occurs in the completed Android or iOS application source-map graph (initial SDK-patch graphs: 2,038 and 2,041 sources; final native-retention graphs: 2,040 and 2,043). Application/server imports were also checked. `react-native-share` does appear in both mobile graphs, including its native spec: successful exports do not turn those features into Expo Go-supported features. The graph receipt is `.tmp/overnight/sdk-patch-runtime-graphs.json`.

This narrows the two findings to the installed host build/development toolchain for these tested application graphs; it does not clear the tools or establish exploitability under every input. `npm audit --omit=dev` returns zero findings for the separate production-server graph. Existing production prune tests reject retained Expo/Metro/CLI/forge tooling. npm's proposed Expo 44 downgrade is incompatible and was not used. Logs: `sdk-patch-full-audit.json` and `sdk-patch-server-audit.log`. No suppression or forced audit fix was added.

## Completed checks

| Check | Result |
| --- | --- |
| Expo Doctor | **21/21 passed**. |
| Expo version compatibility | `expo install --check` passed. |
| Full hermetic suite | **6,328 tests; 6,327 passed, 0 failed, 1 skipped**, 96.529 s. |
| Node syntax | Passed, 854 files. |
| Architecture | Passed, unchanged 144/144 Store-hook ceiling. |
| Android and iOS exports | Both passed with external source maps; 7.8 MB Hermes bundles as reported by this export. |
| Native Android rebuild | Offline `:app:assembleDebug`, x86_64, passed in **2m16s**, 501 tasks / 124 executed. Existing debug signing only. |

The APK remains `android/app/build/outputs/apk/debug/app-debug.apk`, package `com.mshpit.app.dev`, target API 36, SHA-256 `fa1e18facc4a86d38064e40768d7c3c9dd096dc5d4b254499150dd87402f5a68`. Gradle reports existing deprecation warnings for Gradle 10; it succeeds on the configured Gradle 9.3.1. No TypeScript project check, native iOS compile, ARM phone, release APK/AAB or signed iPhone result is claimed.

## Saved screenshot evidence

The supported Library direct-create route succeeded for all four selected images. Receipts are also saved in the task's `overnight-direct-library-receipts.json`:

| Actual screenshot | Library file ID |
| --- | --- |
| Small Discover before, 360 dp / 130% text | `libfile_6e3b2dff3e4c81918504d8d8eedbbf32` |
| Small Discover after, whole section labels | `libfile_5536c9852fa08191b5cb4a6b41b13197` |
| Settled recovered Discover | `libfile_b3e4fafbc960819187f415870a10f0ab` |
| Verified native fullscreen video | `libfile_f2551f1a0eb08191ac4b26341f360c47` |

The previously interrupted owner Feed screenshot was reopened successfully. No duplicate Library copies were created. The earlier guest/member report's statement that Library was unavailable is superseded by this success.

## Runtime follow-up

Updated APK installation succeeded and the guarded owner session was preserved. [The measured native Feed/media review](NATIVE_FEED_MEDIA_REVIEW_2026-10-15.md) records navigation/scrolling samples, video and photo controls, the corrected Feed scroll-position/remount behavior, bounded resource results and final passing regression/exports. No improvement is attributed to dependency patching alone.
