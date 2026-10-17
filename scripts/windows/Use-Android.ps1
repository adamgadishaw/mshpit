# Dot-source this file in a development terminal. Changes affect that terminal only.
$env:JAVA_HOME = 'D:\Development\Tools\Java\jdk-17'
$env:ANDROID_HOME = 'D:\Development\Tools\AndroidSdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_USER_HOME = 'D:\Development\Emulators\User'
$env:ANDROID_EMULATOR_HOME = 'D:\Development\Emulators\User'
$env:ANDROID_AVD_HOME = 'D:\Development\Emulators\avd'
$env:GRADLE_USER_HOME = 'D:\Development\Caches\Gradle'
$env:npm_config_cache = 'D:\Development\Caches\npm'
$env:EXPO_NO_TELEMETRY = '1'
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:PATH"
