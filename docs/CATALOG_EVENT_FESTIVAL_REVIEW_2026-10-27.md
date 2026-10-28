# Event catalog and Ontario festival correction — local review

## Baseline and scope

The GitHub master archive's ZIP comment and connected commit lookup both identify
`531fa4dc6193d86874cd71a20b240141743d065f`. The archive was extracted into an
isolated sandbox-owned repository on `fix/catalog-event-festival-20261027`.
Local baseline commit `248ee3f35d658b4e88f19681315a06f34fcd0f90` records that
source snapshot; it is not a GitHub commit or the production parent history.
The review patch is intended to apply to the real master SHA above.

The original owned checkout was clean but stale. An elevated fetch into the
sandbox clone encountered different OS ownership; no safe.directory exception
or ownership change was used. Downloading the public archive provided the
current source without accessing the restricted D: checkout. Existing work
was not altered. This candidate does not contact another agent, push, merge,
deploy, change production data, activate monitoring, or touch held PR74.

## Event-only text

A production read-only inspection supplied by the parent confirmed that exact
event `tm_1AsZkuSGkexUMwE` is conflicted; other measured editor gates passed.
Cancellation itself was never an editor exclusion.

Event lookup and queue eligibility now permit pending/conflict identities only
for sourced event text. Such identities have `scope=event-only`, no artist key,
and bind source, provider event ID, venue ID/name/city/country, date, end date,
start datetime, provider attraction ID, display name and unresolved status.
They require a strict calendar date and complete venue evidence. Normal artist
and venue eligibility is unchanged. No artist mapping, owner profile, provider
flag, cancellation/status, ticket fact or lineup is modified by a text save.

Prepare/save/public text retrieval use the same repository identity. Existing
revision and expected-hash checks, hidden/stale publication fences, audited
savepoints and actor-scoped idempotency receipts therefore apply unchanged.
Resolution or occurrence changes hide prior text until staff reviews it against
the new identity. Existing public projection suppresses namesake artist binding
for pending/conflict events; a regression covers actual rendered event HTML.
Text remains keyed only by event and cannot become an artist biography.

This does not resolve the underlying provider artist conflict. That still needs
exact attraction/crosswalk evidence and the normal registration safeguards.
No generic conflict-clearing repair endpoint was introduced.

## Festival identity and official dates

Ontario's catalog excludes both `Boots and Hearts West` and `Boots & Hearts West`.
A shared record policy checks Ontario place evidence in both Ticketmaster and
existing-tour ingestion, store writes/rebuilds and all edition reads (including
the direct edition lookup used by plan mutations). Other traveling festival
brands retain their existing geographic behavior. Review and aggregate queries
apply catalog exclusions and explicit Edmonton/ICE District place conflicts
before their limits/counts, including generically named reviews. Deterministic
SQLite row predicates apply Ontario edition eligibility before the hub's
requested limit and the detail reader's 30-row limit. Existing date/ID ordering
and index-friendly scope/country/date predicates remain; no global geographic
rule is applied to multi-location brands. SQL functions perform no I/O or writes.

Mixed historical rows are filtered from public Ontario dates, predictions,
lineups and plan targets. They are not deleted, reassigned, or silently renamed;
existing member plans remain stored against the original edition IDs. Rebuilds
cannot reuse an excluded edition's ID for a new Ontario occurrence.

The official announcement is a finite, sourced record in
`festivalAnnouncements.js`, separate from provider listings/editions. It supplies
August 6–8, 2027 at Burl's Creek, Ontario, from https://bootsandhearts.com/,
checked October 27, 2026. https://bootsandhearts.com/west/ identifies the separate
Edmonton August 28–29, 2026 event. The Ontario announcement appears in the app,
HTML, metadata and Festival schema without provider IDs, offers, performers or
member planning controls. It suppresses estimates and expires after its end date.
Real matching provider editions remain the planning/lineup authority.

## Separate production cleanup plan — not executed

1. Read only `boots-and-hearts` listings and editions and the count of plans per
   affected edition. Record exact IDs, provider event IDs, dates, city/region,
   venue identity and before-state hashes; do not dump unrelated users or plans.
2. Verify each candidate against its official/provider event page. Distinguish
   explicit West names/Edmonton evidence from incomplete Ontario metadata. Do
   not infer that an unfamiliar location proves West.
3. Review a transaction plan with exact IDs, expected hashes and a before-state
   export. Prefer explicit identity quarantine/reassignment with provenance.
   Introducing a West page requires a distinct reviewed identity and biography;
   do not attach Ontario Wikipedia text to it.
4. Preserve edition IDs and member plans through any approved identity move, or
   explicitly review a mapping before changing references. Avoid delete/rebuild
   cascades. Verify plan counts, member intent, both page identities and rollback.
5. Execute only under separate production authority. This code already prevents
   excluded rows from contaminating the Ontario page while review is pending.

## Validation

Focused tests cover conflict-scoped lookup/queue, prepare/save/public fences,
identity and eligibility mutations, unchanged source rows, retry/audit behavior,
ordinary staff authorization, real HTTP publishing, SSR namesake suppression,
both festival ingests, persisted-row/plan preservation, West reviews/statistics,
sourced announcement HTML/schema, no invented provider records, and expiry.

Validation logs are stored alongside the checkout in `catalog-source/`:
`focused.log`, `full-check.log`, `audit.log`, `build.log`, `syntax.log`,
`architecture.log`, `blueprint.log`, `festival-browser.log`, `editor-browser.log`.
Browser screenshots are local ignored artifacts under `.tmp/festivals-browser/`.
Final exact results and any incomplete gates are reported in the handoff.

Final results on Node 24.16.0 after independent-review corrections:

- `npm test`: 7,072 tests, 7,071 passed, zero failed, one skipped (130.2 s).
- Focused HTTP/SSR/editor/festival/native run: 52/52; festival regressions: 11/11.
- Corrected regression fixtures replayed against the prior patch fail on both
  review findings: geography-blind aggregate 16 instead of 2, and upcoming
  `limit=1` returning no valid Ontario edition. The fixed source passes these
  same assertions plus 31 excluded rows before valid detail results, stable
  same-date ordering, unchanged stored posts and multi-location-brand controls.
- Full Node syntax gate: 919 files passed; subsequent changed files also passed
  `node --check`. Architecture passed again after the final server changes.
- Blueprint validation passed. Separately authorized npm audit: zero vulnerabilities.
- Web export and bundle gate passed: initial JavaScript 506.3 KiB / 512 KiB gzip.
- Festival browser tests passed at 390 and 1280 widths, including official-date
  fallback, no invented planning controls, no external requests and screenshots.
  Catalog editor browser tests passed at both widths with three synthetic saves
  per case, including the event-only identity shape. Desktop/phone screenshots
  were visually inspected after entrance animations.
  These accepted UI checks precede the server-only independent-review fixes;
  no browser operation was retried after the subsequent Windows policy denial.
- `git diff --check` passed. The patch passes forward `git apply --check` in
  a clean local baseline worktree. No application commit or remote write occurred.

The aggregate check initially reached npm audit after tests, then stopped on
sandbox registry connectivity. A separately approved audit of the unchanged
lockfile passed with zero vulnerabilities. The local web export and its bundle
gate passed. Browser acceptance uses loopback mocked APIs and synthetic staff;
it is not production or native-device acceptance. Production metadata/cleanup
and the affected real event's additional venue-evidence fields remain unmodified.

## Exact skip, aggregate error and production-read boundary

The one full-suite skip is `server/databaseRecovery.test.mjs:165`,
`offline restore rejects a dangling output link before SQLite can create its target`.
The Windows fixture catches `EPERM`/`EACCES` from `symlinkSync` and reports
`Host does not permit file symlinks`. This is unrelated to festival/event tests.

The aggregate's npm audit logged a failed request to
`https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`, reason `undefined`,
then `audit endpoint returned an error`. It also could not write logs under the
default user npm-cache directory. No more specific network cause was logged.
The separately approved audit used a task-local cache and returned zero
vulnerabilities. `package.json` and `package-lock.json` remain unchanged; the
lockfile SHA256 is `50d1fe2cb2f25b46dde08110c9a8825b3ff7f24b76f9e0b2b847eb92b45523d9`.
The constituent gates are recorded separately; do not label the aggregate run
itself successful.

Actual production venue eligibility remains unverified. Browser inventory had
no connected Render tab. Attempting to select native Firefox window 66700 was
denied because URL-policy enforcement is unsupported for the Windows browser;
Computer Use stopped. No alternate browser route, credential extraction, login,
or production query was attempted. The missing venue fields are not inferred
from provider listings and the strict event-only guard is not weakened.
