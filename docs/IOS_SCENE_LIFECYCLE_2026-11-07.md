# iOS 27 scene lifecycle repair

## Cause and scope

Xcode 27.2 compiled the SDK 57 native template, but iOS 27.2 terminated it at startup with: `UIScene life cycle is required for apps built with this SDK`.

The existing Expo package already provides `ExpoAppSceneDelegate` and `ExpoReactNativeFactoryProvider`. The config plugin in `plugins/with-ios-scene-lifecycle.cjs` wires the generated app to those supported APIs. It keeps factory creation and linking overrides in AppDelegate, moves window/startup ownership to Expo's scene delegate, and declares one application scene in Info.plist. Expo's delegate forwards foreground/background events and cold/warm URL events to the existing app delegate.

The plugin is registered in app.json for development and production regeneration. It is idempotent and fails explicitly if a future Expo template or custom scene manifest requires review. It does not change signing, entitlements, accounts, deployment, or backend selection.

## Local workflow

Use Node 24+ and CocoaPods. On this Mac, their executable folders are `$HOME/.local/node24/bin` and `$HOME/.gem/ruby/2.6.0/bin`.

- `MSHPIT_LOCAL_DEV=1 EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo prebuild --platform ios --no-install`
- Preserve the repository package.json after prebuild: Expo moves frontend development dependencies, but this repository intentionally keeps them out of its production server dependency set.
- Run `pod install` in ios, then open `ios/MshpitDev.xcworkspace`.
- `npm run mobile:backend` starts the disposable, outbound-blocked local backend.
- `npm run mobile:start` starts the IPv4-first local development server. IPv4-first is important: on this Mac plain `expo start --localhost` bound only IPv6, while the simulator tried IPv4.

Simulator compilation does not require an Apple signing account. Do not interpret it as a signed device build or TestFlight approval.

## Verification

Regression tests cover AppDelegate migration, idempotence, retained linking/super calls, manifest generation, preservation of unrelated roles, and explicit rejection of incompatible templates/custom delegates. Native regeneration from an absent ios directory reproduces the scene configuration, with old generated files retained separately during verification. Checks and simulator evidence are recorded below; simulator validation is distinct from release-device certification.

### Recorded local results

- Fresh regeneration plus native Debug arm64 simulator build: passed on Xcode 27.2 / iOS 27.2.
- Plugin regression tests: 3 passed. Independent read-only review found no concrete defect.
- Final review baseline: rebased cleanly onto master `1fad4d4` (festival fixture isolation from PR #93). Fresh `TMPDIR=/tmp TMP=/tmp TEMP=/tmp npm run check` passed: all 7,075 tests, production dependency audit (zero vulnerabilities), syntax, architecture, and production web export/budget (504.0 KiB / 512.0 KiB). `git diff --check` passed.
- Historical baseline before PR #93: 7,073 tests passed and two existing festival fixture assertions failed. Six initial macOS temp-directory fixture failures were avoided by the explicit `/tmp` environment above. No festival changes are included in this lifecycle patch.
- Simulator smoke on the repaired build: welcome renders, login form opens/closes without submitting credentials, Discover artists/Shows render, background/foreground retains the selected Shows tab, and warm `mshpit-dev://news` reaches the logged-out sign-in gate.
- No real-user login, media upload, signed iPhone build, TestFlight upload, merge or production deployment was performed. The source fix is prepared separately for draft PR review. Existing SafeAreaView/deprecated border-style development warnings remain outside this startup repair.
- The freshly regenerated/rebuilt app was reinstalled and cold-launched successfully into Discover. Cold `mshpit-dev://news` opens the development launcher; after selecting the local bundle, its original intent survives and reaches the sign-in gate. This development-client step is not a release-build deep-link certification.
