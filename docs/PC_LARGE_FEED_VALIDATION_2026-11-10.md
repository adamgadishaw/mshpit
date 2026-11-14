# Large feed traversal follow-up — local only

Parent candidate: `20975b1ead3fc1f447522dfe433d24a9fb945829`, based on remote
master `6a51cb7a79605625602beb91dd7e55e26d3b1455`. This is a separate follow-up;
the original commit, patch, bundle and evidence remain preserved.

## Why the original run was interrupted

The original worker manually interrupted the 2,505-post test after several
minutes without a completed result. It was not a passing test or an established
timeout error. This follow-up reproduced a slow query rather than assuming a
transport or pagination failure.

The rich post projection calls `seenOrdinalSql`. SQLite's plan performed a
correlated same-night review scan before checking whether the historical post
had a matching supporting act. Empty lineups therefore still caused repeated
history scans. Worker isolation measured a 2,505-post, single-author raw 50-post
recommendation head at 62,351 ms: its two rich SQL queries consumed 62,337 ms,
while candidate scoring took 6 ms. A lean 50-row selection took 1 ms.

The parent's pre-fix mixed-author traversal also failed its four-minute work
budget, logging 1,500 visited posts before the last progress interval. Its
sampled page times were 7,012, 5,845 and 9,364 ms. That budget is checked between
synchronous calls, not an interruptible timeout. The diagnostic log and CPU
profile are retained in the task workspace as `large-feed-history.log` and
`feed-history.cpuprofile`.

## Fix

`supportingActs.js` materializes matching opener sightings before performing the
same-night anti-join. It preserves artist-key/name fallback, date and unknown-date
rules, same-night deduplication, baselines, removed posts, online reviews and
malformed JSON behavior. No schema, eligibility, ordering or privacy policy is
changed. Regression tests include a 2,505-post empty-lineup query-plan check.

## Retained verification

Run from the isolated clone:

```text
node scripts/verify-feed-history.mjs split-report.json
node scripts/verify-feed-history.mjs single-report.json same-author
```

The harness creates and removes a temporary SQLite database, calls the actual
feed route handlers and rich projections, and does not start an HTTP server or
provider job. Both fixtures initially contain 2,643 posts: 2,505 eligible and
138 excluded across blocked-by-author, muted, removed, banned, suspended and
dormant cases. The mixed fixture has four eligible authors in two cities; the
single-author fixture places all 2,505 eligible posts under one followed local
author. Empty lineups are deliberate to reproduce the identified pathological
plan; broad high-volume nonempty lineups are not benchmarked.

Each section uses 50-post requests and checks exact expected ID coverage, no
duplicates or gaps, advancing cursors, genuine exhaustion, replay of an issued
cursor, chronological tuple order for Local/Following and the For You tail,
and an immutable For You ranking snapshot. A new eligible head arrival is
inserted after page one: it cannot enter the existing traversal, and explicit
refresh must expose it. Separate actual-hook tests expand Local and Following
to 2,505 cards with duplicate overlap, then reject late pagination after refresh
and account changes. Existing For You refresh/section generation tests also run.

Final measured reports are retained under `docs/evidence/`; page-by-page
timings accompany summaries. Measurements are elapsed local synchronous handler
and projection time on Windows, Node 24.16.0, with no competing benchmark run.
They exclude HTTP, network transfer, phone rendering, production concurrency,
real media storage and providers. There is no invented production latency or
capacity threshold. The four-minute work guard and 100-page guard bound this
specific fixture, not supported production capacity.

## Results and remaining limits

Both complete traversals passed all assertions. The measured seed/traversal
window was 12.950 seconds for mixed authors and 37.878 seconds for one author,
including cursor replay and refresh checks, excluding initial module/catalog
startup. Rounded route-page timings:

| Fixture | Section | Eligible / received | Pages | Median ms | p95 ms | Max ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Mixed authors | For You | 2,505 / 2,505 | 51 | 85 | 126 | 137 |
| Mixed authors | Local | 1,600 / 1,600 | 32 | 120 | 130 | 137 |
| Mixed authors | Following | 1,855 / 1,855 | 38 | 102 | 126 | 141 |
| Single author | For You | 2,505 / 2,505 | 51 | 240 | 259 | 272 |
| Single author | Local | 2,505 / 2,505 | 51 | 240 | 258 | 271 |
| Single author | Following | 2,505 / 2,505 | 51 | 241 | 253 | 266 |

Independent review found no blockers and ran 15 supporting-act/feed/lineup
checks plus 15 follow-up identity/hook checks, all passing (groups overlap).
Parent pagination and expanded-history isolation checks passed 22/22.
The final `npm run check` passed: 7,132 tests passed, zero failed, one skipped
(7,133 total), zero audit vulnerabilities, syntax, architecture and web export
all passed. Initial JavaScript remains 509.7 KiB against the 512 KiB budget.
`git diff --check` also passed. Final gate log: task-workspace
`large-feed-quality-gate.log`; traversal logs use the matching report filenames.
Native iOS/device validation and the separately unrecovered Mac source remain
outside this follow-up. Existing snapshot-expiry behavior still requires an
explicit refresh; this patch does not change it. No phone, Mac, production,
dirty D: checkout, push, merge or deployment operation is performed.
