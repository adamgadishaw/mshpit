# Start the existing local AVD in a visible window. No machine settings change.
param([string]$Avd = 'mshpit-api36')
. 'D:\Development\Tools\Use-Android.ps1'
if (Get-Process -Name 'qemu-system-x86_64*' -ErrorAction SilentlyContinue) {
  throw 'An emulator is already running. Close it normally before starting another instance.'
}
$previousOpenGl = $env:QT_OPENGL
$previousAudioInput = $env:QEMU_AUDIO_IN_DRV
try {
  $env:QT_OPENGL = 'desktop'
  # Keep playback output enabled without opening the host microphone backend.
  $env:QEMU_AUDIO_IN_DRV = 'none'
  Start-Process -FilePath "$env:ANDROID_HOME\emulator\emulator.exe" -WindowStyle Normal -ArgumentList @(
    '-avd', $Avd, '-accel', 'on', '-gpu', 'host', '-feature', '-Vulkan',
    '-no-metrics', '-no-snapshot', '-no-boot-anim', '-cores', '4', '-memory', '3072'
  )
} finally {
  $env:QT_OPENGL = $previousOpenGl
  $env:QEMU_AUDIO_IN_DRV = $previousAudioInput
}
