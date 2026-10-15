# iPhone preview finding - 2026-10-15

Project: D:\Development\Apps\mshpit, Expo 57.0.29, React Native 0.86.3. No iPhone runtime has been verified.

The actual startup path does not statically import react-native-share. src/lib/socialShare.native.js dynamically imports it inside loadNativeShare(), catches failure, and reports SOCIAL_SHARE_UNAVAILABLE (or INSTAGRAM_STORY_UNAVAILABLE). Consequently its absence is a sharing-feature limitation, not by itself an entire-app startup blocker. Skia 2.6.2, Reanimated 4.5.1, Worklets 0.10.1 and Expo Video 57.0.5 match installed Expo bundledNativeModules metadata. Other listed native dependencies are Expo modules or bundled React Native libraries. This is source compatibility evidence, not an executed iPhone test.

Current availability: Expo's September 3,2026 announcement https://expo.dev/changelog/expo-go-57-login explicitly confirms App Store Expo Go supports SDK57. This supersedes the earlier SDK57 launch note's pending-approval text. The September22 https://docs.expo.dev/get-started/start-developing/ instructions require the same Expo account signed in to the Windows Expo CLI and iPhone Expo Go. Install/update the phone client and verify its actual SDK support before claiming a successful launch. No iPhone execution is verified. The local CLI identity check returned Not logged in; the owner must complete same-account login before QR testing. We have not created an account, signed in, enrolled, signed credentials or invoked eas go.

QR procedure after checking the installed client and existing same-account login on both devices (and stopping the temporary localhost8082 fixture server):

```powershell
Set-Location 'D:\Development\Apps\mshpit'
$env:EXPO_PUBLIC_API_URL='https://www.mshpit.com'
$env:MSHPIT_APPROVED_LIVE_API='1'
npm run mobile:go -- --port 8082
```

Check CLI identity with npx expo whoami; if either side is logged out, the owner must sign in to their existing Expo account on both sides (npx expo login on Windows; account icon in Expo Go). This task does not create accounts or perform an unapproved persistent sign-in. This explicitly selects Expo Go/LAN on8082, preserving the Android dev client at localhost8081. Windows PC and iPhone must be on the same trusted LAN; scan the terminal QR with iPhone Camera, open in Expo Go and allow its Local Network permission. localhost API would point to the phone, so the approved HTTPS read-only API above is required. No secrets need to be transferred to iPhone or QR. The script sets the native read-only review guard automatically for that exact approved origin. Stop this second server with Ctrl+C when finished. Do not change firewall/network profiles, open a tunnel, or publish/deploy. If existing LAN reachability blocks it, report the block.

Candidate free-preview checks after the client prerequisite: Feed, Discover, artist/venue/show pages, profile navigation, review layout, image browsing and bundled Expo video/editor UI. Test on the real phone before marking any as passed. Custom social artwork/X/Facebook/Instagram sharing needs the custom native binary; no Expo Go pass certifies that. Deep links, app-specific native configuration, permissions and signed app lifecycle require later native iPhone checks.

The free native-preview path is the compatible App Store Expo Go client with the same existing Expo account on both devices, then same-LAN QR. Network reachability and the physical phone run still need verification. The existing web app can also be reviewed in iPhone Safari (no deployment needed), with the local Windows Android custom build available for modules Expo Go lacks. A Mac with Xcode/personal signing can be a separate free device path if the owner already has access; this Windows PC cannot run Apple's local simulator or build/sign through Xcode. No Mac access has been established. EAS Simulator access is not assumed.

Official availability/login update checked: https://expo.dev/changelog/expo-go-57-login ; https://docs.expo.dev/get-started/start-developing/ .

Other official references checked: https://expo.dev/changelog/sdk-57 ; https://expo.dev/go ; https://docs.expo.dev/more/expo-cli/ ; https://docs.expo.dev/develop/development-builds/introduction/ .
