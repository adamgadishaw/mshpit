# Database recovery remediation DB04-DB08 — November 11, 2026

Local implementation based on released `c2bbe88246f249a5fa7cd60f3184f55b6b8794bf`
(tree `4bf95da8e7a1eec74a0750e545554f0a1ff79c02`). The original database audit,
its recovery evidence and checkout were read only. No production write, restore,
credential/IAM change, push, merge, deployment, Mac/phone activity or Claude
request occurred. Synthetic faults deny outbound services. The audit established
source/reproduction defects, not corruption or an observed failed production
restore; production remains the baseline release.

## Implemented behavior

| Finding | Repair and preserved boundary |
| --- | --- |
| DB04 | v2 upload receipts bind to an opaque fingerprint of endpoint/path/bucket/prefixes, excluding credentials. Legacy/mismatched receipts are unverified. Outbox shipment identity is destination-specific. New journal events form a signed sequence/hash chain; a signed checkpoint binds its head and stream to storage. Restore validates all MACs and the entire chain against the snapshot anchor before mutation. |
| DB05 | The first regular timer follows the persisted recovery point's due time, including the existing bounded completion grace; later cadence remains daily. Startup checks and one recovery retry remain bounded. The reproduced 18-hour restart now reaches its first due check at receipt age 23h20 rather than 42h14. |
| DB06 | New partials have exclusive ownership sidecars. Reconciliation before disk admission requires one-hour age, dead PID, same host/process namespace, canonical directory and matching ordinary single-link file identities. Unknown, active, recent and foreign-namespace files remain. Aggregate partial bytes and actual free/required headroom are logged. |
| DB07 | Daily digest projects readiness, signing/storage/continuity, pending count/age, last retained shipment age and allowlisted failure category. Fifteen-minute backlog warns; one hour needs attention. No entry contents, IDs, object paths or raw errors are exposed. |
| DB08 | Runbook grants minimal rights for `db/*`, `privacy-journal/v1/*`, the exact coverage object and journal-prefix-only listing; documents signing-key continuity, conditional writes and isolated permission verification. |

## Destination continuity and interrupted work

Only the currently captured destination can receive success evidence. Credential
rotation in the same namespace preserves evidence; bucket/endpoint/path changes
do not. Full remote history survives local 30-day v2-outbox pruning. Migration
must verify the copied full chain and local durable anchor before rebinding its
checkpoint. Incomplete history fails closed. A copied checkpoint remains
retryable when remote publication precedes local commit; a partially uploaded
suffix is accepted for shipment repair only if it exactly matches the live
immutable outbox. Replay never accepts that incomplete suffix.

Initial checkpoint claims use `If-None-Match: *`; updates use authenticated strong
ETags and `If-Match`. Calls on one SQLite handle coalesce, and conditional writes
fence stale remote publishers. Failed/aborted checkpoint publication cannot mark
entries shipped or prune them. Subsequent smaller batches resume confirmed
progress without rolling the checkpoint back.

Existing journal schemas and old snapshots lack proof of pruned history. They
are explicitly unknown, rather than silently promoted by resetting timestamps.
They require the existing recorded `PRIVACY_JOURNAL_REPLAY_WAIVER` recovery
decision after manual reconciliation. Legacy rows are retained; new v2 rows
retain bounded local shipment retention. This is a restore constraint, not a
new live-service startup gate or a retrospective release condition.

## Local schema and deployment implications

Initialization idempotently adds nullable `entry_json` and
`shipped_storage_identity` columns to `privacy_journal_outbox` and a continuity
record in `app_meta`. These changes ran only on disposable local fixtures in
this task. Journal append and head advancement use one savepoint inside the
caller's privacy-change transaction. Existing restore quarantine, credential
invalidation, account reconciliation and independent snapshot integrity checks
remain in place.

No deployment is included. An older binary cannot provide the new continuity
guarantees: reverting code would need a separate reviewed recovery decision.
Keep signing keys and complete journal chains while corresponding snapshots
remain recoverable; a new snapshot is not proof that historical keys can be
discarded. Provider acceptance of scoped rights and conditional writes has not
been tested against a real bucket here.

## Verification

The checked-in tests cover receipt identity/restart timing, real killed-child
partial cleanup, actual application privacy handlers, and a synthetic SQLite
snapshot/continuity matrix. Final aggregate command results are recorded in the
local implementation handoff. Results on Node 24.16.0:

| Check | Result |
| --- | --- |
| Final recovery suites | 161 tests: 160 passed, zero failed, one Windows file-symlink privilege skip. |
| Full suite, first attempt | 7,257 passed, one unchanged web-map body-deadline test failed, one skip. |
| Isolated unchanged web-map file | 18/18 passed; no source change to that test. |
| Full suite, already-started retry | 7,258 passed, zero failed, one skip. This preceded the final legacy-table guard/regression and journal log redaction; the final focused run covers those changes. |
| Required `npm run check` | Attempted; retry reached dependency audit after passing tests, then stopped at sandbox `EACCES`. Every remaining constituent gate was completed separately. |
| Dependency audit | Read-only audit rerun with network permission: zero production-dependency vulnerabilities. |
| Syntax / architecture / diff | Passed: 936 Node files; architecture baseline tightened by removing explained scheduler catches; whitespace clean. Final changed journal files were syntax-checked again. |
| Expo web production export | Passed, including initial JavaScript budget 507.5/512 KiB gzip. |

The integration owner will run aggregate gates on the combined remediation.
The first failed attempt and its isolated rerun remain in the local evidence;
no flaky-test assertion was weakened. Relevant focused suites include:

- `scripts/backup-db-partials.test.mjs`, `scripts/backup-db.test.mjs`,
  `scripts/start-production.test.mjs`.
- `server/backupScheduler.test.mjs`, `server/periodicJobScheduler.test.mjs`.
- `server/privacyJournal.test.mjs`, `server/privacyJournalContinuity.test.mjs`,
  `server/privacyJournal.integration.test.mjs`.
- `server/siteHealthDigest.test.mjs`, `server/databaseRecovery.test.mjs`,
  `server/backupStorageSecurity.test.mjs`, `server/backupTransfer.test.mjs`.

The continuity matrix includes empty and partial changed destinations after
local pruning; all retained snapshot anchors; complete copied migration;
missing/tampered/wrong-key/wrong-stream objects and checkpoints; valid fresh
zero-entry coverage; unknown legacy history and explicit waiver; interrupted
shipments and retries; stale writers and reused destination protection. All
fixtures and credentials are synthetic. Windows cannot create file symlinks
under the current token; junction and hardlink protections are exercised.

Shipping is bounded to 200 events per batch and two minutes of transport;
restore replay to five minutes. Existing enumeration limits remain 20,000
objects/1,000 pages/4 MiB listing/4 KiB object. Bounds fail closed rather than
truncating history. Large archival streams need a separately reviewed recovery
method. A successful synthetic drill does not prove real bucket survival,
production IAM, remote retention or a completed production restore.
