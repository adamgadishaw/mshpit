# Theme access review — 2026-11-11

Local candidate only. No publication, deployment, production data change, or
native installation is part of this work.

## Source and policy

Base: `c2bbe88246f249a5fa7cd60f3184f55b6b8794bf`, copied with independent Git
objects from the local database integration repository into the isolated
`2026-11-11/task-3/mshpit` checkout. Concurrent database commits are excluded.

The existing `isStaff` helper and official `roleBadge` mapping identify
`admin` as Pit Team. Moderators have the separate `mod` badge; editors have
newsroom access. The existing admin predicate is now shared through
`src/domain/staffRoles.mjs`, with the Store's existing export preserved.
Verified, sponsor, founder/custom badge labels and cached account objects
do not grant theme access. No roles, memberships, purchases, payments,
entitlements, or member-count launch thresholds change.

Guests and non-team accounts may select Daylight and Stage. Pit Team accounts
retain the complete existing 12-theme catalog. Settings expands additional
choices only for a confirmed team account; guest Menu and onboarding filter
the same catalog through the same policy, including saved-selection handling.

## Enforcement and restoration

- Both `PATCH /api/me` theme fields (top-level and `extras.theme`) are checked
  against the current database row inside the existing write transaction. A
  permitted top-level field cannot mask a restricted nested field. Rejection
  is an atomic, catalogued `403 FORBIDDEN` with no accompanying profile edits.
- Public/self account projections expose Stage for an ineligible legacy
  restricted preference. Reads and unrelated profile edits retain the dormant
  stored choice; rejoining the team can recover it. Portable account exports
  remain historical records, not an authorization or theme-restoration path.
- Static StyleSheets are evaluated only after a restricted device selection
  has been checked through live `/api/me`. The startup result is process-local
  and never an authorization cache. Offline/failed checks use a public theme
  and preserve the stored choice. Daylight/Stage need no extra startup request.
- Explicit logout intent wins before and after an in-flight startup check.
  The application boundary hides restricted styles synchronously while the
  session is unconfirmed, after role loss, or after an account transition.
  It reloads a newly authorized instance rather than retaining the old palette.
- Current account/role validation uses the existing session coordinator and
  its foreground, online, and cross-tab signals. There is no new realtime
  server-push revocation mechanism; an external role change becomes known on
  the next authoritative session check.
- Local theme application checks access independently. Account theme writes
  require server success; failed writes cannot leave an unauthorized local
  selection. Repeated in-flight selections are rejected until the current
  write completes. Account epochs and current role checks fence late results.
- Restoration no longer PATCHes the account from cached device preferences.
  Owner-scoped allowed choices still win locally. Storage failures preserve
  existing data; native duplicate reloads retain their existing coalescing.

## Validation and handoff

Focused tests exercise all 12 themes through both real route handlers for
fan, artist, moderator, editor, and admin accounts, stale authenticated roles,
atomic rejection, safe projections, spoofed badge/role inputs, dormant choices,
startup/offline/logout transitions, repeated writes, and native runtime reloads.
Older unrelated privacy tests use permitted themes so they continue testing
their original privacy contracts. Architecture debt shrinks by one direct
Store API call; no exception or gate is loosened.

`scripts/verify-theme-access-browser.mjs` drives the actual exported app with
disposable Chromium contexts and synthetic loopback API responses. It covers
desktop member and team pickers, a phone-width moderator picker, cached admin
spoofing, repeated taps, failed saves, live role loss, role restoration and
cross-tab logout. All external requests are blocked. Screenshots/logs and exact
final checks are recorded in the accompanying handoff outside the repository.

The boot wrapper delays `require("../App")` evaluation until authorization;
the App stays in the initial bundle graph so the existing 512 KiB gzip budget
counts the complete startup code. The reviewed build is approximately 508.5 KiB.

Before commit: required `npm run check`, whitespace check, focused regressions,
browser acceptance, and local iOS export. There is no TypeScript or separate
lint target; the repository syntax, architecture and export checks apply.

Mac/iOS device validation remains required: cold/warm launch with saved team
themes, offline launch/recovery, logout/account switching, observed role loss,
interrupted/repeated selections, native reload failure, and safe-area appearance.
A Windows iOS JavaScript export is not an Xcode build, simulator run, physical
device acceptance, signing verification, TestFlight submission, or installation.

Integration must preserve the database stream's separate changes in
`server/api.js`, `server/db.js`, and `STATUS.md`. No schema migration or bulk
preference rewrite is needed. Deploy server enforcement with the client changes
when a separately authorized release is prepared; older clients can still offer
restricted choices but the updated server rejects their writes. Rollback restores
the prior access policy without data recovery because dormant preferences remain.
