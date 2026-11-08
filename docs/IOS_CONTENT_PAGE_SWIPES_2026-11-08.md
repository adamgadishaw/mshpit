# iOS content page swipes

## Continuous pager revision (integration in progress)

The earlier staged-slide sections below describe the installed eb2ae41 checkpoint, which the owner rejected. They are historical evidence, not the current implementation or acceptance claim.

The replacement iOS pager renders the current page and one real adjacent destination when a deliberate horizontal gesture selects its direction. Both use one continuous full-width track. It does not show an invented screenshot, generic adjacent label or staged blank interval. Destination reads begin during that gesture; there is no idle mounting of every tab. Normal existing read caches are retained, rather than introducing a private screenshot or result cache.

Primary content readiness uses the selected screen/filter's current usable cached data or settled success/empty/error state, not every optional widget. A fast release waits for actual destination layout and bounded primary readiness. After the cap, a real renderable screen can settle with honest loading/retry UI rather than trapping navigation on a slow network. A destination that cannot render is canceled. This cannot guarantee a cold network response before every fast flick.

Preview-specific browse persistence, Search analytics/guest-search recording, announcements/focus and autoplay are gated; Feed does not acquire visible impression/dwell ownership. Profile rewards must wait until selection because that GET can award achievements. Activity/DM routes are not previewed. Existing read-cache fills are not a new preview persistence mechanism.

The same incoming component is promoted on commit and the same outgoing component survives cancel. Absolute tab coordinates stay stable through React promotion; a single epoch-guarded UI worklet rebases origin and drag together. Route/account/auth changes, reader/background intervals and retired gesture/timer callbacks revoke pending work. Reduce Motion avoids page travel; explicit tab controls remain available. Android/web retain their default implementations.

Nested horizontal scroll views now have explicit native recognizers related to their nearest vertical native scroll owner, while retaining exclusion from the page pan. This addresses the observed card-open-on-drag failure, but source tests do not replace replay on the actual phone.

Expanded detail edge Back is documented separately in IOS_DETAIL_GESTURE_EXPANSION_2026-11-08.md. It uses the actual prior route and existing close policy; its outgoing-only animation is not a full previous-detail reveal.

Focused source/React/Worklets tests and independent review pass for the pager. Combined release gates and physical motion/carousel/profile acceptance are still pending. The installed old checkpoint remains preserved and must not be described as the final revised experience.


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

## Installed checkpoint and actual iPhone review (2026-11-08)

Signed source eb2ae41 passed 8,462/8,462 serial tests, server-only dependency audit, syntax/architecture, web budget (522,985 / 524,288 gzip bytes), iOS/Android exports, source-map isolation, Release build and deep/strict signature verification. Independent review verified all 52 artifact files (60,395,881 bytes). Only executable, JavaScript bundle and signature CodeResources differ from db93176; all eleven privacy manifests, Info.plist and profile are unchanged.

Installed in place and launched on iPhone 16 Pro Max / iOS 27.2. Existing account/session remained visible. No uninstall, reset, permission change, production deployment or synthetic post/social action. Ordinary live browsing may emit consented analytics. Activity and DM routes were not opened.

Actual Device Hub review:
- Content drags moved Feed → Search → Discover → You, and You → Discover. Vertical You scrolling worked; the You boundary did not wrap.
- Holding an own-post body opened native Post actions with Edit/Delete/Cancel. Only Cancel was selected. The inert Manage post strip was absent between/after inspected own cards.
- Two populated nested rails failed acceptance: drags on Discover Palace hero and Search London/Paris rail opened the touched detail instead of scrolling. No ticket/attendance action was taken. This is observed under Device Hub input; native recognizer cause is under investigation.
- Staged outgoing/incoming animation showed an empty intermediate capture. Owner explicitly rejected its motion quality. This is preserved checkpoint evidence, not final motion acceptance. Simultaneous incoming/outgoing redesign and nested-scroll correction are in progress.
- Phone left on Search, no modal. Exact private screenshots retained only in ignored checkpoint.

Remote drags/screenshots do not establish frame rate, tactile quality, VoiceOver, largest Dynamic Type, canceled/multipointer gestures, or complete gallery/map arbitration. These remain checks after correction.
