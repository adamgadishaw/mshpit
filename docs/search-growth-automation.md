# Search Growth automation

## What this release does

Search Growth is a default-off, read-only Google Search Console importer with a moderation dashboard and bounded catalog-priority hints. It runs in the existing web service, uses the existing SQLite database, and does not provision another Render service, AI agent, queue server, or paid subscription.

The complete path is:

`Search Console -> daily saved report -> moderation opportunities -> existing eligible catalog workers`

This automates collecting evidence and choosing a small number of useful pages to improve. It does **not** promise rankings, indexing, clicks, completed profiles, or signups. It does not automatically rewrite titles to chase CTR, merge identities, remove noindex, change canonical URLs, or submit general music pages to Google's restricted Indexing API.

## Safe activation

1. Deploy the tested branch through the normal reviewed release process. This code alone does not activate Google imports.
2. In a Google Cloud project you control, enable the Search Console API and create a dedicated service account. Grant that identity permission to read the appropriate Search Console property. Cloud IAM access alone does not grant access to Search Console data.
3. Store the service-account private key only in the server's protected environment settings. Never put it in an `EXPO_PUBLIC_*` setting, source control, a moderation form, logs, screenshots, or chat. Follow your Google credential-rotation process. Delete/revoke unused keys.
4. Set these **server-only** environment variables:

   - `SEARCH_CONSOLE_PROPERTY`: preferably `sc-domain:mshpit.com`, if that is the verified property. The only other allowed values are `https://www.mshpit.com/` and `https://mshpit.com/`.
   - `SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL`: the dedicated service-account email.
   - `SEARCH_CONSOLE_PRIVATE_KEY`: its RSA private key in PEM format. Literal escaped `\n` newlines are supported.
   - `SEARCH_GROWTH_ENABLED=true`: explicit master switch. Missing or false means disabled, including local development.

5. Restart/deploy through the usual controlled release process. Open **Moderation -> Search Growth** as a verified administrator. The initial saved mode is **Monitor**. Confirm the connection state and first successful saved report before enabling **Prioritize**.
6. Check that the existing catalog maintenance/research jobs are enabled and have available budgets. Search Growth cannot turn them on, remove their pause, or raise their limits.

The client requests only the `https://www.googleapis.com/auth/webmasters.readonly` OAuth scope. Google token and API destinations are fixed; moderation cannot supply arbitrary destinations. No production credentials are included in this change or its tests.

Primary Google references: [Search Console authorization](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing), [Search Analytics query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), and [service-account authentication](https://developers.google.com/identity/protocols/oauth2/service-account).

## Modes and scheduling

| Mode | Import Google data | Supply new catalog priorities |
| --- | --- | --- |
| Paused | No | No; existing hints are ignored |
| Monitor | Yes, when configured and due | No; existing hints are ignored |
| Prioritize | Yes, when configured and due | Up to 10 supported public page paths per UTC day |

The scheduler first checks after three minutes, then hourly. A successful import is not due again for 24 hours. Each import compares two adjacent 28-day windows using Google's Pacific-time calendar; the current window ends three calendar days ago and requests finalized Web-search data. This avoids presenting today's incomplete figures as a meaningful change.

Each normal import makes four bounded Search Analytics requests: page rows and separate property totals for each window. OAuth token acquisition is additional when needed. There is no request per visitor, per profile view, or per moderation refresh.

Failures keep the previous complete snapshot and set a six-hour retry delay. The 90-second database lease prevents overlapping import owners, and the entire run has a 60-second deadline. Every provider request has its own timeout and response-size limit. There are no immediate retry storms. Pause/configuration changes and shutdown are checked before saving or delivering work; shutdown aborts and settles the job before closing the database.

Mode changes are administrator-only, require verified email and an expected current mode, are rate-limited, and are recorded in the existing moderation audit trail. Status responses are private/no-store. Refresh only reads saved state: it does not trigger Google or paid research.

## Reading the report correctly

- Each window imports at most 1,000 page rows. Google returns top rows rather than a guaranteed exhaustive export. A truncation flag warns when the configured row limit was reached.
- Property totals are fetched separately. They are **not** the sum of page rows; Google's aggregation rules and row limits can make those figures differ.
- CTR is clicks divided by impressions. Priority scoring is an explicit heuristic, not a forecast: at least 50 impressions, average position 4-20, then low CTR relative to a position-band threshold or a material visibility decline. Scores cannot prove that a title is the cause.
- Up to 200 opportunities are saved, with the top 10 shown in the panel. City/directory opportunities are useful for editorial review but are not automatically mapped to a specific artist or venue.
- Only allowlisted public artist, venue, event, city, and venue-directory paths are stored. No search queries, account identifiers, email addresses, URL queries/fragments, OAuth tokens, or raw provider errors enter these tables.
- Google impressions and clicks are **not membership conversion counts**. The panel explicitly reports signup attribution as not connected. Existing consented member analytics do not establish an organic landing-to-signup funnel; no conversion rate should be claimed from this report.

## Catalog integration and cost controls

Prioritize mode supplies at most 10 supported artist/venue/event path hints per day, with 48-hour expiry. The service must still be enabled, configured for the same property, in Prioritize mode, and have a fresh successful snapshot before workers can use hints.

Bindings are deterministic: exact artist public slug, provider venue slug, or saved public event identity. Ambiguous names/rooms are skipped; no fuzzy identity match is invented. Member-owned, unreleased, inactive, non-music, and unresolved provider events cannot supply automatic priority bindings.

Artist knowledge refresh interleaves discovery/search priorities with the ordinary backlog. Paid research keeps independent priority/regular turns for artists and venues across restarts, so a low daily budget does not permanently starve one queue. Existing biographies, claimed accounts, staff content, freshness/backoff rules, lease checks, catalog pause, media-license validation, storage/memory guards, and provider limits remain authoritative.

No AI budget is increased by this feature. Existing eligible research can use its already-approved allowance on a different page, but a priority hint does not authorize an extra paid call. A hinted page may remain unchanged because it is protected, not due, lacks an unambiguous source, or the workers are paused/out of budget. Priority is not a completion guarantee. Search Growth itself downloads no images or video.

## Storage, recovery and rollback

Persistent data is bounded to two snapshots of at most 1,000 rows each, 200 opportunities, 10 active priority hints, and at most 100 run records. Import outcomes prune run history to the latest 100 records within 90 days. While paused or disabled, older saved reports and run records can remain until imports resume; this is not a timed deletion guarantee. Both report windows and their opportunity list are replaced atomically. There are no daily raw exports accumulating on disk.

The new tables are additive and are included in the existing database backup process. This feature is **not** an off-host backup and does not establish that a remote backup destination is configured or recoverable.

To stop imports and priorities, select **Paused**. To disable the entire framework, remove/set false `SEARCH_GROWTH_ENABLED` and restart normally. No data deletion or new infrastructure is needed. Revoke the dedicated Google key if access is no longer required. Old reports may remain visible as dated evidence; they must not be mistaken for a fresh import.

Configuration and Google errors are shown as sanitized categories. Check property access and API enablement for rejected requests; do not paste credentials or raw token responses into an issue. Use the last successful timestamp, window dates, and connection state to distinguish a stale report from zero traffic.

## Verification

The regression suite uses disposable SQLite databases, generated fixture RSA keys and fake transports. It covers read-only JWT scope, fixed destinations, invalid dates/metrics/URLs, token cancellation, oversized responses, leases/restarts, snapshot rollback, pause/shutdown races, daily priority limits, retention, administrator authorization/auditing, ambiguous bindings, unchanged research budgets, and client account-switch/stale-response behavior. It does not prove live Google authorization; the first configured production import is a separate acceptance check.
