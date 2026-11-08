# iOS feedback polish, November 8, 2026

Runtime checkpoint: `826cc9e30bacb7724cb6ab0f6ef485bc09014139`.
Preserved app: `.tmp/ios-phone-checkpoints/flagship-826cc9e/MshpitDev.app`.
This build is not installed. The previously installed and preserved build is b73d54a.

## Requested changes

- Feed posts have distinct bounded surfaces and a clearer review-first hierarchy. Compact lineup details expand to reveal every retained opener rating, note and linked review; detail posts start expanded. Campaign treatment and other-platform presentation are preserved.
- Discover artwork has a stable frame with an expanding caption. Festivals use edition cards and available credited artwork, without the former spotlight treatment. Explicit image/data recovery, UTC eligibility and supplied official announcements improve presentation without inventing current lineups, imagery or ingestion freshness.
- The iOS profile banner opens its original image. The gallery remains visible through loading, partial, error and confirmed-empty states, with explicit refresh and earlier-post loading. Confirmed empty history cannot resurrect stale cached photos. This does not certify the quality or availability of the user’s actual source images.
- A local Apple-only Expo module renders supplied public venue coordinates with MapKit. It adds no location permission, API keys or new external package versions. Existing list selection, accessible pin alternatives, retry and unavailable states remain. Android and web retain their existing map implementations.

## Verified evidence

- All 8,421 committed-source tests passed using `npm run test -- --test-concurrency=1` (511,336.823333 ms), with no skipped or canceled tests. The unchanged default parallel run passed 8,420 and failed one existing concurrent-React settlement fixture. A deterministic test-only Scheduler correction was reviewed in memory but remains unapplied. The serial pass does not establish parallel fixture stability.
- Server production-dependency audit, syntax and architecture checks passed. That audit is not a native-Pod or whole-application security clearance.
- iOS, Android and web exports passed. Web initial JavaScript is 522,197 bytes gzip against the unchanged 524,288-byte budget.
- The export-isolation gate passed: one Android map (2,201 sources) and 81 web maps (1,172 sources) exclude app iOS implementations and all five explicitly confined domains. This is source-map evidence, not native behavior parity certification.
- Parsed native autolinking includes MshpitVenueMap only on Apple. The generated Pod lock adds only the local MshpitVenueMap to existing ExpoModulesCore dependency; existing external versions/checksums are unchanged.
- The development-signed Release app built successfully and passed deep/strict signature verification. Its executable links MapKit and contains the module. iPhone-only, iOS 16.4 minimum and portrait/upside-down support are unchanged.
- All 11 privacy manifests are byte-identical to b73d54a. The only Info.plist differences are removal of the prior Expo development Bonjour/local-network description by the existing Release strip phase. No location permission was added.
- Exact copied artifact: 52 files, 60,377,477 bytes. JavaScript SHA-256: `57f31a3d9b909425ef23c49508581162d7347bcafa53f724c853ae3d32825568`. Manifest SHA-256: `cb9b7e7e4087aeb77dffe7b42cd96fc1d6c949bcdbfca979909fc62e5df94ca6`. Existing signing identity/profile retained; expiry remains November 14, 2026 at 23:50:01 UTC.

## Remaining gates

The Mac is locked and the owner is updating the iPhone. No new build installation or native visual check was attempted during that update. Actual road-tile rendering, native appearance, gestures, keyboard, VoiceOver, large text and performance remain unverified for this artifact. A compile/export/test pass is not App Store readiness or native accessibility certification.

The production festival read returned HTTP 403 and was not retried by another route. Live dates, image supply/delivery and ingestion freshness are not certified. Only existing credited image fields are displayed; absent source media remains a content limitation.

The Release backend remains https://www.mshpit.com and is not mutation-blocked. Use an authorized isolated fixture for synthetic posting, messages, attendance, read-state changes and sharing. Genuine owner-driven preview remains separate from that certification. Wait for confirmation that the phone update is complete before interacting with or installing to it. Keep the previous signed app available.

Detailed receipts, manifest, platform source-isolation and native autolinking evidence are stored alongside the preserved app. Test/build logs are recorded in its receipt. No production push, merge, deployment, signing-identity change or phone-data reset occurred.
