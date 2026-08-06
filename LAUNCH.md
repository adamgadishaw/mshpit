# Pit Alpha launch and deployment runbook

Last reconciled: **2026-07-26**. Production is a single Node process that serves
the Expo web export and `/api/*` from one origin, with a persistent SQLite disk.
This is the current Alpha deployment shape, not the millions-user target in
`SCALING.md`.

## 1. Runtime and build gate

- Node **24+** is required (`node:sqlite` and the package engine agree).
- Never deploy directly from an unverified worktree. Run:

```bash
npm ci
npm run check
```

`npm run check` regenerates the split catalogue, runs all tests and syntax
checks, and exports the Expo SDK 56 web build to `dist/`.

The production command is:

```bash
NODE_ENV=production PORT=3000 npm run server
```

The server runs additive SQLite migrations on boot, serves `dist/`, and exposes
the same-origin API. A push to `master` auto-deploys on Render, so a brief restart
is expected; failed gates must stop the push.

## 2. Persistent storage and backups

Set `PIT_DATA_DIR` to the mounted persistent disk (Render currently uses its
attached disk). Confirm `/api/health` reports database readiness after every
deploy.

Do not treat copying only `pit.db` from a live WAL database as a complete backup.
Committed transactions live in `pit.db-wal` until a checkpoint, so a bare copy can
be torn or stale.

`npm run backup` implements this correctly. It takes a consistent snapshot with
`VACUUM INTO` (no downtime, no lock held on the live database), then opens the
snapshot as a separate database and runs `PRAGMA integrity_check` plus row counts
against the source before calling it good. Retention defaults to 7, override with
`BACKUP_KEEP`. Snapshots land in `backups/`, which is gitignored because they
contain every user email and password hash.

Prove a restore rather than assuming one:

```bash
npm run backup:verify -- backups/pit-YYYYMMDD-HHMMSS.db
```

For the full proof, copy a snapshot to an empty directory as `pit.db`, start the
server with `PIT_DATA_DIR` pointed at it, and confirm `/api/health` reports
`database: true` and real rows come back. This was last exercised on 2026-08-05.

Off-host copies use `npm run backup -- --upload` with its own private
`BACKUP_S3_*` credentials. It deliberately refuses to write into the `MEDIA_*`
bucket: that bucket is public-read so photos can be served from it, and a
database dump there would publish every account on the internet.

Before broad traffic, migrate to managed Postgres with point-in-time recovery.

## 3. Required production configuration

Secrets belong in the Render web-service environment, never tracked files or
`EXPO_PUBLIC_*` variables.

| Variable | Requirement / effect |
| --- | --- |
| `NODE_ENV=production` | Secure cookies, HSTS, and production behavior. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Seed/maintain the founder admin. Use a unique strong password and rotate anything exposed in chat. |
| `PUBLIC_ORIGIN=https://www.mshpit.com` | Canonical links, resets, and public routes. |
| `YOUTUBE_API_KEY` | Server-side Data API lookup. The IFrame player does not receive this key. |
| `YOUTUBE_SEARCH_DAILY_BUDGET` | Optional Pit reserve; default 90 inside the provider's separate default 100-call/day Search Queries bucket. |
| `YOUTUBE_WARM_BUDGET` | Optional bounded general catalogue/list work; normal warming does not use `search.list`. |
| `TICKETMASTER_KEY` | Production tour dates/ticket links. `BANDSINTOWN_APP_ID` is optional if still used. |
| `MEDIA_ENDPOINT`, `MEDIA_BUCKET`, `MEDIA_REGION`, `MEDIA_ACCESS_KEY_ID`, `MEDIA_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_BASE_URL` | Complete Cloudflare R2/S3-compatible upload configuration. Partial configuration fails closed. |
| `RESEND_API_KEY`, `MAIL_FROM` | Both required for delivery. `MAIL_FROM` must use a verified Resend domain. |

Optional job/provider timeout and retention knobs should remain at reviewed
defaults unless a measured production issue justifies changing them. In
particular, configuration must never extend YouTube API data beyond the 30-day
refresh/delete policy ceiling.

## 4. DNS, TLS, and edge behavior

Render terminates TLS. Point the apex and `www` records to the Render service,
keep HTTPS redirect/HSTS active, and ensure Cloudflare does not challenge normal
`/api/*` application traffic or replace the origin `robots.txt`.

Verify after DNS/edge changes:

- `https://www.mshpit.com/api/health` is JSON, not a Cloudflare/Render HTML page;
- cookies are `Secure`, HTTP-only, and same-origin behavior works;
- `robots.txt` and `sitemap.xml` return their real content;
- R2 CORS permits the production origin's signed PUT/GET/HEAD flow only as
  intended.

## 5. Provider facts that operators must know

Since June 2026, YouTube quota has separate buckets:

- `search.list`: default 100 calls/day; one request costs one Search Queries
  call;
- `channels.list`, `playlistItems.list`, and `videos.list`: separate default
  10,000-unit/day general bucket;
- Pit defaults to 90 search calls/day so ten stay reserved;
- IFrame playback does not spend search calls.

Non-authorized YouTube API data must be refreshed or deleted within 30 calendar
days. The server caps match TTL, prunes expired provider rows, and revalidates
API-derived channels. Do not reintroduce “permanent” API metadata or the retired
100-units-per-search arithmetic.

Channel IDs retain explicit provenance. Low-confidence YouTube search results
are `youtube_unverified`; keyless Wikidata mappings are
`wikidata_unverified`. Neither receives blind trusted-channel scoring until
validated. Wikidata's structured identity itself is CC0 enrichment.

## 6. Post-deploy Alpha smoke test

Run this sequence after a schema/provider/social batch:

1. Check `/api/health`: database, YouTube configuration, separate provider
   circuits/search usage, Wikidata state, tour dates, media, and mail.
2. Sign up/login/logout with two ordinary accounts. Confirm account theme and
   recent-search state do not leak across users.
3. Create/edit/delete a regular status and a concert review. Confirm status text
   and photos do not advance concert badges; a real review does.
4. Upload one photo and one short supported video; open the fullscreen viewer
   and react to individual media.
5. Like, comment, reply, delete a parent comment, follow, block, and unblock.
6. Start a DM in two independent clients and confirm cursor catchup. Remember
   that server-side read cursors/realtime delivery remain backlog.
7. Verify a nonmember cannot read or write fan-club messages, and a nonattendee
   cannot read or write a show lounge. Confirm the public gate shows counts only.
8. Play a popular and deep artist-page track. Confirm the exact provider/source
   identity and duration survive into history/playlist replay and the selected
   YouTube version is official/studio rather than lyric/karaoke/live.
9. Share an immutable public/unlisted playlist snapshot; verify private/not-owned
   playlists are refused.
10. Exercise admin report, wrong-track pin, timeout/ban, and audit-log paths with
    an ordinary account confirming forbidden responses.

## 7. Production enrichment actions

After the channel/provenance migration deploys, run or observe:

```bash
# Zero-search MBID -> Wikidata channel discovery.
node scripts/backfill-channels.mjs

# Evidence-backed genre enrichment in bounded runs.
node scripts/backfill-genres.mjs 500

# Known-channel cache warming; normal warmer does not spend search.list.
npm run warm:youtube
```

Record before/after, validated/unverified, failed/deferred, provider usage, and
sample playback results in `HANDOFF.md`. A prior local 44% Wikidata match or an
admin target of 10k artists is not proof that the production disk contains it.

Catalog growth toward 10k+ currently remains an Alpha in-process/one-off job.
Do not promise completion across deploys until it runs in a durable worker with
persisted run state, leases, retries, and operator-visible outcomes.

## 8. Configuration actions still open

- Rotate any Ticketmaster, Resend, R2, or YouTube credential ever pasted into a
  chat, then update Render.
- Verify the Resend sending domain, set `MAIL_FROM`, and test a single-use,
  expiring reset at two inbox providers. Reset secrets must never be logged.
- Submit `sitemap.xml` to Google Search Console.
- Complete real iOS/Android playback and upload checks before advertising native
  parity.

## 9. Known Alpha limits

- Single-process SQLite and in-process schedulers are not horizontally scalable.
- DMs/group chats/feed use polling plus cursors; server DM read cursors, realtime
  pub/sub, feed removal tombstones, and push delivery remain.
- Playlist sharing works, but full rename/reorder/remove/privacy/delete UI is not
  complete.
- Discographies are provider-backed and identity-aware but still capped; singles,
  compilations, and provider pagination remain.
- Full YouTube playback is web-only; native behavior is not yet equivalent.
- The split/lazy web bundle is improved but still has React Native Web/Expo parse
  cost and a broad store context. Profile it on real phones.
- Direct R2 upload is durable storage, not a full media pipeline: finalization,
  derivatives, metadata stripping, moderation, posters/transcoding, and lifecycle
  cleanup remain.

These limits are acceptable only for controlled Alpha use. Follow the staged
plan in `SCALING.md` before a large launch.
