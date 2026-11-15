# Placebo Prague postponement correction

Local implementation only; no commit, push, deployment, or production data writes.

Release candidate: `codex/placebo-prague-postponed-release`, based on verified
GitHub master `c8a8dd7c4bd068c9fde670d2d099359a21ed83a9`. The original dirty
checkout is untouched. Only the Placebo changes were transferred; `server/api.js`
contains exactly the correction import and exact-resolver guard hunks. No
unrelated review/rating/composer changes are included.

## Evidence and cause

Official source: https://www.ticketportal.cz/Article/11104. The November 15,
2026 show at Sportovní hala Fortuna, Prague, is postponed. No replacement date
is announced; existing tickets remain valid. Read-only local database inspection
confirmed Ticketmaster ID `Z698xZu0Z16vCdfAue`, canonical row
`tm_Z698xZu0Z16vCdfAue`, artist Placebo, date `2026-11-15`, and stale `onsale`
status. Provider upserts previously replaced this status on every refresh.

## Implementation

- `server/reviewedEventCorrections.js` owns the exact source-backed correction.
  Direct read overlays preserve identity and historical date without writing
  the database. Provider upserts retain postponed status and the original date
  until a later explicit review; unreviewed replacement clocks are withheld.
- Shared lifecycle SQL excludes the canonical provider ID from scheduled-show
  selections, including artist next shows, city discovery and public SEO.
  Member-authored records and other canonical event IDs remain unaffected.
- Server public metadata and fresh client snapshots carry the notice and source.
  Show presentation suppresses countdown and purchase actions and labels the
  date as original. Both the interactive and crawler detail pages keep their
  current styling and display the official notice.
  Postponed web/Android and iOS show pages suppress the original start/doors/
  access timing strip, preventing an old clock time from implying a live start.
  Real-render regressions retain the timing strip for scheduled shows and hide
  it for postponed shows on both web and iOS.
- SEO emits `EventPostponed` and no ticket offer. Postponed statuses are treated
  as non-purchasable in SEO generally, consistent with the existing client UI.
- Canonical `GET /api/shows/:key` independently overlays stale stored shows from
  their exact reviewed provider tuple, including legacy shows without a source
  row link. It returns the original date, postponed lifecycle and official
  notice without updating storage or requiring a second event snapshot. The
  normalizer and main ShowScreen retain and display that notice.
- Exact attendance initially regressed to 404 because its resolver reused the
  upcoming-ticket gate. Only the reviewed correction skips that redundant gate
  after existing visibility checks. Current remote RSVP policy is preserved:
  existing plans can be maintained/removed, but new plans remain rejected with
  `EVENT_RSVP_CLOSED`. Live check-in remains denied through exact-event and stale
  stable-show inputs. Inactive-provider visibility remains enforced.

## Validation

Focused tests cover identity isolation, read-only overlays, unchanged historical
dates, stale provider imports (including a purported replacement date), direct
event resolution, artist schedule counts, artist SEO next-show exclusion,
MusicEvent status and missing offers, snapshot normalization, and the actual
fallback JSX notice/link presentation.

Validation in the isolated writable checkout:

- Full suite after timing follow-up: **10,687 total; 10,664 passed, 23 skipped, zero failed**.
- Focused integration tests: 116 passed. Windows/iOS harness checks: 118 passed.
- Timing follow-up: 81 focused render/domain tests passed. Browser assertions
  explicitly reject the old SHOW START and DOORS OPEN labels at both widths.
- Syntax: passed for 1,059 Node files. Architecture: passed.
- Dependency audit: zero vulnerabilities. Diff whitespace checks: passed.
- `npm run build:web`: passed, including catalog split, Expo export and bundle
  budget. Initial JavaScript is 508.9 KiB gzip against the 512 KiB limit.
- Actual exported app plus real `server/index.js`, a fresh synthetic temporary
  database, and headless Chrome: passed at 390px and 1280px with zero page errors.
  The event shows postponed/original date/official notice without purchase or
  countdown; the artist schedule excludes Prague and shows the next fixture.
  Crawler HTML has `EventPostponed`, original start date and no offer. Canonical
  GET is independently postponed. Server and browser outbound traffic was
  blocked; all requests were loopback-only. No production database was used.

The first aggregate check encountered Windows CRLF checkout conversion breaking
byte-pinned source fixtures. Tracked LF files were restored to their repository
bytes and local autocrlf disabled; this introduced no source diff. Two existing
test harnesses received explicit mocks for the new notice helper/diagnostics
dependency. The complete suite then passed. The current remote's lifecycle,
provider-text safety, source-bound snapshot validation and iOS behavior remain.

Evidence is in the task directory alongside the checkout: full-test/build/audit
logs, `placebo-browser-evidence/result.json`, saved event/artist crawler HTML,
and screenshots for both viewport widths. Browser helper scripts are outside
the release candidate and use synthetic fixtures only.

## Remaining release gates

Independent review must inspect this final current-baseline candidate before
any push or deployment. After an authorized deployment, verify the real event
and artist pages. No database migration or manual production database correction
is required. No external publication has occurred.

The correction deliberately remains active across provider refreshes. When an
official replacement date is published, review and retire/update this registry
entry explicitly; a provider sales feed alone cannot clear it.
