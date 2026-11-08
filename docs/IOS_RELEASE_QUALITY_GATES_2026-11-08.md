# iOS release quality gates, November 8, 2026

This is a current engineering checklist, not an App Store approval or a claim
that a connected account is enrolled. Preserve older readiness reports as dated
history. No submission, production deployment, account change or phone install
is performed by this document. For the concise current artifact identity and
next-session plan, read [the preview handoff](IOS_PREVIEW_HANDOFF_2026-11-08.md).

All mutation-path acceptance tests require an authorized isolated fixture
environment. The current live-linked Release preview is NOT mutation-blocked:
the existing nativeReadOnlyReview switch applies only to __DEV__ builds. On that
preview, owner-directed ordinary browsing and unsent draft navigation can be
reviewed only with its real side effects understood. This is not a strictly
write-free synthetic QA mode: consented app-open/screen/feed analytics may post
to the live event endpoint. Use the isolated fixture for repeatable certification,
without changing consent settings to force a test. Do not publish
synthetic comments/reviews, delete content, switch real accounts, or save/share
private calendar data to another app merely to certify a test. Genuine owner-
directed actions and any required approvals remain separate. Opening Activity
marks notifications read; opening a Thread can submit a message read receipt.
Those routes are not state-neutral reads and belong in the isolated fixture or
separately authorized genuine use, not a generic live read-only QA tour.

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
show details, feed, drawer, profiles/You, and unsent composers. Message history/Activity and mutation outcomes
require the isolated fixture or separately authorized genuine use as above.
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

### Artifact-specific interpretation

The verified cd06226 artifact currently declares portrait and upside-down only.
Landscape/iPad floating/split-view cases above are conditional future checks,
not supported orientations to claim tested now. Performance measurement should
use the Release JavaScript binary with React Native __DEV__ false and no Metro
or debug inspector runtime. Do not disable the device's iOS Developer Mode or
change security settings: the current development-signed installation can require
Developer Mode. Release configuration is not App Store distribution signing.

The existing native-performance-probe.mjs is Android-emulator/Metro-specific;
it is not an iOS Release benchmark. The Xcode project currently exposes only the
app target, so an XCTest accessibility/launch suite would need a separate test-
target setup. Neither of those absent gates has been claimed passed.

## Gesture checkpoint acceptance

The cd06226 source checks do not replace these native fixture checks:
- Exercise tab/header rails, photo paging/down-dismiss and the 20-point detail
  Back edge. Interrupt with another destination, cancellation, a second pointer,
  VoiceOver transitions and background/resume. Verify no wrong destination,
  extra pop or displaced surface, and preserve Feed offset/gallery index.
- Confirm VoiceOver reaches explicit alternatives, skips hidden retained Feed,
  enters/exits drawer and gallery correctly, and does not replay interrupted
  outcomes. RN cannot retract speech already handed to the operating system.
- At the largest supported text size with the keyboard visible, verify readable
  labels/errors and reachable Send/Retry/Clear/Discard, preserving multiline
  input, selection and cursor. Use the artifact's supported portrait orientations.
- Observe native image/video/Photos/share recovery and physical Release launch,
  scroll and memory with recorded device/build/network/thermal conditions.
  No synthetic timing result establishes native smoothness.

Use authorized isolated data and observe server effects for mutation/read-marker
acceptance. Do not perform synthetic Send, Report, Block, Follow, Going, read-state
changes or external saves on the live-linked build merely to certify it.

## Dependency evidence scope

A zero server-only npm audit result does not clear mobile dependencies or native
Pods. See IOS_NATIVE_DECODER_REVIEW_2026-11-08.md for the dated installed-chain,
signed-binary presence and specific AVIF-path mitigation assessment. Preserve
its limits and recheck native decoder configuration before a dependency update.


## Latest compiled checkpoint: profile and recovery

6461b05 supersedes cd06226 as the latest preserved signed preview. Its 7,963-test
suite, iOS/Android/web exports, 509.3 KiB web budget, and exact signed copy all
passed. Profile command ownership, Venue failed-read recovery and scoped Auth
error feedback have synthetic actual-component coverage and independent review.
The hardening document and receipt hold exact hashes and limitations. No native
keyboard, VoiceOver, offline, Photos, account-write or installation certification
is implied. The native decoder dependency remains unpatched despite the reviewed
AVIF path-specific mitigation; preserve that advisory distinction.


## Latest compiled checkpoint: community and media recovery

79858de supersedes 6461b05 as the latest preserved signed preview. All 8,130 tests,
platform exports, 509.3 KiB web budget and signed exact-copy checks passed. No
phone installation or live mutation test was performed. The existing signing
profile expires November 14, 2026 at 23:50:01 UTC; do not change signing or infer
App Store/TestFlight readiness from this development-signed Release.

Highest-value remaining physical fixture gates:
- FanClub/DM text and selection survive Profile and Back without extra submission.
- Explicit Lounge entry, metadata outage and Retry show readable status/reachable
  controls, preserve available text, and cause no second Going write.
- Clips cold/page failure recovers to confirmed empty or nonempty content without
  stale or inert errors.
- A current paused/error video's Open action remains usable, while explicit
  Next/Previous/Retry/Close interruptions cannot open retired media.

Use authorized isolated data for attendance, sending, read-state and external
opening verification. Native layout, focus, spoken timing, UI-thread ordering and
physical Release performance are not certified by source/React test fixtures.


## Latest compiled checkpoint: primary-screen recovery

95df901 supersedes 79858de as the latest preserved signed preview. Its 8,183-test
suite, three platform exports and exact signed copy passed. Web initial gzip is
509.9 / 512.0 KiB; retain this budget gate. Android/web source maps contain no app
.ios implementations and select the inert Feed observer. This is build/source
isolation evidence, not physical behavior or performance certification.

In an authorized isolated fixture, verify:
- Discover's query survives cold failure and Retry; no-match copy requires a
  current ready result.
- Feed cold/fallback failure exposes a reachable Refresh; cached cards remain,
  and verified empty content uses neutral copy.
- Profile identity can remain while posts and nested concert history fail
  independently, without false zero/absence claims or an empty-map invitation.
- Complete-empty and partial/cached history retain their distinctions and the
  original Open review navigation.
- Pinned scores remain readable in light themes at largest supported text size.
- Date-only Upcoming retains date/navigation without a guessed doors countdown.

These checks require real layout, focus, VoiceOver and scroll-reachability
observation. The current live-linked preview is not a mutation-blocked test app;
keep the existing live-data and installation boundaries. Signing expiry and the
unpatched native decoder advisory remain unchanged.


## Latest compiled checkpoint: Show recovery and platform isolation

230f0ca supersedes 95df901 as the latest preserved signed preview: 8,236 tests,
platform exports, 509.3 KiB web initial gzip and exact signed-copy checks passed.
Its default-platform maps exclude the iOS draft owner and select inert Show
recovery. No native performance gain or complete platform fault isolation is
implied by the measured payload reduction.

In an authorized fixture, load a confirmed cancelled/postponed show, interrupt
canonical and artist-status refresh, and verify ticket/legacy Going controls do
not reappear during loading/failure. Retry must remain reachable, preserve the
current restriction or adopt a genuinely updated canonical result, and respect
actual attendance rules. Check largest text and VoiceOver focus on the notice.
Use fixtures for real attendance/ticket effects; no live synthetic action is
permitted merely to certify this flow. Installation and all prior native,
signing, dependency-advisory and privacy acceptance limits remain unchanged.

## Latest purpose-copy artifact aa3a29a

The current preserved preview supersedes 230f0ca with 8,238 passing tests and
verified three-platform exports plus signed Release compilation. The embedded
Photos explanation now accurately names MSHPIT and selection of concert photos,
videos and profile photos. Only this Info.plist purpose value and its packaged
configuration changed; JavaScript, privacy manifests and the provisioning profile
are byte-identical to the previous checkpoint. This does not request or expand
Photos access. Permission-flow evaluation remains a separately authorized native
fixture gate. The phone build is still held, not installed or App Store distributed.

## Feed return artifact a39bdba

The current signed preview has 8,268 passing tests and verified exports/build.
On the authorized isolated physical fixture, browse cached For You/Local beyond
the first eight rows, open a post/profile/show, and return. Check actual position,
unchanged filter, current variable-height media and new-drag cancellation without
an unexpected jump. Repeat with a changed/removed anchor, largest text and the
existing direct-gallery path. The bounded JS/native-like fixture proves count,
anchor ownership and finite progression, not native scrolling or performance.
Do not claim deep Following/News restoration or recovery after process termination.

## Current isolated artifact 264f9ad

The current preserved signed preview includes the bounded Feed return and final
platform-isolation cleanup, with 8,273 passing tests and all exports/build checks.
Nine new Profile/You accessibility annotations and two new preference subscriptions
are now strictly iOS-only. Default platform source checks and mocked component
execution complement export isolation; real Android/web assistive-technology
behavior is not certified. Physical iOS gates and the installation hold remain.

## Current Search-feedback artifact b907ea8

The preserved signed preview now includes verified actual-state Search speech,
with 8,310 passing tests and all exports/build gates. On an authorized native
fixture, check All/category success, no matches and explicit Retry with VoiceOver;
interrupt the pending result/quiet window by changing query, leaving the screen,
backgrounding or turning VoiceOver off. Old feedback must not replay afterward,
while current reader-off controls remain usable. The JS bridge/coexistence tests
do not certify audible timing or OS queue behavior. The install hold remains.


## Reusable offline export check

Run scripts/check-ios-export-isolation.mjs after finalized Android/web exports
from the same runtime source, alongside the existing web budget. The b907ea8
exports pass this check; later tooling c414781 passes 8,321 complete-suite cases.
This tooling does not change or rebuild the signed b907ea8 preview. Missing or
malformed maps, app iOS module leakage and non-inert retained defaults fail the
check. Its explicit coverage/limitations are in IOS_EXPORT_ISOLATION_GATE.md.
