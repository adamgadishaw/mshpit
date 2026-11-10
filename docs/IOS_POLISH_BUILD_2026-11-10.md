# iOS polish build, 10 November 2026

## Delivered source and artifact

Frozen runtime/source: `296ce4beac30290ce07ff5748e06ebc1fb33d926`, branch `ios/nov10-polish-clean`. This is based on the clean installed `cc04472` lineage and excludes both the notification reliability rollout and profile-badge client/server rollout. No server, App.js, dependency, native-project or provisioning change is included.

Local signed Release artifact: `.tmp/ios-phone-checkpoints/polish-296ce4b/MshpitDev.app`. Bundle `com.mshpit.app.dev`, version 1.0.0 (1), minimum iOS 16.4. Existing provisioning expires 14 November 2026 at 23:50:01 UTC. OTA updates are disabled. The build configuration selects the production API origin.

## Changes and review

- Discover uses a horizontally scrollable, Feed-style measured tab strip. Its highlight and automatic scroll follow actual page displacement, cancellation, reversal and promotion. Manual tab-strip scrolling remains independent. Selection accessibility remains tied to the committed page; Reduce Motion and interrupted admission are covered.
- Side menu groups Community, Explore, Account and Settings, preserving authorized routes and dropping unavailable actions.
- Messages and Notifications use existing counts and navigation in the fixed Feed header. This neither marks activity read nor introduces the held notification backend contract.
- Previously visited Feed filters remain mounted, bounded to four, preserving exact list identity and expanded pagination. Unvisited canceled previews are discarded. Hidden panes cannot act or read; account/auth replacement and privacy invalidation remain enforced.
- Banner selection gains an iOS 3:1 crop preview with drag/pinch and accessible buttons, uses orientation-corrected native pixels and one high-quality normalization encode, and matches profile/editor artwork sizing. Existing low-detail uploads require reselecting the original; this cannot reconstruct lost detail.
- Independent review caught and closed modal accessibility isolation, Reduce Motion, canceled-modal resurrection and disposed-native-image rerender issues. The separate personal-preview style extraction was independently reviewed. Feed retention runtime was separately reviewed and matched the worker's candidate after merging both test-fixture suites.

## Completed validation

- Full hermetic suite: **9,011 passed**, 1,044 files, 27 serial resumable batches; zero failures, skips, cancellations or TODOs. Every batch is tied to the unchanged source manifest.
- Targeted integration: 231 navigation/Feed checks and 142 banner/profile checks passed before the full gate.
- Catalog generation, 60 card Yoga geometry cases, 927-file syntax check, architecture limits, production dependency audit (zero vulnerabilities), Blueprint schema and whitespace checks passed.
- iOS, Android and web exports passed. Android/web source isolation passed. Web initial JavaScript: **523,893 / 524,288 gzip bytes**, 395 bytes headroom.
- Native Release build succeeded at 00:37:20 UTC. Strict deep signature verification passed before and after independent artifact preservation.
- Exact frozen project source verification passed in all exports and native maps: iOS/native 791 code modules, Android 742, web 753. Held notification and badge added modules are absent; iOS card/navigation/banner modules resolve correctly.
- Main checkout `942e1f3` remains clean: 2,723 tracked files, 9,834 native non-derived files and 10,906 native symlinks unchanged. Prior `cc04472` 52-file artifact remains byte-identical.

## Receipts

- Full gate: `.tmp/discover-tabs-296ce4b/completed.json`, `full-test-summary.json`, individual batch receipts and logs.
- Exact content: `.tmp/discover-tabs-296ce4b/source-map-verification.json` and `source-manifest.json`.
- Native build/signature: `.tmp/native-discover-tabs-296ce4b/`.
- Preserved artifact: `.tmp/ios-phone-checkpoints/polish-296ce4b/receipt.json`, `manifest.json`, `validation-evidence.json`.
- App manifest: 52 files, 59,080,510 bytes, SHA-256 `f4e4ae085dac14b2a84aecc3e7148e0216e49b661d3560abc601d7edc4911a78`.
- Bundled JavaScript SHA-256: `435302b7e52fc32bfa97eebb7e2aa030148b15b98acc0745301abd6c466ab4c9`.

## Remaining acceptance and hold

No phone interaction, installation, reset, push or deployment occurred. The installed app remains `cc04472`. The new artifact is ready for an in-place device review only after fresh phone availability. Physical gesture feel, tab-strip glyph layout, VoiceOver, large-text rendering, native Photos/HEIC/color-space behavior and actual crop/upload behavior remain unverified. These source tests do not certify them. Profile-badge selection remains a separate backend-first rollout; no nonfunctional badge control is exposed here.

## In-place install and launch, 10 November 2026

After Adam explicitly requested installation, the connected physical iPhone and all 52 preserved artifact files were verified again. Strict deep signature verification passed. CoreDevice then successfully installed this exact `296ce4b` app in place and launched `com.mshpit.app.dev`. There was no uninstall, reset, production deployment or authentication-setting change. The app was briefly locked pending the user's normal unlock.

The live Device Hub view then showed Feed with the new Messages and Notifications controls, existing content and signed-in navigation, without login/onboarding. This confirms the visible launch, not a comprehensive audit of all local account data. One supported tap toward Discover returned `-10005 noWindowsAvailable`; the subsequent screenshot remained on Feed. No gesture, VoiceOver or crop/upload acceptance is claimed, and no further phone input was attempted. The phone was returned to Adam.

Dated install/launch evidence: `.tmp/ios-phone-checkpoints/polish-296ce4b/phone-review-20261110T0040/review.json` and its `install.json`, `launch.json`, before/after app receipts. `.tmp/ios-phone-checkpoints/polish-296ce4b/current-status.json` records the installed state. These supersede the historical pre-install hold in the immutable build receipt. Runtime remains `296ce4b`; only this document changes.
