# iOS release quality gates, November 8, 2026

This is a current engineering checklist, not an App Store approval or a claim
that a connected account is enrolled. Preserve older readiness reports as dated
history. No submission, production deployment, account change or phone install
is performed by this document.

## Build identity and environment

The owner-approved local phone preview uses `com.mshpit.app.dev` and the live
first-party MSHPIT service. This is intentional. The distinct app identifier is
not evidence of a distinct backend. `MSHPIT_LOCAL_DEV=1` changes name, scheme and
bundle identifier, while `src/domain/apiOrigin.mjs` deliberately pins native
Release builds to the canonical production API. Do not weaken that protection
or run destructive tests against this preview.

The existing EAS `preview` profile means internal distribution, not TestFlight
and not an isolated staging environment. A future staging release needs an
explicitly reviewed app variant plus backend/credential policy and isolated data.
A public environment variable alone cannot provide that separation. See Expo's
variant guidance: https://docs.expo.dev/build-reference/variants/

Before delivery, record the actual artifact's identifier, version, build number,
source commit, signature verification, provisioning expiry, executable and JS
hashes. The generated local Info.plist currently fixes CFBundleVersion to 1;
a command-line CURRENT_PROJECT_VERSION or a directory called build2 does not
prove that the embedded version changed. Preserve previous signed artifacts.

## Native accessibility and interaction

Source and unit tests are necessary but do not establish spoken behavior. On the
final phone build, use VoiceOver without sight to navigate Discover, search,
show details, feed, drawer, profiles/You, message history and each composer.
Check focus entering/dismissing a modal, destination changes, back gestures,
explicit alternatives, failure announcements and text-field labels/values.

Test the largest Dynamic Type sizes and change them while a screen is open.
Identity, status, controls and the final editable field must remain reachable
with the keyboard visible. Verify live Reduce Motion, media/shelf gestures,
edge Back ownership and interrupted/cancelled gestures. Do not claim Accessibility
Nutrition Labels from JSX alone.

Apple evaluation guidance:
- https://developer.apple.com/help/app-store-connect/manage-app-accessibility/voiceover-evaluation-criteria/
- https://developer.apple.com/help/app-store-connect/manage-app-accessibility/larger-text-evaluation-criteria/

## Measured performance and recovery

Use a Release build on the supported physical device. Record cold/warm start,
time to a usable feed, scroll hitches, media memory growth, background restoration
and energy use with repeatable scenarios and device/build/network details.
Compare before/after rather than inventing a universal millisecond target.
Simulator Debug timings and the development-only ScreenTransition instrumentation
are not release performance certification. Broad Store rewrites require profiling.

- https://reactnative.dev/docs/0.86/performance
- https://developer.apple.com/documentation/Xcode/analyzing-the-performance-of-your-shipping-app

Exercise offline launch, cached-content reads, explicit retry, interrupted reads,
account switches and rapid repeated actions. A failed read must not be presented
as a successful empty collection. Preserve existing scoped mutations and outbox
reconciliation; never automatically replay a publication or payment.

## Privacy, permissions and community safety

Inspect the final built Info.plist and aggregated privacy manifests, not only
app.json. Current configuration disables camera/microphone requests and background
recording/playback and declares photo selection and required-reason API entries.
Verify the archive's actual SDK manifests and purpose strings. Test denied,
limited/full Photos access, iCloud assets and cancellation only with authorized
test data and permissions. No permission changes are part of this checklist.

- https://developer.apple.com/app-store/review/guidelines/#privacy
- https://developer.apple.com/support/third-party-SDK-requirements/
- https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest

Apple's UGC requirements include filtering, reporting with timely responses,
blocking and contact information. Existing report/block controls do not alone
prove that moderation operations are staffed and effective. No particular paid
moderation vendor is required by this finding.

Account-deletion controls exist, but complete deletion/session/media/retention
behavior must be tested with an explicitly authorized disposable nonproduction
account. Do not delete a real user or content merely to certify the release.

- https://developer.apple.com/app-store/review/guidelines/#user-generated-content
- https://developer.apple.com/support/offering-account-deletion-in-your-app/

## App Store and TestFlight handoff

Verify current official upload requirements at release time. The November 8
research found Xcode 26+/iOS 26 SDK requirements effective April 28, 2026 and an
iOS 13+ deployment-target requirement effective September 9, 2026. The generated
local project currently targets iOS 16.4, but the actual archive must be checked.

TestFlight builds expire after 90 days. Internal and external testing have
separate eligibility/review limits (up to 100 eligible internal users and 10,000
external testers under Apple's current rules). An EAS internal build is not a
TestFlight submission. Confirm bundle/build identity, signing, export compliance,
reviewer access, privacy answers and required agreements in the separately
approved release workflow. Do not infer membership or agreements from an old
local report or an Xcode Personal Team display name.

- https://developer.apple.com/news/upcoming-requirements/
- https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/

## Current verification limit

The Mac session is locked, so interactive testing stopped rather than bypassing
it. Source tests and local compilation continue. New physical accessibility,
permission, performance and final-install checks remain explicitly open. The
phone build is held until the owner reconnects and authorizes installation.

## Additional journey gates after the continuity checkpoint

- With a reply and failed-send attempt retained, test the largest text size,
  docked and interactive keyboard dismissal, landscape, a visible verification
  banner/player, and floating/hardware keyboard where supported. Verify input
  cursor/selection and text survive; Send and Clear remain reachable. Unit
  geometry checks do not prove actual Yoga/native keyboard behavior.
- Delay linked Post, profile and News loads, select another destination, and
  verify the newest intent wins. Cancel a dirty-editor close prompt and ensure
  the draft stays and no late route or sign-in abort occurs.
- Open Calendar sharing once, then dismiss or choose Files/Calendar. Verify no
  duplicate presentation or stuck control. Confirm the chosen app's result
  separately; the share promise is not an import receipt. Check temporary-file
  cleanup after actual native completion without deleting unrelated files.
