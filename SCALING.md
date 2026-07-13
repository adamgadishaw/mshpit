# Scaling Pit — keeping servers and phones light

How the big apps (YouTube, TikTok, Spotify, Facebook) avoid melting servers and
phone storage, mapped to Pit. The rule: **never move or store more bytes than the
moment needs.**

## 1. Media is the whole game (photos & video)

Originals are huge; never serve them to a feed.

- **Images** → an image CDN with on-the-fly resizing (Cloudflare Images, imgix,
  Cloudinary, or S3 + Lambda@Edge). Upload once; request `?w=400` for a feed
  thumb, full-res only when a user taps. Serve modern formats (AVIF/WebP).
  *Pit today:* selected user images upload directly to configured S3-compatible
  object storage through short-lived signed PUT URLs; only the public object URL
  is saved. This is durable storage, but not yet a complete media pipeline. Next:
  verify stored bytes, strip metadata, generate bounded feed/avatar derivatives,
  moderate/quarantine content, and deliver those derivatives through a CDN.
- **Video** (clips of shows) → **never store/stream raw MP4.** Transcode to
  **HLS / adaptive bitrate** (multiple renditions) like TikTok/YouTube; the
  player pulls the rendition that fits the network. Store in object storage (S3),
  deliver via CDN, show a poster thumbnail in the feed and only fetch video on
  tap/scroll-into-view. Use signed, expiring URLs.

## 2. Phone storage stays tiny

- **Cache thumbnails, not originals.** Use `expo-image` (disk + memory cache,
  blurhash placeholders, automatic eviction) instead of raw `<Image>`. It caps
  disk use and reuses bytes across screens.
- **Virtualize lists.** The feed is a `FlatList`, so off-screen cards are
  unmounted — memory stays flat no matter how long the feed is. Tune
  `windowSize` / `removeClippedSubviews`.
- **Don't persist heavy state.** Keep only ids + small JSON locally
  (AsyncStorage / MMKV); re-fetch media from CDN on demand.

## 3. Feed delivery without fanout pain

- **Cursor pagination**, not offset — `?after=<cursor>&limit=20`. Stable under
  inserts, cheap on the DB. *Pit today:* the main feed uses a server
  `(created_at,id)` cursor and the client requests later pages. DMs, comments,
  fan-club messages, lounges, notifications, and venue reviews expose cursors,
  but their screens still need incremental load-more wiring. Remove the temporary
  feed offset path after old clients no longer use it.
- **Pull + cache** for most users; precomputed fan-out only for high-follow
  accounts (the Twitter/IG hybrid). Cache hot pages in Redis/edge.
- **Counters** (likes/comments) live in Redis and flush to Postgres in batches —
  never `COUNT(*)` on read.

## 4. Recommendations & search = embeddings

This is the Spotify/TikTok core and what "embedding features" means:

- Represent each **artist, show, and user** as a vector (from genres, who-saw-
  what co-occurrence, audio features, review text). Store in a **vector DB**
  (pgvector, Pinecone, Qdrant).
- "For You" and "similar artists" = **approximate nearest-neighbor** lookups —
  precomputed nightly, cached per user. Cheap at read time.
- **Semantic search** ("dreamy shoegaze near me") embeds the query and ANN-
  searches the same space, instead of `LIKE '%...%'`.
- *Pit today:* `recommendedShows()` scores by genre affinity + proximity + follow
  graph — the same idea, hand-weighted. Drop-in upgrade: replace the score with a
  vector similarity once the embedding job exists.

## 5. Data store layout

- **Hot path:** Postgres (normalized writes) + denormalized read models / cache
  for feeds and profiles.
- **Blobs:** object storage (S3/R2) + CDN for all media; DB only holds URLs.
- **Cold:** archive old media to cheaper tiers; keep thumbnails hot.
- **Search/recs:** vector DB + a text index (Elastic/Meilisearch).

## 6. Client manners

Optimistic UI may acknowledge input immediately, but the server must remain
authoritative: show pending state and roll back/reconcile on failure. Debounce
search, prefetch the next feed page, lazy-load images near the viewport, and
compress uploads on-device before they reach the network.
