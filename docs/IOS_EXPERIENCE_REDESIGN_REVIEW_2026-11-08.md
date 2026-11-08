# iOS experience redesign review

## Scope and isolation

This change is a local review checkpoint for the iOS app. It builds on cce58fa
and preserves the existing local-test connectivity fix. Android and web retain
their original screens and styles. iOS presentation uses .ios components or
explicit Platform.OS gates. Shared account, feed, catalogue and moderation data
flows remain in their existing owners. No backend, signing, account permission,
production deployment or store-submission change is included.

## Delivered

- Discover: large system title, area selector, image-led featured cards,
  horizontal artist/genre shelves, and all six browse categories. Existing
  event sourcing, credits, filters, recovery states and detail callbacks remain.
- Feed: one page title, quieter filters and posts, smaller people suggestions,
  and secondary destinations moved into a closable side drawer. Larger text
  wraps filters into two columns and widens suggestion cards.
- Navigation: four visible destinations, large touch controls, tab-rail swipes,
  and an explicit left-edge Back gesture on read-only detail routes. Horizontal
  content and media do not inherit a broad parent pan recognizer.
- Profiles: coherent banner/avatar/name block, readable biography, clear
  follow/message controls, native action sheets and quieter content sections.
  Empty-banner profiles use a short accent area rather than a large blank box.
- You: private concert memories, personal diary, favorite nights, upcoming
  shows and account tools. Private memory children remain guarded by isSelf.

The drawer preserves the originating feed instance and scroll state while
pausing its exposure/media work. Its routes remain permission-filtered. It
supports explicit close, scrim dismissal, accessibility escape and focus return.

## Gesture safety

Post comments, artist reports, show-ticket notes and festival-plan editors have
unsaved local fields, so those routes deliberately retain explicit Back instead
of the new generic gesture. Logging, settings, authentication, media, moderation
and other editors are also excluded. VoiceOver disables custom gesture strips.
Reduce Motion avoids the interactive page translation.

Simulator testing found that release translation can reset to zero; Back now
tracks absolute coordinates from the original touch, as the existing native
swipe rail does. Tests cover that case, cancellation, short/vertical gestures,
multi-touch rejection, movement clamping and protected routes.

## Actual simulator review

Used iPhone 18 Pro / iOS 27.2 with the existing Debug development client and the
loopback-only, outbound-blocked persistent test backend. Alex Rivera and Jamie
Chen are synthetic local accounts. No production test writes were made.

Observed:
- Feed, Discover, own You and public Profile rendered and inspected.
- Drawer open/close restores Feed; underlying controls disappear from the
  accessibility tree while the modal is open.
- Own account and public-profile native menus open and Cancel dismisses.
- Public profile has no private memory cards or owner-only toolbar.
- Vertical profile scrolling, explicit Back, actual left-edge profile Back,
  and tab-rail swipe from Feed to Search work.
- Discover artist cards open their correct artist destination.
- Larger-text fresh rendering checked at accessibility-large for Discover,
  Feed and You; Feed's cramped filters/cards were corrected and rechecked.
- Simulator text size restored to large. Device Hub keyboard capture is off.

Screenshots are in the ignored .tmp/ios-redesign-review folder. They are QA
fixtures, not production user content. The fake review ratings are unseeded and
show zero; they are not evidence of a production rating regression.

## Remaining release checks

This is not an App Store/TestFlight certification or a newly signed native
binary. A physical-device pass is still needed for horizontal shelf gestures,
VoiceOver focus order, Reduce Motion and the complete real-content experience.
One automated carousel drag opened its card instead of conclusively proving
horizontal paging, so that interaction is not claimed as runtime-verified.

Changing the simulator's Dynamic Type setting while the development client was
already rendered produced stale text-layout clipping; a fresh render/relaunch
measured correctly. This live-setting-change case remains to be checked on a
physical device/release build. It was not hidden by disabling font scaling or
by resetting app state whenever text size changes.

No claim is made that every secondary screen has been redesigned. Search,
artist details, venue/event details and authoring workflows retain their existing
content presentation, with the iOS navigation shell where applicable.

## Verification records

Final sequential validation passed:

- 7,112 tests, zero failures, skipped or cancelled cases.
- Syntax: 920 Node files. Architecture baseline: unchanged and passed.
- iOS Hermes export: index-876aa6b3fcb2d875b0ccb45a0b0d9ae9.hbc.
- Android Hermes export: index-c29fd970f438fb028a8b56b1e431a90f.hbc.
- Web production export and budget: 505.2 KiB / 512.0 KiB gzip.
- Dependency audit earlier in this task: zero production vulnerabilities.
- Final git diff whitespace check: clean.

Logs remain under /tmp/mshpit-*review*. No new dependency was added.
