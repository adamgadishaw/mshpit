# iOS content page swipes

## Scope

Base: d02c177. No device install, backend mutation, deployment, dependency installation, or neighboring-page data prefetch is part of this change.

Main Feed / Search / Discover / You content now follows horizontal finger travel with a restrained perspective slide (maximum 4-degree rotation, up to 2.5% scale change, subtle shadow). Release commits by distance or a same-direction flick with minimum travel. Cancellation and reversed releases spring home; outer tab boundaries resist without wrapping. A quiet adjacent-tab title appears on the backplate, not a fabricated screenshot. Incoming content settles from the opposite side after navigation. This is staged outgoing/incoming 3D slide motion, not a live neighboring-page preview or a literal paper-fold renderer.

The existing rail buttons, media viewer, detail Back gesture, and guarded route dispatch remain. Page gestures reserve 24pt on both screen edges. iOS-only components own the implementation; default primitives re-export React Native unchanged for Android/web.

## Arbitration and protected regions

NativeTabScroll gives main vertical ScrollView/FlatList gestures an explicit simultaneous relationship with the page pan. Horizontal controls and text inputs attach a passive Manual observer directly to their native host, without a layout wrapper. The observer never activates; on native touch-down it excludes the parent page swipe, retains observation through release/cancel, and leaves descendant control actions to their own recognizers/responders.

Covered regions: Feed news and suggested-person rails; Search field/filter/city rails; DiscoverBrowse main vertical scroller, artist/venue/filter/programme/week/genre/festival rails and inputs; You memory rail; post media/footer actions; profile banner/gallery/concert map; Discover SwiftUI venue map and photo programme. Detail and standalone media overlays are outside main content detection. No social mutation is added to a page swipe.

Owner epochs retire queued work and animation completion on route/presentation changes, Suspense disconnect, unmount, VoiceOver and app inactive/background intervals. Reduce Motion changes retire motion and restore identity transform. Accepted completion is single-use. A declined route callback restores and rearms only after its recovery spring, fencing subsequent drags until then.

## Automated evidence

Exact Expo 57 gesture-handler documentation read: https://docs.expo.dev/versions/v57.0.0/sdk/gesture-handler.md. Installed RNGH ~2.32 matches that release.

Focused page/rail/policy suite: 83 tests pass, independently rerun. Tests use actual React and production callbacks with synthetic native gesture/animation schedulers; they do NOT establish physical gesture arbitration or frame quality. Targeted existing screen/control tests also run, including retained Feed anchor/gallery identity, account/permission changes, Search speech and Profile media/concert state. Syntax and architecture gates pass. Full combined release/export/build gates belong to integration, not this isolated branch.

## Required physical gate before claiming completion

- Swipe both ways on all four pages; short/canceled/reversed drags return cleanly, fast flicks commit, boundary tabs do not wrap, second touches cannot strand a page.
- Inspect outgoing movement, backplate, incoming settle, frame smoothness and readability. Feed↔Search crosses the retained-Feed host boundary and needs explicit checking.
- Vertical feed/list scrolling, pull-to-refresh, momentum and horizontal carousels retain intended control. Check actual horizontal ScrollView dimensions and profile/map/gallery sizing.
- Search/Discover text selection and keyboard controls, native map pan/zoom/select, media open/play/scrub, footer gestures and stationary post long-press must not change tabs.
- Open/close retained Feed gallery, drawer and detail during/after a swipe. Check the 24pt Back edge on details.
- Background during release and resume; toggle VoiceOver and Reduce Motion mid-drag; verify stable page, no stale navigation, and explicit tabs remain reachable.
- Confirm Android/web exports retain behavior and budget. No physical pass is implied by JavaScript tests.
