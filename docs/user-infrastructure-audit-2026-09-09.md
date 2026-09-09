# User infrastructure: bottom-up audit

Date: 2026-09-09. Baseline: `0eb2b39`. Scope: preserve the existing product and
member data; reproduce defects, repair the affected boundary, then test upward.
No production database, account, content, credentials or hosting settings were
changed during the audit. This is an evidence-backed engineering review, not a
claim that all security or production capacity risks are eliminated.

The versioned Expo 57 documentation and Expo networking skill informed the
deadline/cancellation work; existing account-identity safeguards were preserved.

## Layer map

| Layer | Boundary reviewed | Result |
| --- | --- | --- |
| 0. Persistence | Mounted database, migrations, transactions, WAL, backups | Strengthened metadata and snapshot verification; exercised real crash rollback and member-graph recovery. |
| 1. Accounts | Signup, verification, password reset/change, linked accounts | Disconnected requests cannot commit once cancellation is observed before the write. Existing account-choice and recovery contracts remain. |
| 2. Sessions | Cookies, revocation, self reads, request identity | Self responses revalidate the original live session; startup request waits now have deadlines, cleanup and final readiness checks. |
| 3. Permissions | Restricted accounts, blocks, comments, feeds, ratings, follows, DMs | Fixed dormant-member visibility in reply ancestors and recommendations; extended restricted-actor coverage. |
| 4. Publishing | Asset ownership, upload/finalize/attach, retries, sharing | Existing generation, ownership and cancellation protections passed targeted tests. No additional media authorization bypass reproduced. |
| 5. Client state | Local persistence, account transitions, forms, recovery | Fixed obsolete private fallback resurrection and mutable fallback snapshots. Full-app browser and real-server tests cover transitions. |
| 6. Runtime | Request admission, queues, caches, shutdown, deployment policy | Fixed a feed-cache index leak and reviewed existing resource bounds; live capacity and deployed configuration still require operational evidence. |

## Repairs and preservation guarantees

### 0. Durable member data

- A missing or invalid schema-version marker is rejected read-only before
  migrations. There is no automatic bootstrap, repair or destructive recovery.
- New backups compare their actual source's table and column inventory with the
  produced snapshot. Durable relation tables also receive conservative row-count
  floors, including comments, follows, messages, attendance and media associations.
  Missing empty tables and views substituted for real tables are rejected too.
- This source comparison applies when creating a backup. Standalone verification
  of a historical backup does not suddenly require newer schema tables.
- Date-shaped directories no longer masquerade as completed backup files or
  enter backup-file retention. Existing real snapshots remain untouched.
- A real killed-writer fixture proves committed accounts, posts, comments,
  messages, likes, follows, ratings, attendance and preferences survive; an
  unfinished update/deletion rolls back. A real-schema snapshot is verified,
  reopened, and checked for the same member graph.
- A proposed global foreign-key scan at every production startup was rejected
  during review: it could introduce unbounded startup work and block on historical
  rows without live evidence. Full integrity and foreign-key checks remain in
  backup verification. The startup addition is only a small metadata lookup.

Evidence: `server/dataDirectory.js`, `server/databaseTransaction.test.mjs`,
`server/persistenceDurability.test.mjs`, `scripts/backup-db-verification.mjs`,
`scripts/backup-db.mjs`, `server/backupScheduler.js` and their tests.

### 1–2. Accounts and sessions

- Added cancellation checks before expensive authentication work and before
  final account, credential, session or linking writes. Existing bounded password
  operations can finish after disconnect, but their result cannot commit if
  cancellation has already been observed.
- `/api/me` and verification's private self response now recheck the original
  session. A captured user object no longer authorizes private data after logout,
  expiry or a role change. Current restrictions/profile fields are read fresh.
- A verification token can still finish address confirmation and replay its
  committed receipt; it does not grant a revoked browser session private data.
- Both JSON and share-image request deadlines now include the cold-start account
  handshake. Cancelled and timed-out waiters are removed instead of accumulating
  behind a promise that may never resolve.
- Readiness is checked in the actual dispatch continuation. Tests reproduce both
  same-turn invalidation and invalidation between asynchronous continuations.
  No unfenced request may escape while identity is unvalidated.
- Existing explicit expected-account headers and response generation checks stay
  intact. A response for account A cannot be adopted after switching to B or
  switching A → B → A. Deliberate identity discovery still works.

No session-token redesign was needed: the existing system uses revocable server
sessions, not a JWT access/refresh pair. Introducing a second token system would
not address the demonstrated boundary defects.

Evidence: `server/accountFoundation.test.mjs`, `server/requestAuthorization.js`,
`server/api.js`, `server/features/accountOnboarding/`, `src/lib/api.js`,
`src/lib/apiIdentityLifecycle.test.mjs`, `src/lib/requestControl.mjs`.

### 3–4. Permissions and publishing

An active reply could reintroduce a dormant author's hidden parent comment,
including its text and identity. The ancestor query omitted the dormancy field
used by the shared visibility check. Adding that projection fixes the leak;
stored comments are not removed or rewritten. Tests cover guests and members,
small/full pages, restricted authors, blocks in both directions and active
ancestors that should remain visible.

Recommendation selection and existing-cursor reads also omitted the dormant-author
check. Both now exclude dormant authors without modifying posts, while retaining
their existing ban, suspension, block and pagination rules. Regression tests cover
fresh and already-issued feeds for guests and members.

The adjacent regression matrix passed for independent media owners, foreign
asset/variant IDs, current-session checks before finalization/attachment,
cancel-versus-publish races, immutable post retry receipts, profile media,
revisions, ratings/follows/messages, block enforcement and DM contact/age rules.
These tests do not prove a real storage provider is reachable or correctly
configured; user-facing storage 503s still require live health/log evidence.

Evidence: `server/commentAncestorPrivacy.test.mjs`,
`server/requestAuthorization.test.mjs`, `server/recommendationSnapshotLifecycle.test.mjs`,
the existing media lifecycle and API
integrity suites, and the prior `security-auth-deep-audit-2026-09-08.md` review.

### 5. Local state and user flows

A failed local save retained a fallback value in memory. After a later successful
save, a subsequent storage read failure could resurrect that obsolete value.
Recovered durable saves now retire only the obsolete fallback; they do not erase
the durable draft or add another healthy-storage cache.

Genuine failed-write fallback uses independent JSON snapshots, matching durable
storage semantics. Mutating a caller's object or returned draft does not silently
change saved state. Unserializable writes preserve the previous usable value and
privacy-removal marker while reporting a storage error.

Browser coverage exercises mobile/desktop layouts, real credential forms and
password-manager hints, duplicate-submit prevention, signup steps, Back/Cancel,
logout failures and reload, linked-account switching, expired sessions, stale
startup caches and offline recovery. An additional isolated actual-server run
uses real HttpOnly cookies, cookie rotation/revocation, single-use password reset,
password change and concurrent authenticated reads for distinct accounts.

Evidence: `src/lib/persistenceAdapter.mjs` and tests,
`scripts/verify-auth-browser.mjs`, `scripts/verify-auth-real-server.mjs`.

### 6. Existing runtime protections checked

Fixed an auxiliary recommendation-cache leak: expiring a cursor removed its
snapshot but not the viewer-to-snapshot index. A deterministic reproduction left
255 viewer entries with zero snapshots, exceeding the 250-snapshot bound. Expiry
now removes only the matching index entry, never a newer head for that viewer.
Tests cover repeated expiry, capacity eviction, foreign viewers and pagination.
This is a demonstrated retention bug, not proof of the cause of a historical OOM.

- Streamed JSON buffering is capped at 256 KiB; request origin checks and
  post-body session validation remain enforced.
- Password work is limited to two active operations and 32 waiting jobs; rate
  limiter storage has a 50,000-key ceiling.
- Image preparation/generation and sharing use bounded concurrency, queues,
  bytes, owner fairness, memory admission and isolated child processes.
- Share artwork cache is bounded by both count and bytes. Shutdown stops
  schedulers, signals cancellation and closes SQLite, with a forced-exit deadline.

## Verification

- Final `npm run check`: **3,999 passed, 0 failed**; dependency audit reported
  **0 known vulnerabilities**; syntax check passed for **552 Node files**;
  architecture check and production web export passed.
- Initial JavaScript: **493.1 KiB gzip**, below the existing **512 KiB** budget.
- Exported-app browser matrix: **30/30 passed**, including mobile and desktop
  flows and credential form semantics.
- Final actual-server browser/session matrix: **9/9 passed**, rerun after the
  recommendation repairs, against the final exported build
  `index-1a29a4d08b3e7cd406986cae8bf236a7.js`.
- Concurrent reads for 5, 10, 50 and 100 distinct fixture accounts returned the
  correct account each time. These are correctness checks, not production load
  targets.
- Local evidence logs (ignored, not committed):
  `.tmp/user-foundation-final-check-20260909.log`,
  `.tmp/user-foundation-browser-20260909.log`, and
  `.tmp/user-foundation-real-server-final-20260909.log`.

All database and concurrency experiments use throwaway synthetic fixtures, not
live traffic. Mobile browser viewport coverage is Chromium emulation, not a
physical iPhone/Safari or native-device certification.

## Remaining operational work, in order

1. Confirm the pushed commit is actually deployed, then inspect authenticated
   moderation health for private-media isolation, processing capability, memory
   headroom and recent request IDs. A Git push is not proof of a healthy deploy.
2. Verify a recent private off-host backup and perform a controlled restore drill
   on an isolated target, including referenced media objects. Local SQLite tests
   cannot certify external backup credentials, storage policy or recovery time.
3. Measure memory, CPU, queue rejection and event-loop delay under realistic mixed
   traffic. The local concurrent account-read test proves isolation/correctness,
   not Render throughput or the absence of every memory leak.
4. Exercise iPhone Safari and native-device upload/Back/background/reconnect flows.
   Public derivatives and presigned capabilities retain their cache/expiry window;
   immediate revocation requires a different delivery contract.
5. Before adding service instances, coordinate rate limits, background ownership
   and capacity admission across processes. Current safeguards are per-process.

Important limits: HTTP request-receipt timeouts are not universal handler execution
deadlines; oversized bodies stop buffering but are still drained. Disconnects
cannot undo an already committed action. Deploy shutdown may interrupt long video
work, so retry/idempotency remains necessary. Concurrent legitimate member deletes
can conservatively fail a backup row floor and cause a retry. The repository uses
`/api/health` for its Render probe; live service settings were not inspected.
