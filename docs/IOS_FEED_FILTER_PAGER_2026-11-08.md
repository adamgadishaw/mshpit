# iOS Feed-filter pager checkpoint · 2026-11-08

## Corrected target

Horizontal paging belongs to Feed’s **Following → Local → For You (`everyone`) → News** strip. Main Feed/Search/Discover/You navigation and the app header are tap-only. The previous main-tab pager checkpoint in `IOS_CONTENT_PAGE_SWIPES_2026-11-08.md` is superseded for gesture routing; its uninstalled build is not the release candidate for this correction.

## Implementation

- `874aa01` adds the local pager. One committed filter owns persistence. A deliberate drag mounts at most one real neighboring page; its normal read begins during the gesture. Cached For You/Local rows remain Root-owned; Following and News use their normal loaders.
- The Feed heading and strip stay fixed, with their existing iOS content inset. Incoming/outgoing content moves together. Cancel retains the source; commit promotes the same incoming instance without restarting its in-flight read. Explicit filter taps retire pending gestures.
- Previews cannot save the filter/return snapshot, autoplay, qualify impressions/dwell, paginate, or run conversion polling. Promotion begins a new viewability interval. Route/account/authorization and accessibility interruptions retire pending work.
- iOS Feed drag does not dispatch social mutations. Explicit reaction buttons, native long hold, horizontal media ownership, vertical scrolling, and guarded detail Back remain separate.
- No idle neighboring reads or retained multi-filter page cache. Android/web retain their default paths.

## Verified locally

Implementation focused cohort: **194/194 passed**. Directly affected source/component cohort: **287/287 passed**. Independent functional review: **153/153 passed**. Fixtures execute the actual React pager/Feed, Following/News hooks, queued UI promotion, and installed React Native viewability logic with synthetic services and gestures. These counts overlap and are not a full-suite result.

## Integrated release and phone verification

Exact runtime **9f8d59a** passed **8,524/8,524 tests**, with zero failures, skips or cancellations; server-production dependency audit; syntax/architecture checks; web, iOS and Android exports; source-map isolation; and a development-signed Release build. Web initial JavaScript is **523,540 / 524,288 bytes gzip**. This does not clear native dependencies or certify runtime platform parity.

The first integrated phone build, `8acc6cd`, passed its 8,523-test suite but displayed a blank Feed body. Actual installed React Native 0.86 no longer exports `StyleSheet.absoluteFillObject`; the pane therefore lost its absolute bounds. `9f8d59a` replaces two iOS style references with supported `absoluteFill`. Its regression fixture executes the installed StyleSheet export; an independent Yoga probe reproduced the zero-height failure and corrected geometry. The final full suite includes that regression.

On 2026-11-09 UTC (November 8 Toronto), `9f8d59a` was installed in place and launched on the physical iPhone 16 Pro Max, iOS 27.2. Actual screenshots confirm the four-filter heading and populated Feed cards/media. Existing session/data remained; no uninstall/reset or synthetic live mutation was performed. The earlier signed preview remains preserved.

The exact app, all-file manifest and receipt are preserved under `.tmp/ios-phone-checkpoints/flagship-9f8d59a/`. Independent audit verified all 52 files, signing and embedded supported-style code. Relative to `8acc6cd`, only JavaScript, executable and signature resources changed; Info.plist, provisioning profile and all 11 privacy manifests are identical. Full test/export logs use `/tmp/mshpit-feed-pager-9f8d59a-`; the signed build log is `/tmp/mshpit-feed-pager-bounds-build.log`.

## Remaining physical acceptance

Device Hub live screenshots and accessibility window controls worked, but coordinate taps/drags failed with `noWindowsAvailable`, including in a fresh independent session. The Mac and phone were unlocked. No phone lock or permission was bypassed. This blocks actual incoming-page motion, cancellation, footer interaction and native gesture arbitration verification; none is claimed passed. User feedback clarified cancellation already worked in the prior build, so it is retained rather than described as a reproduced broken behavior.

On the physical iPhone verify and capture: real destination posts arriving before release; cold/slow/loading/error states; short/reversed/canceled/multi-touch swipes; repeated rapid gestures and explicit taps; carousel-versus-page and vertical-scroll arbitration; all four filter directions; drawer/detail/gallery/account interruptions; VoiceOver and Reduce Motion; large Dynamic Type and stable heading/strip/content insets. Confirm explicit reactions and long hold without invoking live mutations. Separately inspect profile/detail Back and compact post footer. Source fixtures do not certify native recognizers or final pixel layout.
