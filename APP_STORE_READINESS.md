# Pit iOS App Store readiness

Reviewed: **2026-08-21** against Expo SDK **56**. This document describes the
repository state only. No EAS cloud build, Apple credential operation,
TestFlight upload, App Store Connect mutation, or store-readiness claim was made
during this preparation pass.

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
- Native preview playback uses the SDK 56 `expo-audio` package on iOS/Android;
  the config disables microphone, recording, and background-audio capabilities.
  Web playback keeps its existing YouTube/HTML-audio path.
- PIT-branded gold/black icon, splash, Android adaptive, monochrome, and favicon
  assets are wired through the SDK 56 splash plugin. The generated v1 artwork
  has provenance notes in `assets/PIT_BRAND_ASSETS.md` and still needs the
  owner's final brand/trademark approval before a store upload.
- Standalone, crawler-readable, unauthenticated HTML is implemented for
  `/privacy`, `/terms`, `/support`, and `/account-deletion`, including canonical
  metadata, sitemap entries, and matching in-app policy decisions.
- The account uses email/password authentication only. Sign in with Apple is not
  currently required. If Google, Facebook, Spotify, or another third-party login
  becomes an account-authentication option, add an equivalent Sign in with Apple
  option before review.
- In-app account deletion exists under Settings, confirms the current password,
  deletes account-owned database records, and clears the session. In the same
  transaction it durably queues ledger, associated legacy, and exact-owner-prefix
  active-media cleanup; storage work retries asynchronously and dead-letters are
  count-visible in `/api/health`. Blocking, reporting, a server-backed moderation
  queue, Terms, Privacy, and optional analytics controls also exist.
- Reporting is reachable on profiles, posts and exact attachments, comments,
  direct messages, fan-club/lounge messages, venue reviews, and artist-owned
  posts/profiles. Reports are visibility-checked server-side; exact media is
  fingerprint-stable and only a verified PIT-owned object may be previewed by
  staff. A conservative first-line authored-text safety filter covers the write
  routes, with report/block and the normalized moderation queue as backstops.
- Seeded venue photography now fails closed unless each item carries approved,
  machine-verifiable HTTPS provenance and licence fields. The current legacy
  seed yields no accepted venue images rather than shipping unclear rights or
  ATS-incompatible HTTP hotlinks; community review media is separate.
- Render startup is configured to create and verify a persistent-disk SQLite
  snapshot before importing the migration-bearing server module. A failed
  snapshot stops startup before migration; because Render persistent disks do
  not provide zero-downtime deploys, operator intervention or rollback may be
  required to restore service. This is migration rollback protection, not
  off-host disaster recovery.
- `scripts/app-store-config.test.mjs` guards identifiers, versions, export
  compliance, required-reason APIs, media permission scope, EAS profiles, and
  the mechanical 1024-by-1024 opaque PNG icon requirement.

## Release blockers and owner decisions

These must be completed before the first external TestFlight review or App
Store submission.

1. **Approve or replace the v1 PIT artwork.** The repository no longer ships the
   Expo starter art: generated PIT icon/splash/adaptive assets are configured and
   mechanically tested. The owner must approve the design and confirm brand and
   trademark rights, or replace it with final owned artwork before the first
   store upload. Keep the App Store icon square, opaque, 1024-by-1024, and without
   pre-rounded corners; visually inspect the signed build's icon and splash.
2. **Create the owner-controlled accounts and records.** Enroll in the Apple
   Developer Program, create or select the Expo organization, run EAS project
   initialization, reserve `com.mshpit.app`, and create the matching App Store
   Connect app. Let that process write the real Expo project ID. Do not place
   Apple passwords or private `.p8` keys in the repository.
3. **Approve and operate the legal/support surfaces.** Dedicated pages are
   implemented in this release. Verify all four live URLs without login, confirm that
   `support@mshpit.com` exists and is actively monitored, and have counsel approve
   operator identity, jurisdiction, retention wording, Terms, and Privacy before
   entering the URLs in App Store Connect.
4. **Staff and rehearse UGC safety operations.** The report/filter/block/moderation
   code surface is implemented. Before external TestFlight, name a primary and
   backup moderator, adopt the response targets in
   `APP_STORE_MODERATION_OPERATIONS.md`, rehearse reports on every surface, and
   confirm escalation/contact coverage. Text screening is deliberately
   conservative rather than a claim of perfect automated moderation. Arbitrary
   uploaded image/video bytes are not yet scanned by a dedicated safety vendor,
   and several authored surfaces still accept remote HTTPS media URLs. Before
   App Store submission, require canonical owner-ledger media for user uploads,
   derive provider artwork from an allowlist instead of caller-supplied URLs, and
   quarantine or scan media before it becomes public.
5. **Verify deletion and backup operations in production.** Active-media cleanup
   is implemented without blocking account deletion: new upload tickets have a
   durable ledger, seven-day stale tickets are queued, historical account
   deletion performs a paginated exact `users/{owner}/` inventory, object DELETE
   uses bounded retries, and failures dead-letter. Because S3-style providers
   authorize a PUT when its request begins, owner-prefix verification repeats
   every six hours through a 72-hour quiet window after the upload-ticket barrier;
   this catches uploads that complete after an early DELETE returned 404. Before
   public App Store submission, obtain provider evidence for the maximum accepted
   request duration (or enforce an equivalent storage-side lifecycle/tombstone
   control); R2's public documentation does not establish that upper bound, so
   the 72-hour control is strong bounded mitigation rather than proof against an
   arbitrarily slow hostile stream. Before release, scope the
   active-media credential to the correct bucket with `PutObject`, `DeleteObject`,
   and `ListBucket`, exercise this on staging, and prove `/api/health` drains both
   object and owner-sweep queues without dead letters. `BACKUP_KEEP` prunes only
   local snapshots; configure and evidence a lifecycle rule on the separate,
   private off-host backup bucket for the counsel-approved retention period. Have
   counsel approve the final active-storage versus backup disclosure. The current
   1 GB persistent disk also holds the live SQLite database, WAL, seven local
   snapshots, and the next partial snapshot; monitor free space and enlarge the
   disk, reduce local retention, or offload backups before growth makes a
   fail-closed deploy backup run out of space.
6. **Clear third-party catalogue, artwork, and playback rights.** The current
   catalogue contains 932 artist images credited to Deezer and 698 credited to
   Spotify, without per-item licence/source-page provenance. Runtime enrichment,
   rankings, top tracks, and native 30-second preview audio also use Deezer.
   [Deezer's current public developer terms](https://developers.deezer.com/termsofuse)
   say no content rights are granted and limit the Services to non-commercial
   use. [Spotify's current developer policy](https://developer.spotify.com/policy)
   requires its artwork/metadata to carry Spotify branding and a link back, which
   Pit's generic artist-image surfaces do not consistently provide. This
   repository contains no written exception or approval. Before any public App
   Store submission, obtain written
   provider/rightsholder approval for Pit's exact use or replace/fail-close every
   affected asset, datum, and playback path. Store screenshots must use only
   independently cleared content. This is an owner/legal rights gate, not a fact
   that a passing build or short-preview duration can establish.
7. **Resolve the SDK 56 Hermes V1 memory-regression gate.** Current Expo Doctor
   reports 21/22 checks because Expo 56.0.20 / React Native 0.85.3 contains the
   known Hermes V1 memory regression; its suggested fixed line begins with Expo
   57.0.9 / React Native 0.86.2. Do not ship a native distribution on the strength
   of a JavaScript export alone. Treat a separately planned SDK 57 upgrade (with
   exact versioned-doc review and full regression/device testing) or an upstream
   SDK 56 resolution as the engineering gate. The current web release does not
   need to wait on that native-runtime upgrade.
8. **Complete physical-device acceptance.** Test account creation, email
   verification, login/session persistence, password reset, account deletion,
   media selection/upload (including long concert clips), feed/player lifecycle,
   swipe-to-close, external links, poor/offline network states, memory pressure,
   VoiceOver, Dynamic Type, safe areas, interruptions, and background/foreground
   restoration on supported iPhones. Test iPads before enabling tablet support.
   A JavaScript export is not evidence that a signed iOS binary behaves correctly.
9. **Decide deep-link behavior.** The custom `mshpit` scheme is reserved, but
   verification/reset links currently target the website and the native app has
   no associated-domain/universal-link configuration. Either keep those flows
   explicitly web-based with reliable app reconciliation, or implement and test
   native deep links and associated-domain files before advertising that ability.
10. **Prepare reviewer access.** Create a stable non-privileged demo account,
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
| Third parties | YouTube playback can send device/request/player interaction data to Google/YouTube; native preview playback streams from a music-preview/catalogue provider; hosting, email, media storage, ticket links, and other catalogue providers also participate. | Reconcile each provider's submitted-SDK privacy details, ordinary CDN request data, App Privacy answers, and the public Privacy policy. |
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

This preparation pass verified Expo dependencies as aligned. Expo Doctor is
21/22 solely because of the SDK 56 Hermes V1 memory-regression warning described
above; do not waive it as a store-readiness check. The iOS JavaScript export
produced a 6.5 MB Hermes bundle and is a bundle/config gate only. After the
native-distribution blockers above are resolved, the first signed candidate
should go to internal TestFlight testers, then external TestFlight review, and
only then to App Store review. EAS builds/submissions consume service capacity
and require the owner's Expo/Apple authorization, so none were run here.
