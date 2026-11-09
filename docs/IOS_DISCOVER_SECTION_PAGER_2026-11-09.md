# iOS Discover section pager and combined checkpoint

## Scope and interaction

Discover now pages its own sections in the existing order: **Shows → Festivals → Artists → Venues → Cities → Photos**. It does not swipe bottom navigation. The checked-out Android implementation uses section buttons and a horizontally scrollable tab strip, not a Discover content pager. This implements the intended iOS behavior; it is not an Android-device comparison or an Android feature change.

- The heading, area control and section strip stay fixed. The pager mounts the current section plus at most one deliberately requested neighbor.
- The destination is its real component and normal scoped resource. Reads begin during gesture intent, and promotion retains that instance instead of repeating its request. Shared Discover loaders remain single-owned.
- The source stays in place until the incoming native layout exists. During a drag, real loading content can be visible while its read completes. An accepted release waits for ready, empty or error content, or permits that actual loading page after 2.5 seconds. This is not a guarantee of loaded data before every fast swipe.
- Cancel and reversal retain the source and abort abandoned reads. Explicit tabs, filters, account changes, route departure and backgrounding retire pending gestures. Section promotion resets return-scroll ownership rather than replaying another section's offset.
- Previews cannot persist programme/genre/scroll state, register the current section's refresh action, autoplay artwork or receive accessibility focus/interactions. There is no automatic publication or attendance action.
- Existing horizontal rails/maps, vertical scrolling, explicit buttons, 44-point controls and Reduce Motion remain separate owners. Physical gesture arbitration still requires acceptance testing.

UI commit: `e76081968ecb17b3d3b06a85989e4e49bb71ccb3`. Shared additions use inert default-platform readiness behavior. No Store, API, dependency or native configuration was changed by this UI slice.

## Combined verification

The separately reviewed security patch was integrated as `a7a811758226e396c796b462d8a719bc7c885765`, preserving separate commits. At that exact combined runtime source:

- **8,556 tests passed**, zero failures, skips or cancellations.
- Catalog, production dependency audit, syntax, architecture and Render Blueprint checks passed. Blueprint validation does not imply a live deployment or secret validation.
- Web, iOS and Android exports and source-map isolation passed. Initial web JavaScript is **523,575 / 524,288 bytes gzip**, leaving 713 bytes. Source maps do not certify runtime equivalence or native performance.
- The Discover implementation had 210 focused passes and 126 independently rerun passes before integration. Those groups overlap and are not added to the full-suite count.
- A development-signed **Release-configuration** iPhone app built successfully. It is not an App Store distribution build.

The preserved app, receipt and all-file manifest are at `.tmp/ios-phone-checkpoints/flagship-a7a8117/`. It contains 52 files totaling 60,448,190 bytes. Compared with the preserved `9f8d59a` app, only JavaScript, executable and signature resources changed. Info.plist, provisioning profile and all 11 privacy manifests are identical. The profile expires November 14, 2026 at 23:50:01 UTC. Build/test/export evidence uses `/tmp/mshpit-discover-security-a7a8117-`.

## Server scope and remaining security caveats

The security change is **local source only, not deployed**. It caps full-account editor sessions at 12 hours and revokes editorial grants/pending pairings during explicitly invoked offline recovery preparation. Existing editor sessions older than 12 hours will require sign-in after a future server rollout. The separately scoped, opt-in Newsroom lifetime is unchanged. Previously prepared recovery copies require re-preparation before reuse. No real database was prepared or restored here.

The full dependency audit still reports 12 entries: 3 high, 8 moderate and 1 low. The Expo compatibility check reports 10 existing SDK 57 patch mismatches. Dependencies were not changed. The production-only audit is a limited server dependency check, not mobile/native or package-level security clearance. See [the account/database report](ACCOUNT_DATABASE_FORTIFICATION_2026-11-09.md). The separate pending notification-reliability branch is not included.

## Device status and remaining acceptance

**This combined build is now installed and launched on the physical iPhone.** After the user reconnected the phone, the preserved `a7a8117` app was installed in place on the iPhone 16 Pro Max/iOS 27.2 at 2026-11-09 01:16:48 UTC, without uninstalling or resetting app data. Launch succeeded at 01:17:12 UTC with PID 3446. Both receipts identify `DF97F059-1A6F-413B-A03A-2C8E232CBA50/MshpitDev.app`. All 52 artifact files, the receipt source/manifest hashes and the deep/strict signature were rechecked before installation. This supersedes the previous installed runtime `9f8d59a`; prior signed builds and the historical build-time hold remain preserved.

Actual Device Hub pixels show a populated Feed with **For You** selected, the order **Following → Local → For You → News**, and bottom buttons **Feed, Search, Discover, You**. This confirms physical Feed rendering, not session identity continuity or native performance. Device Hub screenshots and the accessibility Raise action worked. One fresh coordinate tap on the visible Local filter failed with `Computer Use server error -10005: noWindowsAvailable`; the post-attempt screenshot remained on For You. No repeated input recovery, restart, permission/security change or alternate input route was attempted. The same input limitation occurred in the earlier sessions, including after an ordinary Device Hub restart.

Consequently, Discover layout/motion, Feed incoming-page motion, swipe cancellation, nested-rail arbitration, tap alternatives, compact-footer interaction, native accessibility and performance are **not certified**. No Discover, swipe or cancellation check passed in this session. No synthetic live action, Activity/Inbox read-state action or production source change was performed.

Current local evidence:
- Device: `/tmp/mshpit-a7a8117-phone-devices-20261109T011625Z-95708.json`.
- Install: `/tmp/mshpit-a7a8117-phone-install-20261109T011648Z-95729.json`.
- Launch: `/tmp/mshpit-a7a8117-phone-launch-20261109T011712Z-95940.json`.
- UI outcome: `/tmp/mshpit-a7a8117-phone-ui-20261109T011827598Z.json`.
- Actual screenshot: `/tmp/mshpit-a7a8117-phone-ui-20261109T011827598Z.jpg`.

For an owner-driven or explicitly approved genuine-use session, verify all six Discover directions, real incoming content, cold/slow/empty/error states, short/reversed/canceled swipes and explicit-tab interruption. Check local rails and maps retain their gestures, vertical scrolling remains natural, and Back returns to the right section/offset. Verify large text, VoiceOver/tap alternatives and Reduce Motion. Use an authorized isolated fixture for any synthetic mutation or read-state test; ordinary Activity/DM opening can mark real content read. Do not infer permission for those actions from installation or reconnection alone.
