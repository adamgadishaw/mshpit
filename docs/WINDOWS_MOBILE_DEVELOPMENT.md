# MSHPIT: free local mobile development on Windows

Assessment date: 2026-10-14. Isolated checkout: `mshpit-android` in this Codex task workspace. Branch: `codex/windows-android-dev-20261014`, based on GitHub master `92aa96d`.

## Current verified state

The existing checkout at `D:\Websites\Concert Website\pit` and all its worktrees were preserved. Its unrelated untracked audit file remains present. No application screen, server behavior, production config in app.json, or deployment was changed. No existing Node process was stopped.

- Node 24.16.0 and npm 11.13.0 are installed. Java, Android SDK, adb and emulator were not found on PATH or in the checked standard installation locations.
- C: had approximately 132 GiB free. Plan for roughly 10–20 GB for an Android SDK, NDK, Gradle caches, emulator and one system image; actual use depends on selected packages. No Android tooling download was started.
- Locked dependencies installed successfully. SDK 57 patch packages were aligned, retaining React Native 0.86.3 and React 19.2.3. Expo is now 57.0.28; expo-dev-client is 57.0.20. This is an isolated patch update, not a production release.
- `expo install --check`: passes. Expo Doctor: 21/21 checks pass.
- Existing sharing/API-origin tests: 47/47 pass. Application config tests: 10/10 pass, including the production/server dependency boundary.
- Android prebuild succeeds with the existing react-native-share plugin. Generated native project uses `com.mshpit.app.dev`; manifest contains the Instagram/Facebook/X package queries.
- Android export: 2,084 modules, successful Hermes bytecode bundle, approximately 9.2 MB.
- iOS export: 2,087 modules, successful Hermes bytecode bundle, approximately 9.2 MB. This is not an iOS native compilation.
- Metro on localhost:8082 returned HTTP 200 for status and Android manifest; manifest identified Mshpit Dev, com.mshpit.app.dev and SDK 57. The temporary server was stopped after checking.
- New JavaScript setup files pass Node syntax checks. No TypeScript source/config or type-check command is established in this JavaScript repository; no full TypeScript check is claimed.
- A separate narrow security remediation pins transitive shell-quote to 1.11.0. Clean `npm ci` reproduces that version; only this package changed in the lockfile. Its quoting regression check, all 57 targeted tests, Expo compatibility/Doctor and the Android Hermes export pass after remediation.
- Gradle preflight stops with `JAVA_HOME is not set and no 'java' command could be found in your PATH`.

No APK has been compiled or installed. No emulator or iPhone app runtime was verified, so there are no actual running-app screenshots.

Validation logs and bundle outputs are under `.tmp/validation`, `.tmp/export-android` and `.tmp/export-ios` (ignored by Git).

## Dependency assessment

`react-native-share` 12.3.1 provides a native module and has New Architecture source paths. Its config plugin generated successfully. This does not establish compilation compatibility with RN 0.86.3: codegen, Java/Kotlin/C++ compilation and device behavior remain unverified until the toolchain is installed.

The real app loads this module dynamically inside `src/lib/socialShare.native.js`, when a social share is requested. It catches unavailable-module errors. It is not part of Expo Go's bundled native modules. Instagram Story, X/Facebook image handoff, target-app detection, and the image-capable native share sheet therefore require the development build. Instagram Story additionally needs the existing Meta app ID configuration and target app; no new Meta account or configuration was created.

The app's other native packages have SDK 57-compatible versions: Expo audio/video, image/image picker/manipulator, file system, clipboard, sharing, SQLite, asset/status/splash/system UI; community slider; Skia; Reanimated/Worklets; gesture handler; safe-area context; SVG. Doctor and bundling verify dependency resolution, not native feature execution.

`npm audit --omit=dev` reports 0 vulnerabilities. All-dependency audit now reports 19 high and 0 critical, versus 22 high and 1 critical on untouched master. No new vulnerable package names were introduced. The existing critical [shell-quote advisory GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) was removed by an explicit 1.11.0 transitive override; its React DevTools parent permits this version through `^1.6.1`. This is development tooling, including interactive editor integration, not exclusively build-time code. The inspected editor integration uses `parse()` rather than the advisory's vulnerable `quote()` path, so exposure of Metro alone was not established as a trigger. Remaining high findings are in development/native tooling. Audit suggests incompatible major downgrades for several packages; none were applied. Keep Metro local, and resolve the remaining toolchain advisories before exposing a development server or treating this as release-ready.

## Android toolchain approval and setup

Google's exact Android SDK License Agreement is at https://developer.android.com/studio/terms . Owner approval is pending; no licence was accepted. Do not pipe automatic yes responses to sdkmanager. Review and approve any additional package-specific agreement before acceptance. Avoid Google Play/Google APIs emulator images unless their additional terms are approved; an AOSP image can reduce that scope.

After approval, install official Android tooling with Android SDK Platform 36, platform-tools, command-line tools, emulator and one x86_64 image. SDK 57's compile/target SDK is 36. Let the generated project's Gradle configuration identify its exact build-tools/NDK/CMake dependencies rather than guessing older SDK defaults. Use a supported JDK (RN setup recommends JDK 17); an Android Studio bundled JDK must also satisfy this Gradle project's requirements. Use official downloads. No accounts or cloud builds are needed.

Create one phone AVD in Android Studio Device Manager and launch it. Check acceleration availability; stop for approval if Windows features, BIOS virtualization, security settings or drivers need modification. A physical Android phone is an alternative when already available, with owner-enabled USB debugging and the device's connection consent.

In PowerShell, set paths for this terminal only (substitute actual installations):

```powershell
cd 'C:\Users\Adam Gadishaw\Documents\Codex\2026-10-14\task\mshpit-android'
$env:JAVA_HOME = '<actual JDK directory>'
$env:ANDROID_HOME = '<actual Android SDK directory>'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = Join-Path (Get-Location) '.tmp\gradle-cache'
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:PATH"
java -version
adb version
emulator -list-avds
adb devices
# Start the AVD from Android Studio, or: emulator -avd '<AVD name>'
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081
npm run mobile:android
```

`mobile:android` runs the Windows-supported local `expo run:android` path. Do not use EAS local build as the Windows build route. Only debug builds are in scope. Expected APK after successful compilation: `android\app\build\outputs\apk\debug\app-debug.apk`. The generated template uses Android's debug keystore; this is not release signing or store submission.

For later sessions with the development APK already installed:

```powershell
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081
npm run mobile:start
# Open Mshpit Dev on the emulator/device and select this local server.
```

These commands default to `EXPO_PUBLIC_API_URL=http://localhost:3000` and reject any non-localhost API, including production. `adb reverse` maps the device localhost ports to this PC. They select the separate development app identifier/name/scheme through `MSHPIT_LOCAL_DEV=1`. Default Expo configuration still retains the production identifiers. The runner restores package.json after prebuild, which otherwise moves build dependencies into the server dependency section and changes existing npm scripts.

No API server, test account or fixture data is provisioned by these commands. Use a separately verified disposable localhost backend before testing data-backed or mutating flows. Do not copy production `.env`, credentials or databases. Without a local backend, API-backed screens can show loading/offline/error states, not real functional coverage. Authenticated upload/post/share-card preparation must wait for a safe fixture backend.

## iPhone / Expo Go scope

On an iPhone with an Expo Go version supporting SDK 57 and iOS 16.4+, this source-level assessment identifies likely UI preview candidates:

| Screens / behavior | Preview scope |
| --- | --- |
| Welcome, authentication form layout, menu, settings, privacy, terms, badge legend | Ordinary React Native UI and navigation candidates; device preview still unverified |
| Feed, search/discover, artists/venues/cities, show details, calendars, top rated, clubs | UI candidates; meaningful loaded data requires a reachable approved non-production API |
| You/profile, log/review forms, edit profile, inbox/lounge/threads/crew | UI candidates; accounts, writes and uploads require disposable test data/backend |
| Photo/video/audio previews and local persistence | Bundled SDK libraries exist; actual playback, permissions, picker and storage behavior must be tested on the phone |
| Social image sharing and Instagram Stories | Not supported by Expo Go; defer to custom native builds |
| Native splash, configured permissions, app identifiers/scheme, package queries/deep links | Expo Go uses its own binary; custom-app configuration is not verified |

Run `npm run mobile:go` to display the Expo Go LAN QR code. This intentionally preserves the local API default, so the iPhone's localhost does not reach the Windows backend. Treat it as a limited offline/UI preview until a separately approved HTTPS staging endpoint or secure local connectivity is prepared. The current API-origin policy rejects plain HTTP LAN IP addresses, so do not simply set `http://192.168...` and expect it to work. No production code was rewritten to accommodate Expo Go, and no tunnel service was created.

Android testing does not certify iOS. Windows cannot run Apple's local simulator or Xcode native compile. An unsigned simulator compile on a suitable Mac could later check compilation; it would still not validate a physical iPhone. EAS Simulator is limited-access and was not assumed available or invoked. Real signed iPhone/TestFlight checks remain for later Apple Developer enrollment.

## Reproduce checks

```powershell
npm ci
npx expo install --check
npx --yes expo-doctor
npm run mobile:prebuild
node --test scripts/app-store-config.test.mjs src/domain/socialShareCard.test.mjs src/domain/socialSharePopup.test.mjs src/domain/socialSharePreparationUi.test.mjs src/domain/socialShareUi.test.mjs src/domain/shareCardPreparation.test.mjs src/lib/socialShareNativeCache.test.mjs src/domain/apiOrigin.test.mjs
$env:MSHPIT_LOCAL_DEV='1'
$env:EXPO_PUBLIC_API_URL='http://localhost:3000'
npx expo export --platform android --max-workers 2 --output-dir .tmp/export-android
npx expo export --platform ios --max-workers 2 --output-dir .tmp/export-ios
npm audit --omit=dev
git diff --check
```

Sources: [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/), [SDK 57 development client](https://docs.expo.dev/versions/v57.0.0/sdk/dev-client/), [Expo local debug builds](https://docs.expo.dev/guides/local-app-development/), [React Native Share installation](https://react-native-share.github.io/react-native-share/docs/install), [React Native environment setup](https://reactnative.dev/docs/set-up-your-environment).
