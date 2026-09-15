# Catalogue maintenance rollout — 2026-09-15

## Delivered scope

- Moderation → Catalog has admin-only status and audited catch-up, maintenance and pause controls. Mode changes require an active, verified administrator, existing CSRF protection and a matching current mode. Retried desired-state requests are idempotent; they do not reset budgets or force downloads.
- Artist enrichment uses three concurrent lookup lanes for initial catch-up, then one for maintenance. These run inside the existing service, not three paid Render services. Exact MusicBrainz identities link to Wikidata and Wikipedia; source, revision and license remain attached. Staff edits, claimed profiles and identity changes remain protected.
- Catch-up caps: 40 candidates/pass, two-minute cadence, 45-second pass deadline, 3,000 attempts and 12,000 provider requests per UTC day. All lanes share a minimum 1,100 ms request-start spacing. Maintenance uses at most ten candidates every fifteen minutes. Budgets, leases, due times and pauses survive restarts.
- Guards preserve interactive capacity, at least 512 MiB free disk and twice the current database/WAL footprint. Enrichment stops if database/WAL growth exceeds 256 MiB above its durable baseline. Responses are bounded to 512 KiB and stored biographies to 1,200 characters; no raw page or image archive is retained.
- Repaired scheduled show refresh: Node DatabaseSync does not provide the better-sqlite3 transaction method previously called by completion bookkeeping. Native SQLite savepoints now atomically persist refresh, revision and cursor markers, including rollback inside an existing transaction. Internal TypeErrors are no longer automatically mislabeled as provider network failures.
- Bounded, privacy-safe show-refresh diagnostics identify the current phase, failure category and safe source location without retaining provider URLs, secrets or user data.
- Public HTML and sitemap eligibility share source/identity rules. Significant saved changes reach sitemap lastmod through existing bounded snapshots, without downloads on crawler requests or a full rebuild after every artist.

## What this does not claim

- Finishing the initial sweep means known-identity candidates were attempted, not that every page is complete. Missing identities, partial fills, no matches and retries remain visible.
- Venue locations and event calendars come from existing verified provider records. Venue accessibility, capacity and other editorial claims are not generated or invented. This is source-backed enrichment, not an unrestricted AI writer.
- The panel reports sitemap evidence, not Google Search Console indexing. Google decides whether and when to crawl and index useful pages.
- Reserved disk headroom is not an off-host backup. A private remote backup destination was still unconfigured at rollout preparation.

## Verification and rollout

- Local npm run check: 4,852 tests passed; syntax, architecture, vulnerability audit and production web build passed. Initial web JavaScript: 508.8 KiB gzip against the existing 512 KiB budget.
- Catalogue moderation browser harness: eight scenarios passed, including responsive layouts and permission/save failure states. The harness is now included in CI.
- Render environment was merged, not replaced: ARTIST_KNOWLEDGE_ENABLED=true, ARTIST_KNOWLEDGE_MODE=catch_up and ARTIST_KNOWLEDGE_CATCHUP_BATCH=40. Render automatically started an environment deployment. Existing credentials and unrelated settings were preserved.
- Code release and live catch-up evidence must be checked after CI and deployment. Local/browser fixtures do not prove live catalogue completion.
- The retired pit-catalog-refresh cron remains unsuspended until Render confirms otherwise. The available connector has no suspend action, and dashboard browser initialization failed. Its retired script reports no data changes; do not confuse that with suspending its schedule.
