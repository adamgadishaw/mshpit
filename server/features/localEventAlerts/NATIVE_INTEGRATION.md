# Native show alerts — local integration

This follow-up starts at `5da166fc88bc93579622639dd69016b353ee7532`. That inbox candidate and its delivery artifacts remain frozen. This is local code, not a deployed push service or a signed device build.

## Entry points and channel policy

- `App.js` mounts `useNativePush.native.js` only on native platforms. It receives the verified account ID, `chatAuthEpoch`, the existing show navigator, and Activity refresh. No feature state was added to Store. The native-only require is eliminated from the web startup bundle.
- `LocalAlertSettings.jsx` uses the existing Settings rows/toggles. `LocalPushSettings.native.jsx` adds independent account-level tour-date and local-ticket device preferences plus explicit enable/disable for this installation. The web counterpart can turn off previously saved push preferences; it never registers a device.
- Tour announcements remain global for followed/favourited artists. Ticket-sale alerts require the existing authoritative home-city/event match and trusted public-sale timestamp/status. No attendance or calendar intent is added by tapping an alert.
- Both push preferences still default false. Inbox preferences and all existing Activity kinds retain their contracts. Saving a push preference alone cannot prompt or register a previously unbound installation.
- Android channel `local-shows` is created before requesting permission. iOS authorized/provisional permission is accepted; denied permission revokes the current server binding. No sound or badge permission is requested. Foreground delivery refreshes Activity without banners; background/terminated OS alerts contain only the generic “You have a new show update.” text.
- Settings callbacks capture account/epoch/lifetime. Old A callbacks cannot write A preferences to B, survive a new auth epoch, or write after unmount. The native child is keyed by account/epoch too.

## Native lifecycle and storage

`nativePushService.native.js` composes the injected, tested controller/runtime with SDK 57 notifications, SecureStore and Crypto. Expo Go is unavailable for this feature. Registration is gated by a configured native build and explicit device opt-in. Resume/token rotation refresh only an installation already bound to the current account and with an enabled push category; they never prompt.

The installation ID and 32-byte CSPRNG secret use SecureStore `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; there is no AsyncStorage/web fallback or local Expo-token cache. Android backup excludes SecureStore. A single serialized record retains installation proof and the last acknowledged account/generation so deletion/restart cannot accidentally reuse an old registration generation. Ordinary account export excludes this installation credential. Server erasure, security receipt retention and bounded outbox cleanup use the existing `98454b0` / `5da166f` contracts; this follow-up adds no database tables or columns.

`authTransitions.native.js` wraps the existing credential coordinator with awaited, single-flight device revocation before credential-changing requests. It does not introduce another cookie-writing queue. Failure preserves the current account and exposes retry. Logout immediately clears the native scope, aborts outstanding work and uses the existing durable server logout/retry path. Offline logout cannot promise remote revocation until that request is acknowledged. The existing server session/generation checks remain the final fence against late registrations.

Tap handling checks account, installation and generation, then fetches `/api/me/local-alerts/:id/target` with the existing expected-account header. Only the returned canonical event is passed to `openShow`. Guest startup waits for verified identity; duplicate taps and delayed targets cannot cross account changes or unmount. Provider URLs and archive IDs are never accepted as navigation authority.

Expo itself may refresh its previously stored provider registration on native startup. That SDK registration does not authorize mshpit delivery: server session, generation, preference, audience and current event eligibility checks still apply. A notification already handed to Apple/Google cannot be recalled reliably. Generic lock-screen text and current-account tap validation limit exposure; no claim of guaranteed delivery or recall is made.

## Server lifecycle

`startLocalAlerts()` starts the existing scheduler via `startLocalAlertDelivery`. Inbox work runs synchronously inside its existing transaction; push provider IO follows outside it. One scheduler/shutdown owner serializes work and drains on stop.

Push requires all three server settings: `LOCAL_EVENT_ALERTS_ENABLED=1`, `LOCAL_EVENT_PUSH_ENABLED=1`, and a nonempty server-only `EXPO_PUSH_ACCESS_TOKEN`. Defaults remain off. GET preferences adds only a boolean `pushDeliveryEnabled`, never a credential. The hermetic test runner strips these three inherited variables; tests inject a fake transport/token.

Existing delivery semantics remain: bounded pages; eligibility rechecked immediately before send; account/event/kind/timestamp and installation generation deduplication; never-attempted ready deliveries can survive benign metadata repairs; accepted/unknown outcomes are not blindly retried; definitive rate limits have bounded retries; provider receipts are checked. Receipt success means provider acceptance, not that a person saw the notification.

Waiting sale rows now advance their next attempt by at most one minute, yielding the first 100 slots to other due work. Fresh trusted sale evidence wakes at most 100 matching queued rows; remaining rows retain the bounded retry. The immutable sale trigger timestamp is unchanged. This fixes starvation without resetting delivered receipts or weakening timing/city rules.

Default limits remain 20 event pages × 100 recipients and 100 due inbox alerts per minute, with up to 20 push sends/receipts per tick. This is bounded launch plumbing, not a new load/performance certification; larger audiences need capacity measurements before increasing throughput.

## Build and account configuration still required

No account, credential, device registration, deployment or live send was performed. Existing Apple/Google/Expo account configuration was not inspected, so the following are requirements to verify, not claims that keys are absent:

1. **Expo project:** choose the actual project UUID associated with this app. Supply `MSHPIT_EAS_PROJECT_ID` (or existing `extra.eas.projectId`) and explicitly set `MSHPIT_NATIVE_PUSH_ENABLED=1` for the intended native build. Missing/malformed UUID fails configuration. No placeholder project is shipped. Expo Go is deliberately blocked. [Expo setup and project identity](https://docs.expo.dev/push-notifications/push-notifications-setup/).
2. **Apple:** paid Apple Developer membership; the actual App ID/bundle identifier (`com.mshpit.app`, or separately `com.mshpit.app.dev` for the local-dev variant) with Push Notifications enabled; valid APNs authentication key for the correct Apple team, key ID and key material in the configured Expo credentials; matching signing/provisioning profile and `aps-environment` for development/distribution. Register development test devices where required by that distribution method. Rebuild the native binary after plugin/capability changes. No Apple setup was changed. [Apple/Expo credential requirements](https://docs.expo.dev/push-notifications/push-notifications-setup/), [iOS app credentials](https://docs.expo.dev/app-signing/app-credentials/#ios).
3. **Google:** Firebase project and Android app matching the exact package; enable FCM v1 and configure an authorized service-account credential in Expo for that project/application. Supply the matching client `google-services.json` through `MSHPIT_GOOGLE_SERVICES_FILE` at build time. This client file is distinct from the private service-account key; never ship the latter in the app or repository. No Firebase account or permissions were changed. [FCM v1 setup](https://docs.expo.dev/push-notifications/fcm-credentials/).
4. **Server/Expo security:** verify enhanced push security in the intended Expo account and provide its access token through the server secret store. Only then enable the two server flags through the normal release process. Keep the token out of `EXPO_PUBLIC_*`, app config and mobile bundles. [Expo enhanced push security](https://docs.expo.dev/push-notifications/sending-notifications/#additional-security).
5. **Devices and release:** build/sign/install through the authorized release workflow and test permission grant/deny/provisional, opt-out, account switch, token rotation, offline restart, foreground/background/terminated taps, provider receipt handling and iPad/Android tablet layout. Tablet support is enabled in config, but physical tablet behavior and real APNs/FCM delivery remain untested here. JS exports and config introspection are not signed native builds. Windows cannot produce/validate an Xcode iOS signing build.

## Integration and evidence

Shared files: `App.js`, `app.config.js`, package manifests, `server/api.js`, test runner and the existing local-alert feature files. New native auth adapter is platform-specific; the web auth adapter is unchanged. Integrate after `5da166f` and preserve other branches' layout work. New UI copy is in `LocalPushSettings*` and the existing `LocalAlertSettings.jsx`.

The external delivery folder contains the exact commit/patch/bundle, changed-file manifest, focused and aggregate test receipts, native exports/config evidence, web budget and browser screenshots. Read its DELIVERY.md for final counts and failures; a passing focused suite does not imply a clean aggregate gate or verified device delivery.
