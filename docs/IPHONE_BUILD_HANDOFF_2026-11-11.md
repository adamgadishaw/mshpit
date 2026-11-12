# iPhone build preparation - 2026-11-11

## Source and outcome

Prepared on Windows in the isolated `task-2/mshpit-ios` checkout, branch
`codex/iphone-build-handoff`, from exact combined PC commit
`266a25de7a9bcf1a0deef4afa263af36db38ec02`. Original iOS fix commit
`9857d67c429e70526f91200d83df5b7cd6ccd20a` remains on
`codex/ios-source-reliability`. The active `task/mshpit` and dirty D: checkouts
were not edited. This handoff adds documentation and an offline verifier only;
runtime, configuration, dependencies, and lockfile remain unchanged.

**This handoff is provisional until source integration completes.** The parent
reports the recovered source ZIP is now present and verified on PC. Calendar
restoration/completion belongs to the main PC chat; messaging belongs to its
separate Astra chat. Mac combined `7260456`, keyboard `407aa2f`, messaging
`bbae706`, calendar `c45b153`, and uncommitted calendar work have not been
integrated or inspected in this isolated branch. Nothing in this package
substitutes for those changes, and their workspaces remain untouched.

The smallest next step toward the intended final build is to finish integration
of that preserved source, then freeze the resulting commit. After that,
generate the native project and compile/sign on an authorized Mac or hosted
macOS builder. This review found no additional reproducible source/config
blocker. It produced no Xcode project, archive, signed IPA, or device validation.

## Evidence and boundaries

| Gate | Result | What it does not prove |
| --- | --- | --- |
| Existing combined full gate | Retained parent evidence: 7,191 passed, 0 failed, 1 skipped; production audit clear | Not rerun in this preparation pass |
| Retained iOS Metro/Hermes export | Rechecked all 698 project modules, including 25 native variants, against this isolated source | No Swift/Objective-C compilation or native linking |
| Build/config/scene/API focused tests | 21 passed, 0 failed, 0 skipped | No live API, account, or device actions |
| Offline build-input verifier | Passed config introspection, installed/locked Expo/RN/React versions, 27 Expo modules/28 pods and 9 RN iOS modules; podspecs exist; 0 duplicate modules | Pod resolution/install and native link step not executed |
| Actual SDK template migration | Scene plugin transforms the installed Expo template, is idempotent, preserves URL/universal-link forwarding and release bundle loading; runtime class/protocol present | Swift compiler and scene lifecycle on device not exercised |
| Signing and device acceptance | Pending | No certificate, keychain, profile, Apple/Expo account, device, or App Store lookup performed |

Export bytecode SHA256:
`4d130fce4dc3824d06e74fa6b9e9d562aa9c7ebf5274f087130be2df143ba499`
(8,077,524 bytes; 2,228 total modules in the retained export).
Source map SHA256:
`50ea836059c119daa805ffd6a05e8dec2d2c64aa07bd5ab82515953f7cb0472d`.
The parent export is retained at `task/evidence/combined-ios`.
This pass's reports/logs are in `task-2/iphone-handoff/evidence`.
See also [the combined audit](PC_COMBINED_RELIABILITY_2026-11-10.md).

Reproducible source checks, with installed dependencies:

```text
node scripts/check-iphone-build-inputs.mjs ../iphone-handoff/evidence/build-inputs-verification.json
node scripts/run-tests.mjs scripts/app-store-config.test.mjs plugins/ios-scene-lifecycle.test.mjs scripts/native-intl-bootstrap.test.mjs src/domain/apiOrigin.test.mjs src/lib/nativeReviewMode.test.mjs
node scripts/check-ios-export.mjs <retained-ios-export-directory> <report.json>
git diff --check
```

The new verifier runs local Expo introspection and autolinking with telemetry,
network discovery, and dotenv loading disabled. It reads the bundled template
using the existing `tar` command; it never extracts a native project or changes
platform restrictions. Its JSON report contains selected non-secret facts only.
After integrating recovered runtime changes, run the relevant regression tests,
the full quality gate, and a fresh export rather than reusing this match result:

```text
node node_modules/expo/bin/cli export --platform ios --source-maps --dump-assetmap --max-workers 2 --output-dir <new-output-directory>
node scripts/check-ios-export.mjs <new-output-directory> <new-report.json>
```

## Build inputs

| Item | Observed source / required follow-up |
| --- | --- |
| Toolchain | Node 24.16.0 in EAS base profile; installed Expo 57.0.29, RN 0.86.3, React 19.2.3 |
| Lockfile SHA256 | `9c943d67602361abae77189c26888e342131fd344344f97bc26b476175fd2bc9` |
| Expo template SHA256 | `88296c550f1f628dc82ac3111c368ccff1d8ac6ac1e5f0a5578457c7dc51b5ba` |
| Native project | Generated from Expo configuration; `ios/` is not tracked. No `.ios` override is required; the verified Metro map selects the `.native` variants |
| App identity | Mshpit, `com.mshpit.app`, URL scheme `mshpit`, version `1.0.0`, configured build number `1`; iPhone only, portrait, dark appearance |
| Xcode target/scheme | Expected `Mshpit` from Expo's name sanitization/template; must be confirmed with `xcodebuild -list` after generation |
| Configuration | Template launch/test Debug; archive Release. EAS `preview` is internal distribution with Release default; `production` uses store default and auto-increment |
| Versions on EAS | `appVersionSource: remote`; inspect the actual remote/archived build number before distribution; local `1` is not authoritative there |
| Signing | No team ID, project owner, EAS project ID, or credentials committed; actual account/project/signing state is unknown |
| Native lifecycle | Custom `with-ios-scene-lifecycle.cjs` supplies the scene manifest and Expo factory provider; introspection and real-template transform pass |
| Privacy/config | Explicit required-reason declarations, encryption declaration, limited media permission copy, no arbitrary ATS loads; current introspected entitlements are empty |

The installed SDK template defaults to iOS 16.4. Use the SDK 57 supported
toolchain (Xcode 26.4 or newer compatible version), not an unreviewed SDK upgrade.
Official compatibility reference: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).
At review time the SDK 57 build image alias resolves to
`macos-tahoe-26.5-xcode-26.6`; `eas.json` leaves image selection automatic.
Record the actual resolved image in the later build receipt, or deliberately
pin a supported image then. [Expo build infrastructure](https://docs.expo.dev/build-reference/infrastructure/).

Frontend/Expo dependencies intentionally live in `devDependencies` so the
production server can prune them. A build checkout needs
`npm ci --include=dev`; do not use the server's production-only install or copy
Windows `node_modules` to macOS. Preserve the lockfile and install afresh for the
target OS. Native pods and their eventual `Podfile.lock` remain to be resolved
and recorded by the builder.

Integration prerequisites for the calendar/messaging owners: if their actual
diff adds native dependencies, permission declarations, config plugins or
entitlements, update the lockfile and rerun introspection/autolinking plus a
fresh native prebuild/pod install. This report then describes only the older
PC base. Keep the scene-lifecycle plugin compatible with the generated
AppDelegate; no plugin/template replacement is needed on the checked base.
Use SDK 57 APIs for restored integrations. The source does not currently
configure an EAS project/team or a sandboxed Release profile; those cannot be
inferred from the recovered UI. No particular missing implementation is guessed.

## API and installation identity

`src/domain/apiOrigin.mjs` routes **native Release builds to
`https://www.mshpit.com`**. A loopback `EXPO_PUBLIC_API_URL` used during an
offline export does not make the resulting Release app use a test backend.
`EXPO_PUBLIC_NATIVE_READ_ONLY_REVIEW=1` only takes effect with native `__DEV__`;
it does not protect a Release `preview` build from writes. The export itself
does not execute the app or contact that API. This clarifies the loopback
environment wording in the prior combined audit.

Both existing EAS profiles use `com.mshpit.app` by default. Such an installed
build may replace an existing installation with that identity; it is not
automatically a separate review app. `MSHPIT_LOCAL_DEV=1` switches to
`com.mshpit.app.dev` and `mshpit-dev`, but changes neither the Release API policy
nor `__DEV__`. No EAS development profile currently exists. A sandboxed native
review therefore needs a separately approved Debug/development-client setup
with an authorized test backend; never label the current preview profile as
sandboxed. [Expo build variants](https://docs.expo.dev/build-reference/variants/).

## Later Mac build procedure (not executed)

1. Integrate the preserved Mac work and obtain the approved final commit. Make
   a disposable clean build checkout. Verify its hash; retain the parent PC
   source and recovery originals. Re-run source/export checks after integration.
2. Select a compatible Xcode installation and installed CocoaPods tooling;
   record `xcodebuild -version`, `node --version`, `npm --version`, and
   `pod --version`. Install dependencies with `npm ci --include=dev`.
3. On macOS, generate iOS using the locked local CLI. The Windows CLI explicitly
   filters iOS out in `prebuild/resolveOptions.js`; that restriction was inspected,
   not bypassed. No Windows prebuild attempt is claimed as a generated project.
4. Install pods, inspect generated source/config and scheme, then select the
   authorized signing team and distribution route. Keep credentials in the
   builder's credential store, outside source and evidence logs.

Commands for the disposable macOS checkout (placeholders must be resolved
before use; these are handoff instructions, not actions performed here):

```sh
npm ci --include=dev
node scripts/check-iphone-build-inputs.mjs "$ARTIFACT_DIR/build-inputs.json"
node node_modules/expo/bin/cli prebuild --platform ios --no-install
pod install --project-directory=ios
xcodebuild -list -json -workspace ios/Mshpit.xcworkspace
xcodebuild -showBuildSettings -workspace ios/Mshpit.xcworkspace -scheme Mshpit -configuration Release
```

Ensure `ARTIFACT_DIR` is an existing absolute directory outside the checkout.
Prebuild may edit package metadata: inspect/retain its diff, dependency lock,
generated `Info.plist`, entitlements, AppDelegate, scheme, and `Podfile.lock`.
Do not silently carry generated changes back to the integration branch or drop
the scene plugin. Confirm the scheme shown by Xcode before the following step.
Inspect signing settings locally without publishing credential material.

With a resolved team, certificate/private key and matching provisioning profile
available, use the selected signing mode in Xcode, or an equivalent archive
command configured for that mode:

```sh
xcodebuild -workspace ios/Mshpit.xcworkspace -scheme Mshpit -configuration Release -destination 'generic/platform=iOS' -archivePath "$ARTIFACT_DIR/Mshpit.xcarchive" archive DEVELOPMENT_TEAM="$APPLE_TEAM_ID"
xcodebuild -exportArchive -archivePath "$ARTIFACT_DIR/Mshpit.xcarchive" -exportPath "$ARTIFACT_DIR/export" -exportOptionsPlist "$APPROVED_EXPORT_OPTIONS_PLIST"
```

`APPLE_TEAM_ID` and the export-options plist must come from the authorized
signing setup, not guessed placeholders. The archive command assumes signing
is already configured; manual signing also requires its chosen profile/cert
settings. Choose ad hoc or App Store export deliberately. Review the signed
archive's actual identifier, version/build, entitlements, architectures and
profile coverage; retain SHA256 hashes, dSYMs, build log and toolchain receipt.
An unsigned compile or a Metro bytecode file is not an installable iPhone IPA.

## Hosted build alternative (requires later authorization)

No cloud request, upload, login, project creation/link, device registration,
credential mutation or build submission occurred. If a supported build service
is selected later, first resolve the intended existing Expo project/owner and
access rights; do not create a duplicate just because the source has no
`extra.eas.projectId`. No `eas` executable was available in this Windows shell;
the source only sets the broad CLI floor `>=16.18.0`, not a reproducible pin.
Select a compatible pinned EAS CLI and record its version before submission.
Review that project's build environment so inherited variables do not alter
the identity or omit development dependencies.

For current `preview`, internal distribution normally means an ad hoc signed
IPA: the Apple team, distribution certificate/private key and provisioning
profile must cover `com.mshpit.app` and each approved device UDID. Obtain device
registration only in a later authorized step; no phone is needed for these
source checks. For TestFlight, use the production/store route, matching App
Store Connect app/access and a distinct later submission step. Build and submit
are separate operations. [Internal distribution](https://docs.expo.dev/build/internal-distribution/),
[iOS build process](https://docs.expo.dev/build-reference/ios-builds/).

After source, account, signing, environment, distribution audience, quota/cost
and upload authorization are resolved, the build-only command is:

```text
eas build --platform ios --profile preview
```

Use `--profile production` instead only if the agreed goal is a store/TestFlight
artifact. No `--auto-submit` is part of this handoff. EAS `requireCommit: true`
requires a committed source; remote versioning and signing defaults must be
reviewed in the chosen project. [EAS configuration](https://docs.expo.dev/eas/json/).
The portable source ZIP is a preservation artifact, not a linked EAS
project; import the branch via Git before a build requiring a commit.

Costs checked 2026-11-11: Expo Free lists 15 iOS builds and a low-priority queue;
Starter is $19/month plus usage with $45 build credit. Available account quota
and plan are unknown; a paid plan was neither required nor purchased here.
[Expo pricing](https://expo.dev/pricing).
Apple Developer Program membership for the ad hoc/TestFlight routes is
$99/year or local equivalent; existing membership and certificates are
unverified. [Apple enrollment](https://developer.apple.com/programs/enroll/).
EAS local builds also need supported macOS tools and Expo authentication; they
do not make Windows an Xcode host. [Local builds](https://docs.expo.dev/build-reference/local-builds/).

## Later native acceptance

Perform these only with an approved build, target device and test-account/data
scope. Actions such as notification acknowledgement can write to the API;
current Release routes target production. Do not run mutation scenarios against
production merely because the build is called preview.

| Scenario | Acceptance on the installed native build |
| --- | --- |
| Build identity/lifecycle | Correct version/build/identity; cold start, background/foreground, URL/deep-link startup and offline recovery; no missing native module or scene crash |
| Current badges | Existing feed and standalone posts reflect current author badges; unauthorized account actions remain unavailable |
| Title and active tab | Each relevant title/active tab scrolls to top and refreshes once; spinner/feedback completes or exposes recovery; disabled boundaries do not advertise refresh |
| Notifications | One history list; only confirmed unread IDs acknowledged; failure/retry does not silently erase unread state |
| Feed traversal | For You/Local/Following load eligible older pages, retain stable order without duplicates, and recover from interrupted/expired pagination |
| Find a Show | Opens saved home city; dismissible prompt leads to Discover Cities; prompt resets for a different city/country and stays dismissed in the same context |
| Layout and control | Safe areas/tab/header hit areas, small and large iPhone layouts, VoiceOver labels/focus, Dynamic Type, Reduce Motion, and scroll/gesture behavior |
| Recovered work | After actual Mac integration, derive calendar/messaging/keyboard acceptance from that recovered diff and its tests; those changes have not been inspected here |

Keep source preparation, Metro export, Xcode compile/link, signed artifact,
installation, and native acceptance as separately recorded gates. No web test
or source-map match closes the last four gates.
