# App recovery release assembly — 2026-10-17

This assembly combines the reviewed public app stack (PR47, PR49, PR50 and
PR52) with the already-live PR51 event recovery change. It also includes the
reviewed browser draft-recovery client from PR48 and the small account-panel
loading correction from the earlier combined candidate.

The client implementation is the same as the reviewed `392c7b0` integration.
This assembly excludes PR48's server asset archive, startup archive phase,
manifest generation and operator promotion commands. It includes no later
foundation commits, database schema change, production dependency change or
Render configuration change.

The browser recovery path keeps the current tab in place after an exhausted
screen import. Supported saved drafts can be restored after an explicit reload;
known storage failures block that reload. Other unsaved forms and raw File/blob
media are not promised to survive. Users can keep the tab or open a fresh one.
Previously loaded clients cannot acquire this behavior retrospectively. This
release does not retain old server assets or certify arbitrary rollback graphs.

The backend delta remains the previously reviewed reset cooldown/follow checks
and artist pagination correction. Existing v1 pagination continues on the new
server. Newly issued v2 artist cursors are rejected by the old server after a
rollback; opening a fresh page starts a new pagination chain. No persisted data
format or password format changes in this assembly.

Validation on this assembly:

- Targeted recovery, request ownership and backend checks: 163 passed.
- Actual full-server browser cookie/recovery checks: 18 passed, using only a
  disposable local database and synthetic accounts.
- Actual exported-browser draft recovery: four passed, including phone width,
  storage denial and keep-tab/new-tab behavior. All API responses were fixtures.
- Web startup: 523,553 / 524,288 gzip bytes; the limit is unchanged.

The assembly's PR records the subsequent exact-head CI result. Source and
configuration matching earlier Android evidence are reused; no new physical
Android, native iOS, signed iPhone, real email delivery or associated-link
certification is claimed. Windows cannot run Apple's local simulator.

From the repository root, using Node 24 and installed dependencies:

```powershell
node scripts/run-tests.mjs
node scripts/check-syntax.mjs
node scripts/check-architecture.mjs
npm run build:web
npm run verify:auth-real-server
node scripts/verify-web-draft-recovery-browser.mjs
```

The browser scripts require an installed Playwright/Chromium runtime; they do
not download a browser. Existing Windows Android commands and bounds remain in
[the development guide](WINDOWS_MOBILE_DEVELOPMENT.md).
