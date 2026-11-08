# iOS festival presentation and recovery, November 8, 2026

## Scope

Local candidate based on b00f507, in the isolated `feat/ios-festival-polish`
worktree. All runtime changes are new `.ios` variants/helpers. The existing
festival API, shared resource loader, server/provider ingestion, shared screen
implementations, Android/web, dependencies and native configuration are unchanged.
No production write, push, deployment, main-checkout build or device action is
part of this work.

## Changes

- The iOS hub uses a quiet editorial heading and image-led edition cards rather
  than decorative spotlight artwork. Cards preserve canonical edition identity,
  complete dates, place and available lineup information.
- Artwork uses only the existing HTTPS image URL and attribution. Poster pixels
  use contain, not crop. Missing/uncredited media has a compact neutral state;
  failed delivery has an explicit retry. Native view generations fence old
  errors/displays and recycled A-to-B-to-A callbacks. No proxy or substitute
  image provider was introduced. Credits remain visible.
- Image failure recovery has content-driven height, and key controls have
  44-point minimum touch dimensions. Physical Dynamic Type fitting is unverified.
- The standalone hub and detail have explicit single-flight pull-to-refresh.
  Existing Discover refresh registration is retained. Cached data survives a
  failed refresh with visible error copy. Initial failure is not rendered as a
  successful empty collection.
- Expired cached editions are no longer presented as upcoming. Calendar-day
  presentation updates at UTC midnight, matching the existing API, and on
  returning to the foreground without polling the server. Past editions remain explicitly labelled. Distinct
  official announcements supplied by the existing response are shown separately
  before listed provider editions, without turning an announcement into a
  ticketed event or attendance target.
- Unlisted lineup data is not described as globally unannounced. No catalogue
  freshness timestamp or guarantee of complete coverage is invented.
- Detail reads are scoped to the current account, not merely signed-in status.
  Guest rendering hides private plans. Attendance editing and sharing use the
  current identity/lifetime guard; save/remove are single flight and cannot
  overlap manual refresh. Edits are held while a command is pending. Save
  requires the actual matching plan receipt; removal uses the existing
  `plan: null` response contract. A missing receipt is not converted into an
  invented successful plan. Retired callbacks and account changes cannot send
  or adopt a private plan for a new owner.

## Evidence and limitations

Twenty-four new projection and actual-React tests pass after the final source
review. Coverage includes original image source/credit, missing image,
failed image/retry, retired callbacks, high-scale recovery layout constraints,
canonical card navigation, first-load errors, cached refresh failure, repeated
refresh, current/past dates, official-announcement presentation, guest/account
boundaries, identity-epoch invalidation, save/remove receipts, date-line parity
and the actual UTC rollover/foreground/cleanup hook under StrictMode.
The native views and all reads/writes are synthetic. No genuine account or
production data was mutated by tests. Independent review found no remaining
source blocker, including the final UTC correction and zero-I/O identity adapter.

The identity adapter only delegates to the existing `captureApiIdentityCheck`
owner. It does not issue `/api/me` or any other request, add an identity owner,
subscribe, persist state, or change the existing festival request contracts.

Validation chronology:

- Before the final UTC-only correction, `TMPDIR=/tmp npm run check` passed all
  8,378 tests, 923-file syntax check, architecture check, server dependency audit
  (zero reported vulnerabilities) and web export/budget (510.0/512.0 KiB gzip).
- The initial check without `TMPDIR=/tmp` hit six fixture-startup failures from
  the existing macOS temporary-directory guard. Both logs are preserved; the
  successful rerun did not change those fixtures or weaken assertions.
- iOS and Android exports succeeded before the UTC correction. Their sourcemaps
  confirmed iOS-specific festival resolution and unchanged shared Android
  resolution. This is bundle evidence, not a native Release build or device test.
- Final UTC-source focused tests pass 24/24, and the architecture check and
  whitespace check pass. The coordinator will run the final integrated aggregate
  sequentially; no additional isolated native export is required for this scope.
- A second aggregate was already running when the coordinator requested no
  further expensive isolated reruns. Its exact completion result is retained
  separately in the handoff; it does not replace integrated validation.

Read-only GET of the production festival endpoint returned HTTP 403 and was not
retried by another route. Current production dates, available photo fields,
image-server delivery and rights were therefore not independently verified.
Displaying/retrying an existing credited URL is not proof that every live
festival has an image or that ingestion refreshed. Missing source content remains
a content limitation, not something these presentation changes fabricate.

This candidate does not restore embedded venue street maps. That is a separate
native-map scope. No provider credentials, permissions or dependencies changed.
Final physical layout, VoiceOver, image delivery and gesture behavior remain
pending after the owner's phone update and explicitly permitted device checks.
