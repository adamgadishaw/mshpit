# iOS refresh and moderation integration — November 10, 2026

Runtime source: `e56c224` on `ios/integrate-refresh-moderation-20261110`.
Merge parents: `3bc93e0` (installed `296ce4b` lineage) and `632f1c3`
(refresh/notification candidate). The six conflicts are resolved and the source
worktree is clean. Original worktrees and the installed phone were preserved.

## Behavior

- The iPhone moderation console uses a compact header and a scrollable right-side
  drawer opposite the main menu. Role-based access and account retirement remain.
- Feed pulls reach the real native list and await fresh content plus server
  notification/message totals, preserving cached rows on failure and existing
  navigation, banners, retained scroll state and privacy guards.
- Native refresh boundaries render the grooved spinning vinyl with a short pop,
  respecting Reduce Motion, backgrounding and retired detail callbacks.
- Messages and Notifications retain the installed labeled controls and gain red
  rounded unread boxes, visually capped at 99+ with full accessible totals.
- Activity refreshes on entry, foreground and every 15 seconds while active.
  Reads never acknowledge unseen notifications; explicit read commands use the
  server's scoped-ID contract. Inbox totals come from the server.
- The backend includes the separately reviewed indexed per-sender unread query.
  No migration or production setting change is required.
- A behavior-preserving artist-follow API module split keeps connection-list
  fetching out of initial loading to meet the unchanged web size budget.

## Verification

- 217 notification, privacy, server, unread and moderation checks passed.
- 200 Feed, vinyl, navigation, badge and accessibility checks passed.
- 69 retained-detail/Show/vinyl checks passed after adding missing native mocks;
  assertions were preserved.
- The full integrated suite ran 9,133 tests: 9,127 passed and six HTTP fixture
  roots failed because the inherited macOS TMPDIR differed from the fixtures'
  expected /tmp. Rerunning the affected files with TMPDIR=/tmp passed all 16
  tests, including their nested checks. No assertions were relaxed. This is a
  full run plus targeted corrections, not a single clean aggregate run.
- The final unchanged artist-follow helper was then split into its own module;
  eight final-source follow tests passed (the isolated candidate also passed
  11 related tests). The full aggregate was not repeated for this module move.
- Syntax passed 930 Node files; the final optimized backend file passed a fresh
  Node syntax check. Architecture passed its existing ceilings: 144 Store hooks,
  47 state hooks, 154 inline API routes. Whitespace/conflict checks passed.
- Final production iOS, Android and web exports passed. Web initial gzip is
  524,263 / 524,288 bytes (25 bytes headroom); the budget was not increased.
- Final Android source map (2,220 sources) and all 82 web maps (1,191 sources)
  passed iOS source-isolation checks with zero issues. These are build evidence,
  not physical gesture, animation, performance or accessibility certification.

Final export hashes:

- iOS Hermes: `80893d289a06487685133f26cc45214d85dfb5ed63c91dca9a0a4a008f0e601d`
- Android Hermes: `6c979d1f679036bedff4782efb7078b131bcbd0b6739f3158e9890f0b82a0610`

## Native build and release limits

Generic-device iOS Release build succeeded with Xcode 27.2, two jobs and the
existing signing identity. Both original and preserved app passed strict deep
signature verification. All 801 mapped application sources matched the checkout;
the complete 2,666-file source manifest had zero changes during the final build.

Preserved app: `.tmp/ios-phone-checkpoints/refresh-moderation-e56c224/MshpitDev.app`.
The exact copy contains 52 files / 59,109,404 bytes. `manifest.json`,
`receipt.json`, `evidence-manifest.json`, and `evidence/` sit beside it.

- Identity: `com.mshpit.app.dev`, version 1.0.0 / build 1, minimum iOS 16.4.
- Existing development profile expiry: 2026-11-14T23:50:01Z.
- All 11 privacy manifests and the provisioning profile are byte-identical to
  the previous native product. Expo's existing Release strip phase removed only
  `NSBonjourServices` and `NSLocalNetworkUsageDescription` (development server
  discovery); all other Info.plist values match. No permission was added.
- Native app bundle SHA-256: `f8065b145df981718f51b574acc97f9f7c15db1735c7ce66170e6887e29630da`.
- App manifest SHA-256: `c70ff8c3255a31566d3eb12ca6a5f82eca787bfbccb0870d30fd4d041db68b56`.
- Native source-map SHA-256: `026aa779742fa22b8a8702f1167ce51a563ca4d0c991aa0799727a208702380d`.

Native success is local compilation/signature/source evidence; it is not an
installation or physical-device acceptance result.

The native inputs are independent APFS copies of the existing project and
installed dependencies, with generated original-root paths relocated. Original
worktrees were not used as writable build directories. A copied module cache
failed Xcode's absolute-path validation; it was retired only in the isolated
build and compilation retried. No dependency installation, prebuild, pod update,
provisioning update, phone action or production deployment was performed.

Before installing the paired client, separately approve and deploy the scoped
notification backend on every serving instance. Verify an authenticated read-only
response advertises `notification-ids-v1` and integer `inboxUnread >= 0`, and verify
the scoped endpoint contract without issuing synthetic read acknowledgements.
Public health alone does not establish this capability. This development app
uses the live service. Native visual/VoiceOver/large-text/gesture acceptance and
installation remain pending. OS push delivery is outside this change.
