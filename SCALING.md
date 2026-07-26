# Scaling Pit from Alpha to millions

Last reconciled: **2026-07-26**.

Pit's current single Node process, SQLite database, bounded polling, and
in-process schedulers are reasonable for Alpha validation. They are not a
million-user architecture. The goal is to preserve the current product and
screen contracts while replacing stateful single-instance internals in measured
stages.

## Stage 0: finish authoritative Alpha behavior

Do this before adding distributed infrastructure; scaling inconsistent state
only makes it harder to repair.

1. **DM read cursors and history:** persist each user's last-read message/cursor
   per thread, hydrate thread summaries at login, and page history on demand.
2. **Feed tombstones:** expose a durable version/delta stream of post upserts and
   removals so deletion/moderation propagates to already-hydrated clients. Apply
   the same event across feed, profile, open-post, count, media, and notification
   views. Batch comment previews/counts.
3. **Shared-chat gates:** keep fan-club membership and exact-performance Going
   checks on both read and write. Public gate endpoints return aggregate-only
   counts. Preserve forward cursors and authorized removal reconciliation.
4. **Playlist lifecycle:** finish rename/reorder/remove/privacy/delete/detail,
   unavailable-track handling, and authoritative history totals.
5. **Music identity:** carry provider/source ID and duration end to end; page
   discographies instead of truncating or blocking initial render.
6. **Native acceptance:** define the Expo SDK 56 playback contract and test real
   iOS/Android interruption, backgrounding, safe areas, orientation, and media.
7. **Client profiling:** measure real low/mid-range phones before splitting the
   broad store context and reducing the initial catalogue/core bundle further.

## Stage 1: durable data and job foundation

- **Postgres:** move normalized writes to managed Postgres with connection
  pooling, online migrations, read/index plans, point-in-time recovery, and
  tested restore drills. Keep stable IDs/cursors during migration.
- **Shared coordination:** use Redis-compatible storage for distributed rate
  limits, short-lived caches, session coordination, pub/sub, idempotency locks,
  and hot counters. Never depend on process memory for a global quota/circuit.
- **Durable workers:** catalog growth, MusicBrainz/Deezer enrichment, Wikidata
  discovery, YouTube refresh/warming, tour dates, mail, notifications, media,
  exports, and deletion need leased jobs with persisted steps, retries, dead
  letters, cancellation, and dashboards. A resumable inner cursor does not make
  a web-process closure durable.
- **10k+ roster:** keep core artist identity in the DB and enrich/page heavy
  releases, tracks, and photos separately. Record added/updated/failed/exhausted
  outcomes; never infer success from the requested target or a stale client
  counter.

## Stage 2: realtime social delivery

- Use WebSocket or SSE gateways backed by shared pub/sub for DMs, fan clubs,
  lounges, feed deltas, notifications, presence, and typing where appropriate.
- The database/event log remains authoritative. Existing `(created_at,id)` or
  equivalent cursors stay as reconnect/catch-up fallback, so realtime loss never
  loses data.
- Store per-user read/delivery cursors server-side. Add push fan-out through a
  durable queue; do not make push delivery the source of truth.
- Use backoff, jitter, heartbeats, bounded catchup, explicit reconnect UI, and
  observability. Stop no-op polling state updates during the Alpha transition.
- Model deletions/moderation as events/tombstones, not an ever-growing client
  deny list or a bounded recent-removals array.

## Stage 3: feed, search, recommendations, and analytics

- **Feed:** start with pull + cached pages; introduce selective fan-out read
  models only where follower scale justifies it. Page by stable cursor, not
  offset. Precompute/copy hot counters rather than `COUNT(*)` on every card.
- **Search:** move artist/venue/user/event text search to a dedicated index once
  Postgres indexed search no longer meets latency. Keep authorization/block
  filters in the query path.
- **Recommendations:** build offline features from follows, genres, location,
  plays, and reviews, then cache candidate sets. Add vector search only when a
  measured use case beats the current explainable scorer.
- **Analytics:** send allow-listed, consented events through a queue to a
  separate aggregate/warehouse path. Do not run unbounded product-analysis scans
  on the transactional DB.

## Media pipeline

Originals are too large and unsafe to serve directly in feeds.

- Finalize presigned uploads by verifying object existence, owner key, MIME,
  size, and checksum; expire abandoned reservations.
- Strip image metadata and create bounded avatar/feed/viewer derivatives in
  AVIF/WebP where supported. Serve through a CDN with immutable versioned keys.
- Quarantine/moderate uploads before public promotion. Preserve audit and
  takedown state.
- Transcode user video to adaptive HLS/DASH renditions with poster frames; do not
  make every client download raw 100 MB MP4 files.
- Use signed access where privacy requires it and lifecycle policies for
  replaced/deleted originals and derivatives.

## YouTube and external-provider capacity

- Since June 2026, `search.list` has its own default 100-call/day bucket; normal
  catalogue/list endpoints use the separate default 10,000-unit/day bucket.
  Model and alert on them separately.
- Non-authorized YouTube API data is refreshed or deleted within 30 calendar
  days. Keep provenance so CC0 Wikidata identity is distinguishable from
  YouTube-derived validation/metadata.
- Normal background warming must keep `allowSearch:false`; use Wikidata,
  known-channel catalogue reads, interactive fallback, and admin pins in that
  order. Request approved quota rather than sharding keys/projects to evade it.
- Public WDQS is an enrichment source, not a high-QPS playback dependency. Move
  channel discovery to bounded offline workers/bulk imports as the roster grows.
- Define provider SLOs, retry/circuit policy, cache lifetime, compliance review,
  outage behavior, and monthly cost before broad marketing.

## Client performance budget

- Keep IDs and small account-scoped caches locally; media stays in object
  storage/CDN and server state is paged.
- Keep list virtualization and bounded windows. Prefetch one useful page, not an
  entire social graph or 10k catalogue.
- Continue screen/media lazy loading, but measure uncompressed JavaScript parse
  and execution, first useful paint, interaction latency, list memory, and
  player continuity on physical low/mid-range devices.
- Split `src/store.js` by domain behind its current consumer API. Stabilize action
  references and selectors; introduce a server-state query cache incrementally.
  A blind provider rewrite risks stale closures and broad regressions.
- Preserve optimistic UI only where every mutation has pending/error state,
  idempotency, rollback, and authoritative reconciliation.

## Readiness gates

“Millions ready” requires evidence, not a technology checklist:

- load and soak tests for hot songs, cold artists, celebrity accounts, chat
  bursts, provider outages, media upload spikes, deploys, and region failure;
- privacy-safe logs, metrics, traces, SLOs, alerts, incident runbooks, and staffed
  moderation/abuse response;
- backup/restore and disaster-recovery exercises with measured recovery time and
  data-loss objectives;
- provider quota/compliance/cost forecasts and graceful degraded behavior;
- canary/rollback-safe schema and application deployment.
