# Pit Alpha launch and deployment runbook

Last reconciled: **2026-08-13**. Production is a single Node process that serves
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
checks, and exports the Expo SDK 57 web build to `dist/`.

The production command is:

```bash
NODE_ENV=production PORT=3000 npm run server
```

The server runs additive SQLite migrations on boot, serves `dist/`, and exposes
the same-origin API. A push to `master` auto-deploys on Render, so a brief restart
is expected; failed gates must stop the push.

The Blueprint intentionally declares only the production web service and its
private video verifier. There is no standing staging deployment. Treat every
`master` push as a direct production release: require the complete local/CI
gate, a verified recovery point, and an explicit post-deploy health check.

## 2. Persistent storage and backups

Set `PIT_DATA_DIR` to the mounted persistent disk (Render currently uses its
attached disk). Confirm `/api/health` reports database readiness after every
deploy.

Do not treat copying only `pit.db` from a live WAL database as a complete backup.
Committed transactions live in `pit.db-wal` until a checkpoint, so a bare copy can
be torn or stale.

`npm run backup` implements this correctly. It takes a consistent snapshot with
`VACUUM INTO` (no downtime; a consistent read lock, not an exclusive/write
lock), then opens the snapshot as a separate database and runs
`PRAGMA integrity_check` plus row counts against the source before calling it
good. Retention defaults to 7, override with `BACKUP_KEEP`. Local CLI snapshots
land in the gitignored `backups/`; production snapshots default to
`$PIT_DATA_DIR/backups` on the persistent disk.

The production server schedules this verified snapshot daily when
`BACKUP_ENABLED=true` (also the production default). It serializes with the other
heavy maintenance work and skips a run when a fresh snapshot already exists.
This protects against a bad live database file, not loss of the whole disk.
Each run stays under a `.partial-*` name until verification and any requested
off-host upload succeed, then publishes atomically; partial files never count as
fresh. Bounded process/upload deadlines keep a wedged provider or SQLite child
from owning the maintenance queue indefinitely.

Prove a restore rather than assuming one:

```bash
npm run backup:verify -- backups/pit-YYYYMMDD-HHMMSS.db
```

For the full proof, copy a snapshot to an empty directory as `pit.db`, start the
server with `PIT_DATA_DIR` pointed at it, and confirm `/api/health` reports
`database: true` and real rows come back. A historical restore was exercised on
2026-08-05; the August 13 scheduler's production output still needs a current
snapshot/upload/restore proof.

Off-host copies use `npm run backup -- --upload` with its own private
`BACKUP_S3_*` credentials. It deliberately refuses to write into the `MEDIA_*`
bucket: that bucket is public-read so photos can be served from it, and a
database dump there would publish every account on the internet.

The scheduler adds `--upload` only when the private endpoint, bucket, access key,
and secret are all present and the bucket differs from `MEDIA_BUCKET`. If that
configuration is incomplete, the run succeeds on the persistent disk only and
logs that no off-host copy was made. Treat that state as a release gap.

After a scheduled child both uploads and publishes a new verified snapshot, the
server writes a credential-free receipt in the persistent backup directory.
Production startup logs an explicit warning when off-host storage is
unconfigured, has no valid successful-upload receipt, is more than 26 hours old,
or is stale after 36 hours. The staff health response and founder health digest
report the same evidence status and age. These are observability signals, not a
readiness gate, and development remains unaffected. The receipt proves that an
upload completed at that time; it does not prove that the remote object still
exists, so operators must still test provider retention and restores.

Before broad traffic, migrate to managed Postgres with point-in-time recovery.

## 3. Required production configuration

Secrets belong in the Render web-service environment, never tracked files or
`EXPO_PUBLIC_*` variables.

| Variable | Requirement / effect |
| --- | --- |
| `NODE_ENV=production` | Secure cookies, HSTS, and production behavior. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Seed/maintain the founder admin. Do not use a shared or AI automation mailbox; changing this identity transfers bootstrap-root ownership and revokes sessions. |
| `ALERT_EMAIL` | Monitored operations inbox for server digests. Falls back to `ADMIN_EMAIL` while unset. |
| `PUBLIC_ORIGIN=https://www.mshpit.com` | Canonical links, resets, and public routes. |
| `YOUTUBE_API_KEY` | Server-side Data API lookup. The IFrame player does not receive this key. |
| `YOUTUBE_SEARCH_DAILY_BUDGET` | Optional Pit reserve; default 90 inside the provider's separate default 100-call/day Search Queries bucket. |
| `YOUTUBE_WARM_BUDGET` | Optional bounded general catalogue/list work; normal warming does not use `search.list`. |
| `TICKETMASTER_KEY` | Production tour dates/ticket links. `BANDSINTOWN_APP_ID` is optional if still used. |
| `MEDIA_ENDPOINT`, `MEDIA_BUCKET`, `MEDIA_REGION`, `MEDIA_ACCESS_KEY_ID`, `MEDIA_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_BASE_URL` | Complete Cloudflare R2/S3-compatible upload configuration. Partial configuration fails closed. |
| `BACKUP_ENABLED`, `BACKUP_KEEP` | Daily verified snapshot switch and retained-count limit. Production defaults on with seven copies. |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | Optional private off-host backup target. All four are required and the bucket must not reuse the public media bucket. |
| `BACKUP_S3_REGION` | Optional for off-host backups; defaults to `auto` for R2-compatible endpoints. |
| `RESEND_API_KEY`, `MAIL_FROM` | Both required for automated delivery. Use the verified Resend subdomain, e.g. `Mshpit <noreply@mail.mshpit.com>`. Google Workspace MX does not replace this sender. |
| `MAIL_REPLY_TO` | Optional monitored Google Workspace mailbox/alias for replies, e.g. `support@mshpit.com`. |

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

## 5b. Rollback

Rolling back code is easy. The question that decides whether a rollback actually
works is whether the **old code can run against a database the new code already
migrated**, because the schema does not roll back with the deploy.

For Pit the answer is yes, and it was rehearsed on 2026-08-05 rather than assumed:
a worktree at the pre-email-schema commit was booted against a database migrated
by current code. It started, served `/api/health` 200, read catalogue rows, and
completed a signup. Rows it wrote were readable by the new schema afterwards.

Two properties make that safe, and both need to hold for it to stay true:

- **Migrations are additive only.** Every entry in `server/db.js` is
  `ALTER TABLE ... ADD COLUMN` with a default, guarded by a `PRAGMA table_info`
  check. Old code ignores columns it does not know about. A destructive migration
  (dropping or renaming a column, changing a type, backfilling in place) breaks
  this and makes rollback a restore-from-backup instead.
- **New nullable state is minted lazily.** `unsub_token` is created on first use,
  not at signup, so accounts created during a rollback window are not left broken.

### Procedure

1. In the Render dashboard, use **Rollback to this deploy** on the last known-good
   deploy. That is faster than a revert and does not need a build.
2. If the dashboard route is unavailable, `git revert <bad-sha>` and push to
   `master`. That triggers a normal build, so it is slower.
3. Confirm `/api/health` returns 200 with `database: true`.
4. Only then investigate. Do not fix forward on a broken production.

**If the bad deploy contained a destructive migration**, do not roll back the code
first. Restore the database from a snapshot (section 2), then roll back the code,
because the old code cannot read the changed schema.

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
- Keep the verified Resend `mail.mshpit.com` records beside Google Workspace's
  apex MX, set `MAIL_FROM` and `MAIL_REPLY_TO`, and test a single-use, expiring
  reset at two inbox providers. Reset secrets must never be logged.
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
