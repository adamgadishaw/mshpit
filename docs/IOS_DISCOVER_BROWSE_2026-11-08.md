# iOS Discover Browse

## Scope

`DiscoverScreen.jsx` retains all existing data loading, filtering, cancellation,
refresh, pagination, account isolation and navigation callbacks. Only iOS enters
`DiscoverBrowse.ios.jsx`; the other-platform entry is inert and the Android/web
render tree is unchanged. iOS starts with cards; Android retains its list default
and web retains its cards default.

The new presentation uses a large system title, horizontal category navigation,
swipe-snapping featured images, artist/genre rails, quieter show controls and
44-point-or-larger controls. It has no automatic carousel advance or broad
screen gesture capture. Titles grow with Dynamic Type rather than truncating.
Actual upcoming show artwork comes from the existing eligible-media projection;
when none is available the hero displays real catalog artists and labels them as
artists, never as upcoming shows. Event credit metadata still travels to details.
Image errors retain an initials fallback and are isolated to the failing URI.

All six categories, area/date selection, weekly lists, artist search, recent
attendance, personalized recommendations, venue/city/festival/photo components,
crew, fan clubs, top-rated shows and lounges keep their established owners.
Choosing a genre foregrounds its results, with an explicit All artists recovery.
No new dependency, account mutation, signing change or production write is used.

## Verification

- The exact Expo SDK 57 reference and SDK 57 Image documentation were reviewed.
- Babel parses all three implementation files.
- Final focused Discover cohort: 117 passed, zero failed (13 new iOS component
  tests plus existing discovery, navigation, refresh and media regressions).
- A read-only baseline comparison verified the shared DiscoverScreen is
  byte-identical to HEAD after removing the isolated iOS import, return branch
  and card-view default. `git diff --check` passes.
- `DiscoverBrowse.ios.test.mjs` executes the real compiled presentation against
  isolated host components. It covers routes, data and credit handoffs, region and
  genre controls, image failures, large text, weekly lists, search, refresh,
  recent attendance and native horizontal-scroll configuration.
- The existing source-level navigation regression now checks the unchanged
  Android/web render independently from the conditional iOS destination slot.
- Simulator presentation and whole-project platform exports are owned by the
  integrating task. Focused tests do not certify physical-device rendering,
  VoiceOver or full release readiness.

Focused tests can run with `node --test src/components/discover/DiscoverBrowse.ios.test.mjs`.
