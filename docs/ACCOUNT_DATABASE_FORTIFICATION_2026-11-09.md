# Account and database fortification, 9 November 2026

Baseline: `dd1b90b` on the iOS experience branch. This is a bounded source review,
primary-source research and synthetic regression pass, not a penetration test,
security certification or verification of production controls. Changes remain in
an isolated local worktree; no device, live database, credential, hosting setting,
permission, deployment or publication was changed.

## Implemented corrections

### Full editor sessions follow the staff lifetime

`server/auth.js` previously treated only administrators and moderators as
privileged for session lifetime. Editors can publish public news, but received
30-day full-account cookies. The documented staff policy is 12 hours.

The shared role policy now includes editors. It applies at session issuance,
rechecks old stored sessions, caps member-to-editor promotion and carries the
original deadline through linked-account switches. Ordinary fan/artist sessions
remain 30 days. The explicitly approved remembered-Newsroom capability remains a
separate cookie/table, narrow route scope, seven-day idle and 30-day absolute
lifetime. It cannot become full account authority.

Five new tests failed against the old code and passed after the correction.
This limits a stolen editor cookie's usable window; it does not establish that a
cookie was stolen. After deployment, a previously issued full editor session older
than 12 hours will require login again. No live sessions were touched in this work.

### Offline recovery invalidates editorial API authority

`prepareRecoveryDatabase` cleared browser sessions and recovery tokens, but not
independent editorial API grants or pending pairing codes. A restored snapshot
could therefore resurrect a previously revoked seven-day grant or a pending code
that could issue a new grant. Browser logout/session deletion does not invalidate
these separately authorized capabilities.

The existing recovery transaction now:

- Revokes active media API grants and clears all remaining grant token hashes.
- Revokes pending pairing codes so they cannot mint new grants.
- Preserves grant identifiers, terminal status/history, immutable audit rows,
  idempotency receipts and content.
- Supports older schemas without these tables and preserves rollback on failure.

Synthetic tests invoke the real authorization/pairing service. They cover bearer
rejection, independent pairing rejection, retained history, repeated preparation,
late failure rollback, grant-update failure and legacy schemas. The original
helper was demonstrated to leave authorization usable after preparation.

This changes offline preparation only. Existing prepared recovery copies must be
prepared again before cutover. It does not rotate current grants, alter any live
database, replay post-snapshot password/role changes, or prove the external privacy
journal is complete.

## Research and threat priorities

1. **Stolen session and privileged publishing.** Server-enforced expiry limits
   bearer reuse. The existing product's 12-hour staff policy was enforced
   consistently rather than inventing a new global timeout. OWASP recommends
   both absolute and idle expiry according to risk; general full sessions still
   have no separate inactivity timeout. [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

2. **Credential theft and offline guessing.** Source uses salted scrypt, bounded
   asynchronous work, dummy verification for missing accounts, exact password
   comparison, reset single-use/expiry and transactional session invalidation.
   However, hashing relies on Node's default scrypt cost (`N=16384,r=8,p=1`), below
   OWASP's listed scrypt profiles, which include `N=16384,r=8,p=5`. Plan a versioned
   hash format, measured cost budget and on-login rehash before increasing cost;
   blindly changing parameters would invalidate old hashes or exhaust capacity.
   No password records were inspected or changed. [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
   [Node crypto](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)

3. **Phishing and account recovery.** Phishing-resistant MFA/passkeys and step-up
   checks for sensitive staff actions remain a high-value roadmap item. Current
   signup accepts 8–100 characters with letter/number composition requirements;
   a blocklist plus longer, flexible single-factor passwords is a separate
   coordinated UX/migration change. NIST's federal guidance is a useful design
   reference, not a claim that this consumer app is required to meet an AAL.
   [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)

4. **Crash versus rollback/restore.** WAL transactions, foreign-key checks,
   consistent `VACUUM INTO` snapshots, independent verification and a recovery
   quarantine are already present. Restoring valid pages does not restore the
   latest authorization/erasure decisions, which is why independent bearer
   revocation is necessary. Backups also need protected storage, independent
   recovery evidence and explicit retention. [SQLite VACUUM](https://www.sqlite.org/lang_vacuum.html),
   [SQLite PRAGMA](https://www.sqlite.org/pragma.html),
   [OWASP Database Security](https://cheatsheetseries.owasp.org/cheatsheets/Database_Security_Cheat_Sheet.html)

## Fresh dependency assessment

The production-only npm audit reports **zero vulnerabilities**. The full lockfile
audit reports **12 vulnerable package entries: three high, eight moderate and one
low**. Those are affected package entries, not twelve independent exploits, and
include development/build tooling omitted from the production-only audit.

The high entries include Expo CLI's dependency chain, `node-forge@1.4.0`, and
Expo's nested `zod@3.25.76`; the root server dependency is already `zod@4.6.6`.
The [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) identifies
4.6.6 as patched, so overriding Expo's 3.x dependency with 4.x is not a safe
unreviewed patch. The [node-forge signature advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
still lists no patched version. `fast-uri@3.1.8` has a
[patched 3.1.9 release](https://github.com/advisories/GHSA-w74x-v6f9-j3xg).

A coordinated SDK/toolchain dependency pass remains necessary. npm proposes
Expo 53.0.11 for some paths, incompatible with this SDK 57 checkout. No forced
fix, package installation, lockfile change or dependency downgrade was performed.
This audit does not prove each advisory is reachable in the app or certify native
binaries, Pods, build infrastructure or production configuration.

The read-only Expo compatibility check also fails ten existing patch mismatches:
`expo ~57.0.32`, `@expo/metro-runtime ~57.0.18`, `expo-asset ~57.0.21`,
`expo-build-properties ~57.0.23`, `expo-constants ~57.0.23`,
`expo-dev-client ~57.0.21`, `expo-image-manipulator ~57.0.22`,
`expo-image-picker ~57.0.21`, `expo-sharing ~57.0.25`, and
`expo-splash-screen ~57.0.11` are the reported expected versions.
The tested checkout retains its existing installed versions. A successful local
export does not close these compatibility or native-release gates.

## Important unresolved work

- **Historical Git database exposure:** `SECURITY.md` and the October 16 audit
  document historical database/WAL/SHM objects and a privileged-looking password
  hash. This pass did not open the blobs or recheck current ref reachability,
  repository visibility, credential validity, prior rotations or exploitation.
  A separately authorized containment review must establish what remains open.
  History cleanup alone cannot revoke previously copied data.
- **Backup interruption and concurrency:** source review found that killed
  backups can leave owned `.partial` files indefinitely, despite scheduler
  comments promising next-run cleanup. Completed names have second resolution;
  overwrite-capable rename allows concurrent CLI processes to collide. These
  require owned-run locking, no-replace/unique immutable publication and bounded
  abandoned-partial recovery. No kill/collision reproduction or cleanup was
  performed, and unknown partials must never be deleted indiscriminately.
- **Operational coverage:** off-host upload/restore success, provider encryption,
  alternate public URLs, least-privilege credentials, current permissions and
  restore drills were not inspected. Source code is not evidence of configured
  production coverage.
- **Other existing limits:** process-local abuse budgets; shared-email signup
  slot reservation/enumeration; incomplete post-snapshot privacy/security replay;
  no native keychain/OS backup or device compromise assessment. The phone was not
  available, and no device operation was attempted.

The review also rejected speculative changes: a synthetic reopened expression
index passed `quick_check` without UDF registration; inspected transaction-helper
callers did not pass asynchronous callbacks or intentionally commit after caught
nested failures. Neither was reported as a reproduced vulnerability.

## Verification

- Focused account group: 83 passed, zero failed.
- Initial focused restore/media/durability group: 44 passed, zero failed.
- Final independent restore regressions: six passed, zero failed.
- Independent review found no blocking issue in the changed account or recovery
  paths. Focused groups overlap; counts must not be added as unique coverage.
- Complete hermetic suite: **8,535 passed, zero failed or skipped**, in 489.6 seconds,
  single worker, Node 24.22.2, `TMPDIR=/tmp` and fresh fixture databases.
- Catalog split, syntax (926 Node files), architecture and Render Blueprint passed.
- Local web export passed with at most two workers. Initial JavaScript was
  **511.3 / 512.0 KiB gzip**. No backend deployment or device installation occurred.
- Production dependency audit passed; full dependency audit and Expo compatibility
  remain open as detailed above. Package/lock/native files were not changed.
- The final documentation check passed all three tests after results were added;
  runtime code was unchanged after the complete suite.

Reproduction from the isolated checkout with the existing dependency installation:

```sh
export PATH="$HOME/.local/node24/bin:$PATH" TMPDIR=/tmp
node scripts/run-tests.mjs --test-concurrency=1
node scripts/split-catalog.mjs --check
node scripts/check-syntax.mjs
node scripts/check-architecture.mjs
node scripts/check-render-blueprint.mjs
npm audit --omit=dev --json
npm audit --json
CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 node node_modules/expo/bin/cli install --check
CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 node node_modules/expo/bin/cli export --platform web --source-maps external --output-dir .tmp/security-fortification/web --max-workers 2
node scripts/check-web-bundle-budget.mjs .tmp/security-fortification/web
node --test documentation.status.test.mjs
```

Local evidence is under `.tmp/security-fortification/` (full/focused tests,
pre-fix reproductions, npm JSON audit reports, Expo compatibility, gates, web
export and bundle-budget report). These disposable fixture logs contain no real
account or database records. No production or real-device result is claimed.
Integrated UI/server changes require their own combined-head checks before release.
