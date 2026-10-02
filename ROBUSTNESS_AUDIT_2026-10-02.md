# Targeted robustness follow-up, October 2, 2026

Base: held integration `a7d48903016a3bf5d7da62240c91992a761e7133`, tree
`c17e78e8b9036795409721bd339f0d4d91b6d9a6`. Branch:
`codex/robustness-hardening-20261002`. This is a local candidate; deployment is
held. Production state was not queried in this follow-up. The earlier source
review of `7bb3c618` and later held integrations must not be confused with
deployed protection. Other active category UI, catalogue API and media worktrees
were excluded and left untouched.

The owner authorized a narrow implementation after an exact file-scope notice.
This pass addresses the unresolved A3, REC-1, REC-2 and CB-01 findings. It does not
repeat or supersede the comprehensive audit ledger, reopen already integrated
directory/signup/identity work, or close historical operational requirements.
The prior reports in `SECURITY.md` remain applicable within their recorded scope.

## Findings and resulting behavior

### A2: clips candidate scanning remains open

`server/api.js:6872` still implements the clips endpoint with repeated batches of
candidate posts until it finds sufficient usable clips or exhausts the candidates.
An output page size does not bound candidate hydration and validation. Sparse or
invalid historical media can therefore make a permitted read expensive. Admission
limits help with request volume but do not preempt its synchronous database work.

No A2 runtime/client change is included. A proposed 256-candidate budget would
need an explicit continuation contract: an eligible clip might be further ahead
even when a bounded response has no clips. Updated clients could request that
contract and offer a deliberate continuation action. Older clients need a clear
failure at an ambiguous scan ceiling rather than a false end-of-feed or silent
empty-page regression. Retrying the same legacy cursor against unchanged data
does not guarantee progress. A durable eligibility index is a broader alternative
requiring schema, backfill, media-write and privacy invalidation work. The owner
decision remains pending; neither option has been silently implemented.

### A3: saturated limiter cleanup and rollback accounting fixed locally

`server/rateLimitBuckets.js:4` and `server/auth.js:146` replace repeated full-map
expiry scans with an indexed min-heap, one node per key. Admission and idle
maintenance remove at most 64 expired entries at a time. Insertion/removal costs
O(log n); denying a new key when every entry is live inspects the earliest expiry
once. The existing 50,000-entry application cap remains and live entries are not
evicted. New identities may still be denied while that capacity is occupied.

Counter replacement also preserves reservation ownership: a rollback cannot erase
a later admission that occurred after the reservation. An uncontested rollback
still restores the previous count and expiry. All route quotas, account/IP key
selection and existing fixed-window semantics remain.

`server/healthAvailability.js:11` and `server/index.js:636` isolate health/readiness
from application-map exhaustion in a 1,024-identity pool while retaining the
120-per-IP-per-minute allowance. Health can still be limited by its own pool,
the event loop or SQLite. There is no user-agent bypass for purported crawlers.

Safe proof: an extracted exact-base limiter section and the new implementation
received 50,000 live keys then 1,000 overflow denials. Expiry inspections fell
from 50,000,000 to 1,000; the old interleaved rollback lost a later admission and
the fixed version retained it. Instrumented timings are not production capacity
measurements. Actual loopback HTTP tests show health/readiness still respond at
application saturation and ordinary API admission still rejects over-budget work.

### REC-1: interrupted backup ownership and cleanup fixed locally

`scripts/backup-db-ownership.mjs:29` owns a permanent, private
`.backup-ownership-v1.sqlite` file in the backup directory. `BEGIN IMMEDIATE`
serializes participating backup execution, cleanup and retention; zero lock wait
fails contention promptly. Process death releases the kernel lock. Its file must
not be unlinked to recover ownership, which could create independently locked
inodes. It is internal coordination metadata, not an application schema change.

`scripts/backup-db.mjs:149` holds ownership through snapshot verification and any
upload, sweeps abandoned files before disk preflight, and cleans its exact partial
and sidecars after closing SQLite. `server/backupScheduler.js:269` and
`scripts/start-production.mjs:70` attempt owned cleanup only after child closure.
Scheduler timeout requests termination and waits for actual closure.

Only matching backup partial names and SQLite sidecars with demonstrably dead
PIDs are reclaimed. Live, reused, permission-denied or ambiguous identities,
links, nonregular files and unrelated names remain untouched. Completed snapshots
are not partial-cleanup candidates. POSIX ownership/directory protections and
Windows's more limited identity checks are described in `BACKUP_OPERATIONS.md`.
Older backup scripts do not participate in this lock and must not overlap a run.

Safe proof: a real VACUUM subprocess over a 128 MiB synthetic database was killed
after producing a 6,893,568-byte partial. Its partial and journal survived the
kill; the next actual CLI run removed them, preserved the previous complete
snapshot, produced a verified new backup and restored content offline while
clearing synthetic sessions. Another process proved prompt lock contention and
lock release after death. A startup-timeout test waits for a marker proving the
child created its partial/journal before killing it.

### REC-2: legacy poster shutdown now cancels and drains locally

`server/legacyVideoPosters.js:507` retains its active promise and cancellation
controller. Request timeout and shutdown cancellation reach poster verification;
cancellation is rechecked before further requests or persistence. `stop()` returns
the active drain. `server/index.js:904` initiates cancellation and line 941 awaits
the drain before closing SQLite. The existing 25-second hard process deadline
remains the fallback if work ignores cancellation indefinitely.

Tests cover abort-aware and late-settling transports, no new work after stop and
database-close ordering. The old `ERR_INVALID_STATE` required a synthetic process
kept alive after database closure; ordinary shutdown exits immediately. No
corruption or permanent data loss was demonstrated, and this patch is not a
claim that a forced operating-system kill runs graceful cleanup.

### CB-01: fresh authority around asynchronous drafting fixed locally

`server/features/newsDesk/newsDeskEditorRoutes.js:98` supplies a fresh writer
authorization callback tied to the original actor and checks it before returning
the response. `server/features/newsDesk/newsDeskEditor.js:252` invokes it before
work, after asynchronous article work, immediately before paid admission and
inside the draft/audit transaction before insertion and after the audit callback.
Session expiry/revocation, demotion, verification/restriction changes and request
cancellation therefore prevent unauthorized continuation at those boundaries.

Provider settlement occurs before the guarded draft transaction. Already incurred
spending remains recorded when draft/audit persistence rolls back; definitely
rejected and uncertain provider failures preserve existing ledger semantics.
Local tests use real SQLite, session/authorization code and route handlers with
synthetic article/model transports. They are not an actual-listener or real paid
provider test. Thirty async/response cases and two transaction-boundary cases
supplement the existing editor/mutation/category tests.

## Verification and limits

Focused checks: A3 56 passed; CB-01 56 passed; recovery 81 passed with one Windows
symlink-permission skip; related recovery 47 passed with one such skip. Selections
overlap and must not be summed as unique tests. The first CB-01 run had three
fixture failures from using NULL for the non-null verification field; changing
the fixture to the existing zero sentinel resolved them.

The final `npm run check:deploy` passed 6,018 tests with zero failures and two
Windows symlink-permission skips, syntax for 827 Node files, architecture and
the web export. Initial JavaScript is 523,199 gzip bytes against a 524,288-byte
budget (1,089 bytes of headroom), unchanged from the held integration. The first
checkpoint stopped at a changed unexplained-catch signature in the scheduler.
The timeout signaling catch now reports a sanitized cause; the architecture
baseline was narrowed from two unexplained catches to one, with no new exemption.

`scripts/verify-local-robustness.mjs` starts actual `server/index.js` on loopback
with an exported web app and a fresh synthetic SQLite directory. Its preload
denies outbound transports, DNS, nested subprocesses and workers before app
imports; the optional sitemap subprocess therefore deliberately fails closed.
The harness covers mixed browsing/identity/privacy, repeated desired-state likes,
comment idempotency/replay/conflicts, over-budget reads and recovery, a 32-job
coordinator boundary and a separate short SQLite writer lock. The coordinator
uses a deterministic private memory lease, not real host memory pressure. The
native SQLite call is observed but not replaced. Its existing synchronous
5,000 ms busy timeout remains unchanged.

All five actual-server checks passed. The 35-read burst admitted 30 and returned
five controlled 429 responses, with health and later reads recovering. The queue
admitted 32 of 34 jobs, rejected two, ran at most one and recovered after a job
failure. A separate writer lock held for 279.7 ms delayed the request to 327.7 ms;
both writes and idempotency receipts survived, integrity was `ok`, and no foreign
key violations appeared. These small local timings are descriptive, not capacity
benchmarks. No outbound transport attempt occurred; one optional helper was
deliberately blocked. The owned process and temporary directory were cleaned up.

The first harness startup failed because its DNS guard also intercepted Node's
numeric loopback bind lookup. Only the exact `127.0.0.1` literal fast path is now
allowed; other DNS and outbound transports remain denied. Both final harness files
passed direct syntax checks after that fixture-only correction. Failed-run logs
remain retained; this was not a production or application regression.

Evidence is retained outside the source tree under
`remediation-evidence/robustness/`: exact source manifests, raw logs, baseline
comparison and final handoff bind the checks to the local candidate. The earlier
successful production dependency audit reported zero advisories and was reused
after exact `package.json` and lockfile hash verification. This is not a fresh
vulnerability lookup; `check:deploy` plus that bound audit covers the component
gates rather than claiming a newly executed `npm run check` audit request.

Not tested: production traffic/capacity, September 30 incident causation, external
targets, real user data, real mail, paid providers, remote object-store recovery,
Linux signal/permission behavior, native devices or A2 continuation UI. No
credentials, production settings, pricing, infrastructure or confidential-media
policy changed. H1 historical Git/credential closure and M1 unpublished-media
confidentiality remain owner decisions. Editor's 30-day TTL versus admin/moderator
12 hours is a policy observation; it was not changed or labeled an exploit.

Limits remain process-local and do not assure fairness under many accounts/IPs.
Shared-IP users share guest allowances; legitimate crawlers receive the same
resource protections without a spoofable user-agent exemption. Whole-catalog
count/order work, deep feed offsets, synchronous SQLite waits and A2 remain
relevant constraints. These fixes reduce specific failure modes and do not
establish immunity to denial of service.
