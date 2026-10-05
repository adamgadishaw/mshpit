# Infrastructure review - 2026-10-05

Reviewed base: `a056e64d13ab6185f4b91965060fc492fb110326` (released PR32).
Batch: `codex/infrastructure-bounds-20261005`. The event recommendation/venue
patch is separate on `codex/event-identity-20261005` (`f6629179576575111d9916f6be716e0eecdf5122`).
This is a bounded code/test/configuration review, not a production load test or
a claim that every path in the application has been exhaustively audited.

## Findings across the eight requested areas

| Area | Finding | Evidence and action |
| --- | --- | --- |
| Race conditions | Present; good coverage for the current single web-process design. Multi-process coordination still has explicit limits. | `server/db.js` enables WAL, foreign keys and a 5-second busy timeout. `databaseTransaction.js` and Media API receipts serialize writes; post/chat receipts reject changed payloads and duplicate effects. `emailQueue.js` uses token-owned expiring claims and serializes drains. Login/password-change and campaign-revision races have regressions. No transaction or authority change proposed. |
| Webhooks | Not applicable to the current inbound application interface. | A tracked-source search of `server`, `scripts` and `.github` found no inbound webhook route or handler. Account inactivity delivery uses persisted provider acceptance plus later receipt lookup (`features/accountLifecycle/accountInactivityWarning.js`), rather than an externally supplied callback authorizing deletion. No webhook server is added without an actual integration requirement. Any future receiver needs its provider-specific signature, bounded timestamp/replay policy, durable receipt and retry contract before activation. |
| Rate limits | Present and user-aware; process-local durability is a known scaling limit. | `auth.js` bounds buckets at 50,000 without clearing live identities; `rateLimitEnforcement.js` supports atomic grouped admission and bounded Retry-After. `post.idempotency.test.mjs` verifies an already successful retry remains recoverable at the hourly limit. Crawler file limits are per normalized client IP. Restarts reset process-local buckets and multiple processes would not share them. Changing policy, thresholds or adding a shared service needs separate review; none changed. |
| Caching | Present; bounded lifetimes and current visibility checks in the reviewed paths. | `artistFallbackCache.js` has a hard non-sliding 24-hour TTL, exact identity validation and a 5,000-row namespace cap. `recommendationService.js` bounds snapshots, ties cursors to viewers and re-reads current block/mute/account visibility. `sitemapSnapshotManager.js` validates revision/origin/size, coalesces refreshes, atomically persists snapshots and backs off failures. `index.js` serves public entity documents with a 60-second shared-cache lifetime and private/nonindexable pages no-store; static public HTML has a separate 3600-second policy. No speculative cache rewrite. |
| MCP servers | Not currently necessary for the existing assistant workflow. | The released `features/mediaApi` supplies explicit expiring/revocable hashed-token scopes, idempotent writes, an audit trail, and same-owner/exact-grant draft recovery. Catalogue administration still uses its existing authenticated API. A new MCP layer would not itself provide new correctness and would require a concrete client/workflow contract. No new server, token, scope or activation. |
| CI/CD | Strong repository checks; one release-policy decision remains. | `.github/workflows/quality.yml` runs tests/dependency audit/syntax/architecture/web build, hosted-setting tests, and a separate browser job on PRs and master, using pinned actions and no persisted checkout credentials. `render.yaml` specifies checksPass deployment and its own test/build/prune guard. GitHub's master branch response listed only `test-and-build` as a required status, with non-admin enforcement; `browser-regressions` was not in that required list. Recommend an owner decision on requiring both jobs and admin bypass, rather than silently changing security/release settings. |
| Database indexes | Present and query-driven in reviewed high-traffic reads. | `features/seo/seoIndexes.test.mjs` and `recommendationIndexes.test.mjs` assert actual query plans for canonical artists, reverse followers, date/id keysets and viewer-first recommendation signals. Venue resolution uses the existing expression index. No measured missing-index finding justifies a production schema/index migration in this batch. A wider performance audit should use real aggregate slow-query evidence before proposing indexes. |
| Background jobs | Present with durable retries; one real memory-queue bound was missing and is fixed here. | `periodicJobScheduler.js` coalesces ticks and provides one bounded recovery retry and shutdown drain. `backgroundJobCoordinator.js` serializes provider maintenance with memory admission and a 32-job cap. `videoProcessingQueue.js` persists conversion requests, retry attempts and restart recovery. However, `videoFinalizeJobs.js` serialized conversion closures without a pending-job cap; a synthetic test admitted 64 waiting jobs with zero external calls. This batch adds the missing process bound. |

## Safe change in this batch

`server/videoFinalizeJobs.js` now admits at most 32 unsettled finalization jobs
across the process, matching the existing maintenance coordinator's order of
magnitude. At the route's existing 64-KiB finalization-body limit, this also
bounds retained request bodies to roughly 2 MiB before ordinary object overhead.
Only one conversion still runs at a time. Exact in-flight retries join their
existing job even when full; changed fingerprints still conflict. New work at
capacity receives existing retryable 503 `MEDIA_STORAGE_UNAVAILABLE` with a
20-second retry hint, before a coordinator entry is created.

A cancelled entry retains its capacity slot until the underlying queued or
non-cooperative work settles. The retry scheduler continues to see that pending
work. Success, rejection and cancelled queued work all release their slot.
`startDurableVideoFinalize` calls this admission before recording a new durable
request, so a rejected new request does not leave a phantom running queue row.
Existing persisted retries remain eligible for a later attempt.

Runtime scope is one file; tests are in `server/videoFinalizeJobs.test.mjs`.
No permission, rate-limit threshold, token, credential, service, infrastructure,
database schema or production data change. No new UI badge is introduced.

## Decisions and operational verification

1. **Release policy:** approve or reject making `browser-regressions` required
   alongside `test-and-build`, and decide whether administrators may bypass.
   This is a repository security/release setting, so it was not changed.
2. **Future horizontal scaling:** before another web/worker instance shares
   quotas, review durable shared rate/quota reservations and worker claims.
   Current mail daily-budget serialization explicitly does not claim distributed
   safety. No new Redis/service purchase or database migration is proposed now.
3. **Live deployment configuration:** the Render connector reports no selected
   workspace and requires an owner-confirmed workspace before reading service
   details. This review therefore validates the committed Blueprint, not its
   synchronization with the live service or current environment values. No
   workspace, account, browser, credential or access restriction was bypassed.
4. **Webhooks/MCP:** no new integration is justified by the checklist alone.
   Revisit when a real sender/client and operation contract is requested.

## Validation

The audit ran 112 focused tests sequentially across concurrency, idempotency,
mail claims, Retry-After, caches, query plans, schedulers, video retry persistence,
Media API and Blueprint validation; all passed. The new coordinator and retry
header suites passed 6/6; 11 targeted media integration cases passed, including
revoked/expired sessions, conflicting and concurrent finalization, orphan cleanup,
and pending-video publication. Syntax (823 Node files), architecture, Blueprint
and diff whitespace checks passed. Independent read-only review approved the
four-file diff with no runtime blockers and reran coordinator, durable queue and
response-header suites (10/10 passed). Its cache-policy wording clarification
has been applied above.
Tests use synthetic local data and mocked transports; no live
mail, provider conversion or production writes.

No local browser, Android or heavy web build. Full release checks belong to
cloud CI. Push/PR/CI status will be reported separately; not merged or deployed.
