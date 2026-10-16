# MSHPIT security and concurrency audit — 16 October 2026

Audit baseline: app branch `codex/nearby-show-finder-20261015`, commit `0bbe15eaf8f68c4cd1b8fd28d973be9e5a68e693`. The baseline backend matches released master `42a36c0aec17a8a43c8e9057585634adaecaef75`. Three independent Astra ultra reviewers examined backend authorization, client identity/request lifecycles, and media/background capacity. Root independently reviewed the resulting patches. This is a bounded source audit with synthetic regressions, not a security certification or production capacity measurement.

## Highest-priority unresolved concern: public database history

GitHub repository metadata reports `adamgadishaw/mshpit` public. A metadata-only traversal of released master ancestry still finds historical `pit.db`, `pit.db-wal`, and `pit.db-shm` objects under `.tmp/browser-smoke-3107/data/`. No database blob or account record was opened, downloaded, or extracted during this audit.

Existing `SECURITY.md` already reports a privileged-looking identity and offline-crackable password hash in that snapshot. That content characterization comes from the earlier report, not new inspection. Current credential validity, prior rotations/revocations, forks/clones/caches, and exploitation are unknown. Passing current-tree privacy tests does not remove historical Git objects.

The owner needs a separately authorized containment review covering the documented credential/session response and coordinated history cleanup. This audit performed no credential extraction, rotation, revocation, access change, history rewrite, or force push. Cleanup alone would not revoke copies already obtained.

## Reproduced defects corrected in this branch

| Finding | Reproduction and correction | Scope |
| --- | --- | --- |
| Stale recommendation actions | An A → B → A transition let obsolete queued hide/Undo actions dispatch as A. Captured account-epoch checks now run before dispatch. | Client intent/lifecycle defect; no demonstrated cross-account write or takeover. |
| Preference cache resurrection | A late failed operation, or a deferred React updater, could recreate a purged preference key or overwrite the new login's state. Checks now run before rollback and inside all four state updaters. | Native preference keys are volatile memory; browser persistence is durable. No demonstrated disclosure to another account. |
| Duplicate recovery claims | Two processes both read the same eligible reset snapshot and wrote competing tokens. An atomic conditional update now claims the live cooldown; only the winning write schedules mail. | Requires concurrent database-writing processes. Does not establish exactly-once external email delivery. |
| Follow authorization after lock contention | A request passed authorization, waited for SQLite's writer lock, then followed after revocation, ban, block, or target visibility changes committed. The transaction now rechecks live authority and relationship restrictions. | Conditional multi-process race; the configured single-instance deployment reduces exposure. |
| Duplicate follow error | Two valid concurrent requests for an absent relationship produced one success and one unique-constraint error mapped to HTTP 500. The transaction now checks the relationship again before inserting/notifying. | Reliability defect; the old behavior still produced only one follow and one notification. |
| Editor decoder admission bypass | Six cancelled native cover attempts retained six players while uncancellable thumbnails finished. Native and web cover adapters now share the feed poster scheduler and preserve its cleanup permit. The same probe retains at most two players and releases both. | Actual app modules with inert native dependencies; no physical decoder/performance certification. |

Independent review found the deferred React updater issue after the first client patch; it was reproduced, fixed, and reviewed again. The final client review passed all 11 lifecycle tests. Media review passed all six scheduler tests. Backend review validated actual SQLite contention, atomic cooldown semantics, and the final duplicate-follow correction. No blocking findings remained in these changed paths.

## Protections verified within the audit scope

- Server tests cover hashed session/reset tokens, password-reset rollback and session revocation, linked-account isolation, privileged-session expiry, expected-account binding, and browser request boundaries. The server revalidates identity after asynchronous request-body reads; long-running protected operations receive a final authorization guard.
- Production client startup removes the legacy `pit.session` identity value and begins with no authenticated identity. Live native authentication uses platform cookie transport. This is not a SecureStore/keychain audit, and no owner cookie jar or private storage was inspected.
- Account-scoped purge, draft cleanup, diagnostic redaction, and identity barriers have focused tests. The API identity wait queue is capped at 128. Deadline and cancellation tests confirm listener/timer cleanup for cooperative fetch implementations.
- Ordinary API cancellation relies on transport honoring `AbortSignal`; a synthetic abort-ignoring transport remained pending until explicitly released. No native transport failure was demonstrated.
- Native drafts use SQLite JSON without app-level encryption. Android backup is disabled in app config/generated manifest; no app-specific iOS SQLite backup exclusion was found. Failed durable deletion is masked in the current process, which cannot guarantee disk erasure after process death. Device encryption, physical-device compromise, iOS storage, and OS backup behavior were not tested.

## Capacity bounds and remaining work

| Component | Verified source/test bound | Remaining limitation |
| --- | --- | --- |
| Password work | Two active, 32 waiting | Process-local; not an overall service throughput figure. |
| Video posters | Two shared active jobs, including deferred native cleanup | Waiting queue has no separate numeric admission cap; queued cancellation removes work. |
| Image worker | One active, two queued, 60 MiB queued input; worker heap 320 MiB | Reservations are not a hard whole-process/native RSS guarantee. |
| Video processing | One active coordinator job; verifier has a 15-minute job deadline | No explicit coordinator waiting-count, retained-byte, queue-deadline, or fairness limit. A direct synthetic probe accepted 48 while one ran. |
| Source upload admission | 40 outstanding objects/6 GiB per account; 10,000/128 GiB global | These quotas constrain new sources but are much larger than a small CPU queue. |
| Database | One synchronous SQLite connection per process, WAL, 5-second busy timeout | Lock waits can block that process; no production-shaped concurrent-user or p95 latency measurement. |
| Client preference coordinator | Settled queue tails clear | Latest-operation entries remain for unique account/post pairs: 10,000 synthetic pairs retained 2,391,304 bytes (about 2.28 MiB) in Node, not a Hermes estimate. P3 memory-retention follow-up. |

Further operational limits:

- The configured topology is a single disk-backed web service. Many counters, admission gates, queue owners, and interval-overlap protections are process-local. Adding instances is not a supported inference from these tests.
- Shutdown aborts verifier requests, but the video coordinator does not explicitly await queued cleanup/bookkeeping before SQLite closes. Durable jobs recover after restart; orderly drain remains a follow-up.
- Converter contention retries do not universally consume the ordinary attempt budget. Several account-export collections remain uncapped.
- Shared-email signup intentionally permits a new unverified sibling account without proving mailbox ownership first. Two synthetic requests distinguish zero/one/two occupied slots (`200,200`; `200,409`; `409,409`) and can reserve remaining slots. No existing-account takeover was demonstrated. Changing this requires a product decision about mailbox proof, sibling-account creation, expiry, and recovery; it was not silently redesigned.
- Repository Blueprint and capacity documentation are configuration evidence, not verification of current live infrastructure. Older capacity figures refer to a different service size and cannot establish today's safe user count.

## Dependency assessment

The production server dependency audit reports zero vulnerabilities. This repository keeps Expo/native/build tooling in `devDependencies`, so that result alone does not cover the mobile development graph. The full audit still reports 19 high, zero critical findings propagated through two underlying advisories: installed `braces@3.0.3` via Metro/micromatch and `node-forge@1.4.0` via Expo CLI/code-signing certificates. The [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv) list no patched versions at this audit date. These are existing findings, also recorded in the Windows setup report; 19 packages does not mean 19 independent vulnerabilities.

The installed dependency paths are development/build tooling. This pass did not prove an exploitable native-app input path or certify every runtime bundle. No package change or forced downgrade was applied; npm's suggested Expo 44/React Native 0.72 downgrades would conflict with the current SDK 57 setup. Advisory remediation and reachability remain a tracked dependency follow-up.

The fresh `expo install --check` did not pass: the current compatibility metadata now expects `expo ~57.0.30`, while this branch has `57.0.29`. Other packages were not flagged. No package was installed or changed during this audit. The newly available SDK patch requires a separate dependency update and Android/native regression pass; the successful exports below are specifically for the existing 57.0.29 tree.

## Validation and boundaries

The local full suite for the runtime patches passed **6,515 tests, zero failed, one skipped (6,516 total)** in 605.7 seconds, with `--test-concurrency=1`: 21 added passing regressions relative to the baseline. The final SECURITY.md wording edit happened after its documentation test had already run locally. Exact-head CI then caught one stale documentation assertion (6,515 passed, one failed on Linux). The assertion was updated to preserve the production/development distinction, SDK patch gap, and historical-device caveats; all three focused documentation tests passed. Runtime code did not change in that follow-up. The final exact-head CI result is recorded in the task handoff. Logs are under `.tmp/overnight/security-*.log` in the isolated checkout.

Android Hermes export passed: 2,207 modules, 9.5 MB. Web export and initial-JavaScript budget passed: 511.6/512.0 KiB gzip. Both exports used at most two workers. Isolated browser fixtures passed 27/27 account-flow cases (four linked-switch, five logout, 18 recovery) and 2/2 media-upload cases. Browser fixtures intercepted all external requests and used installed Playwright 1.62.1/Chrome in fresh temporary profiles.

Already verified: baseline backend 107/107; perimeter/privacy 29/29; final client lifecycle 11/11; final follow/request-authorization/social-revocation group 30/30; media scheduler 6/6; syntax, architecture, and Blueprint checks passed. These groups overlap with the aggregate and must not be added as independent coverage totals.

No production load, real account/email/upload/database writes, purchases, enrollment, signing changes, merge, deployment, or security/virtualization changes. The canonical website checkout and unrelated desktop media task were not changed. Tests use disposable synthetic storage and bounded worker counts.

No fresh running-app screenshot is claimed for this audit. At its start, Metro was absent and the owner emulator's read-only ADB activity query timed out; later its prior process IDs were absent. The audit did not restart or clear the emulator, change its theme/account, or revalidate its current guard. Prior screenshots and successful Android playback belong to the earlier UI pass. Android export checks JavaScript/Hermes compilation; it does not certify native-device behavior, iOS, or signed iPhone/TestFlight operation.

## Reproducible checks

From the isolated app checkout, with Node 24 and existing dependencies:

```powershell
node scripts/run-tests.mjs --test-concurrency=1
node scripts/run-tests.mjs --test-concurrency=1 server/authRecoveryConcurrency.test.mjs server/followAuthorizationConcurrency.test.mjs src/lib/recommendationPreferenceLifecycle.test.mjs src/lib/videoPosterScheduler.test.mjs
npm run check:dependencies
npm run check:syntax
npm run check:architecture
npm run check:blueprint
```

The Android compile check used local-only configuration:

```powershell
$env:EXPO_NO_TELEMETRY='1'
$env:EXPO_NO_DOTENV='1'
$env:MSHPIT_LOCAL_DEV='1'
$env:EXPO_PUBLIC_API_URL='http://localhost:3000'
$env:EXPO_PUBLIC_NATIVE_READ_ONLY_REVIEW='0'
node node_modules/expo/bin/cli export --platform android --output-dir .tmp/overnight/security-android --max-workers 2
```

The test runner always creates disposable database storage and strips inherited mail credentials. The new concurrency tests additionally allowlist their child environment and prohibit outbound fetch. No stress or capacity command against production was run.
