# Personalization and product analytics handoff — 2026-08-13

This pass adds a privacy-conscious, first-party analytics pipeline and a deterministic global-first `For you` feed. It is a practical heuristic v1, not a TikTok-scale machine-learning system. Capacity measurements and deployment assumptions live in [CAPACITY_BASELINE_2026-08-13.md](./CAPACITY_BASELINE_2026-08-13.md).

## Product analytics contract

The Expo client uses `src/lib/productAnalytics.js`; both client and server apply the exact policy in `src/domain/analyticsPolicy.mjs`. The durable client queue is account-scoped, bounded to 200 events, flushes in batches of at most 40, is debounced off the scroll hot path, retries with bounded backoff, and uses stable event IDs so retries are idempotent. Account deletion removes that account's device queue.

Approved event families are:

- lifecycle/navigation: `app_open`, `screen_view`
- feed/content: `feed_request`, `feed_impression`, `content_open`, `content_dwell`
- media: `video_start`, `video_progress`
- product actions: `interaction`, `recommendation_feedback`, `notification_open`
- discovery and reliability: `search`, `performance`, `product_error`
- narrowly sanitized compatibility counters: `view_show`, `view_artist`, `view_venue`, `play`, `login`, `signup`, `post`, `follow`, `block`, `like`, `delete_post`, `join_fanclub`

Every categorical value comes from a closed enum. Required properties must be present. Post identifiers are syntax-checked on both sides and batch-prefetched against canonical posts before storage. Arbitrary event names, arbitrary tokens, unknown identifiers, and unknown properties are rejected.

The pipeline never stores review/status text, search terms, messages, artist/title/venue names, media URLs, raw IP addresses, user-agent strings, passwords, tokens, or arbitrary client-authored strings. Search analytics records only search category and a result-count bucket. Admin analytics exposes aggregates, coverage, and the actual raw window; it does not expose per-handle raw activity streams.

Analytics is optional and defaults off at signup. Terms acceptance is mandatory and stored separately (`termsAcceptedAt`, `termsVersion=2026-08`). Analytics opt-in is a distinct server-authored `analyticsConsentAt`; opting out deletes the account's active raw events in the same transaction. Legacy combined `consentAt` rows are migrated to a Terms acceptance record before the old field is removed. Logical deletion affects the active database; backup copies expire under backup retention rather than being promised as immediate physical erasure.

Server raw retention is bounded by all three controls:

- age ceiling: 30 days by default
- global ceiling: 40,000 rows
- per-account ceiling: 5,000 rows

Pruning happens after insertion inside the ingest transaction, so a burst cannot exceed the configured ceiling between hourly maintenance runs. At the measured representative footprint (~281 bytes per event including indexes), 40,000 raw rows are roughly 10.7 MiB before WAL overhead. At high volume, the row ceiling shortens the raw time window; the dashboard states this rather than calling truncated data a seven- or thirty-day history.

Endpoints:

- `POST /api/events/batch` — `{ events: [{ id, name, props }] }`; consented account only; at most 40 events; idempotent.
- `POST /api/events` — compatibility route using the same sanitizer/ingest path and now requiring a stable event ID.
- `POST /api/me/analytics-consent` — `{ enabled: boolean }`; server-authored consent; disabling atomically deletes raw events.
- `GET /api/admin/analytics` — admin-only aggregate coverage/health, retention, and raw-window truth.
- `GET /api/admin/analytics/users/:id` — bounded aggregate totals only, not a named raw timeline.

## Global-first recommendation contract

`GET /api/feed/for-you?limit=20[&cursor=...]` returns:

```json
{
  "posts": [{ "id": "p_…", "recommendation": { "algorithm": "global-personal-v1", "candidateSource": "global", "reasonCode": "fresh_global", "reason": "Fresh from the Pit community", "personalized": false } }],
  "nextCursor": "opaque-or-null",
  "algorithm": { "id": "global-personal-v1", "candidateSource": "global", "personalized": true, "snapshotAt": 0 }
}
```

The service starts with a worldwide, safety-filtered candidate pool. The scan is bounded to 2,400 newest eligible posts, admits at most 12 posts per author, and ranks at most 600. Candidate SQL projects only ranking fields; full post/media/comment projections run only for selected page rows. Viewer-first indexes support likes, comments, and fan-club signals. Comment momentum counts distinct non-author commenters so one person or the post author cannot inflate rank through repeated replies.

Score components are deliberately inspectable:

- freshness: up to 44 points, 96-hour half-life
- global engagement: up to 30 points, logarithmic likes plus distinct commenters
- completeness: up to 12 points for bounded media, useful review length, and review type
- deterministic exploration: 0–2 points from snapshot seed and post ID
- personalization: at most +24 across artist affinity, followed creator, genre, and city
- own-post penalty: -18

After score sorting, a fixed-window diversity reranker penalizes author and artist repetition and enforces at most two posts from one author in the opening 20 whenever enough alternatives exist. Complexity is bounded to `O(N*k)` with `k=40`, plus a bounded eligibility scan when the opening author cap must reach beyond that window.

Authoritative safety filters remove staff-removed posts, banned or actively suspended authors, two-way blocks, missing posts, and the viewer's exact-post feed preferences. A report by itself is an allegation and does not suppress a post until moderation acts. The client rotates bounded cache revalidation across all loaded post IDs so deep pages also receive moderation/block/preference tombstones without resetting their rank cursor.

Pagination uses an immutable 20-minute in-memory snapshot and opaque offset cursor. Ranking changes and new posts cannot drift or duplicate an active scroll. First-page snapshots are reused per viewer during their TTL, limiting repeated 600-candidate ranking work. The client never merges a periodic new first page into an old paginated snapshot; its background check only revalidates safety state. An expired/invalid recommendation cursor falls back to chronological mode while preserving existing card order.

Cold start is the same global quality/freshness ranking without account boosts. Logged-in signals include favorite artists, follows, fan clubs, the user's own posted artists, likes, comments, recent plays, content opens, meaningful dwell (10 seconds or more), and video completion milestones of 50% or more. Signals are bounded and deduplicated per post where applicable; short scroll-by dwell is not positive feedback.

`Not for me` is core product state, not optional analytics:

- `POST /api/feed/preferences/:postId` with `{ "action": "not_interested" }` hides that exact recommendation.
- `GET /api/feed/preferences` returns up to 500 exact hidden post IDs for cross-device hydration.
- `DELETE /api/feed/preferences/:postId` undoes the exact-post preference.
- Preferences are included in `GET /api/me/export` and removed by account deletion.

The client persists hidden IDs under an account-scoped key, applies optimistic removal, rolls storage back on failure even after an account switch, and uses a mutation revision so a late hydration response cannot overwrite a newer tap. The UI copy says it hides this recommendation; it does not promise author/artist/genre down-ranking. A successful core mutation may also emit optional aggregate `recommendation_feedback`; failed mutations do not.

The legacy `GET /api/feed` remains unchanged for older clients and outage fallback. `POST /api/feed/revalidate` accepts at most 200 canonical IDs per request and returns authoritative `invalidPostIds`; the client rotates the window on successive checks.

## Cross-account and shared-device boundary

Production identity starts locked until `/api/me` confirms the HttpOnly cookie. Account-scoped calls cannot cross that barrier. Once established, every ordinary request sends `X-Pit-Expected-Account`; the server rejects a stale tab if another tab changed the origin-wide cookie. Login/signup/reset and `/api/me` identity discovery are explicitly exempt. A separate one-way auth epoch announces completed auth transitions across tabs; transient validation state never writes that key, avoiding ping-pong validation loops. Focus/resume revalidates with debounce and transient failures retry while private UI remains locked.

Personalized feed/order, likes, blocks, preferences, and private overlays are reset or gated at identity changes. The persisted user directory is an exact public-profile projection and excludes email, consent/Terms timestamps, precise coordinates, private taste picks, and playlists. Production DM, lounge, fan-club-message, notification, attendance/membership, and artist-request caches are memory-only; legacy plaintext keys are scrubbed rather than handed to the next account.

## Verification

- Full project suite: `npm.cmd test` — 469 passed, 0 failed after the final venue-geography regressions (the preceding 467-test tree also passed twice consecutively).
- Focused analytics/recommendation/privacy suite — 50 passed, 0 failed.
- Syntax: `npm.cmd run check:syntax` — 115 Node files passed.
- Expo SDK 56 web export — passed; main entry 2,291,799 bytes raw,
  623,871 bytes gzip, and 515,436 bytes Brotli.
- Expo SDK 56 Android export — passed; 911 modules and a 4.4 MB Hermes bundle.
- Expo dependency alignment and Expo Doctor — clean; 21/21 checks passed.
- Query-plan coverage asserts viewer-first likes/comments/fan-club indexes and the covering distinct-comment index.
- API coverage includes idempotent batch ingest, no authored text/IP, guest and opt-out behavior, hard global/per-account caps, aggregate-only admin responses, default-off signup, legacy consent migration, stable recommendation pagination, open-report eligibility, and moderation/block/preference tombstones.

## Honest v1 limitations

- This is deterministic heuristic ranking, not collaborative filtering, embeddings, model training, or a TikTok-equivalent ML system.
- Exact-post `Not for me` does not yet learn negative author/artist/genre affinity. There is no visible feed-level undo snackbar yet, although the undo endpoint/facade exists.
- Impressions are captured but not yet used as a durable seen-item suppression set, so a new snapshot can repeat content.
- The candidate pool is bounded to a recent 2,400-row scan. Per-author caps resist straightforward flooding, but there is not yet a separately mixed followed/affinity/evergreen candidate lane for content older than that scan.
- Snapshot storage is process-local, has a 20-minute TTL and a 250-snapshot cap. A server restart invalidates cursors, and more than 250 simultaneous distinct viewer snapshots can evict the oldest cursor before TTL. A future multi-instance deployment needs shared or stateless cursors.
- Raw analytics has no daily rollup table yet. Under heavy volume the 40,000-row cap intentionally makes the aggregate window shorter than 30 days.
- Offline batches use server receipt time; occurrence timestamps/session sequence are not stored, so offline funnel chronology is approximate.
- High-value feed, media, search, navigation, action, and performance paths are instrumented. Some compatibility actions still lack precise originating surface, and `notification_open`/all Clips request paths are not yet comprehensively wired. Coverage should be extended through the same closed taxonomy rather than accepting arbitrary properties.
