# iOS scrolling page titles — 2026-11-10

## Behavior and scope

- Feed and Discover retain their large heading above the fixed filters, activity buttons, and area controls. The heading's measured height collapses with the primary scroll offset, with a small upward movement and fade. Returning to the top restores it.
- Feed filter panes retain independent native offsets. Preview and parked panes cannot publish their offsets into the current heading. Promoting a retained pane restores its heading state without a synthetic scroll command.
- Search and Menu already place their large headings in scrolling content. They use the same fade/movement without changing content height.
- You retains the profile action row. Only the large title fades/moves; its row remains available for profile actions. Compact back/navigation headers and inline section headings are unchanged.
- Dynamic Type uses measured natural title height, rather than a fixed animation range. VoiceOver keeps the heading visible; Reduce Motion removes extra fade/parallax while retaining direct layout response to scrolling.
- Fixed headings stay expanded when content has less than twice the title height of extra scroll range. This ensures that the growing viewport cannot clamp the native offset and repeatedly reopen the heading. A 60-point heading with an expanded 500-point viewport requires at least 620 points of content.

## Implementation

`NativeLargeTitle.ios.jsx` owns shared measurement/offset values and the animated heading. `NativeTabScroll.ios.jsx` observes the primary native scroll node through Reanimated 4.5.1 `useScrollOffset`, separately from existing callbacks. Original scroll, drag, restoration, refresh and pagination callbacks remain attached. The wrapper forwards the native ref and GestureDetector's injected `collapsable` prop. Horizontal rails, nested scrolls, and the Discover area picker do not drive the page heading.

The default `NativeLargeTitle.jsx` entry returns its children unchanged when no wrapper style is requested. Android/web retain their existing native scroll exports and receive no new scroll props.

Required references read before code:

- https://docs.expo.dev/versions/v57.0.0/
- https://docs.expo.dev/versions/v57.0.0/sdk/reanimated/
- https://docs.swmansion.com/react-native-reanimated/docs/scroll/useScrollOffset/

## Verification

The actual React runtime harness in `NativeSwipeRail.ios.test.mjs` covers:

- zero/half/full collapse, negative bounce and restoration at the top;
- short-content eligibility and viewport changes caused by the title itself;
- retained Feed filter offsets and hidden-pane event rejection;
- title height remeasurement and live Reduce Motion / VoiceOver preferences;
- in-flow and reserved-row title geometry;
- original event identity, callback/ref pass-through and scroll-source exclusion;
- RNGH native attachment forwarding;
- installed Expo 57 worklet compilation and Metro platform isolation.

137 tests in that suite pass. The final combined targeted run (with Feed accessibility, profile/search presentation and DiscoverBrowse tests) passed all 198 tests. Root orchestration owns the full-suite and production export results.

This is deterministic runtime/build verification, not an iPhone visual or frame-timing measurement. No device, install, push, or deployment action was performed.
