# Storage, fetching, recovery and monthly cost plan

Reviewed 2026-09-15. The working budget is $50/month; all provider prices below
are USD before tax. A current invoice, workspace plan, media usage and bandwidth
totals were not available. This is a configuration-based estimate, not a bill.

## What is being fixed

- Existing exact artist matches and saved MusicBrainz resolutions answer locally,
  including previously saved stale matches. Unknown lookups remain explicit,
  retryable failures when providers fail; an outage is not proof of no match.
- Remote lookup work has bounded concurrency, same-query coalescing, a deadline,
  short failure backoff, and provider Retry-After handling. The client preserves
  its error state instead of silently treating provider failure as an empty result.
- Backups hash and upload as small streams instead of allocating a full database
  buffer. The transfer refuses redirects and verifies private access, transmitted
  checksum, remote length and recorded SHA-256 metadata before success is recorded.
- Insufficient/unknown disk headroom stops backup creation safely. The newest
  existing recovery point is protected; a failed new snapshot cannot remove it.
- Expired sessions and provider metadata are cleaned in batches of at most 500
  per statement, outside interactive requests. Valid sessions, member content,
  and saved artist recovery records are not treated as generic expired cache.
- Disk and database metadata are sampled every five minutes and in the daily
  report. Warnings cover free space, backup headroom and large WAL files. These
  are observations, not automatic destructive repairs or automatic plan upgrades.
- Request measurements keep only fixed categories and 60 minute buckets in
  memory: completions, disconnects, 5xx/429, histogram latency and known body
  bytes. No user identifiers or URLs are stored. Public health stays minimal;
  detailed observations are staff-only. Counters reset on process restart.

## Lowest-risk architecture at the current scale

Keep the existing SQLite-backed web service and isolated video verifier while
measuring real demand. Reuse existing object storage for media delivery rather
than proxying all media through Render. Use a **separate, private backup bucket**
with restricted credentials, no public domain, verified denial of anonymous
access, and a deliberately selected retention policy. Never put databases in
the public media bucket. See [backup operations](../BACKUP_OPERATIONS.md).

Do not add Redis, a new always-on metadata worker, a full MusicBrainz mirror or a
managed database merely to mask a slow endpoint. Each adds recurring cost and
operating work. The existing bounded metadata worker can run in spare capacity.

Do not downsize either service to 512 MB without a representative benchmark:
this app has already had out-of-memory incidents and video decoding needs its
own working-memory headroom. Do not collapse video decoding into the web process
just to save a subscription; it would reintroduce coupled availability risk.

## Cost envelope

| Configured component | Monthly baseline |
| --- | ---: |
| Web service, 1 CPU / 2 GB | $25.00 |
| Private video verifier, 1 CPU / 2 GB | $25.00 |
| Persistent disk, provisioned 5 GB | $1.25 |
| **Compute and disk subtotal** | **$51.25** |

Render bills workspace subscriptions and metered usage separately. Hobby is
$0, Pro is $25. Thus the same configured services start around **$51.25 on Hobby
or $76.25 on Pro**, before bandwidth, builds, media, email, domain, tax and other
services. Both instances running all month are assumed. Published prices:
[Render pricing](https://render.com/pricing).

Hobby includes 5 GB outbound bandwidth/month; Pro includes 25 GB. Public-internet
overage is $0.15/GB. Backup uploads from Render consume outbound bandwidth even
though R2's own egress is free. Browser delivery direct from R2 avoids that
Render response cost. Sources: [outbound bandwidth](https://render.com/docs/outbound-bandwidth),
[public versus private bandwidth rates](https://render.com/docs/private-link).

R2 Standard has a shared account-level free allowance of 10 GB-month storage,
1 million Class A and 10 million Class B operations/month. Above that, storage
is $0.015/GB-month; reads/writes are separately metered and billing units round
up. Do not assume every bucket receives a separate free allowance. For example,
100 GB of total average Standard storage is about $1.35/month **for storage only**
after the allowance. [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

Example backup arithmetic (uncompressed snapshot; 30 scheduled uploads/month):

- A 200 MB snapshot with seven retained off-host copies uses approximately 1.4 GB
  of remote storage and sends 6 GB/month out of Render.
- A 2 GB snapshot with seven retained copies uses approximately 14 GB and sends
  60 GB/month. On Hobby, that is $8.25 outbound overage if there is no other
  outbound usage, plus approximately $0.06 remote storage if the entire R2 free
  allowance is otherwise unused. Application traffic increases the total.
- Local seven-copy retention plus one live database would not fit a 5 GB disk
  once snapshots are 2 GB. The new warnings must be acted on before that point.

These examples are capacity arithmetic, not measured current database sizes.
Keep existing retention until an approved recovery/deletion policy changes it.
Compression is a possible later optimization, but must include verified restore
support and CPU/disk measurements before enabling it.

For a larger database, compare a private **same-region Amazon S3** destination
before assuming R2 is cheapest. Render currently exempts same-region S3/GCS
service-initiated transfers from outbound bandwidth billing; S3 still has its
own storage, request and restore/download charges. Confirm the web service's
actual region and the destination's price first. The existing S3-compatible
backup transport supports this choice without adding an always-on service.
The small-database default can remain a private R2 bucket on the existing
account; no destination has been provisioned automatically.

## How to approach the $50 target

1. Verify actual workspace/billing line items and that retired catalogue jobs
   are no longer running. Do not delete or cancel a service based on its name.
2. Keep the 2 GB web allocation for now. The published configuration cannot
   deliver the same two always-on 2 GB services strictly below $50.
3. Keep media direct-to-object-storage and hashed web assets cacheable; never
   cache authenticated API responses publicly to save bandwidth.
4. Keep the verifier rebuild filter. Batch tested web changes into cohesive
   releases; disk-backed deployments have a real interruption window.
5. Only evaluate a smaller/on-demand video processing design after measuring
   CPU, peak RSS, processing time and queue demand on representative phone clips.
   It requires a durable queue, idempotency, retry and privacy checks—not simply
   switching off today's verifier. No paid plan change has been made here.
6. Stay on transactional email's existing appropriate allowance; do not move
   verification/reset email onto the web server. Resend's published free plan
   is 3,000 monthly emails and has daily limits: [pricing details](https://resend.com/docs/knowledge-base/what-is-resend-pricing).

## Measurement and operating thresholds

- Disk: investigate below 20% free or the estimated next-backup reserve; urgent
  below 10% or 256 MiB. Inspect the cause and preserve verified backups before
  changing retention. A large WAL is not permission to delete the WAL file.
- Database: the tiny read probe is **not disk I/O throughput or a full query
  benchmark**. Use query plans and representative isolated fixtures for slow
  routes. Reusable SQLite pages can serve future writes; do not run VACUUM in
  an HTTP request or automatically against a busy production database.
- Web: compare completed user requests, p95 histogram upper bounds, failures
  and memory through ordinary peaks and provider outages. Health probes are
  excluded so they cannot make real user latency look artificially fast.
- Transfer: known response body bytes exclude headers, streams without length,
  upstream requests, background uploads, CDN cache traffic and disconnected
  partial bodies. Use Render/R2 billing metrics for spend, not this counter.
- Backups: a fresh local snapshot is not off-host protection. Require a confirmed
  private remote copy and a successful isolated download/restore drill before
  declaring recovery ready. The receipt alone does not prove the object still
  exists now, nor does a database backup contain external photo/video bytes.

## Evidence and limits

The full check passed 4,759 tests, the production dependency audit (no known
vulnerabilities), syntax and architecture checks, and the web production build.
The exported app passed all 39 navigation/browser cases, including provider
failure and explicit retry on mobile and desktop. Twelve real-server account
checks also passed against a disposable database, including session rotation,
revocation, permission boundaries and concurrent authenticated reads. These
tests made no production account changes and are not production load tests.
All 52 exported-app account/browser scenarios also passed, including guest
interaction gates, sign-in/out, expired sessions, offline recovery and forms.

Three ordinary public reads during this audit returned 200: health 375 ms,
robots.txt 324 ms, homepage 407 ms, measured to body completion from the local
machine. This is a spot check with network latency, not a load/capacity claim.

An isolated 100,000-session/100,000-provider-row fixture showed these cleanup
p95 durations over 20 rollback repetitions: expired-session cleanup from 8.757 ms
(10,000 removals) to 0.846 ms (500); expired-provider cleanup from 101.735 ms
(90,000 removals) to 1.110 ms (500). This measures shorter per-pass stalls, not
less total cleanup work or a corresponding production speedup.

The dashboard connector was unavailable. No production database, subscription,
credentials, destination or retention policy was changed manually. Tests use
isolated fixtures. Remote protection remains **unconfigured** until a private
destination is approved/configured and the end-to-end backup is verified.

## Availability limitation to acknowledge

Render disk-backed services cannot use multiple instances or zero-downtime
deploys. Restarts/deployments can interrupt requests even after these fixes.
For an eventual stricter uptime target, plan a separately tested migration to
a network-accessible managed database and multiple stateless web instances,
including rollback and recovery. That is not a $50 architecture and should not
be slipped into this repair. [Render disk limitations](https://render.com/docs/disks).
