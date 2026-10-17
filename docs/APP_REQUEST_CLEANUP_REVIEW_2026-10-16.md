# App request cleanup review — 16 October 2026

Baseline: PR 50, `a2437494e35aef87316394e7ce2595bc020b3af6`. Work is isolated on `codex/app-session-cleanup-20261016`. Sol workers performed the bounded reproductions and focused tests; one bounded Astra ultra review inspected the final changed paths. Existing app checkouts, the canonical website and the owner emulator were preserved.

## Reproduced defect

`apiBinary` rejects a successful response when its content type is unsupported or its declared body exceeds the eight-MiB default limit. Previously it immediately cleared the deadline and removed caller cancellation forwarding without aborting the unread body. With a streaming fetch implementation, an abandoned response could keep downloading after the error was shown. The current callers prepare social share cards.

The regression executes the actual API transport and request control against a tiny, ephemeral loopback HTTP server. Before the fix, each rejection happened after one 32-byte chunk, but the connection remained open after about 100 chunks; later caller cancellation did not reach the request. Synthetic response cases also reproduce this without network I/O. Five of seven new tests fail on the baseline.

The four-line product correction exposes explicit cancellation on the existing request control and invokes it before cleaning up rejected binary responses. It preserves the `invalid_response` error, request metadata and diagnostics ownership. Both real loopback responses now close with the transport signal aborted; accepted PNG responses still succeed. The final tests assert cancellation immediately after rejection, before the caller cancels.

This real-transfer evidence applies to streaming fetch. The installed React Native XHR-based fetch buffers a response before exposing its headers, so this correction does **not** establish early Android download rejection, reclaimed native memory or reduced native bandwidth. A response without `Response.body` is covered to verify the cancellation call does not require the web stream API. No physical-device claim is made.

## Session checks without a product change

Fourteen additional tests found no new session identity defect in the selected races:

- Pending `/api/me` account, guest, HTTP 401 and HTTP 503 responses cannot overwrite a successful linked-account switch or resurrect an account after logout.
- Rejected authentication preserves the confirmed account while fencing an older validation result.
- Cold-start offline recovery stays locked until successful validation; a retry scheduled before login validates the replacement account.
- Unmounted identity effects ignore late guest/replacement replies and remove scheduled retries.

These fixtures execute the complete production validation effect, authentication/logout/switch declarations, API transport, validation coordinator, retry policy and auth-transition coordinator. React setters, account adoption/projections and external I/O are synthetic seams. They do not mount the entire app or test a real account cookie. The effect does not abort its `/api/me` transport on unmount, but the tested late responses cannot publish identity changes; no additional product fix was made for that bounded observation. The owner's original sign-out incident remains unattributed.

## Validation

- New binary cleanup regression: **7/7 passed**, versus **2/7** before the correction.
- Focused API identity, diagnostics, request control and native share coverage: **107/107 passed**.
- New session concurrency tests: **14/14 passed**; combined existing session/auth coverage: **63/63 passed**.
- Independent bounded Astra review found no blocking issue. Its suggested assertion that header rejection itself owns cancellation was added; all seven cleanup tests passed again.
- Syntax, architecture and web export passed. Initial JavaScript: **524,050 / 524,288 gzip bytes**, with the existing budget unchanged.
- Android Hermes export passed: **2,207 modules / 9.5 MB**, exit code zero.
- Hermetic full suite: **6,662 passed, zero failed, one skipped (6,663 total)**, exit code zero, using two workers in 325.8 seconds. No test process was duplicated during the model handoff.

Reproduce from this worktree using the existing dependencies:

```powershell
node --test src/lib/apiBinaryCleanup.test.mjs
node --test src/domain/sessionValidationConcurrency.test.mjs src/domain/sessionValidationRecovery.test.mjs src/domain/sessionValidation.test.mjs src/domain/sessionValidationRetry.test.mjs src/domain/authTransitions.test.mjs src/lib/nativeAuthIntentLifecycle.test.mjs src/screens/authNavigationCancellation.test.mjs
node scripts/run-tests.mjs --test-concurrency=2
node scripts/check-syntax.mjs
node scripts/check-architecture.mjs
$env:EXPO_NO_TELEMETRY = '1'
$env:EXPO_NO_DOTENV = '1'
node scripts/split-catalog.mjs
node node_modules/expo/bin/cli export -p web --source-maps external --max-workers 2
node scripts/check-web-bundle-budget.mjs
$env:MSHPIT_LOCAL_DEV = '1'
$env:EXPO_PUBLIC_API_URL = 'http://localhost:3000'
$env:EXPO_PUBLIC_NATIVE_READ_ONLY_REVIEW = '0'
node node_modules/expo/bin/cli export --platform android --output-dir .tmp/session-cleanup-android --max-workers 2
```

The hermetic full-suite runner creates disposable database storage and strips inherited mail credentials. The seven cleanup tests use only synthetic responses or their own small loopback servers, which close after each case. Task-local evidence is stored alongside this worktree in `session-cleanup-request-{baseline,after,focused,final}.log`, `session-cleanup-session-tests.log`, `session-cleanup-full-tests.log`, `session-cleanup-build.log`, `session-cleanup-android.log` and the `session-cleanup-*-evidence.json` receipts.

## Boundaries

No dependency install, lockfile edit, budget increase, live request fault injection, production load, account/email/upload write, credential change, security or virtualization change, merge or deployment. The existing dependency directory is linked read-only by convention; no installation was run through it. Existing servers and the owner emulator were not restarted or changed, and no new running-app screenshot is claimed for a transport-only fix. Android Hermes export checks JavaScript compilation, not native runtime behavior or iOS certification. Historical database exposure containment remains unresolved.
