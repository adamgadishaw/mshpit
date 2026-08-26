# Sitemap snapshot operations runbook

MSHpit serves sitemaps from an atomic last-known-good (LKG) snapshot. HTTP requests must never scan the database or assemble the sitemap. A refresh builds and validates a replacement away from the request path, persists it atomically, then swaps the in-memory pointer.

## Expected lifecycle

1. At startup, load and validate the persisted public snapshot if one exists.
2. If no valid snapshot exists, sitemap endpoints may return a temporary `503` while the first asynchronous prewarm runs.
3. After database/public-media readiness, schedule a coalesced refresh.
4. Materialize eligible candidates once, derive every dataset from that immutable context, render shards, and validate the result.
5. Write and fsync a temporary file in the configured data directory, atomically rename it over the prior persisted snapshot, then fsync the containing directory where the platform supports it.
6. Swap the in-memory pointer only after persistence and validation succeed.
7. Refresh on the configured interval. Overlapping triggers join the running refresh.
8. On build, validation, or persistence failure, keep serving the prior LKG and schedule the retry at the manager's bounded backoff time.
9. On shutdown, stop both interval and backoff timers and drain the active refresh before closing the database.

## Safety invariants

- One canonical URL appears at most once across all shards.
- A shard contains at most 50,000 URLs and is smaller than 50 MiB uncompressed.
- Only canonical, public, `200`, indexable routes are eligible.
- Private, blocked, deleted, banned, malformed, empty, thin, duplicate-query, and noncanonical page-one routes are excluded.
- Candidate reads use deterministic ordering and never silently truncate. The current reducer has an explicit 100,000 combined source-row safety ceiling: crossing it fails the refresh and keeps the LKG intact.
- One refresh intentionally retains one immutable post/tour candidate snapshot so every dataset shares identical eligibility. This removes repeated scans but memory grows with public rows. Move to the documented spool reducer before reaching the explicit ceiling; never swap a partial sitemap.
- The persisted snapshot has a 96 MiB total-file ceiling in addition to Google's per-shard 50 MiB limit. An oversize replacement fails validation before write and leaves the LKG untouched.
- Refresh work is bounded/coalesced and never executes in an HTTP request handler.
- A failed refresh cannot replace or truncate the LKG.
- Persisted data contains public XML/URLs and aggregate metadata only—no tokens, email addresses, private identifiers, moderation data, or raw query errors.

## Authorized health fields

- `available`, persisted/current-process source, generation time, and age;
- refresh state, start time, and duration;
- total URL count and per-dataset counts;
- shard count and largest shard bytes/URL count;
- last successful refresh and consecutive failure count;
- sanitized failure category/time and next eligible retry.

## Routine verification

1. Run the complete quality gate and production web export.
2. Run the SEO verifier against the candidate deployment.
3. Run the runtime indexable-count inventory.
4. Compare inventory-eligible counts with snapshot dataset counts.
5. Fetch the index and every shard. Confirm XML parsing, canonical host, uniqueness, limits, and representative live indexability.
6. Compare production sitemap counts with Search Console discovered counts after processing.

## Capacity gate

1. Before traffic or catalog step changes, benchmark refresh duration and process RSS with representative 10k, 50k, and expected next-year public post/tour volumes.
2. Record source row counts, dataset counts, shard bytes, refresh duration, and RSS before/after refresh.
3. Alert on sustained snapshot age, refresh duration approaching the schedule interval, or memory headroom falling below the service limit.
4. Move materialization to a bounded temporary SQLite/spool table or streaming reducer before the combined public post/tour source approaches 100,000 rows or the serialized snapshot approaches 96 MiB. Do not raise either limit without a representative RSS/storage measurement, add a hidden truncation limit, or swap a partial sitemap.

## Incident: sitemap returns 503

1. Check whether a persisted LKG was found and accepted at startup.
2. Check database/public-media readiness and first-prewarm state.
3. Check the sanitized failure category and retry time.
4. Confirm the data directory is writable and atomic rename occurs on one volume.
5. Do not add a synchronous request-time fallback. Restore a validated snapshot or let the bounded refresh finish.

## Incident: snapshot is stale

1. Confirm the scheduler is active and whether a refresh is already running.
2. Compare refresh duration with the configured interval and timeout.
3. Inspect aggregate candidate counts and query latency; use query-plan tests for regressions.
4. Check validation failures: duplicate URLs, oversize shards, malformed XML, or empty required datasets.
5. Keep serving the LKG while repairing the cause.

## Incident: inventory and sitemap differ

1. Ensure both use the same release and policy version.
2. Compare each route family, not only the grand total.
3. Confirm pagination and city/archive qualification thresholds.
4. Confirm page-one canonicalization and duplicate-query exclusion.
5. Check whether refresh completed after inventory capture.
6. Inspect keyset boundaries for missing/duplicate rows, especially above 10,000 candidates.

## Incident: Google says “Couldn't fetch”

1. Fetch `https://www.mshpit.com/robots.txt` and `https://www.mshpit.com/sitemap.xml` as anonymous external traffic.
2. Confirm `200`, XML content type, valid XML, canonical absolute URLs, and no Cloudflare challenge/login redirect.
3. Fetch every child sitemap in the index.
4. Confirm TLS, DNS, redirects, and CDN behavior for Googlebot match ordinary anonymous traffic.
5. Run Search Console **Test live URL** for the sitemap and representative pages.
6. Re-submit only after production verification passes. Email MX changes do not repair HTTP sitemap fetching.

## Recovery and rollback

- A code rollback may continue serving the last compatible validated snapshot.
- If the exact snapshot file is corrupt, quarantine only that file and let prewarm replace it; never delete the application data directory.
- Never hand-edit production XML.
- Never force a swap, reset failures, or weaken validation merely to return `200`.
- Record release SHA, failure category, snapshot timestamps/counts, remediation, and Search Console outcome.
