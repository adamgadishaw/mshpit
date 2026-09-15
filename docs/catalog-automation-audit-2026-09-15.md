# Catalog upkeep: what runs automatically, and what still needs building

Audit date: 2026-09-15. This report describes repository behavior, not a claim
that production jobs have run. The live Render workspace and runtime progress
have not been inspected as part of this audit.

## Current behavior

| Area | Automatic work | Limits and gaps |
| --- | --- | --- |
| Artist biography and country | `server/artistKnowledgeRefresh.js` fills blank fields in SQLite from exact MusicBrainz-ID → Wikidata → Wikipedia matches. The Blueprint enables it. | Up to 10 artists per 15-minute pass, a 45-second pass budget, and one provider request at a time. Artists without a trustworthy identity/matching source stay unfilled. Existing editorial text is not rewritten. |
| Artist genres | Existing exact-identity genre scheduler refreshes provider evidence. | Staff corrections outrank provider evidence. Provider failures pause or defer work; a discovery tag is not treated as verified genre. |
| Artist images | Existing bounded Spotify photo scheduler runs when credentials and its enable switch are configured. | It does not grant permission to copy arbitrary web photos. Licensed mirrored catalog photographs have a separate provenance path. |
| Events and venue locations | `server/tourdates.js` refreshes persisted Ticketmaster/Bandsintown events; event and venue documents read those saved facts. | The Blueprint requests a 12-hour rotation with limited artists, cities, and countries per pass. It is not a complete worldwide crawl every 12 hours. Venue addresses/coordinates come from identified provider events. |
| Venue descriptions and detailed guides | Existing curated data and page projections. | There is no scheduled, source-backed venue biography/accessibility/capacity curator. Do not describe this as implemented. |
| Catalog roster growth | Staff can start a durable-history SQLite catalog job in Moderation. | Operator-started, not a continuously running AI editor. The old local `npm run pipeline` writes bundled files and is not the production scheduler. |

There is **no LLM-based autonomous editor** integrated in the server. The useful
part already running in code is a deterministic, source-synced background worker.
It reads small amounts of provider data and persists approved facts, so a visitor
does not need to trigger a fresh Wikipedia download for each artist page.

The biography worker retains its attempt ledger and provider cooldown across
restarts. It validates the external identity, saves the exact source revision and
license, and rereads the row before saving so a concurrent staff edit or identity
correction wins. It pauses for low disk space and shares the memory admission
queue with other background jobs. These safeguards must survive future upgrades.

At the current ceiling, 10 × 4 × 24 = **960 artist attempts per day** before
provider delays, paused work, skipped records, and unmatched identities. Thirty
thousand missing artists would therefore take at least about 32 days, not one
overnight run. This is a capacity illustration, not a measured production backlog
or a promise that every artist has a suitable source.

## Reporting issue repaired in this change

A pass that paused for storage or a provider cooldown previously returned before
updating its durable last-pass summary. That could leave an old successful result
in place. Paused passes now record their actual state without changing artist
facts or bypassing the pause. Regression tests cover success → disk pause →
provider cooldown and ensure the artist attempt ledger is preserved.

Protected staff health (`services.artistKnowledge`) and the daily health email
now expose the durable evidence: enabled state, last-pass age, last-pass checked
and filled counts, current ledger totals, unmatched/retry records, and the batch
ceiling. Cooldown, low-space pause, stale/missing evidence, and telemetry failures
produce explicit watch codes. Ledger aggregates are cached for at most one minute
to keep staff polling inexpensive; they are not an exact real-time completeness
percentage. No artist names, member details, remote calls, or schema mutations
are introduced into health reads.

## Practical next stage: one source-backed catalog curator

Use the current service and SQLite rather than add a paid worker, queue, vector
database, or LLM on every page view. The reusable pattern is:

1. Keep a durable task per canonical entity and field group, with a due time,
   source identity, lease, retry count, last outcome, and stop reason.
2. Prioritize missing facts for upcoming shows and venues with real member
   activity; then rotate through the remaining catalog. A visit may enqueue work,
   but must not wait for the provider or bypass the global request budget.
3. Fetch only needed source records. Match venues by stable provider ID or a
   verified source link plus geography—not a same-name match in another city.
4. Persist small normalized fields and provenance. Reuse saved data on reads.
   Refresh volatile event times/statuses more often than venue descriptions.
5. Preserve staff/owner corrections. Send ambiguous matches and conflicting
   changes to review, instead of silently publishing them.
6. Extend the artist diagnostics added here to a clear Moderation progress panel
   for every curator lane and the daily digest. Never call an empty queue “complete”
   when entities lack identity or usable evidence.

This next stage should extend the current architecture, not launch the legacy
whole-catalog file pipeline inside the web service. Importing full Wikimedia
dumps would not fit the current small server/disk or the roughly $50 monthly
target. Read traffic and background enrichment need separate bounded budgets.

An optional LLM can later draft short summaries **from verified source passages**
or suggest duplicates for review. It must have an explicit daily spend cap,
source citations, a structured output schema, and no authority to change account
permissions, merge entities, fabricate ratings/reviews, or overwrite facts. Its
credentials and paid usage are not configured by this change. An LLM cannot
replace the original data source or guarantee that an absent venue fact exists.

## Source rules and live acceptance

Wikidata provides structured data under CC0 and recommends efficient access,
meaningful identification, and honoring rate limits. Wikipedia text needs its
own attribution/license treatment; this implementation preserves the source,
revision, and CC BY-SA 4.0 notice with imported artist biographies. See
[Wikidata data access](https://www.wikidata.org/wiki/Wikidata:Data_access/en) and
[MediaWiki API etiquette](https://www.mediawiki.org/wiki/API:Etiquette).

Ticketmaster's official documentation and FAQ currently disagree about the
default per-second limit (5 versus 2), while both describe 5,000 calls/day. Keep
the existing conservative pacing and honor the actual account quota rather than
increase throughput from a generic number. See
[Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/)
and [Ticketmaster FAQ](https://developer.ticketmaster.com/support/faq/).

Before reporting production success, confirm the deployed revision, enabled
switches, available provider configuration (without exposing secrets), the
durable last-pass timestamp/outcome, and a sample of updated public pages with
correct identity and attribution. A test pass and an enabled Blueprint are not
proof of live background progress.
