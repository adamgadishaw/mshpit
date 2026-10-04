# Newsroom entry from Settings

Base: `15c4cb44a0931119fd86943a57e98e667282febe`.
Branch: `codex/newsroom-settings-entry-20261004`.

Settings exposed Moderation and Catalog editor but omitted the existing
standalone Newsroom. Admins and editors can now open Newsroom directly from
Settings. Its existing Menu entry is unchanged. Moderator, fan, artist and
signed-out sessions do not receive the new shortcut.

The runtime change touches only `SettingsScreen.jsx` and `App.js`: one
role-filtered row and a callback that pushes the existing `newsroom` frame.
Back returns to Settings through the existing navigation and composition guard.
The Newsroom implementation, API permissions, email-verification override,
publishing policy, access grants and broader console structure are unchanged.
The shortcut does not bypass an external browser security gate.

## Validation

- 22 focused tests passed: actual Settings JSX and App callback execution,
  immediate role-change masking, existing Menu roles, profile settings,
  retained Newsroom drafts, and rejection of private overview requests/writes.
- Syntax checks passed for 823 Node files; architecture and whitespace checks
  passed. The browser script was checked again after its final test changes.
- Independent review found no blocking issue and passed 22 focused checks,
  including navigation history. All three new tests passed again after review
  tightened exact-read readiness and active-account binding in the harness.
- Eight fixture-only cases were added to the existing news-category browser
  script: admin/editor/moderator/fan at 390px and 1280px. The existing 12 category
  cases and all timeouts remain. The workflow already invokes this script.
- Allowed-role cases check standalone entry, clean Back, Keep editing, Leave,
  retained headline after re-entry and return to Settings. Denied roles never
  mount the composer. Navigation triggers no fixture mutations.
- The complete request ledger preserves existing sign-in reads: two for admin,
  one for moderator, none for editor/fan. Subsequent private staff reads are
  restricted to the existing Newsroom editor GET; moderation/member/health/error
  and artist-alert requests fail the isolation assertion.

Actual browser execution and full `npm run check` remain cloud CI gates before
merge. No local Chromium or heavy web build was run, and no live browser,
production account, publishing action, provider request or deployment was used.
No schema, dependency or configuration migration is required.

## First cloud run and fixture correction

PR30 run `37228104631` at `9e891144` passed test/build, all 67 navigation cases
and all six general news cases. Its first new case (`390 settings-admin`)
failed before reaching Settings: the immediate Menu Newsroom count was zero.
The remaining seven Settings cases and all twelve category cases did not run.

`MenuScreen` is loaded with `lazyWithRetry`; clicking Menu schedules navigation
but does not prove its chunk has mounted. `count()` immediately inspected that
loading state. The harness now registers account/bootstrap response waits before
navigation, confirms the exact account and role, and finishes those responses
before clicking Menu. Both allowed and denied-role checks wait for the Menu
heading, exact account profile and Settings entry. Allowed entries must also
scroll into view and remain visible at their actual test viewport.

A deterministic deferred regression separately holds authentication, Menu mount
and profile mount for all four roles, proving no presence/absence assertion can
run before readiness. All 23 focused tests pass, along with browser-script syntax,
architecture and whitespace checks. No runtime change, permission relaxation,
removed assertion, increased timeout or local browser/build is included.

The remaining steps were retraced against the actual UI: responsive Menu uses a
non-virtualized ScrollView; Settings rows render with its heading; each Newsroom
opening waits for its account-bound GET; Back returns to the pushed Settings
frame; Keep editing/Leave preserve the account draft; remount restores the
headline; and final network idle precedes complete request-ledger checks. All
eight Settings cases and the twelve preserved category cases still need fresh
cloud execution. Failure logs now retain bounded synthetic page/request context.
Independent review found no blocking issue after retracing the entire flow;
all four changed tests and browser-script syntax passed independently.
