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
