# Activity reliability candidate

Scope: local cross-platform client/server fix, rebased onto reviewed Discover runtime 80601219641f7f49bc3df02eb96a834f66480708. No push delivery,
production notification mutation, deployment or device installation is included.

## Behavior and rollout

- Activity fetches on entry/foreground, exposes loading/error/older-page states,
  and preserves authoritative unread totals independently of the loaded page.
- Viewing or refreshing Activity does not mark anything read. The explicit
  “Mark loaded as read” control snapshots only the currently loaded unread IDs.
- GET advertises `notification-ids-v1`; new clients write only the distinct
  `/api/me/notifications/read/scoped` route. Old servers fail safely instead of
  interpreting a scoped request as their old global mark-all command.
- Upgraded servers make old bodyless `/read` calls a no-op. Old clients may
  temporarily display locally cleared badges until reloading; no unseen server
  activity is cleared. Upgrade every serving backend instance before publishing
  the client when approved. Old clients routed to an old instance still have the
  old unsafe behavior, so a partial backend rollout is not complete protection.
- Acknowledgements validate ownership/visibility and return exact confirmed IDs,
  including retry confirmations. Batches are at most 100. A later batch failure
  preserves prior confirmed updates and allows idempotent exact-ID retry.
- Pagination applies block/mute visibility before LIMIT. Private cache is bounded
  to 1,000 loaded rows, with an explicit UI limit notice. A refresh resets paging.
- Background/hidden tabs stop optional badge polling; active apps poll a one-row
  summary every 60 seconds without replacing expanded history. This is not push.
- The notification runtime loads on demand behind a small account/epoch/lifecycle
  facade. The facade retains at most 1,000 account-owned local rows, clears them
  synchronously on account changes, and forwards requests into the runtime's
  single queue. Failed loading is retryable. Pre-load welcome rows survive.
- Projection and adoption remain synchronous together; a confirmed DM/privacy
  mutation cannot be overwritten across an awaited helper return. Captured read
  IDs are copied before deferred code can run.
- Demo notification fixtures live in the lazy runtime. Cross-account client
  notification generation was removed; the server is the source of those events.
- Metro retains Expo's minifier settings and adds a second compression pass.
  The 512 KiB startup budget is unchanged. This applies to production bundles
  across platforms and must pass web/iOS/Android validation before integration.

## Architecture decision: migrate the notification Store seam

Owner: notification feature (`src/features/notifications`). The existing
`usePrivateEphemeral` notification binding is replaced one-for-one by
`useNotificationActivity`; no Store hook-count ceiling increases. The feature
owns all new state, lifecycle, services, command and cache policy. Store retains
only its compatibility facade for older callers such as confirmed DM reads and
block/mute scrubs. The exact hook baseline registers this replacement while
removing the legacy state binding and its direct API calls. Two notification
routes leave server/api.js for `server/features/notifications`.

Removal condition: once consumers use a dedicated notification feature provider,
remove the Store integration hook/facade and shrink its hook allowance. This
migration is not permission to add other Store state or raise hook ceilings.

## Regression risks specifically covered

Concurrent/unseen/older notifications; owned and visible acknowledgements;
legacy/mixed-version servers; retries and partial batches; account/epoch changes
including A-B-A; cancelled observers and remounts; external confirmed DM reads
or privacy scrubs racing GET responses; pagination/cap; explicit-only UI writes.


## Frozen validation receipt (2026-11-09 UTC)

Runtime/test source: `c569d3a9ca898366024767fa0b145aa2e1022cab` on
`fix/notification-reliability`. All nine stages of the serial isolated pipeline
completed successfully at 02:14 UTC. An independent read-only review verified
source ancestry, clean tracked files and the test/export receipts.

- Full suite: 8,661 tests passed; zero failures, cancellations or skips. Run with
  Node 24 and `node scripts/run-tests.mjs --test-concurrency=1`.
- `npm run build:web`: catalog split, export and unchanged startup budget passed.
  Initial JavaScript is 523,912 / 524,288 gzip bytes (511.6 / 512 KiB), leaving
  only 376 bytes of headroom. Paused music-player labels were absent. Recheck
  this tight budget after integration and any future startup changes.
- Syntax: 929 Node files passed. Architecture: 144/144 Store hooks, 47/47 state
  hooks and 154/154 inline API routes; no allowance was increased.
- Render Blueprint schema/reference checks passed. This does not validate live
  deployment configuration or secret presence.
- Production dependency audit: zero reported vulnerabilities.
- Expo production exports for iOS and Android passed with external source maps.
  Export-source isolation passed with zero issues (Android and web checked).
- `git diff --check` passed. No main checkout, deployment, production read state,
  notification setting or phone operation was changed by this validation.

Exported Hermes bundle SHA-256 values:

- iOS: `e7c3091d282fa65b437a407d984880e5a711db96c6535da6713884d7c6f9485d`
- Android: `d3b1ded57cf5fabdd79c164f984a3d4f532e7cf3b3c03ffbdac55a1b4d62e78c`

The pipeline status is `/tmp/mshpit-notifications-current-status.json`; sibling
`/tmp/mshpit-notifications-current-*.log` files contain individual results.
The web report is `dist/web-bundle-budget.json`, and the isolation receipt is
`/tmp/mshpit-notifications-isolation-c569d3a.json`. Temporary logs/exports are
local evidence, not a deployed artifact or a permanent release archive.

Remaining release work: revalidate the actual integrated main revision, perform
native build and physical Activity UX testing when authorized, and separately
approve deployment. No signed native build or physical notification runtime QA
was performed for this candidate. Push delivery remains a separate feature.
The server-first, all-instances rollout requirement above remains mandatory.

## Integrated local checkpoint (2026-11-09 UTC)

The frozen isolated receipt above is retained as history. The reviewed candidate was merged locally as runtime `6569968744734f7162b3e828767964c8f6239cf8`. Its actual integrated checkout subsequently passed the full 8,661-test serial suite, all aggregate checks, strict web budget (523,910 / 524,288 bytes; 378 bytes headroom), iOS/Android exports and source-map isolation, and a development-signed generic-device iOS Release build. The runtime/test/configuration files are identical to the isolated candidate.

The signed app is preserved at `.tmp/ios-phone-checkpoints/flagship-6569968/` with an all-file manifest, receipt and copied gate evidence. An independent read-only review verified it and the unchanged older checkpoints. See the [combined release receipt](ios-combined-notification-release-2026-11-09.md) for exact hashes and gates. This later documentation-only record does not change the built runtime source.

**The combined build is rollout-held, uninstalled, and not install-ready.** The server-first, every-serving-instance requirement above remains mandatory and was not executed. Physical Activity/Discover testing, safe installation coordination, and deployment approval remain separate pending work. Preserved uninstalled `8060121` remains the simpler Discover-only retest candidate.
