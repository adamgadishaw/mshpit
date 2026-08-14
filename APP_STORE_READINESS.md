# Pit iOS App Store readiness

Reviewed: **2026-08-14** against Expo SDK **56**. This document describes the
repository state only. No EAS cloud build, Apple credential operation,
TestFlight upload, App Store Connect mutation, commit, push, or store claim was
made during this preparation pass.

## Prepared in the repository

- The native identifiers are explicit: `com.mshpit.app` on iOS and Android.
  Confirm that this is the permanent identifier before the first signed build;
  identifiers cannot be changed for an existing App Store record.
- Marketing version `1.0.0`, initial iOS build `1`, and Android version code `1`
  are explicit. The production EAS profile uses remote version management and
  automatic build-number increments.
- Settings reads the embedded Expo version instead of displaying stale
  `Alpha 0.1` copy.
- The initial iOS scope is phone-first (`ios.supportsTablet: false`). Re-enable
  tablet support only with completed iPad layout/device acceptance and store
  screenshots.
- `eas.json` contains credential-free internal-preview and production profiles.
  `requireCommit` prevents a cloud build from silently packaging an uncommitted
  working tree. The submit profile deliberately contains no Apple ID, team ID,
  App Store Connect app ID, API key, or invented placeholder.
- The app declares that it uses no non-exempt encryption. That remains accurate
  while the native app only uses ordinary platform HTTPS and no separately
  implemented non-exempt cryptography.
- iOS App Transport Security rejects arbitrary cleartext network loads. The only
  exception is `localhost` for local development; the native production API and
  media services must remain HTTPS.
- The app-level privacy manifest repeats the required-reason APIs declared by
  the installed Expo/React Native native packages: UserDefaults, file timestamps,
  disk space, and system boot time. Re-audit after any native dependency change
  and check Apple's post-upload privacy-manifest report on the first TestFlight
  binary.
- The photo-library permission explains the concert/profile media use. Camera
  and microphone permissions are disabled because Pit selects existing media
  and does not expose capture/recording controls.
- The account uses email/password authentication only. Sign in with Apple is not
  currently required. If Google, Facebook, Spotify, or another third-party login
  becomes an account-authentication option, add an equivalent Sign in with Apple
  option before review.
- In-app account deletion exists under Settings, confirms the current password,
  deletes account-owned database records, and clears the session. Blocking,
  post reporting, a server-backed moderation queue, Terms, Privacy, and optional
  analytics controls also exist.
- `scripts/app-store-config.test.mjs` guards identifiers, versions, export
  compliance, required-reason APIs, media permission scope, EAS profiles, and
  the mechanical 1024-by-1024 opaque PNG icon requirement.

## Release blockers and owner decisions

These must be completed before the first external TestFlight review or App
Store submission.

1. **Replace the stock Expo artwork.** `assets/icon.png`, the splash artwork,
   favicon, and Android adaptive artwork are technically valid files but are the
   starter Expo brand, not Pit. Supply final owned Pit artwork. The App Store icon
   must remain a square, opaque 1024-by-1024 PNG with no pre-rounded corners.
   Configure and visually verify the SDK 56 `expo-splash-screen` plugin after the
   final splash asset exists.
2. **Create the owner-controlled accounts and records.** Enroll in the Apple
   Developer Program, create or select the Expo organization, run EAS project
   initialization, reserve `com.mshpit.app`, and create the matching App Store
   Connect app. Let that process write the real Expo project ID. Do not place
   Apple passwords or private `.p8` keys in the repository.
3. **Publish dedicated legal and support URLs.** The app contains readable
   in-app Terms and Privacy screens, but `https://www.mshpit.com/privacy` and
   `/support` currently resolve to the general SPA shell instead of dedicated,
   crawler-readable documents. Publish a counsel-reviewed privacy policy and a
   support page with a monitored owner-approved contact method. Add their final
   URLs to App Store Connect only after they return the intended content without
   login. Also publish a web account-deletion explanation if the selected store
   or jurisdiction requires it.
4. **Finish the user-generated-content safety surface.** Users can block
   accounts and report posts, and staff can process reports. The backend accepts
   reports for users, comments, and messages, but the current user interface does
   not expose reporting controls on all of those surfaces. Add reachable report
   actions for profiles, comments, direct messages, fan-club/lounge content, and
   any uploaded media; define a monitored escalation path and moderation response
   procedure; and decide what proactive objectionable-content filtering is
   appropriate. This is a review risk for a social/UGC app, not merely polish.
5. **Resolve deletion and export retention disclosures.** The deletion screen
   truthfully says the object-storage cleanup worker is not deployed and media or
   backups can remain. The synchronous export is intentionally bounded. Decide
   and implement the production retention/deletion process, align it with the
   public policy, and have counsel approve the final disclosure.
6. **Complete physical-device acceptance.** Test account creation, email
   verification, login/session persistence, password reset, account deletion,
   media selection/upload (including long concert clips), feed/player lifecycle,
   swipe-to-close, external links, poor/offline network states, memory pressure,
   VoiceOver, Dynamic Type, safe areas, interruptions, and background/foreground
   restoration on supported iPhones. Test iPads before enabling tablet support.
   A JavaScript export is not evidence that a signed iOS binary behaves correctly.
7. **Decide deep-link behavior.** The custom `mshpit` scheme is reserved, but
   verification/reset links currently target the website and the native app has
   no associated-domain/universal-link configuration. Either keep those flows
   explicitly web-based with reliable app reconciliation, or implement and test
   native deep links and associated-domain files before advertising that ability.
8. **Prepare reviewer access.** Create a stable non-privileged demo account,
    provide review steps for media/player/moderation-sensitive flows, keep the
    backend online throughout review, and never put demo credentials in Git.

## App Privacy questionnaire working inventory

This is a conservative engineering inventory, not a completed legal declaration.
The owner and counsel must map it to the exact App Store Connect questions for the
submitted binary and production services.

| Data/function | Current evidence | Likely declaration work |
| --- | --- | --- |
| Contact information | Name and email are required for an account. | Declare linked account/contact data and its account-management purpose. |
| User identifiers | Internal account IDs, handles, sessions, follows, blocks, and moderation records. | Declare linked identifiers; verify whether session/security data falls under Apple's diagnostics/identifier definitions. |
| Coarse location | The user chooses a city; the app does not request device geolocation permission. | Declare coarse location if Apple's current questionnaire treats the saved city as location data; do not claim precise location. |
| User content | Reviews, ratings, photos, clips, comments, playlists, messages, and community posts. | Declare linked user content and all operational/moderation purposes. |
| Usage data | Optional, account-consented first-party product events plus plays and recommendations. | Declare linked product-interaction/usage data. Validate every retained event against the shipped schema. |
| Diagnostics/security | Request metadata and transient IP processing support security/rate limiting; diagnostic references are retained. | Determine the exact diagnostics and "other data" answers from production logging/retention. |
| Third parties | YouTube playback can send device/request/player interaction data to Google/YouTube; hosting, email, media storage, ticket links, and catalogue providers also participate. | Reconcile each provider's submitted-SDK privacy details and the public Privacy policy. |
| Tracking | No ad-network SDK or cross-company tracking is implemented today; optional analytics are first-party. | Answer "tracking" only after counsel/provider review. Add ATT only if a future implementation meets Apple's tracking definition. |
| Purchases | Pit does not currently sell digital features in the app. Ticket links are for real-world events and leave Pit. | Keep store copy and reviewer notes precise; reassess before adding subscriptions, boosts, or other digital goods. |

Age rating must be answered from actual community content and moderation policy.
Concert media, open UGC, messages, references to alcohol/drugs, profanity, and
embedded music/video mean an all-`NONE` questionnaire would not be credible
without a content audit.

## Store listing inputs still required

- Final app name availability, subtitle, description, keywords, primary/secondary
  categories, copyright owner, age-rating answers, pricing/countries, and release
  strategy.
- Final privacy-policy, support, and marketing URLs.
- iPhone screenshots for every required size and iPad screenshots if enabled;
  an optional app preview must show only real app behavior and licensed media.
- App Review contact details, monitored phone/email, demo credentials, and notes.
- Rights confirmation for the Pit brand, user-supplied concert media, catalogue
  artwork, venue photography, music/video embeds, and any store screenshots.
- App Privacy answers and any Canadian/other jurisdiction-specific disclosures.

No `store.config.json` was created because those facts are not safely inferable
from code and placeholder store claims are worse than an explicit checklist.

## Verified local checks

Run before every TestFlight candidate:

```powershell
npm.cmd test
npm.cmd run check:syntax
npx.cmd expo install --check
npx.cmd expo-doctor
npx.cmd expo config --type public
npx.cmd expo config --type introspect
npx.cmd expo export -p ios --output-dir .tmp\ios-store-export
```

This preparation pass verified Expo dependencies as aligned and Expo Doctor at
21/21. The iOS JavaScript export is a bundle/config gate only. The first signed
candidate should go to internal TestFlight testers, then external TestFlight
review, and only then to App Store review. EAS builds/submissions consume service
capacity and require the owner's Expo/Apple authorization, so none were run here.
