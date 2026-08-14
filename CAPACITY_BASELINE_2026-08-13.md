# Capacity baseline — 2026-08-13

## Practical answer

Treat the current production topology as a **small-community launch**, not a
viral-scale service. Until a production-shaped soak runs on a Render
Starter-equivalent instance, the defensible operating budget is:

- **5–10 sustained origin API requests/second**;
- roughly **10–25 simultaneously active browsers**, assuming an active person
  averages one origin request every 2–4 seconds;
- about **100,000 ordinary API requests/day** when traffic is spread; and
- **15 requests/second or 25 active browsers only as a short monitored burst**.

This is a planning boundary, not a claim that browser 26 fails. It intentionally
does not promise 25 sustained requests/second, 50 active browsers, 250,000
requests/day, or 100 concurrent production connections without comparable
staging evidence.

## Production boundary

- One Render `starter` web service: 0.5 CPU and 512 MB RAM.
- One synchronous Node.js process serves the web build and all API routes.
- One 1 GB persistent disk owns the SQLite database and seven local full
  snapshots. A disk can attach to only one Render service instance, so this
  topology cannot horizontally scale or perform zero-downtime replacements.
- Photos and videos bypass Node through R2, but the current `r2.dev` hostname is
  still an independent, non-production media-delivery risk.
- The per-account/address 300 requests per five minutes guard is an abuse limit,
  not a capacity promise.

Render documents the current instance and disk limits in its
[compute plans](https://render.com/docs/compute-plans),
[persistent disk](https://render.com/docs/disks), and
[scaling](https://render.com/docs/scaling) guides.

## Repeatable local evidence

The capacity tools refuse production targets and fixture paths:

```powershell
npm run benchmark:seed -- --database .tmp/capacity-benchmark/pit.db --posts 600
$env:PIT_DATA_DIR = (Resolve-Path .tmp/capacity-benchmark).Path
npm run benchmark:recommendation -- --iterations 40
npm run benchmark:read -- --url http://127.0.0.1:3130 --profile personalized --concurrency 8 --seconds 120 --warmup 15
```

The final isolated fixture used on 2026-08-13 contained 19 users, 621 posts (600
synthetic recent recommendation candidates), 2,393 total likes, 906 total
synthetic comments, 2,658 artists, and 1,230 tour dates.

### Recommendation service

After bounding diversity reranking to the top 40 candidates, selecting only a
narrow candidate projection, and sharing an unexpired guest snapshot:

| Path | p50 | p95 | Max |
|---|---:|---:|---:|
| Cold signed-in first page, bounded global pool | 13.8 ms | 16.0 ms | 20.0 ms |
| Warm shared-guest first page | 5.2 ms | 5.3 ms | 5.6 ms |

This includes SQLite signal/candidate queries and the selected 30-row full post
projection on the local workstation. It is not a Render result.

### Unauthenticated global-first browse mix

The read mix is 40% `/api/feed/for-you`, 20% discovery sidebar, 15% Discover
overview, 15% artist search, and 10% tour dates. It is closed-loop: each worker
waits for a response before sending another request. The benchmark does not send
an account cookie, so `/api/feed/for-you` exercises the shared global-first guest
snapshot rather than signed-in affinity queries. Signed-in cold-start ranking is
measured separately in the recommendation-service table above.

| Concurrency | Throughput | p50 | p95 | Errors |
|---:|---:|---:|---:|---:|
| 1 | 143 req/s | 6.5 ms | 12.3 ms | 0 |
| 8 | 148 req/s | 51.0 ms | 93.1 ms | 0 |
| 16 | 149 req/s | 101.5 ms | 168.3 ms | 0 |

Throughput has already flattened by concurrency 8 while latency keeps rising;
the higher row demonstrates queueing, not safe production headroom. Historical
measurements against the old chronological feed are not used to support the new
For You capacity claim.

The local workstation is faster than the half-CPU production container. The
probe also omits internet/TLS/proxy latency, production CPU scheduling, backup
overlap, authenticated write contention, and a long-lived production data set.
Its closed-loop design has coordinated omission during overload. That is why the
launch budget remains 5–10 origin requests/second despite much higher loopback
throughput.

## Analytics and disk budget

API requests and analytics events are not interchangeable: one feed request can
produce many impressions, dwell buckets, video milestones, interactions, and a
performance event, later uploaded in one batch.

Raw first-party analytics therefore has a 30-day age limit, a hard 40,000-row
global ceiling, and a 5,000-row per-account ceiling so one account cannot cycle
everyone else's diagnostic history. A local SQLite sample using the event table and its indexes
measured roughly 28–41 MiB per 100,000 representative rows depending on ID and
payload distribution. Forty thousand rows is intentionally a small working set;
long-term product trends must use bounded aggregates or a separate analytics
store, not unlimited raw rows.

The disk constraint is stricter than the nominal 1 GB suggests. Peak local
snapshot use is approximately:

```text
live DB + 7 retained snapshots + next .partial ≈ 9 × live DB
```

before WAL and safety reserve. With a 20% reserve, the practical live-database
ceiling is around **70–90 MiB** while seven same-disk copies remain. The prior
250 MB migration trigger was unsafe. SQLite deletes reuse pages but do not shrink
the file below its high-water mark with the current configuration.

## What fails first

1. CPU and event-loop latency in the single synchronous Node process.
2. SQLite's single-writer boundary during analytics, likes, comments, and posts.
3. The 512 MB memory ceiling when catalogue projections, JSON responses,
   recommendation snapshots, and a backup upload overlap.
4. Disk capacity from the live DB, WAL, and same-disk full snapshots.
5. `/api/tourdates`, which remains a large unpaginated projection, and other
   synchronous catalogue aggregations as the data set grows.
6. Deployment availability because the persistent disk prevents horizontal and
   zero-downtime replacement.
7. Media delivery through `r2.dev`, independent of API health.

## Operating alerts and migration triggers

- Alert at API p95 above 300 ms for five minutes; stop growth at 500 ms.
- Alert at p99 above one second or 5xx/timeouts above 0.5%.
- Keep normal CPU below roughly 70% and RSS below 350 MiB.
- Alert when event-loop-delay p95 exceeds 100 ms.
- Investigate any normal-traffic `SQLITE_BUSY`, write timeout, or WAL above 64 MiB.
- Alert at a 60 MiB live database or 35% total disk use; treat 80–90 MiB as a
  hard topology limit while seven local snapshots remain.
- Alert near the 40,000 raw analytics cap; move longer-term measurement to
  rollups rather than raising it on this disk.
- Begin PostgreSQL/stateless API work before 10 sustained origin requests/second,
  25 routinely active browsers, or a public campaign that can synchronize load.

Before raising the promise, use a Starter-equivalent staging service and a
production-shaped database for a 30-minute **open-loop** soak at fixed 2, 5, 8,
10, and 15 request/second arrival rates. Mix guest and authenticated first/cursor
feed pages, analytics batches, likes, comments, posts, and a backup. Record CPU,
RSS, event-loop delay, p95/p99, WAL/disk growth, `SQLITE_BUSY`, and errors.

The next architecture should move relational state and analytics rollups to
managed PostgreSQL, serve immutable web assets from a CDN, deliver R2 through a
custom cached domain, and run a stateless API that can scale horizontally.

No production load test was run. Every included tool refuses the production
hostname or non-temporary fixture path.
