# iPhone preview finding - 2026-10-15

Project: D:\Development\Apps\mshpit, Expo 57.0.29, React Native 0.86.3. No iPhone runtime has been verified.

The actual startup path does not statically import react-native-share. src/lib/socialShare.native.js dynamically imports it inside loadNativeShare(), catches failure, and reports SOCIAL_SHARE_UNAVAILABLE (or INSTAGRAM_STORY_UNAVAILABLE). Consequently its absence is a sharing-feature limitation, not by itself an entire-app startup blocker. Skia 2.6.2, Reanimated 4.5.1, Worklets 0.10.1 and Expo Video 57.0.5 match installed Expo bundledNativeModules metadata. Other listed native dependencies are Expo modules or bundled React Native libraries. This is source compatibility evidence, not an executed iPhone test.

Important current blocker: https://expo.dev/changelog/sdk-57 still states the SDK57 App Store/Play Store release is waiting for approval, with SDK57 iPhone Expo Go distributed through eas go. https://expo.dev/go defaults to SDK57 and public https://exp.host/--/api/v2/versions lists SDK57 client57.0.9 / RN0.86.3, but the iosClientUrl is a simulator tar.gz, not an installable physical iPhone IPA. The existence of that URL does not establish that the App Store client on Adam's phone supports SDK57. Verify the actual installed client's supported SDK before promising a free QR launch. Do not invoke eas go, create accounts, sign, enroll or downgrade the app under this task.

Conditional QR procedure, once an SDK57-capable physical iPhone Expo Go client is available:

```powershell
Set-Location 'D:\Development\Apps\mshpit'
$env:EXPO_PUBLIC_API_URL='https://www.mshpit.com'
$env:MSHPIT_APPROVED_LIVE_API='1'
npm run mobile:go -- --port 8082
```

This explicitly selects Expo Go/LAN on8082, preserving the Android dev client at localhost8081. Windows PC and iPhone must be on the same trusted LAN; scan the terminal QR with iPhone Camera, open in Expo Go and allow its Local Network permission. localhost API would point to the phone, so the approved HTTPS read-only API above is required. No secrets need to be transferred to iPhone or QR. The script sets the native read-only review guard automatically for that exact approved origin. Stop this second server with Ctrl+C when finished. Do not change firewall/network profiles, open a tunnel, or publish/deploy. If existing LAN reachability blocks it, report the block.

Candidate free-preview checks after the client prerequisite: Feed, Discover, artist/venue/show pages, profile navigation, review layout, image browsing and bundled Expo video/editor UI. Test on the real phone before marking any as passed. Custom social artwork/X/Facebook/Instagram sharing needs the custom native binary; no Expo Go pass certifies that. Deep links, app-specific native configuration, permissions and signed app lifecycle require later native iPhone checks.

What works free immediately without claiming native iPhone coverage: review the existing web app in iPhone Safari (no deployment needed) and continue the local Windows Android custom development build. A Mac with Xcode/personal signing can be a separate free device path if the owner already has access; this Windows PC cannot run Apple's local simulator or build/sign through Xcode. No Mac access has been established. EAS Simulator access is not assumed.

Official references checked: https://expo.dev/changelog/sdk-57 ; https://expo.dev/go ; https://docs.expo.dev/more/expo-cli/ ; https://docs.expo.dev/develop/development-builds/introduction/ .
