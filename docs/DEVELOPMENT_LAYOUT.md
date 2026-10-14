# Shared Windows Android development

Created on 2026-10-14 for MSHPIT. This layout separates reusable tooling, virtual devices, caches and application checkouts.

| Location | Contents |
| --- | --- |
| `D:\Development\Tools\Java\jdk-17` | Checksum-verified Temurin OpenJDK 17.0.20.1 |
| `D:\Development\Tools\AndroidSdk` | Official command-line tools, Android 36 platform, Build-Tools 36.0.0, platform-tools 37.0.1, Emulator 37.2.12, AOSP Android 36 x86_64 image |
| `D:\Development\Tools\AndroidSdk\ndk\27.1.12297006` | NDK selected by the generated React Native build |
| `D:\Development\Tools\AndroidSdk\cmake\3.22.1` | CMake selected by the native build |
| `D:\Development\Emulators\avd` | AVD definitions and virtual-device disks; MSHPIT device is `mshpit-api36` |
| `D:\Development\Emulators\User` | Android/emulator user state |
| `D:\Development\Caches\npm` | Shared npm download cache |
| `D:\Development\Caches\Gradle` | Shared Gradle distributions and dependency cache |
| `D:\Development\Caches\Downloads` | Verified toolchain download archives and provenance |
| `D:\Development\Apps\mshpit` | Isolated MSHPIT checkout; future apps get their own sibling folders |

Start a development terminal with:

```powershell
. 'D:\Development\Tools\Use-Android.ps1'
cd 'D:\Development\Apps\mshpit'
java -version
adb version
```

Dot-sourcing changes that terminal's environment only. No global PATH, Windows security setting, virtualization setting, paid service or cloud account was changed. Each future app can use this same tooling script while keeping its own lockfile, build outputs, environment and disposable data. Shared caches may be recreated; the Tools and Emulators folders contain installations and device state.

The owner approved Google's Android SDK License Agreement. Package receipts for the installed SDK and AOSP image reference `android-sdk-license`. Temurin is the open-source ZIP distribution with included licence notices; no separate installer agreement was accepted.

Hardware acceleration check reports that the Android Emulator hypervisor driver is absent. No driver was installed. Software-mode preview has not been verified; do not assume a working emulator until `adb devices` reports a device and `adb shell getprop sys.boot_completed` returns `1`.

Local MSHPIT commands:

```powershell
npm ci
npm run mobile:prebuild
npm run mobile:backend  # separate terminal; disposable DB, scrubbed credentials, outbound network blocked
npm run mobile:start   # separate terminal; localhost Metro, production API guard
```

For an already running compatible emulator, or an owner-authorized physical Android device:

```powershell
adb devices
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081
npm run mobile:android
```

An x86_64-only emulator APK is built with:

```powershell
cd android
.\gradlew.bat assembleDebug --no-daemon --max-workers=2 -PreactNativeArchitectures=x86_64
```

This architecture-specific APK is not suitable for typical ARM phones. For a physical ARM64 Android device, use `npm run mobile:android` to build for its architecture, rather than treating the emulator APK as universal. Native changes require a rebuild; ordinary screen edits can reload through Metro.

The local backend uses a newly created `.tmp\mobile-data-*` folder per start. It does not read production `.env` or copy a production database. Catalog data is disposable and outbound providers are blocked; UI smoke results from this backend do not establish production integration or iOS behavior.
