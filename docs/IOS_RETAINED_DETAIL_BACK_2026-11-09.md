# iOS retained detail-to-detail Back

## Candidate and release boundary

Local review branch `ios/retained-detail-back` starts from the verified Feed-only
commit `48d3bd87c13c3733a51dba48f825633db7abe064`. That commit and the main checkout
at `942e1f3` remain intact. This candidate has not been pushed, merged, deployed,
installed, launched or tested on the phone. No dependency, native project,
signing, API route, database or backend changes are included.

The inherited combined-runtime hold still applies: the scoped-read notification
backend must reach every serving instance before publishing or installing this
combined client. This work does not authorize that rollout. `8060121` remains
the separate preserved Discover-only retest candidate.

The audited retained families are Artist, member Profile, Show and Post. A chain
of these can reveal its actual immediate previous page while the top page follows
the finger. Existing direct Feed reveal is preserved. Other routes keep the old
fallback, and protected forms/account flows break retention. This does not claim
live previous-page reveal throughout every route in the app.

## Why this approach

The app uses custom Root overlays, not an installed native navigation stack.
Its installed runtime is Expo SDK 57, React 19.2.3 and React Native 0.86.3.
React Activity hidden mode hides the native view and disconnects effects; making
it visible can restart effects and reset existing screen state. Expo's
navigation-aware Activity integration is experimental and requires SDK 58 or
later. `react-freeze` is not installed and freezing alone is not an effect or
privacy boundary. Introducing a native stack would be a separate migration,
not a safe unreviewed shortcut in this patch.

Sources checked against the installed runtime:
- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/)
- [Expo React Activity integration](https://docs.expo.dev/router/advanced/react-activity/)
- [React 19.2 Activity behavior](https://react.dev/blog/2025/10/01/react-19-2)
- [React Navigation screen lifecycle](https://reactnavigation.org/docs/navigation-lifecycle/)
- [Apple interactive transition guidance](https://developer.apple.com/library/archive/featuredarticles/ViewControllerPGforiPhoneOS/CustomizingtheTransitionAnimations.html)

The installed React Native renderer was also inspected for hidden native views,
layout/passive effect disconnection and reconnection. These findings justify
explicit bounded live ownership rather than snapshots or hidden reconstruction.

## Retention and ownership contract

- At most six actual detail occurrences are mounted. Duplicate targets have
  distinct occurrence identities. Capacity eviction does not change logical
  navigation history.
- A backdrop must be the exact previously committed, presented, currently ready
  immediate predecessor. A deep link does not create unseen old pages; a lazy
  screen never presented, or one disconnected by Suspense, is not reconstructed
  or allowed to finish first mounting hidden.
- The current page receives fresh Root props before new input admission. An
  inactive occurrence keeps only its last committed raw JSX and local component
  state. It still receives live Store/context updates, not a frozen Store copy.
- Planning does not mutate committed retention. Abandoned concurrent renders
  cannot replace old callback props or evict a committed occurrence.
- Covered pages have no touches or accessibility exposure. Native dialogs,
  links, media, speech, refreshes and queued callbacks require current command
  ownership. New screen-owned work pauses on cover, app inactivity and obstructions.
  An already admitted shared ProfileHistory read may finish its authoritative
  cache receipt while covered; another foreground occurrence may share that same
  request. Cover does not cancel that other consumer, start pagination or polling.
- Every layout admission gets a new immutable lifecycle token. The actual inner
  route Suspense boundary tracks connectivity and a layout generation. An old
  callback cannot regain authority after the same native page reconnects.
- Lifecycle/read ownership is separate from command privacy ownership. A known
  authoritative denial or already accepted write receipt can settle for its
  still-current occurrence. Privacy changes immediately retire queued commands,
  including before React rerenders. Successful private reads require their own
  privacy proof; denial paths must not be turned into automatic reload loops.
- Covered mounts are evicted when the privacy generation changes. The active
  mount is not restamped as newly safe, so later navigation cannot reuse its old
  payload as a retained backdrop. Live active projections also remove withdrawn
  posts, blocked authors and removed photos; covered eviction alone is not enough.
- Sensitive account/auth flows clear supported detail content rather than
  remounting it through the unmanaged fallback. Account-link activity has a
  synchronous predicate in addition to rendered state.
- Already accepted writes may finish their exact receipt reconciliation after
  departure. They cannot dismiss a successor, issue stale success speech, clear a
  newer draft, or start another external/native action.

## Implementation areas

- Root `NativeDetailStack`, its pure retention planner, and the iOS presentation
  context retain real keyed occurrences. The default platform component is inert.
- Artist/Profile/Show/Post iOS screens and their resource/component variants
  preserve settled data, expansion state, draft text and native scroll identity
  without continuing hidden effects. Default screen implementations are preserved.
- Narrow Store privacy notifications use the iOS adapter. Default platforms do
  not acquire the retained-screen behavior; Store hook counts stay unchanged.
  Bounded account/target denial claims prevent an older successful read from
  restoring a newer quarantined Profile. Private histories, concert detail,
  comments, reviews and Crowd reads distinguish authoritative denial from
  transport failure, publish revocation across retained occurrences and expose
  deliberate retry without privacy-triggered request loops.
- Shared iOS Ticket, News, media, keyboard, refresh and share descendants carry
  immutable ownership through real controls and delayed native continuations.
- Tests execute the actual App Root JSX and Back callbacks with real stack,
  presentation, gesture, Post, Ticket and keyboard components. They complement
  isolated resource/domain tests rather than assuming that green stubs prove
  composition.

## Validation status

Independent source review is complete with no remaining demonstrated correctness
or privacy blocker in this four-family rollout. Its final independent runs
passed 164/164 core/planner/share/Artist/EventReviews/profile-fence cases, 65/65
private-resource/comment/Profile/Show cases, 25/25 final concert/resource cases,
and 9/9 Artist photo producer cases. These are overlapping focused matrices, not
an aggregate total. The parent also independently passed 238/238 affected core
and legacy navigation/Feed/Ticket/share cases before the final private-resource
corrections.

The complete final check chain passed on the frozen source on November 9:
`split:catalog`, **9,033/9,033 tests** (zero failed, skipped or cancelled),
dependency audit (zero vulnerabilities), syntax (929 Node files), architecture,
production web export/budget, Render Blueprint validation and whitespace checks.
The test phase took 438.7 seconds. The chain exited 0 at 17:01:27 UTC.

This is the same check sequence as `npm run check`, with its test phase run using
the repository-supported `npm test -- --test-concurrency=1`; Blueprint validation
is additional. It is not a claim that the default-parallel invocation passed.
Architecture remains at 144/144 Store hooks, including 47/47 state hooks, with
all existing architecture ratchets unchanged. Source hashes remained fixed
through validation. Passing these local gates is not release approval.

The unchanged web initial-JavaScript limit is 524,288 gzip bytes. The first
candidate export exceeded it by 1,060 bytes. Platform-specific hooks/screens and
scalar conditional service bindings corrected the overhead, with the latest
final export at **524,206 / 524,288 bytes gzip** (82 bytes below the limit).
The web common chunk matches the verified baseline; eleven default Artist
modules are byte-identical. No budget, minifier, architecture rule or dependency
was changed.

Final iOS and Android Hermes production exports pass after all corrections.
All 67 expected changed iOS runtime modules match their exported source content
exactly. All 82 web source maps and the Android map exclude iOS-only
implementations. All 48 existing default/native counterparts remain byte-identical
to `48d3bd8`. All 1,622 frozen source-manifest entries still match after the
complete check chain and final exports. No frozen runtime/test source changed
during final validation.

The first broad test run during implementation found obsolete Root extraction
and hook-loader fixture wiring alongside the new privacy regressions. The
fixtures now execute the appropriate production Root/iOS modules, retaining
existing behavior assertions and exact default-platform comparisons. No test is
excluded from final acceptance. As in the verified Feed-only candidate, final
acceptance runs the repository-supported serial test option, not an asserted
passing default-parallel run.

## Maintenance and remaining native acceptance

Platform siblings deliberately keep the default screens/resources unchanged.
Future shared bug fixes must be ported to both implementations where applicable;
this patch does not pretend that duplicated screen/resource code is free of
maintenance cost. The iOS history hook and Store mutation bindings must continue
using the same account-scoped singleton.

Synthetic React/native-recognizer tests establish ownership and host identity,
not iPhone frame pacing, exact gesture geometry or VoiceOver behavior. No native
Xcode build, simulator run or physical-device acceptance is claimed.

When separately authorized and safe, verify nested Profile → Artist → Show →
Post chains, repeated duplicate targets, native scroll and draft continuity,
short cancel/reversal/commit, modal and keyboard focus departure, old callbacks,
background/resume, Reduce Motion, VoiceOver, account changes, blocked/withdrawn
content, deep links, protected route barriers and capacity eviction. Confirm an
old page's own input loses first responder without dismissing a successor input.
