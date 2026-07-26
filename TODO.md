# Pit Alpha product backlog

Last reconciled: **2026-07-26** against the current code, tests, commits
`f85f050` and `6f42771`, and the active hardening batch.

This is the authoritative execution list. The recovered owner wording remains in
`CLAUDE_SESSION_RECOVERY_2026-07-21.md`; implementation history remains in
`HANDOFF.md`. Those historical files explain why work happened, but this file
decides what is still open.

## Status and acceptance rules

- **HARDENED / VERIFY**: implemented in the current working batch, but not done
  until the full gate, merge, deployment, and production checks pass.
- **PARTIAL**: a useful Alpha path exists, but a named user-visible or operating
  requirement remains.
- **CONFIGURATION**: code exists; a private dashboard, DNS, provider, or device
  action remains.
- **FOUNDATION COMPLETE**: the requested Alpha behavior is implemented and has
  focused evidence. It can still have a separate scale follow-up.
- **OPEN**: implementation or a product decision remains.

Do not mark work complete because an endpoint or component exists. Record the
test, device, and production evidence in `HANDOFF.md`. `npm run check` must pass
before merging to `master`.

## Alpha release order

### P0.1 Music lookup correctness, capacity, and YouTube compliance

**Status: HARDENED / VERIFY.**

The foundation from `f85f050` maps MusicBrainz IDs to YouTube channel IDs through
Wikidata P434 -> P2397 without consuming YouTube search. Commit `6f42771` proves
that a known-channel song can resolve through `channels.list`,
`playlistItems.list`, and `videos.list` when Pit's search budget is zero.

The current hardening batch corrects the first implementation:

- Since June 2026, `search.list` has a separate default **100-call/day Search
  Queries bucket** and one request costs one call from that bucket. The normal
  default **10,000-unit/day bucket** is separate and covers the catalogue/list
  endpoints. Pit reserves ten search calls by default, so its application limit
  remains 90 unless `YOUTUBE_SEARCH_DAILY_BUDGET` is changed. The old “100 quota
  units per search” arithmetic is retired. See the official
  [quota overview](https://developers.google.com/youtube/v3/getting-started#quota)
  and [`search.list` reference](https://developers.google.com/youtube/v3/docs/search/list).
- Non-authorized YouTube API data is refreshed or deleted within 30 calendar
  days. Match TTL is capped at 30 days, expired rows are pruned, and old
  API-derived channel mappings are revalidated. See YouTube Developer Policy
  [III.E.4](https://developers.google.com/youtube/terms/developer-policies#e.-handling-youtube-data-and-content).
- Artist channel rows carry `youtube_channel_source`: `youtube`,
  `youtube_unverified`, `wikidata`, or `wikidata_unverified`. Low-confidence
  search and keyless Wikidata pointers are retained with provenance but are not
  granted trusted-channel scoring until validated.
- `wikidata_channel_checks` stores one durable result per MBID. SQL filters
  eligible identities before `LIMIT`, same-MBID aliases update together, misses
  have a bounded retry time, transient batches retry, and failed/deferred counts
  are visible to the CLI and health endpoint.
- Live WDQS lookups are single-flight per MBID, concurrency bounded, short
  deadline, negative cached, and honor a 429 `Retry-After` cooldown.
- Search and general-data circuits are separate. A spent Search Queries bucket
  cannot disable known-channel catalogue playback.
- The daily warmer runs Wikidata discovery and expiry pruning without a YouTube
  key. With a key it uses `allowSearch:false`, so background work never consumes
  interactive search calls. Progress is day-scoped and partial artists are not
  falsely marked complete.

**Production acceptance:**

1. Run the full automated gate, merge, and deploy the migrations and hardening.
2. Run `node scripts/backfill-channels.mjs` against the production database, or
   observe the scheduler complete it. Keep the before/after coverage plus
   validated/unverified and failed/deferred counts. Claude's local 2026-07-25
   run found 1,146 mappings among 2,618 artists; that is useful evidence, not
   proof that production was backfilled.
3. Sample popular and deep-catalogue songs in production. Report official,
   preview, missing, rejected-version, and capacity rates separately.
4. Verify a known channel still resolves with search usage at its application
   limit, and verify expired API-derived matches/channels refresh within policy.
5. Before large traffic, move WDQS/backfill/warming out of the web process into a
   durable enrichment worker or bulk-source pipeline. Public WDQS must not be a
   synchronous dependency for a million-user playback path.

### P0.2 Messaging, group-chat authorization, and realtime state

**Status: PARTIAL; group gates hardened, DM state still Alpha.**

Fan-club and concert-lounge writes were already gated. The current batch also
gates **reads**: message bodies require an authenticated active club membership
or Going record for the exact performance. Public gate endpoints expose only
aggregate member/attendee and nonremoved-message counts. Client polling begins
only after the server confirms the gate. Blocking filters and authorized
removed-message reconciliation remain active; there is no staff read bypass.

DMs and shared chats use stable forward cursors and bounded polling, so new
messages appear without a manual refresh and reconnect can catch up. This is an
Alpha bridge, not the final delivery system.

**Remaining:**

- Persist per-user/per-thread DM read cursors on the server. The current global
  device key can produce wrong unread counts after account switching or on a new
  device.
- Make login hydrate thread summaries, then page history on demand instead of
  loading large recent windows for every conversation.
- Add realtime WebSocket/SSE delivery through shared pub/sub, with cursor catchup
  as the recovery source of truth; add backoff/jitter, delivery acknowledgement,
  explicit reconnect/loading states, and push fan-out.
- Add a durable message deletion/event cursor. The current bounded `removedIds`
  list cannot represent an indefinitely active room.
- Add older-history controls, attachments, typing, receipts, and group-DM
  creation only after the authoritative cursor/read model is in place.

### P0.3 Feed deletion/moderation reconciliation

**Status: OPEN scale/cross-device gap.**

Create/edit and first-page refresh are server-backed, owner deletion is a soft
delete, comments have parent tombstones, and the feed is cursor paged. However,
a merge-only refresh cannot reliably remove a post that was already hydrated and
then deleted or moderated on another client.

**Acceptance:**

- Return feed upserts and removal tombstones from a durable delta cursor, or use
  an equivalent versioned/ETag contract. Apply each event idempotently across
  feed, profile walls, open post, counts, photos, and notifications.
- Batch comment-preview/count reads instead of issuing work per card. Keep full
  threaded comments paged on the post screen.
- Preserve the existing local-mutation sequence guards so an older network
  response cannot undo a fresh local create/edit/delete.

### P0.4 Complete playlist management and listening history

**Status: PARTIAL.**

The backend supports create, read, patch, visibility, and delete. Users can add
individual tracks, save a session, and share an immutable public/unlisted
playlist snapshot in a status post. Exact recording identity survives the feed
card and play-history replay.

The missing product slice is a playlist manager: rename, remove, reorder, set
privacy, delete, open a stable detail/deep link, and explain unavailable tracks.
The existing store actions are not exposed by a complete management screen.
Listening history needs server-authoritative totals and visible pagination past
the initial window; a loaded-array length must not be presented as lifetime
plays.

### P0.5 Full discographies and recording identity

**Status: PARTIAL; identity handoff hardened, release coverage still open.**

The current batch carries Deezer `sourceId`, provider, duration, and album-track
identity from the artist page into the player, playlists, history, and YouTube's
duration-aware matcher. This closes a major path where the UI discarded the
evidence needed to distinguish official/studio recordings from live, lyric, or
karaoke variants.

Discography loading is not complete: it requests a large Deezer page but keeps
only a capped set of albums/EPs. Singles, compilations, provider pagination,
release-group dedupe, and an explicit load-more/detail strategy remain. Do not
fetch an unlimited catalogue synchronously on initial page open; page releases
and cache provider identities separately. Same-name artists still need a
surrogate catalog identity rather than normalized display name as primary key.

### P0.6 Durable 10k+ artist and enrichment jobs

**Status: PARTIAL.**

The DB-backed roster, MusicBrainz cursors, on-demand artist resolve, and provider
enrichment exist. The audited local snapshot contains roughly 2,658 artists, not
10,000. A prior attempt or UI counter is not proof that a 10k seed completed.

Move catalog growth, genre backfill, Deezer enrichment, Wikidata channel work,
and cache warming into durable jobs with persisted run/step state, leases,
idempotency, retries, dead letters, and operator-visible outcomes. A web-process
closure can disappear on deploy even when its inner crawl cursor is resumable.
Before treating the MusicBrainz tag crawl as a commercial-scale source, review
its supplementary-data CC BY-NC-SA terms; core artist/MBID data is CC0, tags are
not. Keep crawl buckets as nonpublished discovery hints.
Run a verified 10k+ production job, record added/updated/failed/exhausted counts,
and keep songs/releases on demand rather than rebundling full discographies.

### P0.7 Native playback and physical-device acceptance

**Status: OPEN/PARTIAL.**

The compliant YouTube IFrame path is web-only. Native currently relies on honest
preview/open behavior rather than feature-equivalent full playback. Decide and
implement the Expo SDK 56 native contract: preview/audio through the supported
native audio path and a focused, visible YouTube web surface where policy and
platform behavior permit it. Never hide the video to simulate an audio-only
YouTube service.

Test real iOS and Android devices for play/pause/seek, queue/history, app
backgrounding, interruptions, orientation, keyboard/safe areas, 44-point targets,
uploaded video, and failure recovery. Browser emulation is not acceptance.

### P0.8 Bundle, render, and client-state performance

**Status: PARTIAL; measured improvements landed, structural work remains.**

Catalog splitting reduced startup catalogue allocation and screen-level lazy
loading reduced the web entry bundle, but React Native Web/Expo still leaves a
large parse/execute floor. `src/store.js` remains a broad context whose changing
value can rerender many unrelated consumers.

**Next:**

- Reduce the initial catalogue core further and load server-paged artist/venue
  data per surface. Never put a 10k enriched catalogue or discographies back in
  the startup bundle.
- Profile on real low/mid-range iOS and Android hardware. Track entry transfer,
  uncompressed JS, parse/execute, first useful paint, interaction latency, list
  memory, and player continuity.
- Split store state by domain behind the current screen-facing API, stabilize
  actions/selectors, and adopt a server-state query cache incrementally. Do this
  with profiler evidence rather than a blind context rewrite.
- Keep feed/list virtualization, lazy media, bounded windows, and abortable
  requests as regression gates.

## P1 product and operations backlog

1. **Notifications:** refresh on screen focus/realtime delivery, persist read
   state server-side, and load a notification's target by ID rather than relying
   on the current feed window.
2. **Genres:** finish evidence-backed provider enrichment. MusicBrainz crawl tags
   stay hints, never asserted genres.
3. **Events/festivals:** introduce an Event entity with lineup, date range, and
   one or more venues; stop representing club nights/festivals as artists.
4. **Artist/venue identity:** migrate same-name entities to surrogate IDs and
   backfill unambiguous post bindings.
5. **Themes and spacing:** confirm the owner's intended themes; run contrast and
   interaction-state checks across all themes and finish component-level spacing
   only with visual regression evidence.
6. **Admin/moderation:** page/search members and reports server-side, await an
   enforcement action before resolving its report, capture reasons, and provide
   confirmation/failure feedback.
7. **Media:** verify uploads after direct PUT, strip metadata, create bounded
   derivatives/posters, transcode video, moderate/quarantine, and clean abandoned
   objects through durable jobs/CDN lifecycle.
8. **Analytics/privacy:** complete legal review and move high-volume events off
   the primary relational database before broad collection.
9. **SEO:** submit the sitemap in Search Console, confirm Cloudflare serves the
   origin robots file, and plan pre-render/server rendering for important public
   entity pages.
10. **Resend:** rotate exposed credentials, verify the sending domain, configure
    `MAIL_FROM`, and complete two-provider reset delivery tests.

## Foundation complete for Alpha

- Separate regular status and concert-review composers/cards.
- Facebook-style post media grid, fullscreen photo/video viewer, direct object
  upload, and per-media hearts.
- Blocking across follows, profiles, feed, interactions, playlists, rewards,
  DMs, group chats, notifications, venues, and attendees.
- Comment replies, author deletion, and deleted-parent tombstones.
- YouTube attachments and audited wrong-track reports/admin pins.
- Account-scoped recent listening with exact recording/video identity.
- Playlist snapshots in feed posts.
- Near You entry points and account-location discovery.
- Search's last-five UI, song search, public entity routes, metadata, sitemap,
  and robots groundwork.
- Badge **definition v2**: only `kind='review'` posts advance shows, written
  concert reviews, show photos, cities, and artists. Likes on status posts still
  count toward Tastemaker; Superfan and Connector remain social achievements.
  Version-1 awards are grandfathered because the append-only ledger cannot tell
  a falsely status-earned award from a legitimate concert badge whose source was
  later removed. Any revocation requires an explicit product policy/manual audit.

## Platform gates before “millions ready”

Alpha completion is not the same as millions-ready. The latter requires managed
Postgres and online migrations, shared cache/rate limits/session/pub-sub,
durable workers, CDN media processing, realtime delivery, dedicated search and
recommendation indexes, an analytics pipeline, privacy-safe observability,
load/soak/DR testing, abuse operations, and provider cost/compliance forecasts.
See `SCALING.md`.
