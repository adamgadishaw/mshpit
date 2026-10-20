# Backend reliability release candidate

Local verification only, 2026-10-20. No push, merge, deployment, live data
operation, credential change or paid resource was performed.

This document extends the historical
[admission report](BACKEND_RELIABILITY_SLICE_2026-10-20.md) and
[recovery report](BACKEND_RELIABILITY_RECOVERY_2026-10-20.md). Their statements
about untested HTTP recovery describe the earlier stage; the case below now
covers that local acceptance boundary.

## Exact baseline and preserved work

GitHub `adamgadishaw/mshpit` master was read again during this verification and
resolved to `66a0604690d8f4aef435592321b7df1034d19172`. This is a source release
baseline, not evidence of the revision currently serving production.

The original development checkout at `D:/Development/Apps/mshpit` was read
only. The original isolated branch, `codex/backend-reliability-20261020`, and
all five commits through `545c0d18a65c586329b56576731a0810f6cf1d9e` remain
available. The new isolated branch is
`codex/backend-reliability-release-20261020`.

| Earlier isolated commit | Release-based commit | Scope |
| --- | --- | --- |
| `c6a610f` | `f6b6fff` | Bounded admission; identical retries join before limits |
| `b05190f` | `0eaa907` | Durable acceptance before dispatch |
| `339258a` | `d088cd5` | Shutdown owns completion and database bookkeeping |
| `8fe1b4d` | `f4c656c` | Released capacity is offered to due durable retries |
| `545c0d1` | `7d6fcaf` | Evidence and restore replay boundaries |

All five cherry-picks applied without conflicts and retained identical stable
Git patch IDs (`CANDIDATE-RECONCILIATION.json`). An exact tree comparison,
not a merge-base comparison, found changes in `server/api.js` between the old
snapshot and master. The queue, shutdown entrypoint, existing affected tests,
package files and Blueprint compared identically. The final API delta was
reviewed to retain the newer release's unrelated changes.

New commit `f2d9792cba63f59cdb5681d87f1f8e1a10accce6` adds only HTTP recovery
coverage and its test transport fixture. The aggregate checks target this
code tree; subsequent changes to this report do not change application code.
No schema, dependency, deployment configuration or provider protocol changed.

## Real HTTP acceptance case

`server/persistenceDurability.test.mjs` reuses the existing crash/restore
harness. It launches the actual `server/index.js` in disposable child
processes with an actual loopback listener, real routes, sessions and SQLite.

1. A loopback proxy receives a committed finalization response and destroys the
   client connection before delivering response bytes. The client observes
   `ECONNRESET`. The same mechanism loses a committed post-create response.
2. The server is killed while its accepted video is waiting on source storage.
   A new process reopens the same temporary database and its startup scheduler
   resumes the durable request.
3. HTTP retries join the pending video and return the original post identity.
   Releasing storage yields one verifier call, one poster upload, one render
   variant, one poster variant, one post, one media link and one receipt.
   Foreign-key checks remain clean.
4. After another cold restart, completed retries retain those identities and
   make no storage HEAD, verifier or poster-upload calls. A changed post
   mutation returns 409. Logout makes both retry routes return 401.

`scripts/fixtures/recovery-http-preload.mjs` rejects outbound network and
requires a fresh temporary fixture directory, test environment and IPC.
Provider storage and the signed verifier are synthetic. The output video bytes
are deliberately not a real decoder result. The test does not establish
exactly-once remote conversion if a process dies after remote output but before
local commit, provider availability, real ffmpeg behavior or production
recovery performance.

The focused case passed in approximately 6.8 seconds. The test initially used
a hand-built stale photo snapshot; it now uses the application's actual
`buildStatusCreateBody` client helper. That was a fixture correction, not a
production defect.

## Aggregate verification

Results are recorded in the enclosing task directory as
`candidate-<stage>.json` and `.log`. Each result records the tested commit,
tree, arguments, runtime, duration and exit status.

The local runtime is Node 24.16.0 with SQLite 3.53.0. The runner uses one
test/export worker, task-local temporary directories and caches, an OS
environment allowlist and no live credentials.
Dependencies are ordinary copies from the installed development tree; no
installation scripts or source dependency mutations occurred. This is not a
fresh Linux `npm ci` reproduction.

| Gate | Local result |
| --- | --- |
| Catalog and Render Blueprint | Passed |
| Full test suite | 6,709 passed, zero failed, one skipped; 683 seconds |
| Production dependency audit | Passed; zero reported vulnerabilities |
| Syntax | Passed; 864 Node files |
| Architecture | Passed; no baseline relaxation |
| Web export | Passed; 1,082 modules, one worker |
| Initial JavaScript budget | Passed; 511.8 / 512.0 KiB gzip |
| Hosted-settings suite | 6,709 passed, zero failed, one skipped; 632 seconds |

The skipped test is the existing dangling-symlink restore case because this
Windows host does not permit file symlinks. The public npm registry was
unreachable in the restricted sandbox; an approved retry with empty npm
configuration and only task-local cache writes completed the audit.

The hosted-settings check starts with the workflow's environment flags.
The existing runner deliberately forces test mode and throwaway storage and
removes `RENDER` and mail credentials. This verifies that environment boundary,
not the behavior or capacity of production infrastructure. The two full runs
repeat the same cases; their counts must not be added as unique coverage.

## Release and rollback checklist

The following is preparation, not authorization to perform a release.

1. Confirm the intended Render workspace and identify the production service,
   live deploy ID/SHA, repository branch, actual auto-deploy trigger and
   previous retained artifact. Reconcile any difference from `66a0604` before
   calling this candidate current. The repository's `checksPass` setting is
   not evidence of the live setting.
2. Review and authorize integration of the exact combined patch. Run the
   repository's Linux Quality workflow, including fresh installation and
   browser regressions, on the final integrated SHA. Keep unrelated beta work
   out of this change.
3. Before the approved release window, record actual Node and SQLite versions,
   mounted persistent data directory, `journal_mode`, `synchronous`,
   `foreign_keys`, `busy_timeout`, disk headroom, and the current verified
   backup/upload receipt. Do not print credentials or member data. The source
   requests WAL, foreign keys and a 5-second busy timeout; local assertions do
   not prove those production settings.
4. Confirm a recent private off-host backup can be downloaded and restored in
   an approved isolated environment with outgoing effects disabled. Before
   any real recovery cutover, reconcile post-snapshot deletions, blocks,
   restrictions, password and role changes as described in
   [backup operations](../BACKUP_OPERATIONS.md#restore-replay-coverage).
   The current signed journal covers only account erasure and email opt-out.
5. Approve the deployment and interruption window. Render persistent disks
   disable zero-downtime deployment. Preserve the existing 25-second application
   watchdog within Render's documented default 30-second termination window;
   disk-backed services cannot configure a custom shutdown delay.
6. After deployment, verify the exact live SHA, core `/api/health`, strict
   `/api/readiness`, decoder/private-storage readiness and recovery of accepted
   jobs. Any live upload/post/restart acceptance test needs separately approved
   disposable accounts, media and cleanup. Observe errors, oldest retry age,
   queue saturation, conversion latency and memory/disk headroom.
7. If the release regresses, use an approved retained prior artifact or a
   reviewed code revert. This patch adds no migration to reverse. Preserve
   durable rows and the persistent disk; a deployment rollback does not roll
   back disk contents. Verify auto-deploy settings after rollback: API
   rollbacks do not automatically disable auto-deploy, unlike Dashboard
   rollbacks. Reverting these commits reintroduces their documented defects.

Current official references were read for these operational constraints:
[deploy lifecycle](https://render.com/docs/deploys),
[rollback behavior](https://render.com/docs/rollbacks), and
[health checks](https://render.com/docs/health-checks).

## Pending evidence and exact authorization

Production metadata is pending because no Render workspace was selected.
Discovery returned `My Workspace`; the existing question asks the user to
identify it as the intended workspace. No service,
deploy, secret or live database read has been substituted for that answer.
The Render monitor skill explicitly requires workspace identification when no
workspace is selected. Local release reconciliation and tests completed
independently. Source inspection confirms public health omits the commit;
the revision is in staff health. No account access was used as a substitute.

Approval is still needed for push/merge/deployment, any live test data or
restart, and any access to live backups for a restore drill. If off-host backup
storage or credentials are missing, separately approve the private destination,
credential scope, retention and monthly spending cap after measuring snapshot
size and current provider pricing. This patch requires no new paid service;
no cost estimate or production capacity claim is inferred from these tests.

Later scaling work should follow measurements. No additional API replica,
database replacement or service split is justified by this local result.
