# DM inbox query benchmark

DB13 removes the inbox summary's full-history `ROW_NUMBER` ranking. The query walks distinct peer keys using recursive range seeks over the existing directional indexes, obtains each direction's latest visible message with the pair/removal/cursor index, then compares at most two candidates per conversation. Read and consent projections use the same peer-key traversal. No extra conversation table, write trigger or production index build is required.

Inbox removal IDs use indexed removed-message ranges with at most 750 candidates per peer and direction before selecting the same global latest 750 IDs. A direction cannot contribute more than 750 rows to that result. This prevents an otherwise empty removal response from scanning all visible message history. Per-thread removal responses still include every removal.

The work still grows with the number of conversations and bounded removal candidates. Exact unread totals also grow with the number of genuinely unread messages. Older messages remain available through the unchanged message pagination route; the 200-preview summary limit is unchanged.

## Reproduce locally

With the repository's dependencies installed and its supported Node runtime:

```sh
node scripts/benchmark-dm-inbox.mjs --output docs/performance/dm-inbox-results.json
```

The script creates and removes its own temporary database, sets explicit test configuration, and blocks network connections. It accepts neither an existing database path nor a server URL. `--iterations 7` is the default; each measurement has three warmups followed by seven measured calls. Use `--iterations 3` through `--iterations 30` to change the sample count. Omit `--output` to print the JSON.

The baseline queries are frozen from released commit `c2bbe88246f249a5fa7cd60f3184f55b6b8794bf`. Both versions run against the same synthetic records and current schema. Before timing, the script compares ordered previews, read cursors, unread counts, latest incoming boundaries and consent for every peer, including peers beyond the 200-preview cap. It also verifies the exact latest 750 removal IDs, compares current API summary payloads and checks the final database's integrity and foreign keys.

Two distributions run at 1,000, 10,000 and 100,000 messages per viewer:

- Five inbound-only peers, all messages read, matching the audit's history-growth shape.
- 250 peers with incoming/outgoing messages, equal timestamps across peers, removed messages, explicit acceptance, pending requests and blocks in both directions. Each peer has up to two visible incoming messages after its read cursor.

Each size uses a fresh viewer and peer IDs in one disposable database. The prior fixtures remain until the run finishes, so total database size grows to 222,000 messages. Reported row counts are messages owned by the measured viewer. Measurements include statement preparation, as the application does. They are local warmed measurements under the host's current load, not production performance, an SLO or a capacity guarantee.

`summaryDataWork` compares the latest-row query plus read/consent assembly before and after. `summaryDataWithRemovals` includes the removal query as well. `currentSummaryRoute` measures the actual optimized API route, including profile hydration and relationship context; it is deliberately separate because the script does not run the historical whole API. Component measurements and full query plans are retained in the JSON.

## Recorded results

Recorded on November 11, 2026 using Node 24.16.0 / SQLite 3.53.0 on the Windows development PC. All result comparisons passed, `integrity_check` returned `ok`, and there were zero foreign-key violations. All six actual API fixtures also confirmed that the loaded route executed the bounded removal query. [Full measurements and query plans](dm-inbox-results.json) are included; an identical run artifact is retained at `../evidence/dm-inbox-results.json` relative to the repository root.

Median milliseconds, seven measured iterations after three warmups:

| Distribution | Messages | Query assembly before, including removals | Query assembly after, including removals | Optimized whole API route |
| --- | ---: | ---: | ---: | ---: |
| 5 peers, all read | 1,000 | 3.154 | 1.006 | 1.380 |
| 5 peers, all read | 10,000 | 46.546 | 1.024 | 1.404 |
| 5 peers, all read | 100,000 | 644.293 | 1.001 | 1.746 |
| 250 peers, mixed | 1,000 | 5.601 | 9.235 | 17.889 |
| 250 peers, mixed | 10,000 | 43.805 | 21.581 | 31.429 |
| 250 peers, mixed | 100,000 | 552.007 | 91.076 | 99.051 |

The first two timing columns compare the same SQL/read/consent/removal assembly. The last column includes the current route's additional profile and relationship work; there is no historical whole-route timing in this run. The global accepted unread total stayed at zero for the five-peer cases and 414 for every mixed case.

At 100,000 messages across five peers, the latest-row query changed from 413.061 to 0.537 ms and the global unread count from 32.327 to 0.151 ms. The plans show recursive `(to_id,from_id>?)` and `(from_id,to_id>?)` seeks and `idx_dms_visible_cursor` seeks bounded by both participants and removal state. Temporary sorts remain for peer keys, two latest-message candidates and the final result; complete visible history is no longer ranked.

There is an overhead tradeoff for shallow conversations: at 1,000 messages across 250 peers, query assembly increased from 5.601 to 9.235 ms. The mixed 100,000-message fixture also contains 5,880 removed rows, so removal candidate selection still costs 67.724 ms and accounts for most of its remaining work. The algorithm bounds each direction's candidates by the unchanged 750-row inbox removal limit, but does not make many-conversation or many-removal workloads constant-time. Host load and cache state affect these measurements; the recorded speedups are evidence for this synthetic workload only.

## Focused regressions

The hermetic test runner passed 44 tests with zero failures and zero skips:

```sh
node scripts/run-tests.mjs server/dmInboxSummary.test.mjs server/dmReads.test.mjs server/dmReadThrough.test.mjs server/dmConsentRoutes.test.mjs server/features/messaging/directMessageConsent.test.mjs server/dmHistoryRemovals.test.mjs server/dmReadWebAcceptance.test.mjs server/chat.idempotency.test.mjs server/features/messaging/messageRelationshipContext.test.mjs
```
