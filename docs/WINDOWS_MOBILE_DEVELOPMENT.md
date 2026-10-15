# MSHPIT: free Windows Android development

**2026-10-15 update:** the Android emulator and installed development app now run successfully. The initial virtualization blocker below is historical. See [the current local review and run commands](NEARBY_SHOW_FINDER_REVIEW_2026-10-15.md) for verified screenshots, read-only review mode, current branch and remaining device limitations.

Updated 2026-10-14. The isolated app checkout is now `D:\Development\Apps\mshpit`, branch `codex/windows-android-dev-20261014`, based on GitHub master `92aa96d`. The earlier Codex task checkout and the original `D:\Websites\Concert Website\pit` working tree/worktrees were preserved. No production app screen, server behavior, deployment or production data was changed.

## Verified outcome and remaining blocker

The native Android development APK compiled successfully in 13 minutes 19 seconds (696 Gradle tasks). This includes React Native New Architecture codegen/C++ and react-native-share 12.3.1. The APK verifies with Android debug signing, identifies itself as **Mshpit Dev / com.mshpit.app.dev**, targets SDK 36, and contains only **x86_64** native libraries.

- APK: `D:\Development\Apps\mshpit\android\app\build\outputs\apk\debug\app-debug.apk`
- Size: 112,176,224 bytes (about 107 MiB).
- SHA-256: `66eedc89d2eb35329f08e2115cfa4f2323adee81cbbb4be9baa66ad1f955befc`.
- This is an emulator development APK, not an ARM phone APK or a store release.

The AVD `mshpit-api36` exists on D:, but no running app was verified. Hardware inspection reports firmware virtualization disabled on the AMD Ryzen 7 3700X, no running hypervisor, and Windows Hypervisor Platform disabled. One software-mode attempt exited with Windows error 0xC0000005; a second supported software renderer remained offline in adb and was stopped. No settings or drivers were changed. There are **no actual running-app screenshots**.

The next emulator step requires owner approval and manual firmware work: enable AMD SVM/virtualization in BIOS, enable Windows Hypervisor Platform, and reboot. Google's current [emulator acceleration documentation](https://developer.android.com/studio/run/emulator-acceleration) recommends WHPX on Windows; installing an alternative driver is not required for this route. These settings were not authorized or changed by this setup.

## Reusable D: layout

| Location | Purpose |
| --- | --- |
| `D:\Development\Tools\Java\jdk-17` | Checksum-verified Temurin 17.0.20.1 |
| `D:\Development\Tools\AndroidSdk` | Official SDK, emulator, NDK and CMake |
| `D:\Development\Emulators\avd` | AVD definitions and device disks |
| `D:\Development\Emulators\User` | Android/emulator user state |
| `D:\Development\Caches\npm` | npm cache |
| `D:\Development\Caches\Gradle` | Gradle cache/distributions |
| `D:\Development\Caches\Downloads` | Verified archives and provenance |
| `D:\Development\Apps\mshpit` | MSHPIT; future apps use sibling folders |

Reusable session configuration is `D:\Development\Tools\Use-Android.ps1`; shared instructions are `D:\Development\README.md`. Dot-sourcing changes the current terminal only, not global PATH or startup settings. The setup used approximately 19 GiB on D:, including build outputs and caches; about 837 GiB remained free.

Installed tools: Node 24.16.0/npm 11.13.0; JDK 17.0.20.1; platform-tools 37.0.1; Android Platform 36 revision 2; Build-Tools 36.0.0; Emulator 37.2.12; AOSP Android 36 x86_64 image revision 2; NDK 27.1.12297006; CMake 3.22.1; Gradle 9.3.1. The owner approved Google's Android SDK License Agreement, and these SDK package receipts reference `android-sdk-license`. No different installer agreement was accepted, paid service used, or external account created.

## Run after a compatible device is available

In each PowerShell terminal:

```powershell
. 'D:\Development\Tools\Use-Android.ps1'
cd 'D:\Development\Apps\mshpit'
```

Start the disposable backend in one terminal and Metro in another:

```powershell
npm run mobile:backend
```

```powershell
npm run mobile:start
```

The backend command creates a fresh `.tmp\mobile-data-*` database, drops inherited service credentials, binds localhost:3000, and blocks outbound requests. It uses the real backend with disposable seed data; it does not copy production data or provide complete production integrations. Startup and `/api/me` guest HTTP 200 were verified. Metro localhost status/Android development manifest returned HTTP 200. Temporary servers were stopped after checking.

After approved virtualization setup and reboot:

```powershell
emulator -accel-check             # must report an installed usable hypervisor
emulator -avd mshpit-api36 -no-metrics
adb devices                      # must report device, not offline
adb shell getprop sys.boot_completed  # wait for 1
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Open Mshpit Dev and connect to the local Metro server. The local commands use `EXPO_PUBLIC_API_URL=http://localhost:3000`, reject production/non-local APIs, and select the separate development identity/scheme. They restore package.json after Expo prebuild so frontend tools remain pruned from the production server dependency section.

To rebuild the emulator APK:

```powershell
npm run mobile:prebuild
cd android
.\gradlew.bat assembleDebug --no-daemon --max-workers=2 -PreactNativeArchitectures=x86_64
```

For an owner-authorized physical ARM64 Android phone, build for that device using `npm run mobile:android`; this x86_64 APK is not compatible with typical ARM phones. Ordinary JavaScript screen edits can reload through Metro; native dependency/config changes require rebuilding.

## Dependencies and checks

SDK 57 patch packages were aligned on this isolated branch: Expo 57.0.28, expo-dev-client 57.0.20, React Native 0.86.3, React 19.2.3. There was no SDK major upgrade. The transitive shell-quote critical advisory was fixed with an explicit compatible 1.11.0 override, committed separately; only that package changed in its remediation lockfile diff. Clean npm ci reproduced it.

- Expo install compatibility passes; Expo Doctor 21/21 passes in the D: checkout.
- Targeted app config/sharing/API-origin tests pass 57/57 in the D: checkout.
- The patched quoting regression check rejects the advisory's unsafe input pattern without executing a shell command.
- Android native build and debug signature verification pass.
- Android JavaScript/Hermes export: 2,084 modules, about 9.2 MB. iOS JavaScript/Hermes export: 2,087 modules, about 9.2 MB; this is not an iOS native compile.
- Production dependency audit reports 0 vulnerabilities. All-dependency audit reports 19 high and 0 critical (untouched master had 22 high and 1 critical). No force upgrades or major downgrades were applied.
- This is a JavaScript repository without an established TypeScript source/config/type-check command. Setup scripts passed syntax checks; no full TypeScript check is claimed.

Reproduce:

```powershell
npm ci
npx expo install --check
npx --yes expo-doctor
node --test scripts/app-store-config.test.mjs src/domain/socialShareCard.test.mjs src/domain/socialSharePopup.test.mjs src/domain/socialSharePreparationUi.test.mjs src/domain/socialShareUi.test.mjs src/domain/shareCardPreparation.test.mjs src/lib/socialShareNativeCache.test.mjs src/domain/apiOrigin.test.mjs
npm audit --omit=dev
git diff --check
```

Native compilation now supports react-native-share's Android compatibility assessment, but actual social sharing, package detection, picker permissions, playback and persistence remain runtime tests. Instagram Story sharing also requires the existing Meta app ID and installed target app; neither was newly provisioned.

## iPhone / Expo Go limits

With an Expo Go version supporting SDK 57 and iOS 16.4+, ordinary React Native UI is a source-assessed preview candidate: welcome/auth forms, menu/settings/privacy/terms, feed/search/discover, artists/venues/cities/shows/calendar, profiles/log/review forms, clubs/inbox/lounge/crew. Meaningful loaded data and writes require a reachable approved non-production API. Actual iPhone previews were not performed.

Run `npm run mobile:go` for the LAN QR code. Its safe localhost API default does not reach the Windows backend from an iPhone, so consider this limited offline/UI preview until approved secure connectivity is provided. The current API policy rejects plain HTTP LAN IP origins; no production source was rewritten to accommodate Expo Go and no tunnel was created.

react-native-share is loaded dynamically only when needed and is not bundled in Expo Go. Instagram Stories, X/Facebook image handoff, target-app detection and native social image sharing require custom native builds. Expo Go also does not verify this app's configured native splash, identifiers, permissions, package queries or deep links. Other SDK libraries' presence is not proof of device feature execution.

Android testing does not certify iOS. Windows cannot run Xcode or Apple's local simulator. An unsigned simulator compile on a suitable Mac could later check native compilation. EAS Simulator access was not assumed and no paid/cloud build was used. Real signed iPhone/TestFlight tests remain for later Apple Developer enrollment.
