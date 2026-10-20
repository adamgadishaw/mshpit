# Backend reliability: local baseline and first slice

Status: implemented and tested locally, not deployed. No production readiness or
service-capacity claim follows from this acceptance run.

This records the first admission slice. The durable-write, shutdown and retry
items below are superseded by
[the recovery follow-up](BACKEND_RELIABILITY_RECOVERY_2026-10-20.md).

## Provenance and isolation

- Read-only source: `D:/Development/Apps/mshpit`, clean tracked state at
  `36a2533376f9857e0ad24989e2765988eae3f964`.
- Independent tracked-source archive in
  `C:/Users/Adam Gadishaw/Documents/Codex/2026-10-20/task/mshpit-backend-reliability`.
  Local branch: `codex/backend-reliability-20261020`.
- The snapshot baseline and source Git tree both equal
  `770319706f3ccdc8645885793a9ea1bdc7799c28`. This copy has its own Git objects
  and index, with no alternates or links to the beta checkout.
- Parent research examined newer GitHub master `66a0604690d8f4aef435592321b7df1034d19172`.
  This patch is against the local baseline above. Check the current release
  diff before integration; neither checkout is asserted to be the deployed build.
- Root `AGENTS.md` requires the Expo 57 reference to be read; it was read before
  code changes. No tracked nested `AGENTS.md` or local `.agents/skills` directory
  was found in the source checkout.
- No running API, Metro, Android build, device, process, account, live fixture,
  shared database, credential, or external service was changed. Tests used fresh
  temporary databases. Runtime packages were copied into this task without
  install scripts, network installation, or a shared `node_modules` link.

## Actual architecture inventory

| Area | Current implementation | Reliability boundary |
| --- | --- | --- |
| HTTP/runtime | `server/index.js`, Node core HTTP; `render.yaml` declares one disk-backed web service and a private video verifier | This is a single-writer application, not an Express/Postgres deployment. Several controls and schedulers remain process-local. |
| Persistence | `server/db.js:59-68`, built-in `node:sqlite` `DatabaseSync`, WAL, foreign keys, 5-second busy timeout; `server/databaseTransaction.js` owns nested-safe writes | Existing durability tests assert FULL synchronous commits and crash rollback. Lock waits still block the one Node event loop; no measured production p95 or disk failure coverage here. |
| Uploads | `server/mediaAssets.js`, signed source storage, asset/variant identities, finalization hashes, transactional readiness and current-owner checks | Storage I/O and SQLite are separate failure domains. Existing idempotency and generation checks must be preserved. |
| Video work | `server/api.js:startDurableVideoFinalize`, `server/videoFinalizeJobs.js`, `server/videoProcessingQueue.js` | In-memory serial execution is backed by `media_processing_jobs`; interrupted running rows become retries on restart. Retry status is not durable proof of successful output. |
| Other work | `server/backgroundJobCoordinator.js`, periodic schedulers, `server/emailQueue.js` | Background coordinator already bounds pending jobs to 32. Email has leases and process-local drain serialization; it does not promise exactly-once provider delivery. `server/features/jobs` is staff job advertisements, not the work queue. |
| Auth/session | `server/auth.js`, `server/sessionCookies.js`, current-session/account checks in API flows | Opaque session tokens are hashed in SQLite; password work is bounded/asynchronous on HTTP paths. Existing automatic video recovery checks current account restrictions and decoder allowance. No owner credentials or session data were inspected. |
| Event ingestion | `server/tourdates.js`, provider HTTP timeout/abort classification, checkpointed coverage, savepoint upserts and transaction-bound progress | Partial provider failures retain useful rows and do not advance a completed-coverage checkpoint. Provider availability/quotas still affect freshness. |
| Health/shutdown | `server/healthAvailability.js`, `server/index.js`, `server/backgroundRuntime.js` | Core health is distinct from strict readiness. Shutdown owns many workers and has a force-exit budget, but the video scheduler's stop only clears timers; explicit coordinator/bookkeeping drain remains a gap. |
| Backup/restore | `scripts/start-production.mjs`, `scripts/backup-db.mjs`, `server/backupScheduler.js`, `server/databaseRecovery.js`, `scripts/prepare-db-restore.mjs`, `server/privacyJournal.js` | Verified pre-migration snapshots and offline restore gates already exist. `BACKUP_OPERATIONS.md` explicitly requires configured off-host storage, upload evidence, and a real restore drill. These operational facts were not verified here. |
| Tests | `server/persistenceDurability.test.mjs`, `server/post.idempotency.test.mjs`, video queue/integrity tests | Existing synthetic tests already cover killed WAL writer, real-schema backup, raw snapshot rejection, reviewed cold reopen, and restored-session/queued-mail invalidation. They are reused, not replaced. |

## First slice: bounded video admission

Evidence before the change:

- `videoFinalizeJobs.js` limited terminal outcomes to 2,048, but retained an
  unbounded chain of active/queued conversion closures.
- `docs/SECURITY_ULTRA_AUDIT_2026-10-16.md` recorded the same open gap.
- Four new coordinator tests failed against the original implementation with
  missing expected overload exceptions.

The patch limits active plus queued retained jobs to **32 globally** and **20 per
owner**. The global count follows the existing background-work ceiling; the
owner count accommodates the existing 20-attachment album limit while retaining
room for another owner. These are conservative policy limits, not benchmarked
throughput figures.

Identical owner/asset/fingerprint requests join before admission checks, even
when full. Conflicting edits retain their 409 response. Excess distinct work
gets the existing retryable `503 MEDIA_STORAGE_UNAVAILABLE` contract before the
coordinator creates public state or `startDurableVideoFinalize` records a new
durable request.

A separate retained-entry set owns capacity. Cancelling a draft removes its
public coordinator state immediately, but holds its slot until the queued
closure or active task settles. This prevents repeated cancellation/retry from
accumulating an unbounded promise chain. Success and failure both release the
slot; the scheduler continues to see cancelled-but-unsettled work as busy.

No schema, storage representation, quota, session, provider protocol, dependency,
or deployment configuration changed.

## Acceptance evidence

Execution host: Node `v24.16.0` on Windows. Five test files, concurrency one:

```text
server/videoFinalizeJobs.test.mjs
server/videoProcessingQueue.test.mjs
server/videoProcessingIntegrity.test.mjs
server/persistenceDurability.test.mjs
server/post.idempotency.test.mjs
```

Result: **28 passed, 0 failed, 0 skipped**, about 7.6 seconds. The task launcher
uses an OS-only environment allowlist, fresh fixtures and a preload that rejects
real fetches; tests supply synthetic transport responses. It starts no app
server and touches no device.

New assertions cover global/owner caps, joins at capacity, conflicting edits,
success/failure slot release, cancellation with non-cooperative work, and the
real durable API's overload behavior. Existing durable rows and attempt counts
stay unchanged on rejection; a new rejected request creates no job; no rejected
work reaches storage/conversion; the existing retry resumes after capacity
returns and consumes exactly one attempt.

The architecture ratchet and `git diff --check` passed. No full suite, Android
compile, image workload stress test, production request, or real provider call
was needed for this slice.

Task-local supporting artifacts outside the repository:
`BASELINE.json`, `SOURCE-PRESERVATION.json`, `video-admission-before.log`,
`video-admission-after.log`, `focused-tests.log`, `TEST-RESULT.json`,
`LOCAL-DEPENDENCIES.json`, `architecture.log`, and `run-focused-tests.cjs`.
Reproduce from the task directory with `node run-focused-tests.cjs`.

## Remaining launch work, in order

1. **Durable acceptance and orderly drain.** Inject a failure in
   `recordVideoProcessingRequest`: current `startDurableVideoFinalize` schedules
   its promise before recording the durable row. This ordering is source-verified;
   its failure case was not exercised in this slice. Add atomic admission/
   persistence ownership and a bounded stop that awaits conversion bookkeeping
   before `db.close`, preserving restartable rows within the existing shutdown
   budget. The admission patch does not claim to solve either issue.
2. **Queue time and retry fairness.** The cap bounds retained work, not waiting
   time or bytes of a generic closure. The existing verifier deadline remains;
   there is no new coordinator wait deadline or round-robin scheduling.
   Per-owner admission limits monopolization but does not guarantee fairness.
   The retry scheduler waits while any coordinator work is active; sustained
   new work can still delay older durable retries.
3. **Prove operational recovery.** Verify actual private backup destination and
   recent upload receipt, then download and restore an exact snapshot in an
   isolated environment with outgoing effects disabled. Review post-snapshot
   privacy/credential changes before cutover. The signed privacy journal covers
   account erasures and marketing opt-outs; do not infer replay of every content
   deletion, block, role change or password change.
4. **Release acceptance.** Integrate against the exact candidate revision and
   perform the separately authorized beta/live test window. Unit tests do not
   establish Android upload behavior, deployed queue limits, or availability.

Later scalability work should follow observed queue latency, oldest retry age,
event-loop lag, database contention, storage growth, and converter utilization.
Additional API replicas, a shared queue, or a database replacement are not
justified by this small local change.

## Review, rollout and rollback

Review the patch against the latest candidate, retaining current owner/session
checks and the durable queue contract. Run the focused checks before any release.
An actual rollout additionally requires release authorization and staging/live
acceptance appropriate to the final candidate. Watch overload rate, queue wait,
retry age and terminal failures; a rise in 503s can indicate converter backlog.

Rollback is a code-only revert of this slice. It requires no database migration
or data restoration; persisted media identities and retry records are unchanged.
Rolling back reintroduces unbounded admission, so do not use it as a permanent
capacity remedy.

No external approval was needed for the completed local work. The following
remain outside this task's authorization:

- Push, merge and production deployment of the reviewed candidate.
- Selection/creation of a dedicated private backup bucket, bucket-scoped
  credentials, server secret configuration, retention policy and spending cap.
  Supply current provider pricing and actual snapshot size before estimating
  cost; daily full snapshots imply roughly `30 × snapshot GiB/month` transferred,
  plus retries and explicitly approved restore downloads.
- A private, off-host download/restore drill using live backup data and any
  approved test-account or media writes. Never replace the live database as
  part of the drill.

None of those actions was attempted or denied. They are future authorization
boundaries, not blockers to the completed local slice.
