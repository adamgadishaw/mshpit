# Artist directory query correction

This isolated correction is based on released server commit
`c2bbe88246f249a5fa7cd60f3184f55b6b8794bf`. It changes no response fields,
eligibility rules, page sizes, ordering, or exact-count behavior. It is not a
production incident root-cause finding or a production performance guarantee.

## Cause and correction

The directory's correlated review `EXISTS` combined canonical `artist_key`
matching and an unkeyed, unambiguous legacy-name fallback with `OR`. On the
synthetic full schema, SQLite selected
`idx_posts_recommendation_candidates (removed=?)`, reconsidering live posts for
each artist. `COUNT(*) OVER()` correctly requires eligibility for the entire
directory even when only twelve results are returned, amplifying that work.

Split that identity predicate into two `EXISTS` clauses with the same review,
author and sanitized-media qualifications. Add partial indexes for canonical
keys and unkeyed lowercase names. Canonical identity remains authoritative;
wrong keys cannot fall back to names. The legacy uniqueness check is unchanged.
Neither posts nor profile/media data are cached. Author and media revocations
remain live predicates. The shared directory/Discover SQL retains its total,
projection, public-catalog policy, tour eligibility and sort clauses.

The plan now seeks `idx_posts_public_artist_evidence (artist_key=?)` and
`idx_posts_public_artist_name_evidence (<expr>=?)`. An index-only diagnostic on
the 500-artist sparse fixture remained about 645 ms; splitting the query with
the indexes reduced it to 7.6 ms with an identical response. No index hint is
forced. Read-only/old small fixtures still function without the indexes.

## Bounded synthetic comparison

Windows, Node 24.16.0, SQLite 3.53.0; fixed instant 2026-11-12T12:00:00Z;
first page of twelve; actual repository functions and full application schema.
Each case started from a separate disposable copy of the preserved synthetic
schema fixture. No production data, credentials, requests or load tests were
used. Outbound networking was blocked in the workers. There were no SQLite
statistics tables and no `ANALYZE`. One released invocation was compared with
three candidate invocations after index creation. OS cache, host scheduling
and small-sample noise were not controlled; these are observations, not a
statistical performance threshold. All nine cases finished in 31.95 seconds
under a 45-second per-case bound and 180-second launch budget.

| Distribution | Artists | Posts | Tours | Eligible | Released ms | Candidate ms, three samples |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Keyed reviews | 200 | 2,000 | 0 | 200 | 11.14 | 1.75, 1.76, 1.55 |
| Sparse mixed | 500 | 2,500 | 2,500 | 100 | 615.18 | 7.46, 5.91, 5.94 |
| Biography control | 2,000 | 0 | 0 | 2,000 | 5.22 | 4.85, 4.45, 4.22 |
| Keyed future tours | 200 | 0 | 2,000 | 200 | 9.33 | 4.63, 2.44, 2.41 |
| Keyed future tours | 2,000 | 0 | 20,000 | 2,000 | 37.66 | 35.26, 19.72, 19.19 |
| Unkeyed unique-name future tours | 2,000 | 0 | 20,000 | 2,000 | 39.14 | 35.04, 22.56, 21.52 |
| Keyed reviews | 2,000 | 20,000 | 0 | 2,000 | 980.89 | 8.00, 6.31, 6.63 |
| Sparse mixed | 2,000 | 10,000 | 10,000 | 400 | 13,725.33 | 33.39, 30.79, 29.62 |
| No evidence | 2,000 | 0 | 0 | 0 | 3.51 | 4.07, 3.70, 4.07 |

Keyed-review cases have ten substantive reviews per artist. Tour cases have
ten qualified future events per artist. Mixed cases have five posts and five
events per artist: one tenth have substantive posts, a different tenth have
future events, and the remainder have empty reviews and historical events.
All authors are synthetic active accounts. These performance distributions
do not represent the production population or photo-heavy/private catalogs.

Every complete response was deeply equal before/after, including total,
membership, ordering and pagination fields. All copies passed `quick_check`
and had zero foreign-key violations. In the largest sparse case, a queued
zero-delay timer waited 13,726.59 ms before and 30.18-33.87 ms after. This
demonstrates synchronous event-loop occupancy locally; it does not prove the
reported Render restart was caused by this query. CPU timing is coarse on
Windows. The empty-evidence case showed slight overhead. The artist scan,
total calculation and sort remain; this does not promise arbitrary-scale
latency or remove all synchronous database work.

## Upgrade and write implications

Two additive `CREATE INDEX IF NOT EXISTS` statements run after the legacy
post-column migrations. They do not rewrite/delete source rows or alter a
column, trigger or constraint. Existing rows participate immediately, and
ordinary inserts/updates maintain the indexes. Old code can safely leave these
indexes in place on rollback; this statement concerns these indexes only and
does not override other releases' recovery/older-writer restrictions.

Index creation still scans the posts table, consumes disk and acquires SQLite
write locks during startup. Production row counts, available headroom,
concurrent writes, build duration and locking impact have not been measured.
Normal release backup/headroom and restart checks remain necessary before any
separately authorized deployment; no production migration was performed here.

On the 20,000-post synthetic copy, initial construction took 22.75 ms. A
separate rebuild took 20.57 ms and `dbstat` measured 466,944 bytes for the keyed
index plus 4,096 bytes for the empty legacy index. Rolled-back batches of
1,000 inserts had median 116.40 ms before and 117.78 ms after; marking those
1,000 rows removed had median 22.28 ms before and 23.79 ms after. Three samples
per phase; excludes durable commit/fsync, so this is not write throughput.

## Regression and integration boundaries

Focused coverage checks three-page counts/order/exhaustion, both identity
paths, ambiguous names, incorrect keys, empty legacy dates, removed/online/
wrong-kind/short reviews, banned/suspended/dormant authors, inaccessible
artist catalogs, missing slugs, and private/pending/wrong-owner media. It
rechecks removals, media revocations and author revocations using the same
repository. Plan tests use the real initialized schema. A separate process
upgrade test starts with existing rows and absent indexes, verifies unchanged
rows/results and integrity, then verifies an idempotent second startup. The
existing legacy-column migration fixture drops the new dependent indexes
before intentionally dropping columns to emulate an old schema.

The focused seven-file run passed 100 tests, zero failures/skips. Full-gate
receipts and the exact final commit are supplied separately in the delivery
handoff. Initial fixture failures are preserved in external evidence; they
were corrected before the passing run and are not counted as passes.

Runtime overlap is limited to `server/db.js` and
`server/features/seo/publicDocumentRepository.js`. Other changes are tests and
this note. Apply as a separate local commit to the current integration branch,
review those two files and the legacy migration fixture, then rerun the
affected tests and required combined gate. This work does not modify the
standalone DB/theme candidate, feature integration, deployed service or phone.

Evidence is retained outside source under
`artist-directory-fix-evidence-20261112`: the nine `benchmarks/*-result.json`
files contain actual SQL hashes/plans/timings; `run-receipt.json` records all
completions; `query-trial.json` records the index-only comparison;
`write-cost.json` records write/index storage observations. The delivery
includes these receipts and scripts with checksums, excluding database files.
