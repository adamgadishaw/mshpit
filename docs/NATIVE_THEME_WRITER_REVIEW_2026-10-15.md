# Native theme writer investigation — October 15

## What is known

The owner runtime showed active/stored Ember at 19:32:46 UTC, then active/stored Stage at 19:43:42 UTC, with account theme Daylight in both snapshots. The same owner binding and authenticated session remained present. The earlier transition was not instrumented, so its writer is unknown. No theme control/setter was invoked by this investigation; the current Stage selection was left untouched. It is not evidence that the owner selected either theme.

A bounded debug observer wrapped only the SQLite theme key operations, recording sanitized selection metadata and caller stacks. It was installed at 19:52:09 UTC and removed/restored at 19:54:03 UTC; no key operations occurred during that interval. No reload, theme sync or setter was manually triggered. The observer has no persistent component and is absent after cleanup. Its empty event log cannot explain the historical transition. Task receipt: theme-writer-observation.json.

## Writer and isolation audit

- Explicit appearance choices: Store chooseTheme, reached from Settings, guest Menu and signup artist/theme selection. It persists locally after its account request settles; read-only review can retain a local choice even when the account PATCH is refused. A later account revalidation can therefore show a different server theme without proving an automatic local overwrite.
- Native reconciliation: Root waits for authoritative auth/settled navigation, Store reads current refs, and syncNativeAccountTheme chooses a valid same-owner local value before the account preference. A guest or different account cannot inherit another owner's override. Native reconciliation returns before the browser account-PATCH path.
- Clearing: account retirement, sign-out and account deletion remove the complete local theme/owner pair. Theme loading alone can display default Stage when reads fail, but that display fallback does not by itself persist Stage.
- Browser theme storage uses localStorage, not the Android SQLite adapter. Node theme tests compile against in-memory Maps; the full test runner uses throwaway server data and clears mail credentials. Searches of task scripts/local ignored JS found implementation/test definitions but no direct owner-runtime theme writer. This is a bounded audit, not proof about every external process.
- Android fixture installations use separate package identities/data sandboxes. Existing runtime diagnostics are package-targeted; no fixture was launched or account changed in this investigation.

## Reproduced defect

The native adapter previously caught a storage read exception and returned the same null pair as a successful empty read. Reconciliation then treated a valid but temporarily unreadable preference as absent. Synthetic saved Ember/owner A plus one failed reconciliation read was overwritten with account Daylight. With an account snapshot containing owner A but no theme, the same failure wrote Stage/owner A; later Daylight reconciliation retained that Stage as the local override. Both preservation regressions failed before correction.

This proves an app defect and a mechanism capable of producing the observed end state under those injected conditions. It does not establish that a native storage exception or partial account snapshot occurred in the historical owner interval. No such event was captured. Normal readable-storage precedence and startup ordering did not reproduce the unexplained change.

The adapter now distinguishes a storage exception with unavailable:true. Native reconciliation treats that result as handled but defers writes/reload, leaving stored bytes intact. Successful empty reads and malformed JSON retain existing fallback behavior. A one-off boot read failure can recover the existing choice during subsequent readable reconciliation. If storage remains unavailable, the usable display fallback remains until a later readable reconciliation/relaunch; there is no forced retry/reload loop or persistent preference reset. Explicit theme choice behavior and browser adapter are unchanged.

## Validation and current state

Focused local checks passed 27/27; independent review passed 31 focused theme checks and found no blockers. Regression coverage includes one failed reconciliation read, partial-account fallback, failed boot read followed by recovery, persistent unreadability with readable relaunch, same-owner override, guest/account isolation, write verification and rejected reload handling. Final full suite passed: 6,453 passed, zero failed, one skipped (6,454 total), 106.5 seconds. Syntax and architecture passed; Android Hermes export passed (2,207 modules, 9.5 MB). CI status is recorded in the PR/handoff after push.

At19:56:01 UTC the actual client remained at Feed: signed in, auth ready, active/stored Stage bound to the same owner, account theme Daylight, auth-link flow idle, and production Post/Like/Report blocked. No preference restoration, account mutation, deployment, signing change, purchase or enrollment occurred. This fix does not retroactively attribute the historical writer.


