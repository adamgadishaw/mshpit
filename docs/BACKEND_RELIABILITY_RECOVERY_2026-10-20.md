# Video recovery reliability: local follow-up

Implemented and tested locally on 2026-10-20. Nothing was pushed, merged or
deployed. These tests do not establish production availability or launch
readiness.

This follows admission commit `c6a610f` and supersedes the first two remaining
work items in [the baseline report](BACKEND_RELIABILITY_SLICE_2026-10-20.md).
The isolated branch is `codex/backend-reliability-20261020`, based on the tracked
source snapshot of `D:/Development/Apps/mshpit` at
`36a2533376f9857e0ad24989e2765988eae3f964`. It has its own Git index, objects and
copied test dependencies. The source HEAD and index remained unchanged and its
tracked diff remained empty in the final read-only check.

## Reproduced failures and smallest fixes

| Slice and local commit | Before | After |
| --- | --- | --- |
| Durable acceptance, `b05190f` | A SQLite trigger rejected the job INSERT, but the already-enqueued closure still made a storage HEAD and a synthetic `/v2/verify` request. | `startVideoFinalizeJob` runs synchronous durable acceptance after join/cap checks and before publishing or queuing work. A failed write creates no job, owns no capacity and starts no provider work. Existing retry state is preserved. |
| Shutdown ownership, `339258a` | Retry scheduler stop returned while accepted work still owned SQLite. Detached outcome bookkeeping was outside shutdown ownership. | Completion includes outcome bookkeeping. Stop closes admission, aborts accepted work and awaits settlement; `index.js` owns the drain even if the optional scheduler never started. SQLite closes only afterward. |
| Retry fairness, `8fe1b4d` | Sixty simulated timer ticks with continuing fresh work completed sixty new jobs but admitted no older retry. A saturated-queue regression also left the retry waiting after a slot was released. | A single scheduler callback gets the next released slot synchronously. Timer ticks may admit due work behind active work. All admissions still pass through the same 32-global/20-owner limits and serial FIFO. |

The fairness probe represents 900,000 milliseconds of virtual time, not a
production latency measurement. A retry is placed behind already accepted
work, ahead of subsequent requests competing for that released slot. This is
not round-robin scheduling or a waiting-time guarantee. A full owner allocation
can still defer that owner's retry until one of its jobs settles.

No schema, database migration, provider protocol, quota, dependency, service,
deployment setting or paid resource was added.

## Preserved contracts

- Identical owner/asset/fingerprint requests join the existing completion
  promise; conflicting edits still return 409. Saturation still returns the
  existing retryable `503 MEDIA_STORAGE_UNAVAILABLE` contract.
- Cancellation retains capacity until the closure settles. Capacity callbacks
  run only after release, are removed when the scheduler stops, and cannot
  change a settled job's result if they fail.
- A job cancelled before dispatch leaves its accepted running row and prior
  attempt count intact. Startup recovery makes that row retryable. An interrupted
  active attempt becomes retryable without charging the interrupted attempt.
- Cooperative application work and bookkeeping drain before `db.close()`.
  A storage transport that ignores abort may finish later; the existing bounded
  transport adapter discards that response before finalization can use SQLite.
- Non-cooperative owned work does not cause a false successful drain. SQLite
  remains open until the existing 25-second process watchdog exits. This keeps
  the existing shutdown budget and relies on durable restart recovery afterward.
  The watchdog is an event-loop timer, not protection against an OS hang or a
  synchronously blocked event loop.
- Current account/session checks, decoder allowances, generation checks and
  finalization idempotency remain in force.

## Verification and its limits

Node `v24.16.0`, serial test execution, fresh temporary databases, OS-only
environment allowlist and a preload rejecting real external fetches. No running
API, Metro process, beta checkout, emulator, device, shared database, account or
live fixture was changed.

| Final check | Result | Task-local evidence |
| --- | --- | --- |
| Coordinator, queue, integrity, shutdown and fairness | 33 passed, zero failures/skips; about 2.6 seconds | `fairness-focused.log`, `fairness-focused.json` |
| Broader selected media/API/transport/verifier regressions | 85 passed, zero failures/skips; about 10.4 seconds | `broader-media-final.log`, `broader-media-final.json` |
| Crash/restore plus post idempotency | 11 passed, zero failures/skips; about 6.5 seconds | `recovery-final.log`, `recovery-final.json` |
| Architecture ratchet | Passed without baseline changes | `architecture-final.log` |

These sets overlap; do not sum them as unique coverage. The broader media run
used the name filter recorded in its JSON metadata, not the full application
suite. `git diff --check` passed.

The existing `server/persistenceDurability.test.mjs` harness was extended rather
than duplicated. A child commits acceptance and dies before dispatch; a fresh
child reopens the real schema, recovers the exact request and joins a duplicate
with one synthetic output. Existing killed-WAL-writer, backup verification,
reviewed cold restore, session invalidation and queued-mail checks still pass.

The API regression counts one verifier request for an admitted retry joined
while queued. This does not prove exactly-once remote conversion across a
process crash: storage and SQLite remain separate failure domains. Real HTTP
lost-response/restart testing, a real decoder process and a real off-host restore
were not exercised here.

Before-fix evidence is retained in `durable-acceptance-before.log`,
`shutdown-before.log`, `fairness-before.log` and `retry-fairness-result.json`.
Tests and fixes are separately reviewable in the local commit sequence.

Reproduce from the enclosing task directory:

```powershell
node run-focused-tests.cjs fairness-focused server/videoProcessingFairness.test.mjs server/videoFinalizeJobs.test.mjs server/videoProcessingQueue.test.mjs server/videoProcessingIntegrity.test.mjs server/backgroundShutdownOwnership.test.mjs
node run-focused-tests.cjs recovery-final server/persistenceDurability.test.mjs server/post.idempotency.test.mjs
```

## Integration, rollback and outstanding launch work

The task-local `backend-reliability-recovery.patch` contains this follow-up after
`c6a610f`; `backend-reliability-all.patch` includes the original admission slice.
`HANDOFF.json` records exact revisions, hashes and patch validation.
Parent research used a newer upstream revision, so integrate against the exact
release candidate and reconcile its diff first.

Rollback is a code-only revert, preferably newest commit first. There is no
schema rollback or data restoration step. Reverting reintroduces the documented
failure mode; preserve durable rows rather than deleting them. Apply/rollback
checks are preparation evidence, not authority to change the beta checkout.

Launch-critical work still outside this local result:

1. Review and integrate the code into the exact candidate, then authorize a
   release/test window. Verify actual HTTP retry after a lost response and a
   restart, including current-session checks and stable published identities.
2. Verify the deployed runtime, persistent disk and SQLite settings, recent
   private off-host upload receipt and a restore of the exact downloaded backup
   in a separate environment with outgoing effects disabled.
3. Resolve post-snapshot replay coverage before any real recovery cutover.
   `server/privacyJournal.js:PRIVACY_JOURNAL_KINDS` contains only
   `account_erased` and `marketing_opt_out`. It does not replay post/comment/
   message deletions, blocks, restrictions, passwords or role changes.
   [Backup operations](../BACKUP_OPERATIONS.md#restore-replay-coverage) now
   documents the required operator reconciliation. Restore review references
   are attestations, not an automated reconstruction of missing history.

Later scalability decisions should follow measured oldest retry age, queue
wait, overload rate, conversion duration, event-loop delay, database contention
and disk growth. This work does not justify extra API replicas, microservices,
a shared queue or a database replacement.

## Remaining authorization

No approval blocker or denied action occurred in this local follow-up. Future
steps require explicit authorization for:

- Push/merge/deploy of the reviewed candidate and any live test-account/media
  writes.
- Selecting or creating the private backup destination, bucket-scoped
  credentials, production secret configuration and retention policy. Confirm
  actual snapshot size, current provider pricing and a monthly spending cap
  before committing cost; no price or spending commitment was made here.
- Accessing live backups for an isolated download/restore drill, its private
  storage location and transfer budget. A real cutover is a separate action.

