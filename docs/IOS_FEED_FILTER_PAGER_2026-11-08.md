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

## Remaining release checks

Full combined checks and platform exports/builds belong to the integration gate. No device build or installation was performed by this implementation task.

On the physical iPhone verify and capture: real destination posts arriving before release; cold/slow/loading/error states; short/reversed/canceled/multi-touch swipes; repeated rapid gestures and explicit taps; carousel-versus-page and vertical-scroll arbitration; all four filter directions; drawer/detail/gallery/account interruptions; VoiceOver and Reduce Motion; large Dynamic Type and stable heading/strip/content insets. Confirm explicit reactions and long hold without invoking live mutations. Separately inspect profile/detail Back and compact post footer. Source fixtures do not certify native recognizers or final pixel layout.
