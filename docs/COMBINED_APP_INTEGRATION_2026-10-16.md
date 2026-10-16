# Combined app integration candidate — 16 October 2026

This branch is a review candidate, not a production release. It combines the complete app stack with the two independent website recovery branches in an isolated worktree. No existing PR, master branch or production service was merged or deployed while preparing it.

## Exact integration scope

| PR | Verified head | Relationship and scope |
| --- | --- | --- |
| 47 | `36a2533376f9857e0ad24989e2765988eae3f964` | Base app work on master `42a36c0`: Windows Android path, native navigation/auth/media, dependency changes and reviewed client/backend security/concurrency fixes. |
| 49 | `21b85d673ccbae91f17f589839ee6170bf9b8c39` | On 47: Discover recovery/scope, server artist cursor compatibility, diagnostics ownership and responsive state preservation. |
| 50 | `a2437494e35aef87316394e7ce2595bc020b3af6` | On 49: session response validation, Discover dates/spinner, native clip retry and first-frame intent, worktree-safe disposable backend. |
| 52 | `1ae2f94c0bb8816d47ca6cfb1c20270a80201822` | On 50: abort rejected binary transfers and additional session race coverage. This already contains the four app PRs. |
| 48 | `75152ae434d8b02a99dff96b37da84dc1185262c` | Independent on master: draft-preserving web recovery and bounded complete asset retention. |
| 51 | `41612810d6867c13319927f041332b752d674c97` | Independent on master: event-page resilience and manual artist lookup recovery. |

The local merge commits are `946ad90` (52 + 48) and `1c5387107d9bf21bdf30e8bbaae2f42403f703b6` (+ 51). Existing PR heads remain unchanged. PR 47's description was corrected to disclose its current head and backend/dependency scope; its older device evidence retains its original commit labels.

## Integration blockers reproduced and resolved

1. **Three merge conflicts.** PR 47's explicit hard-reload retry overlaps PR 48's draft-preserving recovery in `ErrorBoundary.jsx`, `errorBoundaryReceipt.test.mjs` and `lazyWithRetry.js`. The candidate takes PR 48's reviewed behavior in those files. Native retry behavior remains covered, and the automatically combined API keeps the app identity/diagnostics and binary cancellation changes. PR 51 combined without conflicts.
2. **Startup budget failure.** The first combined export measured **525,462 / 524,288 gzip bytes** (513.1 / 512 KiB). The closed account menu and restricted-account panel now load on demand. The restricted branch retains its gate and displays a loading fallback while its panel loads; it never reveals Feed. Final startup is **523,553 / 524,288 bytes** (511.3 KiB), with 735 bytes of headroom. No budget or dependency change was used to pass.

Actual exported-app tests hold each new chunk pending: the account menu does not load before intent and does not replace Feed; the restricted panel never exposes Feed while pending. Menu navigation and restricted-account privacy controls remain reachable afterward. The restricted status in that UI case is deliberately synthetic and does not certify server ban enforcement.

## Combined validation

- First full combined suite: **6,692 passed, zero failed, one Windows platform skip (6,693 total)** in 335.8 seconds, two workers, disposable databases.
- Targeted combined paths: **246/246 passed**, including web draft recovery, archive/startup, native boundary retry, API identity/diagnostics, session races, Discover scope/retry, Clips lifecycle and event snapshot rendering.
- Actual full server + exported Chromium app + real HttpOnly cookies: **18/18 passed**. Includes login/profile choice/reload, linked switch and cookie rotation, logout and old-cookie replay rejection, password-reset/change session revocation, lost signup/reset-response recovery, and cold-start `/api/me` 503 followed by bounded cookie recovery without a login request. The three newly added cases cover that recovery and the two deferred UI panels. Synthetic accounts live only in a temporary local database; server outbound access is blocked before application imports. Small parallel-read cases are local correctness checks, not production capacity measurements.
- Asset/release recovery: **6/6 passed**, including two distinct actual exports: the prior PR 52 app opens News through retained old chunks after the local release switch. Saved drafts, storage denial, stay/new-tab, expiry and rollback fixtures pass.
- Discover failure/retry: **8/8 passed** at phone/desktop widths; event-page outage/recovery: **3/3 passed**; browser video: **2/2 passed**, including decode, rejected-play recovery, hidden pause and retry remount.
- Syntax: **868 Node files passed**. Architecture passed without increasing legacy limits. Android Hermes export passed: **2,211 modules / 9.5 MB**. Final web export and the unchanged budget passed.
- CI now includes the real-server cookie/recovery harness. Its final result belongs in the candidate PR and task-local receipt after completion.

### Android emulator evidence

The existing separate `com.mshpit.app.dev.perfdebug` package loaded the actual combined App/Store/API against a fresh loopback server. Normal UI taps entered synthetic linked-account credentials and selected account A. After a complete stop/relaunch of this test package, native `/api/me` returned account A and authenticated reads succeeded without credential entry. A one-fault loopback proxy then returned a real HTTP 503 for the next cold-start `/api/me`; the next read returned 200, account A was restored, and the visible signed-in Feed returned without another login request. Receipts contain only synthetic account IDs and request path/method/status, never cookies or password values.

The first pending-state inspector capture arrived before the inspector was available; it is not a captured identity-lock assertion. The subsequent native trace proves the 503/200 sequence and final identity. The browser case separately verifies that failed cold validation does not publish private identity. An initial emulator screenshot was also taken during settling and is not labeled a final UI pass.

Two temporary harness setup failures were corrected without app changes: the raw Expo launcher bound IPv6-only loopback, then external-worktree lazy resolution failed. Using the already-existing Windows wrapper preferences (`--dns-result-order=ipv4first` and `EXPO_NO_METRO_LAZY=1`) resolved both. The combined App then displayed Discover, the real login/profile choice, and a settled signed-in Feed. The official mobile wrapper already contains those preferences.

The owner app was not stopped, signed out, reconfigured or cleared. It was returned to its existing MainActivity. Only the temporary fixture's servers, package and port forwards were stopped; original 8081/8083 forwards remain. The temporary synthetic database was deleted. Native video player files are unchanged from PR 50; its prior Android playback evidence remains tied to that implementation, while this candidate adds the combined source/export/browser checks. This is not a new physical-device playback or exhaustive native resource audit.

Task-local logs are `integration-{targeted-tests,full-tests,web-build,web-final,native-build,real-auth,browser,player-browser}.log`. Browser screenshots are under `.tmp/integration-real-auth`, `.tmp/integration-release-browser`, `.tmp/discover-events-browser`, `.tmp/event-page-recovery-browser` and `.tmp/player-browser`. Native evidence is in the task's `integration-native` folder: `restarted-state.json`, `restarted.png`, `native-503-recovered.json/.png` and `proxy-receipt.json`.

## Actionable next steps and release gates

1. **Review this combined candidate as one exact scope.** It contains all six PR heads plus the small startup-loading correction and real-server test wiring. If accepted, use this candidate as the integration path; do not separately reapply or duplicate the same PR changes. Existing drafts can be reconciled after the chosen integration is merged. No merge is authorized by this report.
2. **Continue Windows refinement from this branch.** Existing Android tools and APK are reusable. `node scripts/mobile-dev.mjs start --port <unused-port>` applies the Windows preferences. Use a disposable backend for synthetic sign-in tests; avoid repointing the owner app to a different backend or clearing its storage. The recorded separate-package fixture provides a proven local smoke route.
3. **Before any production release**, explicitly review PR 47's backend/dependency scope, PR 49's server cursor change and PR 48's startup/archive operation. Confirm live disk headroom, mandatory database backup/recovery and WAL capacity, API/database rollback compatibility, and deliberate rollback-graph promotion. Local asset tests do not satisfy these operational gates.
4. **Contain the historical database exposure separately.** Its documented credential/session response and history/copy review remain unresolved. No credential extraction/rotation, revocation, security-setting change or history rewrite was performed.
5. **Resolve dependency/device gates deliberately.** Current Expo 57.0.29 compatibility metadata recommends ~57.0.30; existing development advisories remain. No dependency was changed or force-downgraded here. Physical Android playback/audio/AV sync, real email/associated-link delivery and iOS storage/backup behavior remain unverified. Windows cannot run Apple's local simulator; signed iPhone/TestFlight checks remain for later enrollment. Expo Go cannot validate react-native-share or native app configuration.

No paid service, purchase, enrollment, new account outside synthetic test storage, production stress or content write, expanded persistent access, deployment or app-store submission was part of this integration pass.
