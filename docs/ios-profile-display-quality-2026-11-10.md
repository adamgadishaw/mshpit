# iOS profile display quality: device feedback follow-up

## Diagnosis before changes

The previously shipped banner changes addressed upload encoding and crop selection (see `ios-profile-banner-quality-2026-11-10.md`). They did not alter the avatar delivery policy or native image decode policy.

- `Avatar.jsx` requests `previewSrc` first on every platform, including the main profile identity. At 88 points on a 3x display it asks for a 288-pixel wsrv rendition with JPEG quality 80. That is another lossy conversion of an already sanitized upload. Android shares this delivery code, so this alone does **not** explain a reported platform difference.
- The iOS banner already requests the stored URL, with no blur or dark scrim over its primary artwork. There is no evidence that it accidentally requests the gallery's 720-pixel preview.
- Both avatar and banner enabled iOS-only `enforceEarlyResizing`. Installed Expo Image 57 `ios/ImageView.swift` supplies SDWebImage a `imageThumbnailPixelSize` using the view bounds and `imagePreserveAspectRatio = true` before content-fit processing. This is a fit-inside decode step; a legacy image whose ratio differs from the displayed cover can lose useful crop detail. Exact 3:1 new banners need not exhibit that problem. The change removes this avoidable constraint for the two hero images, while retaining the later content-fit-aware downscale.
- `displaySrc` sends HTTP HEIC images through a JPEG proxy before native decode, although Expo Image supports HEIC on iOS. Main profile images can attempt their own stored native source first.
- Android uses the shared `ProfileScreen.jsx` and a different banner treatment, with a 72-point identity avatar. iOS uses an inset, rounded 3:1 artwork card, an 88-point avatar, an accent-colored ring, and a large view-photo pill over the banner. These are presentation differences, separate from pixel quality.

No production image, source camera file, phone screenshot, CDN response, or phone installation was inspected in this task. Therefore these findings identify concrete avoidable quality loss and presentation differences; they do not establish the precise cause of Adam's existing banner blur. Previously discarded source detail cannot be recreated by a renderer.

## Official reference check

Read the required [Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/) before editing. [Expo Image 57](https://docs.expo.dev/versions/v57.0.0/sdk/image/) documents native HEIC support, the early-resize memory tradeoff, and the separate final downscaling option.

[X's profile guidance](https://help.x.com/en/managing-your-account/how-to-customize-your-profile) recommends a 1500 x 500 header and 400 x 400 profile image. Its upload/edit/save workflow keeps changes user-controlled. The existing app's 1800 x 600 banner output already exceeds that nominal header resolution; increasing it blindly would not establish a fix for this report.

The official search result for [Facebook Page dimensions](https://www.facebook.com/help/125379114252045) describes a circular profile picture and separate cover. The full page returned a blocked login response. The official [Instagram profile-picture help](https://help.instagram.com/557544397610546/) search result describes choosing/uploading a new profile photo; the full page returned HTTP 429. No proprietary rendering, compression, current app screenshot, or exact visual parity is inferred from those limited sources. The familiar broad-cover/circular-avatar hierarchy informs the presentation choice; it is not a claim to reproduce those apps.

## Local changes

- Only the iOS main profile opts into original-source rendering. Avatar tries its stored URL before the existing preview/error ladder. Banner tries native HEIC directly before its existing conversion fallback. There is no new public URL publication or added third-party destination.
- Hero cache identities differ from thumbnail identities. Replacement URI/version still invalidates the prior image, and obsolete native error callbacks cannot advance a replacement's fallback ladder.
- Hero `enforceEarlyResizing` is disabled. `allowDownscaling` remains enabled so the final displayed bitmap uses the view's content-fit dimensions. Ordinary avatars, galleries, feeds, Android, and web retain their existing bounded delivery/decode behavior.
- Main banner spans the profile width at the same 3:1 crop ratio. A decorative 32-point photo glyph replaces the large text pill; the entire banner remains the accessible minimum-44-point tap target. The avatar is 96 points with a neutral background ring. Identity, role, badges, sections and profile operations remain present.
- Owner heading reads “Your posts.” The You/action header is inside the tab's primary scroll content for the coordinated global chrome change; public detail back controls remain fixed.
- Profile name badges consume the badge agent's `displayedProfileBadges` selector. Role/status and the complete earned-badge collection retain their existing semantics.

## Verification and remaining acceptance

63 tests passed with Node 24 across `SmartImage.ios.test.mjs`, `profileMediaIOSIntegration.test.mjs`, and `profileIOSPresentation.test.mjs`. New behavior checks mount the real components and verify direct HEIC/avatar delivery, cache separation, bounded fallback, obsolete errors, original banner vs bounded gallery decode, owner wording, and tab/detail header placement. Existing integration coverage verifies block/removal/privacy changes and retained-screen callback fencing. The profile integration harness now resolves the actual iOS SmartImage instead of accidentally exercising its default-platform counterpart.

Physical acceptance remains: inspect the same stored profile images on iPhone and Android, confirm avatar/banner clarity at native scale, choose and crop a fresh full-resolution source, verify portrait/HEIC orientation and sharpness after save, and check large text plus the global top chrome on a device. No claim of physical-device acceptance, deployment, automatic image replacement, account mutation, or recovery of detail lost in older uploads is made.
