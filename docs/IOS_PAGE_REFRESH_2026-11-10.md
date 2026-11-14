# iOS server refresh and Feed counts, November 10, 2026

Local candidate based on 942e1f3. No phone interaction, installation, upload, or
production mutation is part of this work. The notification freshness/API slice
must be integrated separately before calling the count refresh end-to-end ready.

## Findings and changes

The Feed already had a refresh handler but VinylRefreshBoundary wrapped
FeedReturnProvider rather than FlatList. The boundary cloned its direct child,
so the native refreshControl prop stopped at a React context provider and never
reached the actual scrolling list. Moving the provider outside the boundary
repairs that propagation without remounting the list or replacing its callbacks.
The same nesting also prevented the web boundary's scroll-owner marker reaching
the real list.

Every iOS Feed filter now awaits its own content read and the optional
onRefreshCounts server read. The notification slice supplies that callback; it
returns latest Activity and an authoritative accepted-Inbox unread total without
marking notifications/messages read. iOS News also refreshes its visible top-story
strip. Failure of either source leaves existing rows and exposes the retry error.
The actual server-owned loaders remain responsible for response validation and
account isolation. There is no new timer or automatic full-feed reload.

Refresh admission checks the current visible/read-enabled presentation, not just
a callback's captured boolean. Hidden previews, retained departed screens,
account changes and superseded presentation callbacks cannot begin new reads.
The existing abort/request identity checks prevent an outgoing response clearing
the next account's spinner. Repeated gestures join the current visual latch;
errors and cancellation settle it without unhandled rejections.

The fixed iOS Feed heading now contains separate Notifications and Messages
buttons, 48-point targets, dark-red rounded count boxes and a visual 99+ cap.
Zero hides the box; accessibility labels keep the full valid integer total.
Counts come only from the existing unread/notifUnread props, not visible rows.
The default/web Feed header and Android UI are unchanged.

The iOS-specific refresh boundary reuses the website's grooved vinyl/amber-label
visual in native views. UIKit still owns the gesture, pull threshold and inset.
The small record is drawn in the empty pull-down gap and disappears when that
gap closes, with no second scroll container or layout-changing header. A short
scale pop and 900ms rotation use non-interactive native animations. Reduce Motion
and app backgrounding stop decorative animation. No minimum delay is added to
network completion. Existing scroll callbacks, refs, list data and styles remain.

## Covered surfaces and exclusions

The boundary propagates the vinyl treatment to existing server-backed refresh
owners: Feed, Search, Discover, Profile/You, Activity, Inbox, message Thread,
Calendar, Post, Show, Artist, Artist archive/gallery, Venue/Venues, Cities/City,
Nearby, Tour archive, Follow lists, Fan clubs/Fan club, Lounge, Top Rated, Clips and Admin.
Their existing scoped loaders are reused; no claim is made that every one was
visually exercised in UIKit. Feed is the confirmed missing native gesture fix.

Festival hub/details already have native RefreshControl plus bounded server
reloads and retain the system indicator in this slice. Login/onboarding, settings,
compose/edit forms and other static or draft-owned screens are not given a pull
that would discard user input. Initial error states keep their explicit Retry.

## Verification and remaining gates

- 189 focused tests pass, including the actual iOS boundary + real React context
  provider + FlatList composition, data read/failed-read retry, retained row/list
  identity, late account result isolation, hidden/read-permission round trips,
  all four Feed filters awaiting fresh counts, unread normalization/99+ rendering,
  live Reduce Motion/background cleanup and existing navigation/return tests.
- Initial full suite: 8,672/8,673 passed. The sole failure was an obsolete source
  assertion expecting inline await rather than awaited Promise.allSettled; that
  assertion now checks both server callback and awaited request batch and passes.
  A pre-integration rerun passed 8,676/8,676; the final wrapper-lifetime regression
  adds two passing focused cases. Final combined gates are tracked separately.
- Initial iOS, Android and web offline exports compiled successfully. The platform
  source-isolation gate passed for Android plus all 82 web maps. Architecture
  check passed. Initial web budget: 524,013/524,288 gzip bytes (275-byte headroom).
  Final combined runtime requires fresh export/budget checks after integrating
  notification wiring and the later admission-guard review fix.
- Physical UIKit overscroll placement, animation appearance, VoiceOver spoken
  behavior, largest text sizing and final integrated phone runtime remain open.
  Synthetic native primitives and source maps do not certify native visuals.

The user's phone has not received this local candidate. No user data was used
for synthetic likes, notifications, messages or read receipts.


## Final combined verification receipt

The separately reviewed notification candidate 941a42b was cherry-picked after
refresh commit de3678d, producing combined runtime 197c559da3aa79f1fa1475832fd81713cd88328d.
No runtime source changed during the following final checks:

- Complete hermetic serial suite: 8,685/8,685 passed, zero failures/skips,
  490.127 seconds. Command: node scripts/run-tests.mjs --test-concurrency=1.
- Offline Expo SDK 57 export: iOS, Android and web all succeeded, output
  .tmp/combined-197c559 (EXPO_NO_DOTENV=1, EXPO_OFFLINE=1, CI=1, two workers).
- Web budget: 524,094/524,288 gzip bytes, 194 bytes remaining; paused-player
  labels absent. The budget was not raised.
- Android plus all 82 web source maps passed the iOS-export isolation gate.
- Architecture gate passed at existing ceilings. Syntax passed 929 Node files.
- git diff --check passed. Independent refresh and notification reviews found
  no remaining implementation blocker after the stale native callback repair.

Hermes artifact SHA-256 values:
- iOS index-0b4cdcda0cdfaf31a39f80d630a8a7e4.hbc:
  b81b10eb5c67dba6c4a6c8e6eda7f47547a124a44ae966f695843ba8e7a57455
- Android index-a8891b102cf263e0605c4900cf86a090.hbc:
  58f8302dcb8b74c970794e73d6c65fc1860552910532427751b6534e156e518e

These are JavaScript export artifacts, not a signed/native app or install receipt.
Server-first rollout/contract verification and authorized native visual/accessibility
acceptance remain required. No release, live mutation or phone interaction occurred.
