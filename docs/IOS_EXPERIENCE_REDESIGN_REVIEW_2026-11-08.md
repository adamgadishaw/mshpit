# iOS experience redesign review

This is the dated initial visual-review checkpoint, not the current release
receipt. See IOS_FLAGSHIP_HARDENING_2026-11-08.md and
IOS_RELEASE_QUALITY_GATES_2026-11-08.md for later fixes, signed artifacts and
remaining native acceptance. Any early zero-vulnerability npm audit statement
below describes the server-only production dependency audit; it does not clear
mobile dependencies or native Pods. The dated native decoder review preserves
the separate unresolved advisory and path-specific mitigation limits.

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

## Accessibility continuation and phone update

The owner requested continued accessibility work and installation of the updated
iOS app on the connected iPhone, preserving the existing app identity and live
Mshpit backend. This is not authorization to deploy the website or Android app.

Additional iOS-only fixes:
- Large-text navigation reflows without disabling font scaling; header and
  drawer branding stay within the available width.
- Profile actions, stats, favorites and upcoming shows reflow for larger text.
- You subscribes to live size changes and adjusts memory-card width/actions
  while preserving the selected memory and stable content keys.
- Discover section actions stack below large headings. Feed onboarding labels
  wrap within their buttons.

The full suite passed 7,119 tests with zero failures/skips/cancellations. Syntax
and architecture checks passed, and git diff whitespace checks remained clean.
Tests include scale changes 1 to 2 to 3.1 and back to 1 without state resets.

VoiceOver was enabled in the simulator and the app and menu were opened.
Device Hub intermittently stopped exposing descendants and reliable activation,
including on Apple's own Settings pages, so spoken-focus/navigation certification
remains incomplete. No speculative modal-ownership change was made. The original
simulator VoiceOver-off preference was restored and read back as false, followed
by a simulator restart. The physical phone's settings were not changed. Runtime
Reduce Motion, physical shelf gestures and live physical Dynamic Type still need
hands-on review; their existing logic/guards were not described as runtime-proven.

The signed physical-iPhone Release build from source commit 20c4be7 completed
successfully. Strict deep signature verification passed on the build and its
preserved copy. It retains com.mshpit.app.dev and the existing signing team.
The generated Info.plist remains version 1.0.0, bundle version 1 despite the
command-line build-number request; it must not be described as version/build 2.
Its fresh bundled JavaScript is 9,594,436 bytes, SHA-256
887fd910035cf7c39271931a6bcd7de8889f48ed5ecffa9d1a74e17bba4b8441.

The owner needed their phone before installation. No install or launch of the
updated physical build was attempted. The signed app and receipt are preserved
under ignored .tmp/ios-phone-checkpoints/redesign-build2; this directory name is
a checkpoint label, not the app's CFBundleVersion. The previous local build is
also preserved in a verified zip. Wait for explicit reconnection before install.
No website/Android deployment, push, merge, TestFlight submission, new signing
permission or production-content write occurred. The test simulator was shut
down after restoring VoiceOver, and Device Hub keyboard capture stayed off.
