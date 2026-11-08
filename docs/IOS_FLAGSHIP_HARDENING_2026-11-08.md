# iOS flagship hardening, November 8, 2026

## Latest fully verified artifact

Checkpoint b907ea8 is preserved at
.tmp/ios-phone-checkpoints/flagship-b907ea8/MshpitDev.app with a receipt, exact
manifest and platform-isolation evidence. All 8,310 tests, three platform exports
and signed Release compilation passed. This is a development-signed, live-linked
preview, not installed or App Store distribution. Physical interaction,
accessibility and performance remain open. Earlier checkpoints, including 264f9ad,
remain preserved. Later work is not included until separately verified.
The current concise [preview handoff](IOS_PREVIEW_HANDOFF_2026-11-08.md) separates
this compiled source from the later export-checker tooling checkpoint.

## Scope and release boundary

This continues the iOS redesign on `feat/ios-experience-redesign`. Android and
web retain their current presentation and behavior. No new dependencies, backend
changes, website deployment, signing grants or production-content writes are part
of this pass. The physical-phone update remains held until explicit reconnection.
The earlier signed build and its original receipt are preserved separately.

## Design rationale

The priority is a reliable journey from discovery to useful concert details, not
extra ornamental surfaces. MSHPIT keeps its own identity, content and actions.
The iOS navigation layer uses familiar hierarchy, generous controls and accessible
alternatives; it does not copy another app's branding or imply music playback
rights it does not have.

Reference guidance:
- Apple materials: https://developer.apple.com/design/human-interface-guidelines/materials
- Apple tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Apple search: https://developer.apple.com/design/human-interface-guidelines/searching
- Apple layout: https://developer.apple.com/design/human-interface-guidelines/layout
- Apple accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- React Native accessibility announcements: https://reactnative.dev/docs/0.86/accessibilityinfo
- Expo SDK 57 image behavior: https://docs.expo.dev/versions/v57.0.0/sdk/image/

These sources support design choices, not a claim that conversion, retention or
runtime speed has already improved. Such claims require measured user/device data.

## Completed changes

- Search uses larger, multiline result identity and accessible controls. Existing
  cancellation, scoped recents, partial-failure handling and canonical navigation
  remain intact.
- Search and Discover retain bounded, account-owned navigation preferences and
  scroll position when opening a detail and returning. They do not retain result
  payloads or keep hidden screens fetching in the background. New user filter or
  layout intent cancels a pending old scroll restoration.
- Feed presents initial content before suggested people. The suggestion row is
  not counted as a post impression or media item. Cold-start discovery and the
  News destination retain their existing meaning.
- On Discover's Shows destination, real upcoming shows precede an unrelated
  artist fallback feature. Effective local scope and date range are explicit.
- Show and Venue details have a clearer identity/date/venue/action hierarchy and
  larger controls. Ticket links retain the established validator and opening
  confirmation; failure feedback does not claim ticket availability or prices.
- Search outcomes and ticket-opening failures use explicit, queued iOS VoiceOver
  announcements for user-triggered outcomes. Pending work is scoped and stale
  callbacks are fenced. React Native cannot retract speech already handed to the
  operating system queue; no such cancellation guarantee is claimed.
- iOS accessibility preferences use shared live subscriptions that reject stale
  asynchronous initial reads. Custom gestures/motion stay conservative until the
  system preference is known.
- The concert-memory modal respects live Reduce Motion without resetting the
  selected memory. Larger text can wrap in its footer.
- Profile editing has explicit spoken field labels, picker roles/selection values,
  44-point accent targets and iOS keyboard insets/dismissal behavior.
- Calendar adapts its day geometry, event identity, badges and actions to larger
  iOS text. Actual dates, query ownership, status and export behavior are retained.
- Composer ratings have distinct iOS spoken labels rather than repeated 'Rating'.
- Typed direct-message drafts and synchronous send claims survive detail
  navigation on iOS. Account, authentication epoch and recipient own a bounded
  in-memory cache. Successful sends clear only the unchanged submitted revision;
  newer edits survive. Existing delivery/outbox/retry ownership stays in Store.
  Pending entries cannot be evicted to admit another composer. A pending promise
  may retain its old isolated owner until settlement after Root unmount; mounted
  guards prevent updates to an unmounted Root and no new owner is reachable.
- Inbox distinguishes initial loading, failed loading and a successful empty
  result while retaining cached rows and offering explicit retry. Polling and
  manual refresh share a single request with explicit cancellation ownership.
  This relies on the existing Store response contract; it does not add raw
  response-schema validation or repair shared Store malformed-response behavior.
- iOS chat positioning snaps the first loaded history, respects live Reduce
  Motion even for queued callbacks, and never follows new content while the
  reader is browsing older messages. Scope transitions invalidate old events.
- An explicit caller image-cache policy is no longer dropped when SmartImage
  delegates a video poster on iOS. Public defaults and Android/web behavior stay
  unchanged. This is a policy-propagation fix, not evidence of a prior data leak
  or a claim that previously cached files have been erased.

## Verification boundaries

Source/unit checks cover ownership races, user-intent cancellation, accessibility
preference changes, platform isolation and existing action handlers. Test results,
exports and build receipts are recorded after the final stable source checkpoint.

The earlier simulator review used synthetic accounts and an outbound-blocked
loopback backend. A later direct simulator framebuffer showed the new Feed fully
rendered while Device Hub displayed a stale launch image. Native hierarchy also
contained the actual Feed. No speculative splash-screen workaround was added.

The Mac then reported a locked session. Interactive testing was stopped rather
than bypassing that lock. The simulator was shut down to conserve resources.
Source tests and compilation can continue independently, but the following are
not yet certified on the final physical build:
- VoiceOver spoken focus/order and queued failure announcements.
- Live Dynamic Type changes, lower profile fields with the keyboard and Calendar
  at the largest accessibility sizes.
- Reduced-motion behavior, horizontal shelves and real-device gesture arbitration.
- Search/Discover return position with actual network delays and content changes.
- Release-device startup, scrolling, memory and energy measurements.

## Deliberately separate follow-ups

- A stale analytics-preference response can overwrite unrelated client privacy
  fields in shared Store code. This was reproduced with synthetic data, not as a
  server exposure. A narrow field-adoption repair needs separately coordinated
  cross-platform scope; it is not silently included in an iOS-only redesign.
- A broad Store subscription rewrite is not justified without profiling.
- Public-image proxy eligibility is not itself proof of publication permission.
  Any future private/signed-media path needs an explicit provenance contract.
- Universal Links need coordinated domain/website/signing release work. The
  existing custom scheme is not equivalent, and this pass does not change grants.
- App Store/TestFlight review, production migration and phone installation are
  separate release actions, not implied by a successful local build.


## First hardening checkpoint verification

The corrected sequential full run passed 7,178 tests with zero failures, skips
or cancellations (481 seconds). The macOS test invocation uses TMPDIR=/tmp so
parent/isolated-child HTTP fixtures agree on their temporary root. Older source-
shape assertions were replaced with semantic lifecycle checks rather than
removing their regression guarantees. New chat changes were completed during
this run and have additional focused lifecycle checks; a final stable-source
full pass remains a release gate.

Syntax passed for 920 Node files. Architecture baseline and whitespace checks
passed. Initial iOS and Android Hermes exports passed. The web production build
and budget passed at 508.1 KiB / 512.0 KiB gzip. These are compilation and size
checks, not runtime speed measurements or deployments. Review subsequently fixed
capacity-notification and queued-motion callback edge cases; final build receipts
must be generated from the later stable source rather than the initial exports.

All 160 tests in the changed test files passed after the capacity and queued-
motion review fixes. The independent chat review found no remaining blocker.
Native interaction remains unverified for the new hardening paths.

## Second hardening slice

- Artist details retain section, scroll position and album/list expansion on a
  retained navigation frame. A new visit or account/authentication lifetime gets
  a new bounded lease. Removed release IDs never open a different positional
  item. Explicit section/expansion/list changes cancel a pending old offset.
- iOS Artist music controls separate album expansion from rating, expose distinct
  spoken values and use wrapping text at larger sizes. Follow/fan-club outcomes
  are announced only for explicit actions; existing mutation owners remain.
- Thread history now distinguishes loading, failed loading and successful empty
  history, retaining cached messages and offering explicit retry. Unlike cursor
  reads are serialized; like requests share one result without stealing another
  poll's cursor. Android/web keep their prior relationship-loading path.
- Profile edits get a dirty/busy navigation guard through the existing Root
  composer contract. Dismissed or stale alerts cannot act in another lifetime;
  unsuccessful navigation can be retried rather than trapping the editor.
- Queued edge-Back callbacks require the same committed navigation permission
  lifetime. Tests reproduced stale navigation after unmount, disable and
  VoiceOver round trips before the fix. Protected editor routes stay excluded.
- Drawer cancellation restores its opener once. Selecting another destination
  does not focus the old screen, and callbacks from an older opening are ignored.
- Explicit Thread refresh-error speech is scoped to foreground/VoiceOver/lifetime;
  background changes do not replay a stale error on returning to the app.
- Default iOS avatar initials use the readable theme foreground. Chosen avatar
  color/tint, photos and explicit caller overrides remain. Android/web retain
  their previous foreground. Tested theme/tint contrast is not a guarantee for
  arbitrary content backgrounds.

The first phase-2 full run completed 7,300 tests: 7,293 passed and seven older
fixtures failed on changed imports, prop order or newly separated rating controls.
The fixtures were updated to exercise actual platform-aware callbacks and retain
all guest/member authorization and recycled-image guarantees, rather than
changing production behavior to satisfy source formatting. The expanded native
image fixture now runs on iOS and Android. A later stable-source full run is still
required before calling this slice regression-complete.

The interim web export remained within the unchanged budget at 508.5 KiB / 512.0
KiB gzip. It is not a website deployment. The current release-quality checklist
is in IOS_RELEASE_QUALITY_GATES_2026-11-08.md; it separates the intentionally
live-linked local preview from a future isolated staging/TestFlight release.

### Venue-review reliability

The iOS venue-review screen now owns one picker/upload/publication operation at
a time and registers the existing dirty/busy close contract. A confirmed result
cannot be posted again if navigation fails. Unconfirmed results retain the
rating, text, photos and deliberate gallery choice, with an explicit warning to
check the venue before retrying; there is no automatic resend. New success copy
requires Store's explicit ok:true contract and is not independent raw-server
receipt validation. The public-gallery switch stays off by default and the
payload/Store/API owner is unchanged.

The same screen has iOS field/rating labels, keyboard insets/dismissal, accessible
photo controls and 44-point Post/remove targets. TapStars accepts an optional
disabled state; existing callers retain their prior default behavior. Native
interaction remains unverified while the Mac is locked.

The next full run passed 7,369 of 7,370 tests (483 seconds). Its sole failure was
an older TapStars test requiring literal source text for a now-conditional hint.
It now executes the real enabled/disabled component and retains the existing
focus, checked and bounded-value guarantees. The affected shared controls,
venue/media lifecycle and logging suites passed all 180 focused tests. Syntax
(920 Node files), architecture baseline and whitespace checks passed. A fresh
stable-source full run and final artifacts follow this local checkpoint.

An independent deterministic synthetic ownership harness passed nine groups and
14,114 bounded operations with seed 0x1a0f2026. It exercised an independent draft
model under capacity pressure, account/epoch changes, retained/replaced frames,
queued abort/failure, stale alerts/timers and failed navigation. Results remain
in ignored .tmp/ios-flagship-stress. This is pure JavaScript simulation, not a
native interaction, transport or performance measurement.

## Verified signed checkpoint 0fcb4fd

The frozen committed source passed all 7,370 tests with zero failures, skips or
cancellations in 478.9 seconds. Sequential iOS and Android Hermes exports passed;
the web export passed the unchanged budget at 508.6 KiB / 512.0 KiB gzip. These
are regression/build checks, not an Android/web deployment or device benchmark.

The iPhone Release build succeeded with the existing cached signing authority
and provisioning profile. Strict deep signature verification passed on the
built app and the preserved copy; all 52 files/links matched. The artifact is
60,161,417 bytes, with 11 bundled privacy manifests. Their presence is not a
substitute for App Store privacy answers or an independent SDK privacy audit.

Preserved app: .tmp/ios-phone-checkpoints/flagship-0fcb4fd/MshpitDev.app
Receipt and exact manifest: receipt.json and manifest.json alongside it.
Source: 0fcb4fd6fe418efcd5b44409c2c22f3ed6d1622e.
Actual app identifier: com.mshpit.app.dev. Version 1.0.0, bundle version 1.
Minimum OS: iOS 16.4. Built SDK: iPhoneOS 27.2.
Provisioning expires November 14, 2026 at 23:50:01 UTC.
Bundled JavaScript: 9,654,325 bytes, SHA-256
25ed1318fab2fe20a200182c32d9c19bf2c8a598260999a1e7cfd344619ff66c.

This build uses the owner-approved live MSHPIT backend and remains held, not
installed. Earlier signed checkpoints are untouched. No push, merge, deployment,
store submission, provisioning update or production-content write occurred.
The final physical launch, VoiceOver, Dynamic Type, gestures and performance
checks remain pending. The simulator remains shut down and keyboard capture off.

Further comment-continuity and explicit image-recovery work is isolated in
separate worktrees. It is not included in this signed checkpoint until separately
reviewed, integrated, tested and rebuilt.

## Comment continuity and explicit image recovery

The next independently reviewed iOS-only slice is now integrated after the
0fcb4fd signed checkpoint. Root retains bounded, account-and-auth-epoch-scoped
comment drafts in memory, including the selected reply identifier, revision,
exact attempted delivery key/payload, pending claim and recoverable error.
Opening a profile, photo or show no longer inherently discards that local work.
Pending delivery remains single-flight across remounts; a result only clears
unchanged submitted text. Failed sends require a deliberate retry with the same
key or an attempt-specific discard confirmation. Nothing is persisted to disk,
URLs or telemetry, and no additional comment fetch or automatic resend is added.

Reply context is resolved from the current thread, never from retained parent
text or profile data. Missing, deleted or still-pending parents block new sends
and retries; absence means unavailable in the loaded thread, not necessarily
deleted. Retrying preserves the original attempted parent, even if newer draft
edits selected another. A deletion between local validation and server commit
remains an existing backend-contract limitation. Discard does not remove any
possibly accepted comment and warns the user to check the thread first.

The image slice adds a platform-resolved iOS attempt lifetime so callbacks from
an old image, including A-to-B-to-A source changes, cannot fail a fresh image.
An accepted explicit Feed refresh emits one synchronous retry intent. Only
already exhausted mounted images reset; healthy/in-flight images consume the
intent without restarting. The native view key changes per attempt, while the
URI, cache key, proxy inputs, existing cache policy, gallery actions and video
poster policy stay unchanged. There are no automatic network retries or cache
clears. Android/web use the inert retry context and their original image hook.

All 100 immediate integrated tests passed, including existing public/private
profile and Android/web presentation checks. Two profile fixtures initially
lacked the new Avatar retry-context dependency; the missing inert dependency
was added without removing assertions. Independent reviews passed 113 related
comment tests and 48 image/cache tests before integration. A fresh frozen full
suite, platform exports and signed artifact are required for this new slice.
Native offline/keyboard/VoiceOver behavior has not been revalidated while the
Mac is locked, and the held earlier signed build does not contain this slice.

The first full continuity run passed 7,418 of 7,419 tests in 155.5 seconds. Its
only failure was an older source assertion requiring the image hook to have
exactly two arguments. It now verifies the same scoped source list plus the
platform-resolved retry argument and the inert Android/web context, retaining
all disk-cache, fallback and recycling assertions. A fresh run follows.

## Verified signed continuity checkpoint e873ca5

The frozen continuity source passed all 7,419 tests with zero failures, skips or
cancellations in 141.5 seconds. Sequential iOS/Android Hermes exports and the web
export passed; web remained inside its unchanged budget at 508.9/512.0 KiB gzip.
The signed iPhone Release build passed with the same cached signing authority and
profile, followed by strict deep verification and an exact 52-entry copy check.

Preserved app: .tmp/ios-phone-checkpoints/flagship-e873ca5/MshpitDev.app
Receipt and exact manifest: receipt.json and manifest.json alongside it.
Source: e873ca53d8841686cc996ffcfbedb838b96f1e03.
Artifact bytes: 60,174,957. Actual version remains 1.0.0, bundle version 1.
Bundled JavaScript SHA-256:
bdba7ebeba3a27085c67d21a4a8096e7775aff5066933f62e182525dea44d75b.
Manifest SHA-256:
2cbcfb8aee51a3c5bed63472a4c848e35f0ec27894e4258d79ae7e9aec2a2712.

This app includes comment continuity and explicit image recovery. It is still
held, not installed, and uses the already-approved live backend. Earlier signed
artifacts are preserved. Profile expiry and native-QA limits remain unchanged.

The subsequent Post composer slice adds an iOS-only measured keyboard container,
44-point Send/Clear controls, labelled multiline input and wrapping reply/retry
content. A single keyboard owner measures its actual window bounds rather than
assuming a fixed safe-area/banner offset. It rejects stale measurements and
clears on keyboard hide/background; Android/web resolve to a bare View. Return
adds a newline and explicit Send publishes. All 66 focused actual-component,
geometry and existing draft tests passed after integration, with independent
review approval. Actual native keyboard visibility, animation, VoiceOver and
extreme large-text/small-height fit still require device testing. It is not yet
part of the signed e873ca5 artifact.

### Linked destinations and Calendar sharing

The next integrated iOS journey slice uses a single Root-owned lookup claim for
linked posts, profile handles and News. New taps, committed navigation, account
changes and same-account reauthentication invalidate older lookups. An old
result or stale notice/dirty-form confirmation cannot change the current route
or abort a newer sign-in. Claims are consumed only after the existing editor
close guard permits navigation. Guest auth still deduplicates before side
effects. Cached authoritative artist identities retain their canonical route;
missing/rejected optional lookups retain the current route and can be retried by
a deliberate tap. Store/data ownership and the original Android/web handlers
remain, with an inert default-platform owner.

Calendar sharing now uses an iOS-only synchronous single-flight claim across
same-frame presses and an exporter-level presentation gate that survives route
remounts. Account/auth epoch, unmount and foreground-ended intents cannot open a
late share sheet. Each export uses its own non-overwritten cache file, cleaned
up only after the native sharing promise settles. Android/web exporters and
calendar event/date/content policies are unchanged. Expo cannot cancel an
already-presented share sheet, and its void result only proves dismissal, not
saving or Calendar import. The UI reports those limits truthfully.

All 170 combined focused tests passed after integrating Post keyboard, linked
navigation, Calendar sharing and existing comment/draft behavior. The three
slices had independent source/test sign-off before integration. The next full
suite/export/signed checkpoint remains required. No native share sheet or real
calendar was invoked by the mocked tests.

## Verified signed journey checkpoint 94be923

The integrated journey checkpoint passed all 7,516 tests, with no failures,
skips or cancellations, in 129.5 seconds. Syntax and the architecture baseline
passed. Sequential iOS and Android Hermes exports succeeded; the web export
remained within its unchanged 512.0 KiB budget at 509.1 KiB gzip. The signed
iPhone build succeeded and passed strict deep verification plus an exact
52-entry copied-artifact comparison.

Preserved app: .tmp/ios-phone-checkpoints/flagship-94be923/MshpitDev.app
Receipt and exact manifest are beside it. Source:
94be92348e1c1ced383ae4341647166d02010d73.
Artifact bytes: 60,187,372. Bundled JavaScript bytes: 9,680,280.
JavaScript SHA-256:
751d146199d78a1acf908d5306bae2320f0e6188e5ebd6676d72ed6b78f206dd.
Manifest SHA-256:
ebcc9d68b010ad0ce8fc60117a54ba5e52255135908051e652a005c6e5be5d96.

All preceding signed checkpoints remain preserved. No app was installed,
pushed, merged, deployed or submitted. This is a development-signed Release-
configuration preview using the approved live backend, not App Store distribution.
Actual identity remains com.mshpit.app.dev, version 1.0.0, build 1, iOS 16.4 minimum,
iPhoneOS 27.2 SDK and the same profile expiring November 14 at 23:50:01 UTC.

The actual artifact declares portrait and upside-down orientations only.
Landscape/iPad floating-keyboard scenarios are future/support-dependent tests,
not current artifact acceptance paths. No camera or microphone purpose string
or background mode is present. ATS arbitrary loads are false, with the existing
localhost exception. The photo-library purpose string and development profile's
get-task-allow entitlement remain unchanged. Eleven bundled privacy manifests
have no tracking domains; this does not certify the app's data disclosures.

The independent linked-navigation stress harness is preserved in ignored
.tmp/ios-flagship-stress/linked-navigation.mjs, with its JSON result beside it.
A reproduced run used seed 0x4d534850, 128 sequences, 32,768 operations, 2,925
accepted claims and 791,060 independent-oracle checks. Six independent negative
controls were caught by the reviewer. These are ownership/correctness evidence,
not native performance measurements.

## Feedback and comment accessibility checkpoint, 05:40 UTC

Source be4eb3f1b100877a43c52a030703f43f7eb5750a is now compiled and preserved.
The iOS feedback host is keyed by account and authentication epoch. Exact notice
and effect-lifetime ownership prevents old timeout, Dismiss or Details callbacks
from acting on a replacement. Current diagnostics authorization remains required.
VoiceOver-enabled or unknown preference state keeps a notice available instead
of enforcing a seven-second limit; disabling it starts a fresh interval. Copy
can wrap, and Dismiss/Details stay separate accessible controls. A Suspense effect
reconnect clears retired notice state rather than leaving inert controls.

Explicit accepted iOS comment Send/Retry actions have a separate scoped outcome
announcer. It requires positively known VoiceOver-on and foreground state at the
action, then permanently revokes on reader-off, inactive/background, lease/scope
change or unmount. One claim owns a queued timer; stale callbacks cannot speak or
clear a newer timer. Copy contains no authored or raw server text. Success says
'Comment confirmed'; ambiguous failure never claims a message was not delivered.
Invalid current and original retry parents use distinct guidance. Delivery still
settles with the same payload/key even when speech is cancelled. Retained errors
are not spoken merely on mounting. Android/web resolve an inert hook.

The shared iOS preference owner adds a separate null/false/true confirmed-state
API without changing existing conservative boolean consumers. Both consumer
kinds share the same native query/listener and generation/revision fences. No
Store/API, diagnostics throttling, global speech, permissions or dependencies
changed. RN cannot retract an announcement already handed to VoiceOver.

Verification:
- 164 combined host/preference/comment/nearby focused tests passed.
- Complete suite: 7,561 passed, zero failures, skips or cancellations; 131.402s.
  Log: /tmp/mshpit-ios-accessibility-full-tests.log.
- Syntax: 920 Node files. Architecture baseline and whitespace checks passed.
- Independent reviews passed 42 host tests and 98 Post outcome tests, including
  five negative-control ownership mutations. These are synthetic JS tests.
- Reproduced deterministic preference model: seed 0x564f4943, 32,768 operations,
  131,200 invariant checks, 245 native-subscription lifetimes, all passing.
  Harness/result: .tmp/ios-flagship-stress/accessibility-preference{.mjs,-results.json}.
- iOS and Android Hermes exports and web export passed sequentially. Web remains
  509.1 / 512.0 KiB initial gzip. No native runtime or speed claim follows.
- Development-signed Release copied and strictly signature-verified, with all
  52 files/links exactly matching. Artifact: 60,199,786 bytes; JS: 9,692,694 bytes.
  JS SHA-256: 77ada56552959511c290f0b384f1f9f6ccf51c41cb18adeb1cf704d62b2d7d5e.
  Manifest SHA-256: f087599dc2c7d342a586a79e991fe6c05a9cbfeb4660007247fc00a521b7269e.
- Bundle com.mshpit.app.dev, version 1.0.0/build 1, same cached development
  signing identity/profile, expiry November 14 at 23:50:01 UTC. No install.

Physical VoiceOver output/focus/wrapping, Dynamic Type geometry and final phone
launch remain unverified. Real Send/Retry tests are not permitted against the
live-linked preview as synthetic QA. Activity and Thread opening also persist
notification/message read state, so they require the isolated fixture or a
separately authorized genuine action. The upstream cross-account diagnostics
throttle and shared analytics response-adoption issue remain separate proposals.
Earlier signed checkpoints are preserved, not replaced.

### Live browsing is not a write-free test harness

Source tracing confirms that consenting live accounts can emit app_open,
screen_view and feed events through the first-party /api/events/batch endpoint
while simply browsing. Activity and Thread also persist read markers as noted
above. No such production test actions were performed. The owner's genuine app
use is separate from synthetic certification; controlled QA remains in the
outbound-blocked fixture. No analytics consent, event policy or signing setting
was changed to work around this boundary.

## Retired controls and private Report draft checkpoint

Source 659d1d1a0035b3c1eb3e23469d2d24f7a515c471 is compiled and preserved.

- Activity lookups and controls are scoped to the presented account/epoch and
  Root route generation. A queued row/Avatar/Back action or late lookup cannot
  navigate after departure, including Root edge Back before React cleanup and
  a later restoration of the same frame object. Existing transport, notification
  read marking and refresh behavior are unchanged. No new global lookup owner
  was added for unsupported entry paths.
- Report is a private, local iOS form with synchronous single-flight report/block
  actions and locked edits during submission. Reason/details survive unconfirmed
  outcomes. Confirmed UI requires explicit success and a nonempty receipt ID.
  Failure/discard copy does not claim a report was never received or withdrawn.
  Dirty/busy Root navigation is protected, including Suspense hiding; pending
  commands retain their barrier through layout reconnects. Old Send, Block,
  Done and confirmation callbacks cannot act for a new owner. No persistent
  report cache, automatic retry, moderation-policy or Store change was added.
- iOS ticket controls reject starts from a retired presentation/scope before
  calling the existing validator/confirmation/opener. Same-tick dedup, manual
  retry and the established completion-time speech policy remain. Already-
  presented confirmations or already-started external opening are not cancelled.
- Explicit iOS Thread refresh speech now acquires a confirmed-reader/foreground
  claim at accepted task start, not failure completion. Interruptions revoke it
  without cancelling data work. Silent polling, read markers and refresh joining
  are unchanged; stale/aborted outcomes release listeners and stay silent.
- Android/web preserve their existing behavior. Substantive Activity, Report and
  Thread speech ownership resolves only on iOS; the ticket path has iOS gates.

Validation: 278 combined focused tests, all 7,707 aggregate tests (137.234s),
920-file syntax, unchanged architecture baselines, whitespace and sequential
iOS/Android/web exports passed. Independent reviews passed 65 Activity, 97 Report,
96 Thread and 23 ticket focused cases. Worker counts overlap and are not additive.
Full log: /tmp/mshpit-ios-controls-full-tests.log. Web remains 509.1 / 512 KiB gzip.

The development-signed Release is preserved at
.tmp/ios-phone-checkpoints/flagship-659d1d1/MshpitDev.app with its receipt/manifest.
All 52 files/links match the built source, and strict signature verification
passed. Artifact bytes: 60,212,660; JS bytes: 9,705,568.
JS SHA-256: db24174176c12a4279c9a41c0d855b36245bdbcdeac5fb780a5e8e419fdd33ca.
Manifest SHA-256: f1fa1be0eb9def10f321d83c365a5cfde7683af48da1ff31d234fc1f5e78e4cf.
Same existing development signing identity/profile; no permissions changed.
Bundle com.mshpit.app.dev remains version 1.0.0/build 1, live-linked and not installed.

These tests use synthetic callbacks, React/Worklet seams and local fixtures, not
real reports, blocks, ticket openings, read receipts or native speech. Physical
layout, gestures, accessibility and Release performance remain unverified. Live
browsing side effects and the phone-install hold remain unchanged. Prior signed
artifacts are preserved.

## Gesture and suggestion checkpoint: cd06226

Source commit cd06226dc9c3c97fefba3d5bacd8e3629f983bbb adds iOS-only
gesture lifetime protection and suggestion draft/receipt protection. Android/web
fallbacks, Store/API contracts, navigation geometry and existing production
permissions are unchanged.

- Tab/header swipes, photo paging/down-dismiss and detail edge Back each own a
  presented lifetime. Both queued RN dispatch and retired UI handlers are
  fenced, so a previous screen cannot pop or switch a newer destination.
- Root's current-route predicate also covers the interval before React cleanup
  and retained Feed beneath a gallery. Opening the drawer retires tab intent
  synchronously. Deferred editor-close approval rechecks the same gesture claim
  before navigation or authentication-abort effects.
- The actual shared confirmed-reader subscription retires interrupted gestures
  even if React batches VoiceOver on/off into the same final boolean. Fresh
  gestures recover; a retired subscription cannot revoke a successor. Width
  changes retire edge geometry; canceled and multi-pointer drags still settle.
  Same-route benign renders retain valid gestures.
- SuggestionBox has a private local draft and synchronous pending claim, Root
  dirty/busy close protection, stale-control fences and normalized receipt
  confirmation. Anonymous payload and existing idempotency keys are unchanged.
  An unedited retry retains its key. Local discard cannot withdraw a suggestion
  already received by the service; uncertain results are described honestly.
- Report/Suggestion test factories now supply the actual fixture Platform to
  extracted Root Back. The initial integration ReferenceError was a missing
  fixture dependency, corrected without weakening assertions or production code.

Verification:
- Complete suite: 7,886/7,886 passed, zero failures/skips/cancellations,
  83.429 seconds. Log: /tmp/mshpit-ios-gesture-full-tests.log.
- Architecture baseline unchanged; Node syntax gate passed for 920 files.
- Sequential iOS/Android Hermes exports, web export/budget and Release Xcode
  compilation passed. Web initial JavaScript is 509.2/512.0 KiB gzip.
- All 81 web source maps (1,158 source entries) exclude the new iOS gesture
  implementations and iOS suggestion owner.
- Independent review covered actual React lifecycle, actual Root refs and the
  real preference owner, including negative controls. The saved five-owner
  harness mounts tab/gallery/edge plus Post/Thread speech together. StrictMode
  off/on both pass with one native preference listener, independent revocation,
  partial-unmount recovery and complete teardown. Three deliberately broken
  gesture variants are detected. This is synthetic ownership verification,
  not native recognizer arbitration, UI-thread ordering or performance.
- Harness: .tmp/ios-flagship-stress/combined-gesture-owners.mjs; output:
  .tmp/ios-flagship-stress/combined-gesture-owners-results.txt. Harness SHA256:
  fa4dece8c18eaa0f2a6934bf2b52bd9456222c3a69b73493ab296af587425b60.

Preserved artifact:
- .tmp/ios-phone-checkpoints/flagship-cd06226/MshpitDev.app
- Strict deep signature verification and all 52 files/links match the built
  artifact exactly. Total 60,231,632 bytes; receipt and manifest are beside it.
- JavaScript SHA256:
  0192e1f24457852d3e8f721d2a7d40892b13cb95a24004254df7b15301030e6e.
- Manifest SHA256:
  abf4887614c46643731a5abe4cb92393e99c34c4f47249ed0fa7056b9e8eb97b.
- Existing signing authority/profile retained, intended phone included,
  profile expires November 14 at 23:50:01 UTC. No new signing grants.
- com.mshpit.app.dev, 1.0.0/build 1, development-signed Release configuration,
  live backend https://www.mshpit.com. Not installed, pushed or deployed.
  Previous signed checkpoints remain preserved.

An already-released Like/Repost is not treated as withdrawn merely because a
photo opens; social action semantics were not broadened. All gesture, suggestion
and publication effects in tests were synthetic. Physical gesture feel,
VoiceOver focus/speech, keyboard/Yoga, native image/video and measured Release
performance remain open. Live-linked browsing may emit consented analytics;
Activity/Thread may mark read. Mutation certification needs an authorized
isolated fixture, not synthetic actions against production.


## Profile, venue recovery and sign-in feedback checkpoint (6461b05)

- iOS Profile editing now synchronously admits one Save or media command. Native
  editable/disabled properties and retained callbacks prevent a pending keyboard
  edit from being lost behind a successful save. No-op edits still release the
  edit barrier. Existing account-scoped upload, draft, close guard and Store
  payload semantics remain authoritative. Confirmed work is not submitted again
  merely because closing the screen fails.
- iOS Venue fan notes now distinguish loading/failure from a confirmed empty
  collection. Cached privacy-filtered notes remain visible and an accessible
  44-point retry is available. Mount, retry and refresh share the current read;
  account/epoch/venue/privacy changes fence status adoption. This checks the
  existing Store result contract, not raw-network schema or all offline cases.
- An accepted iOS login/signup general failure can announce fixed, non-sensitive
  “could not be confirmed” feedback. Positively known VoiceOver-on and foreground
  eligibility are captured at action start; interrupted/retired results do not
  replay. Field errors, forgot/reset, success, credentials and authentication
  transitions remain unchanged. No global announcer was introduced.
- Platform-resolved default hooks are inert. No Store, server, dependency,
  native project, signing permission or production-content changes were made.

Verification: 7,963/7,963 full tests passed, zero failures/skips/cancellations,
83.508644292 seconds. Integrated targeted regressions passed 190/190. The first
full integration run found one old genre-validation source-prefix assertion;
it was updated to require all original gates plus the new command gates. No
product behavior was weakened to satisfy it. Architecture and syntax gates pass
(920 Node files). The independent recovery-sensitivity harness passes all three
actual-component scenarios and catches four intentionally broken in-memory
variants. Its source SHA256 is
85299b8b9593584a9ecc8c501fa67d12ff370fe9bf3b43bd96d087773992ce37.

All three exports and signed iPhone Release compilation passed. Web initial
JavaScript is 509.3/512.0 KiB gzip. Eighty-one web source maps contain 1,161 source
entries; the three new iOS hook implementations are absent. This is bundle/source
isolation evidence, not a new Android/web visual certification.

Preserved artifact: .tmp/ios-phone-checkpoints/flagship-6461b05/MshpitDev.app.
Source 6461b0550024568a4d465e59142d36e92b64e64a; 60,247,414 bytes, 52 exact
files/links. Strict deep signature and copied-byte verification passed.
- JS SHA256: b013804ca319d406a202dac12eb38b552f515c8583ab0d1fc86f4ade37b3b7c0.
- Executable SHA256: b6d221dce07b0be3e9c9d78959d7440210dbe4707b94b485c5f4924e2604a04b.
- Manifest SHA256: 21b025ae2e8dfd7453524c03a085d070c77f918526f4e959e8c7d5110c337224.
- Existing development signature/profile unchanged; expiry November 14,
  2026 at 23:50:01 UTC. Bundle com.mshpit.app.dev, version 1.0.0/build 1,
  iOS minimum 16.4, iphoneos27.2 SDK, 11 privacy manifests.
- Receipt created November 8 at 07:06:48.502453 UTC. Live backend unchanged.
  Not installed. Earlier signed checkpoints remain preserved.

Evidence logs: /tmp/mshpit-ios-79ca509-integrated-full-tests.log (final green
6461b05 source), /tmp/mshpit-ios-auth-profile-venue-integrated-tests.log,
/tmp/mshpit-ios-profile-genre-fixture-tests.log, and the ios/android/web export
and iphone build logs named mshpit-*-6461b05-*.log. The earlier failed full log
is retained honestly as /tmp/mshpit-ios-auth-profile-venue-full-tests.log.

The native decoder/advisory review is separately recorded in
IOS_NATIVE_DECODER_REVIEW_2026-11-08.md. A reviewed path-specific mitigation does
not patch or close the package-level advisory. No decoder was executed and no
blind binary override was applied.

Native keyboard/IME, VoiceOver timing/focus, real offline recovery, Photos and
physical dismissal remain uncertified. All behavioral tests used synthetic
accounts/services. The live-linked artifact must not receive synthetic login,
profile writes or reviews for QA; use an authorized isolated fixture. Phone
installation still waits for explicit reconnection.


## Community, direct-message controls and media recovery checkpoint

Source 79858ded36d4d5f40028e637dbd3367c04a39ef2 was compiled and preserved on
November 8 at 07:55:39 UTC. It adds the following iOS-only journeys:

- FanClub and Lounge composers retain bounded in-memory text and accepted pending
  claims across detail navigation, with separate account/authentication-epoch/
  channel ownership. Same-tick keyboard/button submission admits one Store
  intent. Existing Store outbox, delivery keys, retries and settlement remain
  authoritative. Later text revisions survive earlier successful settlement.
- Community eligibility remains live. Draft restoration never rejoins a FanClub,
  enters a Lounge, marks Going or restores polling. Lounge re-entry still requires
  the existing explicit server-confirmed action. Stale controls cannot edit, send,
  retry or cancel after route/presentation/gate ownership ends.
- An entered Lounge now offers an explicit, accessible metadata Retry when its
  current status cannot be confirmed. Confirmed entry and available draft state
  are retained; composing and polling remain gated until current open metadata
  succeeds. Retry does not issue another attendance action.
- DM composer controls now require current route and presentation ownership before
  starting edits or actions. Already-accepted delivery settlement still runs
  after navigation, preserving newer revisions and existing outbox behavior.
- A successful replacement Clips head retires only the error it supersedes.
  Failed, canceled, stale or malformed reads cannot claim recovery or hide a newer
  pagination failure.
- Video external-opening controls reject retired route, foreground, presentation,
  media-item and retry intents. Current paused/error media retains its explicit
  Open action. Already-started operating-system opening cannot be recalled.

The shared Store, API client, chat delivery/draft owner, live-chat and scoped-
refresh implementations, dependencies, app/EAS configuration and Pod lock remain
unchanged from 0c53aaa. Android/web use their existing paths. Inspection of 81 web
source maps (1,164 distinct source paths) found none of the three new iOS helper
implementations. The web initial JavaScript budget remains 509.3/512.0 KiB gzip.

Verification: 8,130/8,130 full-suite tests passed with zero failures, skips or
cancellations (83.504 seconds); 215 focused integrated checks also passed. iOS
and Android Hermes exports, web export/budget, syntax, architecture, diff checks,
signed Release build and exact-copy signature verification passed. Independent
actual-React sensitivity probes also caught three removed chat admission guards
and four removed media recovery/admission guards. These are synthetic ownership
checks, not native timing or performance measurements. Evidence lives in the
checkpoint receipt and /tmp/mshpit-ios-chat-media-final-full-tests.log; the
preserved .tmp/ios-flagship-stress chat-admission and media-recovery harnesses
contain the repeatable in-memory probes.

The first full run (8,110/8,111) exposed a test fixture that typed before fresh
post-entry Lounge metadata had committed, when the actual input was disabled.
Controlled delayed-metadata probes showed the text was rejected immediately,
not lost by stale settlement. The corrected fixture explicitly waits for current
metadata/readiness and asserts that text was accepted before testing the old
completion. Its historical failed log is retained. The separately reproduced
entered-room missing-Retry issue was repaired in a distinct product commit; no
assertion was weakened or product gate bypassed to make the suite green.

Signed artifact: 60,261,202 bytes across 52 files/links. JavaScript SHA-256:
c8e49fcfcaa0ce8b03f64a638bb8ccbfd0a1ce27f3f06e904b89d6666856f3c0
Executable SHA-256:
0036868cfd7618f61eaa346be07dd156bfa0e960eaddab1a04c159a77d494a36
Manifest SHA-256:
5d89c457800dba62941707272c21f3853531378da048d7c9b8a2ec0b93a74f93
Only the executable, JavaScript bundle and signature resource manifest differ
from 6461b05. All 11 privacy manifests and the provisioning profile are byte-
identical. The existing profile includes the intended phone and expires November
14 at 23:50:01 UTC. No signing grants or profile changes were made.

This remains a development-signed, live-linked Release preview, not installed.
Draft continuity is in-memory navigation continuity, not app-termination recovery.
Native keyboard/cursor, VoiceOver, gesture arbitration, real offline media and
physical performance remain unverified. Attendance, sends, read markers and
external opening must be tested against an authorized isolated fixture, not as
synthetic activity on the live backend.

## Primary-screen recovery checkpoint: 95df901

Source 95df9017f075f96baec5bf915fadb29fe903b232 was frozen and compiled on
November 8 at 08:35:50 UTC. This slice prioritizes truthful state and usable
recovery in the primary journeys rather than adding decorative UI.

- Discover's artist query no longer turns an unfinished or failed overview read
  into a false no-match result. Existing query/scope and cached matching rows
  remain, with the existing explicit retry action.
- Feed now distinguishes an unconfirmed first read from verified empty content.
  Initial/fallback failure exposes Refresh instead of a dead cursorless older-
  posts footer. Cached cards and buffered local reveals remain available.
- Public Profile and You no longer claim zero reviews, no posts or no upcoming
  history based on an unavailable/incomplete history response. Current complete
  receipts still establish real empty states, and cached rows remain visible.
- The nested concert-history component has its own independent history source.
  Its count stamp, summary and empty-map invitation now follow the same iOS
  truthfulness rule. The actual child, hook, resource and lazy map are tested,
  not just a mocked child. Existing map preference, rows and review links remain.
- Favorite rating text uses readable theme amber on iOS rather than an arbitrary
  profile accent. All 96 actual theme/accent combinations meet 4.5:1 for this
  text. Member banner/border accents remain unchanged; this is not an app-wide
  accessibility certification.
- iOS Profile no longer labels the normalized date's 20:00 fallback as a precise
  countdown to doors. Date, provenance and navigation remain. Shared date and
  calendar normalization are unchanged; no actual doors time was inferred.

Feed observer scope is deliberately narrow. Its platform-resolved iOS owner
observes the existing admitted head read, and retains only status, verification
and an opaque lifetime token. It owns no requests, content, account identifiers,
cache or analytics. Current receipts, cancellation, account resets and logout
retire stale status. Android/web resolve to an inert default. Executed reader
parity tests preserve request options/order, data updates, returns and telemetry;
removing only the observer additions reproduces the prior Store source. This
is not proof of native timing or performance neutrality.

Verification and artifact evidence:
- Complete suite: 8,183 passed; zero failed, skipped or cancelled; 86.248 seconds.
  Log: /tmp/mshpit-ios-primary-recovery-final-full-tests.log.
- The earlier run's four failures were outdated AST-extracted logout fixtures
  missing the new optional observer dependency. Their original auth assertions
  remain, with actual observer reset/late-receipt checks added. The failed log
  /tmp/mshpit-ios-primary-recovery-full-tests.log is preserved, not replaced.
- Syntax: 920 Node files. Architecture: 144 Store hooks including 47 state hooks,
  and 156 inline API routes, unchanged. Diff check passed.
- Independent review and actual React/source tests cover loading, cold failure,
  cached data, explicit retry, complete empty, partial history and account/epoch
  retirement. The saved primary-journey-recovery.mjs harness passed four positive
  groups and caught six deliberate baseline/mutated regressions. Its SHA-256 is
  65f4df6c389cab8dedb84b5510d6fc290dc0d17fc74f2bd3e81c304bbb48db76.
- iOS and Android Hermes exports and web export passed. Android's 2,194 source
  entries and web's 81 maps / 1,165 distinct sources include no app .ios module.
  Both resolve Feed status to the default helper and exclude its domain owner.
  Local source maps are evidence only; they were not uploaded or deployed.
- Web initial JavaScript is 509.9 / 512.0 KiB gzip. The narrow remaining budget
  is a release constraint for future changes, not a claim of unchanged bytes.
- Signed artifact: 60,266,681 bytes; 52 files/links; 11 privacy manifests. Its
  exact copy and deep strict signature verify. The provisioning profile and all
  11 privacy manifests are byte-identical to 79858de; only executable, JavaScript
  and signature resource bytes differ. Existing signing identity/grants remain.
- JavaScript SHA-256:
  0a154ad353501d676e22a04d27d5634f1bb5425383bfeec02776460e1666acec
- Executable SHA-256:
  3c41d8662e884a0d0111c4c4864f42882e33171fcaa34938def0cfd16462baa8
- Exact artifact manifest SHA-256:
  2046ab7dea2719fa7c8ac2cbc6bcf0339cf15356919764930eeb8288cc949ae9

No phone installation, website deployment, production synthetic actions,
permission change or native runtime certification occurred. The live-linked
artifact still needs authorized fixture checks of largest text, focus/VoiceOver,
actual retry controls and physical Release performance. Profile history loaders,
concert resources/map implementation, calendar/show-time policy, API client,
dependencies and Pod lock remain unchanged for this checkpoint.

## Show recovery and platform-isolation checkpoint: 230f0ca

Source 230f0cab63893b3724cbf4fd9fbb273a8fe60c08 was compiled and preserved at
09:08:53 UTC on November 8. Two independently reviewed, bounded changes passed:

- A failed iOS Show refresh no longer discards an already confirmed cancellation
  or postponement and restores ticket/legacy Going actions from the older row.
  Only the current same-owner, provider-backed document survives explicitly
  classified transient network, timeout, retryable service or exact retryable
  HTTP 429 failures. There is no automatic retry or new request/cache owner.
- Denial/removal, identity conflicts, suppressed old-account errors, invalid JSON,
  normalized null/malformed responses, owner/target changes and unmount do not
  reuse that document. Network-coded body/HTML-intermediary uncertainty is
  distinct from invalid JSON, following the existing API classifier.
- The real memorial-status fallback also preserves the restrictions while its
  own read is pending or fails. Current artist/public recovery controls remain
  reachable. Typed attendance rules, public cancellation precedence, canonical
  success replacement, API normalization and date policy remain unchanged.
- A readable retained-status notice and 44pt explicit Retry use the existing
  refresh owner. Its JSX/source tests do not certify native focus or speech.
  Android/web select the inert recovery entry and retain their existing behavior.
- App's iOS message-draft factory now resolves through a platform boundary. iOS
  re-exports the exact original function; Android/web select an inert default.
  Both Root construction guards and all draft/claim semantics are unchanged.
  This removes unused iOS owner code from the other bundles, not shared backend
  dependencies or all possible cross-platform faults.

Matched isolated web exports for the draft boundary saved 542 gzip bytes
(522,098 to 521,556) and 1,453 raw bytes with identical build inputs. The combined
checkpoint is 521,565 bytes / 509.3 KiB gzip with 2,723 bytes of budget headroom;
module-layout changes mean its combined total is not the isolated comparison.
Android's 2,195 source entries and web's 81 maps / 1,166 distinct sources select
the two default entries, exclude the draft domain and contain no app .ios module.

Evidence:
- Complete integrated suite: 8,236 passed; zero failed/skipped/cancelled;
  84.742 seconds. Log: /tmp/mshpit-ios-show-isolation-full-tests.log.
- Show: 46 added actual-component/real-API-classification cases, including real
  memorial and attendance children. Draft boundary: seven added identity,
  installed-Metro resolution and actual Root construction/claim regressions.
- Independent integrated checks passed 53 selected tests. The preserved
  show-recovery-sensitivity.mjs passes current source and catches the original
  baseline plus three targeted regressions. SHA-256:
  ac72d3117c2d5f5cfa8601f5077cce8cd7c8fe9ff109fba608030aca2ff30c57.
- Syntax 920, architecture and diff gates passed. iOS/Android Hermes and web
  exports passed, followed by signed Release compilation and exact-copy checks.
- Artifact: 60,271,256 bytes; 52 files/links; all 11 privacy manifests and the
  profile are byte-identical to 95df901. Existing authority and expiry remain.
- JavaScript SHA-256:
  109e736bfa100160ba4a9ccf541485c56d8bba11bfe4eabc086c9358eefd4db4
- Executable SHA-256:
  0d1bb21cf190b3d9e2f9023cdd9190e6639fd63f319d4ba919a9ffb8fabee1a9
- Exact artifact manifest SHA-256:
  6d735acf93b9d095c8fa55e6842e379d6be3d8acae1db576fd52074233e31978

No install, push, deployment, dependency/security change, real attendance/ticket
operation or native performance/accessibility certification occurred. The existing
server-only audit wording in the initial scene/visual reviews and the initial
Discover test receipt are explicitly qualified as historical evidence.

## Photos purpose wording checkpoint aa3a29a

The owner-approved Photos purpose now names MSHPIT rather than Pit while retaining
its exact selection purpose: “Allow MSHPIT to choose concert photos, videos, and
profile photos you want to share.” No permission request, permission setting or
access-scope change occurred. Installed Expo introspection for both production
and local-development variants verified that only the Photos option and its two
iOS plist representations changed. All generated Android output was identical.

The existing generated native plist was updated from that introspected value,
without prebuild. The actual signed artifact confirms the same single Info.plist
value change. Its packaged EXConstants app.config changes only the matching plugin
option. All 11 privacy manifests and the provisioning profile remain byte-identical;
the JavaScript bundle is byte-identical to 230f0ca. Native icon/splash pixels and
packaged identity assets were inspected separately and required no alteration.

- Source: aa3a29a9c4e8f81e1d5eede087d6c5d2386f099c.
- Full suite: 8,238 passed, no failures/skips/cancellations, 85.762 seconds.
- Syntax: 921 files; architecture and diff checks passed.
- iOS/Android exports, web budget and signed Release build passed.
- Artifact: 60,271,262 bytes; 52 files/links; development-signed Release.
- JS SHA-256: 109e736bfa100160ba4a9ccf541485c56d8bba11bfe4eabc086c9358eefd4db4.
- Executable SHA-256: ccc8dd2e09037896c25b34442f37b55c18318655959a28c2372b90f957f070e9.
- Manifest SHA-256: 45519e04c0f311759ceb98e5fcd62bcc6135a9c2d633bac00a2a827c66fb73d7.
- Web initial gzip: 521,565 bytes, with 2,723 bytes of budget headroom.
- Android/web source maps contain no app .ios modules or iOS message-draft domain.
- Same signing identity/profile, expiring November 14 at 23:50:01 UTC.
- No installation, launch, permission grant, production action or native UI QA.

Generated-output evidence is beside the checkpoint in photos-copy-evidence; the
isolated review preserves both complete before/after variants. The previous signed
artifact still contains its original wording and has not been overwritten.

## Feed return-continuity checkpoint a39bdba

Opening a post, profile or show previously remounted Feed with eight revealed rows
after browsing 24. The selected filter already persisted; it was not a filter-loss
defect. Direct media already retained the same Feed instance and remains unchanged.

The iOS-only return snapshot keeps up to 64 cached For You/Local rows and bounded
opaque row identity/position metadata, never post payloads. It preserves normal
detail unmounts and all existing data, media, analytics and virtualization owners.
A valid same-order anchor is restored from current measured layout, with at most
six nonanimated seeks and a 1.5-second deadline. Incomplete restoration does not
force a jump to the top or add reads. New drag/filter/refresh, owner/epoch/route,
geometry or lifetime invalidates old work. Following/News deep-page return is not
promised. Exact physical position and scrolling quality remain unverified.

- Source: a39bdbaa8683502ab73134189a9aa2c51e7362e8.
- Full suite: 8,268 passed, no failures/skips/cancellations, 85.245 seconds.
- Thirty new actual-React cases; independent review passed 59 focused cases.
- Separate integrated sensitivity run passed current behavior and detected baseline
  row loss, one-seek failure, geometry relabeling and missing route admission.
- Syntax: 921 files; architecture/diff checks passed. All platform exports and
  signed Release build passed.
- Artifact: 60,282,744 bytes, 52 files/links.
- JS SHA-256: 24221d4bfcc6fdc2b4abc8d3d8aef0a8019a0a1e4f8f240065bdbbfe5a0d7975.
- Executable SHA-256: e0ba80a203b54865dab4db73171e53bded0a6c7a1c4451b6547e0bbdc38f58e6.
- Manifest SHA-256: db072a30b6047048f4987d082df6d9fce0ebde3f42506d602859c8abb7e61e4a.
- Web initial gzip: 521,884 bytes, 2,404 bytes below budget.
- Android/web maps contain inert default Feed entries, no app .ios files and no
  iOS Feed-return/message-draft domains. This is build isolation evidence.
- Info.plist, all 11 privacy manifests and the profile match aa3a29a byte-for-byte.
- Same signing identity, live backend and installation hold. No device actions.

See ios-feed-return-continuity-2026-11-08.md for the bounded algorithm and acceptance
limits. The preserved sensitivity harness is feed-return-sensitivity.mjs under the
ignored checkpoint stress directory, SHA-256
a5d73db27dd37c6aa1a2e3f8a28ac478b809d387937dee115106501b80edd86b.

## Final shared-code isolation audit and checkpoint 264f9ad

A source differential against pre-redesign cce58fa reviewed App navigation/shell,
shared screens/styles, default helper entries, Store observation, media/cache,
composers, ticket links and layout helpers. It found nine new explicit accessibility
annotations in Profile/You and two new preference consumers in Artist/ConcertMemory
that also reached Android/web. These additions are now iOS-only. Android/web retain
the baseline omission of those explicit props and import-free, unsubscribed default
consumers; iOS directly reuses the original hooks and shared subscription owners.
No visible text, style, handler, data or navigation behavior changed in this cleanup.

The audit found no further concrete Android/web visual/navigation/data/request
regression in the reviewed differential. This is not proof of complete behavioral
equivalence or live assistive-technology certification. Shared core/services remain;
platform-specific presentation and release lanes are not three separate backends.

- Source: 264f9ada1cca4b194d43d0f17733bceaf2bab401.
- Full integrated suite: 8,273 passed, no failures/skips/cancellations, 88.898 seconds.
- Focused cleanup: 80 passed; independent review cleared production and final
  test-only selector correction with unchanged navigation assertions.
- Actual JSX, Metro resolution, live iOS preference identity/subscription and inert
  defaults are covered. Syntax 921, architecture and diff checks passed.
- Three-platform exports and signed Release compilation passed.
- Artifact: 60,283,748 bytes; 52 files/links.
- JS SHA-256: 46dcea139324e8e47f9c211595798dac0e4af4c52115490d4ab6f27037dd4b14.
- Executable SHA-256: 73507611df54aa4a2a1a0e732e20352c3d33c0cb2089aff3e9e358cbd25c4502.
- Manifest SHA-256: 8618699dda897654d72a9ffd79ba42bc6a6b97b339d2bf438074a4f29b339f7a.
- Web initial gzip: 521915 bytes; 2373 bytes below budget.
- Export maps verify inert default Feed/accessibility entries, no app .ios files,
  and no iOS Feed-return or message-draft domain in Android/web.
- Info.plist, all 11 privacy manifests and provisioning profile remain byte-identical
  to a39bdba. Existing signing identity, backend and installation hold unchanged.

No phone installation, production deployment, account/permission change or live QA
occurred. Actual VoiceOver, keyboard, Dynamic Type, gesture/scroll feel and physical
Release performance remain the separately authorized fixture/device gates.

## Search feedback checkpoint b907ea8

Actual Search execution revealed that default All success emits the result state
“ready”, while the original speech helper accepted “results”. Visible results were
correct but their iOS completion announcement was rejected. The actual outcome is
now normalized, and explicit query/Retry intents own speech only when VoiceOver is
positively known on and the app is active. Reader/foreground interruptions, account
or auth-epoch change, presentation teardown and newer user intent retire pending
feedback permanently. Retired query/Retry/Clear/Cancel controls cannot alter the
current query or cancel newer speech. Current reader-off/unknown users retain
normal search controls. Search reads, caches, recents, visible copy and live data
owners are unchanged; default platforms keep their existing live regions.

- Source: b907ea879638bb74ab01f25ea810fd8a2294fc7d.
- Full integrated suite: 8,310 passed, no failures/skips/cancellations, 84.866 seconds.
- 37 new actual-component cases; focused 72 passed. Independent review passed
  58 selected cases, 17 actual-screen scenarios and five sensitivity controls.
- Integrated seven-owner coexistence passed in normal/StrictMode: one shared
  native reader listener, independent gesture/speech retirement and recovery,
  isolated Search removal/readdition, and zero remaining listeners on teardown.
  Seven intentionally broken owner variants were detected. This is synthetic
  React/bridge ownership evidence, not native recognition or audible certification.
- Syntax 921, architecture/diff, all platform exports and signed Release passed.
- Artifact: 60,285,587 bytes; 52 files/links.
- JS SHA-256: e0bb4973fffebef5a57374cfed90fe24ea475b0de9322ce8e0bf67f738c49ea2.
- Executable SHA-256: a411558532e4aef285145718d6a7582b55fbae6ac5089ae7ae7c898023287fbb.
- Manifest SHA-256: bbaf1c848aeca9cecf59a86500421b49cba42a8f7e80e1de8aafc944d1233fe1.
- Web initial gzip: 521916 bytes; 2372 bytes below budget.
- Export maps exclude app .ios files and the iOS message-draft, Feed-return and
  Search-announcement domains; default platform entries are present.
- Info.plist, all 11 privacy manifests and provisioning profile remain byte-identical.
- Existing signing identity, live backend, November 14 profile expiry and install
  hold remain. No phone, account, permission, native speech or production actions.

The exact combined-search-gesture-owners.mjs evidence SHA-256 is
c6467bc9372f29a414dcfd2d4c2aa0d445e997893594743c730a6680450a9a1e.
Once speech is handed to React Native's native queue, it cannot be recalled.

Feed wording clarification: restoration starts no explicit Feed query or automatic
pagination and introduces no request owner. It does not prove identical total
network/media/analytics activity as current cards mount; those existing owners
remain intact and native timing has not been measured.


## Offline export gate and preserved-artifact verification

Tooling-only commit c414781 adds the reviewed offline export-isolation checker,
11 hermetic regressions and a usage document. The complete suite passed 8,321
tests, zero failures/skips/cancellations, in 84.99911525 seconds. Syntax passed
for 923 Node files; architecture budgets and git diff checks passed. No runtime,
dependency, build, signing or phone change was made for this tooling checkpoint.
The signed b907ea8 receipt retains its original 8,310-test result.

The checker passed against the finalized b907ea8 exports: Android one map /
2,198 sources / 730 application sources; web 81 maps / 1,169 sources / 742
application sources. No isolation issues; retained reviewed defaults match their
inert source contracts. Evidence: .tmp/ios-export-gate-b907ea8.json. It checks
source-map isolation only, not compiled-byte mappings, freshness, performance or
complete platform behavior. Static web boot scripts outside the Metro subtree
are explicitly outside its map scan. See IOS_EXPORT_ISOLATION_GATE.md.

A separate read-only integrity review verified all 14 preserved flagship app
checkpoints against every manifest entry, their JS/executable receipt hashes
and codesign --verify --deep --strict. No historical artifact was overwritten,
re-signed, installed or launched. The oldest 0fcb4fd receipt uses sorted compact
JSON for its manifest hash; the actual file and that serialization were both
verified, not silently treated as identical. Later receipts hash file bytes.
The dated report is .tmp/ios-phone-checkpoints/checkpoint-integrity-review.json.
