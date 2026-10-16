# Event-page artist recovery — 2026-10-16

The event page preserves its public details when artist lookup fails, but its
fallback previously hid the difference between a provider outage and an artist
without a confirmed profile. Its combined refresh control also appeared usable
while the artist lookup controller silently rejected retry during cooldown.

This change makes the existing failure and recovery state visible. It does not
repair or suppress the upstream provider failure.

## Scope and diagnosis

- Base: `42a36c0aec17a8a43c8e9057585634adaecaef75`, verified against
  `git ls-remote origin refs/heads/master` before creating this worktree.
- Branch: `codex/event-page-artist-recovery-20261016`.
- Isolated worktree:
  `C:\Users\Adam Gadishaw\Documents\Codex\2026-10-14\task\pit-event-page-recovery`.
- Canonical website checkout remains on `f7fda62`; its existing untracked audit
  file was preserved. The separate native app recovery checkout was not changed.
- The repository's required Expo SDK 57 versioned documentation was read.

The reported October 16 resolver failure was `PROVIDER_UNAVAILABLE` (502) for
`Les Solidarités`, associated with an event-page request. That log does not
establish the underlying network cause or whether the name is a catalog artist.
Current source and local reproduction show that a loaded, validated public event
snapshot keeps date, venue, and tickets usable. Artist profile, ratings, social,
and archive actions remain gated. This is an artist-availability failure, not a
whole-page crash. The former fallback copy obscured that distinction.

## Change

`ShowScreen.jsx` now passes checking, missing, error, and cooldown state into its
public event fallback. Provider/status failures display “Artist information is
temporarily unavailable”; confirmed misses and pending identities retain their
distinct unlinked-profile presentation.

Event details refresh and artist retry are independent controls. The artist
control uses the existing cooldown and single-flight controller. It remains
available when the public snapshot is missing or fails, so that an artist check
can still recover the original show page. Existing pending-identity restrictions,
memorial checks, cancellation behavior, and snapshot/account scoping are unchanged.

There are no server, cache, identity-matching, dependency, or data changes. A
provider failure remains 502 rather than becoming a false no-match. No artist is
created by this public lookup. Taking an artist key from the event snapshot would
change identity precedence and was deliberately left outside this correction.

## Validation

All requests used temporary databases or intercepted browser fixtures. No
production requests, provider calls, paid calls, installation, merge, or deploy
were performed during investigation and validation. The coordinating task owns
the separate draft PR and CI verification.

- Three new renderer/wiring regressions failed on the original implementation.
- Final focused client and navigation-fixture tests: **55 passed, 0 failed**.
- Resolver availability, lookup recovery, and public snapshot server tests:
  **29 passed, 0 failed**. They confirm stored/stale identities, truthful 502s,
  bounded repeated/concurrent lookup, and no invented catalog identities.
- Actual exported-web Chromium recovery checks: **3 passed, 0 failed** at 390px
  and 1280px, plus a missing-snapshot case at 390px. Each performed exactly two
  artist requests: initial simulated failure and one explicit manual recovery.
  Disabled clicks and cooldown expiry made no request; rapid retry clicks shared
  one request. Details refresh did not retry the artist. Ticket popups were
  fulfilled locally. Unexpected external requests and page errors: **0**.
- Existing artist-identity conflict browser checks: **2 passed, 0 failed**.
- Production web export and bundle check passed. Initial JavaScript:
  **519,744 / 524,288 gzip bytes**, with the budget unchanged.
- Architecture check passed; full Node syntax check passed (**853 files**);
  whitespace diff check passed.
- Independent diff review found and resolved the missing-snapshot recovery edge
  case; subsequent review found no product or identity/privacy blocker.

Existing dependencies were reused through a local junction to the prior auth
worktree. Both worktrees have the identical package-lock SHA-256
`32cfb10f2e6d6d75312490ca350d1e71f081efc2311ea8c719aef21bb73b9b3e`.
No dependency installation was run through that junction.

Reproduction commands, from this worktree (PowerShell):

```powershell
node scripts/run-tests.mjs src/domain/publicEventSnapshotRender.test.mjs src/domain/publicEventSnapshot.test.mjs src/hooks/useCanonicalArtistIdentity.test.mjs src/hooks/usePublicEventSnapshot.test.mjs src/features/artistSearch/artistLookupController.test.mjs src/domain/artistMemorialUi.test.mjs src/features/artistSearch/artistSearchApi.test.mjs scripts/verify-navigation-browser.test.mjs
node scripts/run-tests.mjs server/publicEventSnapshotResolution.test.mjs server/artistResolverAvailability.test.mjs server/artistLookupRecovery.test.mjs
node scripts/check-architecture.mjs
node scripts/check-syntax.mjs
$env:EXPO_OFFLINE='1'; $env:EXPO_NO_TELEMETRY='1'; $env:CI='1'
npm run build:web
$env:PIT_PLAYWRIGHT_MODULE='C:\Users\Adam Gadishaw\AppData\Local\Temp\mshpit-playwright-1.62.1\node_modules\playwright'
$env:PIT_BROWSER_EXECUTABLE='C:\Users\Adam Gadishaw\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe'
node scripts/verify-event-page-recovery-browser.mjs
node scripts/verify-navigation-browser.mjs discover-show-artist-conflict
git diff --check
```

Local evidence remains in the task workspace:

- `../event-page-recovery-before.log`: the original three failing regressions.
- `../event-page-recovery-client-final.log`: 55 passing focused tests.
- `../event-page-recovery-server.log`: 29 passing server regressions.
- `../event-page-recovery-build-final.log` and
  `dist/web-bundle-budget.json`: final export and budget.
- `../event-page-recovery-browser-run4.log` and
  `.tmp/event-page-recovery-browser/results.json`: three passing browser cases.
- `.tmp/event-page-recovery-browser/*-outage.png` and `*-recovered.png`: actual
  exported-page screenshots, visually inspected at mobile and desktop widths.
- `../event-page-recovery-conflict-browser.log`: two existing conflict cases.
- `../event-page-recovery-syntax.log`: syntax result.

Earlier browser attempts exposed fixture-only date/duplicate-element selector
issues; their logs remain alongside the final successful run. They required no
additional product change. Remote CI and release verification remain for the
separate website PR. The underlying provider/network cause remains unverified.
