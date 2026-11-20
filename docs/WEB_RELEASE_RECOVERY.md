# Web release recovery

This narrow change keeps old tabs working when their fingerprinted web assets are retained, and gives new clients an explicit recovery path when an asset cannot load. It does not migrate accounts, clear local storage, change credentials, or deploy anything by itself.

## Client behavior

An import retries once. A recognized browser chunk failure then renders an in-place recovery card instead of automatically replacing the document. Optional preloads still reject quietly; ordinary render errors and native behavior retain their existing paths.

The explicit recovery action flushes supported mounted post/newsroom drafts, verifies their exact durable browser-storage contents and account ownership, then asks before reloading. Account identity and durable sign-in-intent receipts are checked before saving and again after the dialog. A failed save, denied storage, unfinished post edit, selected temporary media, or active registered operation blocks in-tab reload. The person can keep the existing tab or open a fresh same-origin tab without carrying account-link tokens in the URL.

An already-unmounted error boundary cannot flush former forms. Its recovery screen says that only previously saved drafts can be restored; an explicit loss warning precedes any reload. Arbitrary form state, raw File/blob media and all in-memory work are not promised to survive a document replacement. After an account validation epoch changes, an old recovery registration remains invalid; a freshly mounted composer or new tab can register after validation settles.

Already-loaded pre-feature JavaScript does not acquire this behavior retrospectively. Retaining its exact assets can prevent a failure, but this change cannot reconstruct the already-missing incident News chunk without a verified complete original artifact.

## Retention design

The web build produces a private deterministic manifest outside public `dist`. It includes every approved fingerprinted web JavaScript/CSS file and imported asset, byte sizes, MIME types and SHA-256 digests; dependency checks reject incomplete graphs. Stable code dependencies must remain available and compatible at their original paths.

Production startup keeps the mandatory database backup as its first gate. The optional archive step then runs in a separate child process with a 30-second deadline, using the existing data directory's `web-asset-cache/v1` subtree. Complete verified files are published atomically before the server uses their bounded lookup index. A cache failure does not bypass the database backup gate or prevent serving the current build.

| Bound | Limit |
| --- | --- |
| Entire archive, staging and metadata | 128 MiB allocated storage / 4,096 files |
| Published graphs | 6 |
| One graph, including its manifest | 16 MiB logical bytes / 512 files |
| One retained file | 8 MiB |
| Manifest / catalog | 256 KiB / 64 KiB |
| Writers / staging candidates | 1 / 1 |
| Additional free-space reserve | 1 GiB |
| Unpinned age | Up to 7 days after deactivation |

Current and explicitly accepted rollback graphs are protected by the same global count/byte limits. Other graphs can be evicted earlier under those bounds. Restarts and reads do not extend deactivation time. Missing or expired assets return 404 with `no-store`, never HTML or a newer module under an old hash. Current `dist` takes precedence. Maps, private files, metadata, user records, database files, traversal and symlinks are excluded from the fallback.

Admission reserves filesystem allocation space for the complete candidate, child directories and catalog replacement before writing. The global accounting includes allocated directory blocks and uses the detected allocation unit when the platform does not expose allocated block counts.

An existing writer lock is treated as busy, including after an interrupted process. Deliberate maintenance with all archive writers stopped is required to resolve a stale lock; startup never guesses that it may unlink another writer's lock. Until resolved, optional retention can be unavailable while the current build continues to serve.

No new disk or service is provisioned. The repository declares an existing 5 GB data disk; actual live free space and peak database/WAL/overlapping-backup needs have not been inspected. Confirm that the reserve is sufficient before a release. Archive capacity must never be obtained by deleting database or backup data.

## Rollout and rollback

1. Review this narrow branch independently of PR #47, which also includes unrelated mobile, security and dependency work.
2. Confirm live disk headroom, database recovery readiness and server/API compatibility. Merge and deployment require a separate release decision.
3. The first retention-aware runtime captures its own complete build for subsequent releases. It cannot restore unavailable pre-feature artifacts.
4. After accepting a deployed release, deliberately advance its rollback pin with `node scripts/web-asset-archive.mjs promote --graph <current-graph-id>` in the configured runtime data directory. Starting a process does not imply acceptance. The running resolver observes a pin-only change within one second of fallback lookups; other catalog changes require a fresh verified startup snapshot.
5. Asset rollback requires a retention-aware server and supported catalog schema. Retaining JavaScript does not make an incompatible API or database rollback safe. A pre-feature binary does not serve this archive.

## Reproducible checks

Use the project's installed dependencies. This Windows review worktree reuses an existing dependency installation through a junction; dependency replacement belongs in an independent checkout.

```powershell
$env:EXPO_NO_TELEMETRY='1'
$env:EXPO_NO_DOTENV='1'
$env:EXPO_OFFLINE='1'
node scripts/split-catalog.mjs --check
node node_modules/expo/bin/cli export --platform web --source-maps external --output-dir dist --max-workers 2
node scripts/check-web-bundle-budget.mjs dist
node scripts/web-asset-archive.mjs manifest
node scripts/check-architecture.mjs
node scripts/check-syntax.mjs
node scripts/run-tests.mjs --test-concurrency=2
node scripts/verify-web-release-recovery.mjs
```

The browser harness uses the existing pinned Playwright/Chromium runtime and loopback API fixtures. `PIT_PLAYWRIGHT_MODULE` and `PIT_BROWSER_EXECUTABLE` can select existing installations. Optional `PIT_PREVIOUS_WEB_DIST` exercises a complete older real export against the new one; optional `PIT_WEB_RELEASE_RECOVERY_OUTPUT` saves receipts/screenshots. It makes no production requests or posts.

Evidence distinguishes synthetic A/B module graphs from the actual exported app. The former covers nested chunks, imported image bytes, GET/HEAD, cache headers, expiry, missing files and rollback. Actual-app cases check explicit recovery, saved composer text restoration, cookie/storage continuity, blocked storage, and stay/new-tab behavior. These Chromium checks do not certify Safari, physical iPhone or native iOS behavior.

## Local validation on 2026-10-16

- Full suite: 6,327 passed, zero failed, one platform skip. Final affected archive/startup selection: 30/30 passed after the last server changes; client recovery selection: 64/64 passed.
- Architecture and syntax checks passed. The Expo web export passed its 512 KiB initial JavaScript gzip budget at 508.8 KiB. Its validated manifest contains 77 entries and graph `311ee0cbcfe0d55575e178ce670f989fa6fd7a363f4b506477089dfbe760a77b`.
- Final browser run: 6/6 passed, including the optional older actual export, desktop and mobile-width composer restoration, and blocked storage. Loopback fixtures provided account/API state; no real authentication or production posting was performed.
- This Windows checkout reused the available dependency installation. A clean lockfile install and Linux checks belong to the draft PR's CI; live disk headroom, deployment and device-specific behavior remain unverified.


