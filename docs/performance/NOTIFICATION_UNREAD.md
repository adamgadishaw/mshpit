# Notification unread index (DB12)

The additive startup schema creates `idx_notifs_unread_user` on
`notifications(user_id) WHERE read=0`. Counts visit only the recipient's unread
candidates. Actor visibility, bilateral blocks, mutes and current reaction
validity are still evaluated by the original query. There is no stored visibility
count or copied profile data. History and scoped acknowledgement contracts are
unchanged.

This was tested only on disposable local SQLite databases. No live index build
or production migration was performed. The normal schema initializer will add
the index when this change is eventually deployed; migration from populated
pre-index state and repeat startup are covered by the regression test.

## Reproduce

```sh
node scripts/run-tests.mjs --test-concurrency=1 server/notificationUnreadIndex.integration.test.mjs server/notificationReliability.integration.test.mjs server/migrations.test.mjs server/verificationMigration.test.mjs
node scripts/benchmark-notification-unread.mjs ../evidence/notification-performance.json
```

The benchmark creates its own temporary database and accepts no database input
path or remote target. It removes credential environment values and rejects
fetch calls. Each history size has exactly 100 unread system notifications.
Baseline and indexed measurements use the same fixture; only this index is
dropped/recreated. Three warmups precede 15 count/page samples and seven write
samples. Writes run inside rolled-back transactions so the fixture is unchanged;
their timing measures statement/index work, not durable commit throughput.

## Recorded comparison

Windows PC, Node 24.16.0 / SQLite 3.53.0, 2026-11-11. Other local work was running.
These are warmed synthetic measurements, not production latency, an SLO, or a
capacity guarantee. Full plans and timings are in `notification-unread-results.json`.

| History rows | Count before, median ms | Count after, median ms |
| ---: | ---: | ---: |
| 1,000 | 0.2352 | 0.0234 |
| 10,000 | 1.7212 | 0.0238 |
| 100,000 | 39.0198 | 0.0273 |

At 100,000 rows, EXPLAIN changes recipient candidate access from
`idx_notifs_user (user_id=?)` to `idx_notifs_unread_user (user_id=?)`. All privacy
subqueries remain in the plan. The disposable index build took 13.61 ms.

| Rolled-back write batch at 100k | Before, median ms | After, median ms |
| --- | ---: | ---: |
| Insert 1,000 unread notifications | 5.0512 | 5.7165 |
| Mark 100 notifications read | 0.1819 | 0.2797 |
| Actual scoped acknowledgement of 100 IDs | 81.0974 | 43.0422 |

The index adds write work, as expected. Scoped acknowledgement also performs
the existing ID/visibility lookup, whose cost is not eliminated by this unread
index; the table does not imply every part of acknowledgement is bounded by
unread rows. No index or history was removed to obtain the improvement.

The focused run passed 27 tests, failed 0, skipped 0. New coverage verifies the
query plan, read-history exclusion, changed block visibility, mutes, withdrawn
reactions, foreign-account IDs, concurrent arrivals, idempotent acknowledgement,
delete/write maintenance, injected rollback and populated startup migration.
Final benchmark integrity was `ok`, with zero foreign-key violations.
