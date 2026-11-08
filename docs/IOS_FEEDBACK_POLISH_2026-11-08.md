# iOS feedback polish, November 8, 2026

Runtime checkpoint: `826cc9e30bacb7724cb6ab0f6ef485bc09014139`.
Preserved app: `.tmp/ios-phone-checkpoints/flagship-826cc9e/MshpitDev.app`.
Historical initial checkpoint: this build was subsequently installed in place after the owner completed the phone update. See the physical findings and corrected checkpoint below.

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

At the initial checkpoint the phone was updating, so installation and native checks were held. Subsequent authorized physical checks are recorded below. A compile/export/test pass is not App Store readiness or native accessibility certification.

The production festival read returned HTTP 403 and was not retried by another route. Live dates, image supply/delivery and ingestion freshness are not certified. Only existing credited image fields are displayed; absent source media remains a content limitation.

The Release backend remains https://www.mshpit.com and is not mutation-blocked. Use an authorized isolated fixture for synthetic posting, messages, attendance, read-state changes and sharing. Genuine owner-driven preview remains separate from that certification. The owner subsequently confirmed reconnection and authorized phone work. Preserve existing app data, avoid interrupting another active phone task, and keep the previous signed app available.

Detailed receipts, manifest, platform source-isolation and native autolinking evidence are stored alongside the preserved app. Test/build logs are recorded in its receipt. No production push, merge, deployment, signing-identity change or phone-data reset occurred.

## Physical findings and correction: ef83fb0

After the phone update, 826cc9e installed in place and launched with the existing account, personalized Feed, profile and gallery intact. Actual phone checks exercised banner opening, gallery Next/horizontal swipe/Close, public-profile edge Back, drawer, Discover and festival layouts. No synthetic posting, attendance, messages, reactions, reports, read-state changes or external sharing occurred. Activity and DM were not opened. Existing browsing analytics may occur. Keyboard capture remained off.

Two concrete defects were reproduced:

- Venue map initialized at the continent camera with no visible venue pins, then timed out. The real Expo/Fabric property path converts nested null to boxed nil; decoding selectedId failed and discarded the whole snapshot. The iOS JS/native boundary now represents no selection as an empty string. The existing native view, geometry, map provider, permissions and Android/web implementations are unchanged. The actual native contract fixture verifies annotation/camera adoption, selection clearing and stale ownership, but injects map readiness and does not certify network tile delivery.
- You gallery video posters appeared as short strips inside square cells. The bundled RN Yoga layout reproduced absolute-only children yielding a 44pt wrapper. Both iOS preview wrappers now have in-flow width and aspect ratio. The opt-in bundled-Yoga gate covers 144 layouts; media source/cache, private-history ownership and viewer behavior are unchanged.

Corrected runtime source: `ef83fb05a7e8afd6e8a960d5952581b3303426f9`. Preserved app: `.tmp/ios-phone-checkpoints/flagship-ef83fb0/MshpitDev.app`. All 8,422 tests passed serially with zero failures/skips/cancellations, followed by server production dependency audit, syntax, architecture, web export/budget, iOS/Android exports and source-isolation checks. Development-signed Release build and deep/strict signature verification passed. Independent artifact review verified all 52 files (60,382,163 bytes). Only JS bundle, executable and signature resources differ from 826cc9e; Info.plist, all 11 privacy manifests and the provisioning profile are byte-identical. JS SHA-256: `ad5be0187f7ebb8d16efc1954b3d019deb774802db87f9947990f4c3cd1cfa2c`. Manifest SHA-256: `774848fdd70754e0710e31525a16e7767162b5bf16e5786d78e03e9354e137fb`.

ef83fb0 was subsequently installed in place in the background without launching MSHPIT; the post-install app URL matches the installation receipt. This finished before a subsequent hold instruction arrived. No further device actions are permitted until the owner confirms the phone is free. Actual corrected road tiles/pins, gallery geometry and post-update session continuity still require the authorized phone retest. Accessibility Inspector produced no usable report in the earlier session; this is not an accessibility pass. VoiceOver speech/focus, largest Dynamic Type and performance remain uncertified. Live festival media supply remains dependent on credited catalogue images. The separate Feed hierarchy polish is source-reviewed and integrated after ef83fb0, with 35 focused tests passing; it is not included in this signed artifact and awaits full release checks.

### Corrected physical retest completed

After the owner confirmed the phone was free and later resumed a requested pause, ef83fb0 launched on the iPhone16ProMax/iOS27.2 with the existing session and content present. Actual Toronto road tiles/labels and numbered venue pins rendered. You gallery previews were square, a middle preview opened item2/14, and Close returned to You. Local exact screenshots and launch receipt are referenced in the checkpoint installation record. Pin-selection accuracy and gesture arbitration were not exhaustively certified. A brief Mac transport loss and a microphone/camera screen-sharing interruption are recorded; neither is represented as an app defect. No synthetic live mutation, Activity/DM read-state action, device settings change or external share occurred. Accessibility and performance limitations above remain.

## Feed hierarchy release checks: db93176

Runtime source `db93176e7cad4d254aecea9812a89d9eeb56b64c` includes the reviewed iOS Feed hierarchy candidate (`1aaab134`, integrated as `d926824`). Actual baseline phone screenshots motivated a compact social-action row, labeled overflow for management/reporting, one Show details disclosure for secondary information, quieter recommendation attribution/views, compact rating control and slightly wider content. Existing handlers, guest/owner guards, delete confirmation, spoiler protection and media geometry remain. Exact Android/web component-tree gates pass; this is not a claim of pixel-identical compiled bundles or measured native performance.

The independent focused cohort passed 35/35. The integrated full serial run passed 8,427/8,427 with no failures, skipped or canceled cases. Server production dependency audit, syntax, architecture, web export/budget, iOS/Android exports and five-domain source-isolation checks all passed. Initial web JavaScript is 522,285 bytes gzip against the unchanged 524,288-byte limit. Development-signed Release build and deep/strict signature verification passed.

Preserved app: `.tmp/ios-phone-checkpoints/flagship-db93176/MshpitDev.app`. Independent artifact review verified all 52 files (60,378,720 bytes). JS SHA-256: `2b3eec5cbd6759a5ed830db961e211a368c441f1d8903d7c8a8b9e9f44b69e26`. Manifest SHA-256: `457fac4be020baf1a0a3f8e10cf2c50d7be59f532381c8eb2ad8b90a822be89c`. Info.plist, all 11 privacy manifests and provisioning profile are byte-identical to ef83fb0; only the JS bundle, executable and signature resources differ. No signing, backend, permission or deployment change occurred.

This Feed artifact is NOT installed. The owner took the phone and requested no further phone controls or installation until they say otherwise. ef83fb0 remains installed. Next authorized physical check: compact card hierarchy and normal/large-text wrapping, Show details with opener ratings and setlist spoiler protection, More actions open/Cancel without live mutations, recommendation explanation, and return from a full post. Component/style tests do not certify native VoiceOver focus, true hit testing or final typography. The separate cross-platform notification candidate remains isolated and is not included here.
