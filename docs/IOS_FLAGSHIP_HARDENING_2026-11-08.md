# iOS flagship hardening, November 8, 2026

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
