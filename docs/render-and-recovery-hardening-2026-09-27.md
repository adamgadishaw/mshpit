# Render validation and recovery safety — September 27, 2026

## Blueprint diagnosis

The committed Blueprint passed Render's public JSON Schema on September 27.
This is not proof of a successful live Blueprint sync: missing dashboard-managed
values, resource ownership, and platform errors require the actual sync error.
The connected Render tool does not expose Blueprint sync history and the browser
connection was unavailable during this repair. Do not delete/recreate services,
regenerate verifier secrets, change plans, or remove the persistent disk to clear
an unidentified alert.

`npm run check:blueprint` now validates YAML, duplicate service/variable names and
cross-service references in CI. Its offline schema snapshot comes from
https://render.com/schema/render.yaml.json (fetched September 27, 2026;
raw SHA-256 `57aa0a1ff9c3b2d0fcb91b790b7b285aef6397adb0c92930e6e601054444cfe5`).
The fixture is reformatted JSON, so its file hash differs. Run
`npm run check:blueprint -- --live-schema` for a read-only comparison against
Render's current schema. Updating the pinned schema is a reviewed code change.

Live settings differed from source in the verifier build-input list. Its API
description also reported a default `:10000` URL while the bound port was 10001.
Do not assume this display field is the effective `fromService` value. Verify
the resolved web-service `PIT_VIDEO_VERIFIER_HOSTPORT` safely in Render; the app
intentionally rejects reserved port 10000. Never print shared secrets in logs.
Keep both build-filter arrays explicit so sync cannot retain unintended filters.

When a sync fails, record the Blueprint ID, failed operation, timestamp and exact
non-secret error. Distinguish that from GitHub CI, web deployment and verifier
deployment failures. Use deployed SHA/Render status to watch releases; do not
repeatedly request an endpoint known to produce 500s.

## Future database restores

New local/off-host snapshots carry a recovery-quarantine marker. Both the normal
production launcher and direct database initialization reject a quarantined
snapshot before serving requests or applying migrations. Existing live databases
are unaffected. Older unmarked backups cannot be automatically identified and
must follow the same offline procedure below.

1. Stop traffic and background/email jobs for an actual recovery. Never use
   production as a restore-drill environment. Keep the original backup unchanged.
2. Verify the snapshot, then work on an isolated copy with no provider/mail
   credentials. Replay post-snapshot deletions, consent withdrawals, blocks,
   moderation restrictions, credential/email/role changes and media removals.
   A durable off-backup deletion/suppression journal is still an operational
   requirement; if the necessary evidence is unavailable, do not approve recovery.
3. After that review, prepare a NEW output with:

   `node scripts/prepare-db-restore.mjs --source /offline/reconciled.db --output /offline/prepared.db --privacy-replay-ref incident-id/privacy --credential-review-ref incident-id/auth`

   These references are operator attestations, not an automated claim that
   reconciliation happened. Do not put personal data or credentials in them.
   The tool invalidates sessions, linked-session grants, email-verification
   receipts, reset/verification/signup-cancellation tokens, pending owner-approval
   links and restored queued mail in the output only. Approval audit receipts
   remain intact. It never overwrites the source, an existing output,
   or the configured live database. Once preparation starts, a failed review
   leaves the output fenced. Never use an interrupted copy: historical sources
   may lack the marker until the copy has finished and fencing has run.
   Journaled account erasures and email opt-outs are then replayed
   automatically: the server refuses to serve a prepared copy until it has read
   `privacy-journal/v1/` from the backup bucket with `PRIVACY_JOURNAL_KEY` and
   saved replay evidence (see `SECURITY.md`, section 2). Post, comment and
   message deletions are not journaled yet and still need manual review.
4. Check integrity, foreign keys, permissions, content and representative member
   flows on that output. The owner must explicitly authorize production restore.
   Keep `EMAIL_CAMPAIGN_RECOVERY_ENABLED=false` until suppression replay and
   outbound behavior are verified. Do not automatically restart paid/background
   jobs simply because SQLite's integrity check passed.

No production snapshot or database was altered by developing these safeguards.

## News and catalogue operation

The news desk checks feeds every 20 minutes but can publish only within the
five three-hourly Toronto slots described in
`server/features/newsDesk/README.md`. This is a publication allowance, not a
promise to invent five stories on a quiet day. The default quiet-day fallback
allows one story backed by two independent publisher groups when nothing has
been published that day; normal and sensitive-story standards remain stronger.

News stays out of Following and Local. For You includes only explicitly
followed artists, with a durable per-member introduction receipt and ordinary
ranking after that first introduction. Account switches, blocks, unfollows and
refreshes must not retain a stale pinned story. News supports likes, comments,
author navigation, reports and owner deletion. A dedicated story-text editor
is not implemented; the ordinary post editor cannot safely edit its separate
story body and is not offered as a misleading substitute.

The server-rendered news hub now links to individual articles; their structured
data exposes publication/update dates. This supports crawling, not guaranteed
indexing or rankings.

Catalogue record failures use bounded per-record retry delays instead of
pausing every artist for a day. Genuine provider outages use a short durable
circuit and a single recovery probe, respecting explicit Retry-After headers.
Shared paid requests reserve their allowance atomically, including follow-up
research calls. Unknown billing receipts retain their reservation. Application
admission limits do not replace provider-side billing caps, especially for
server-side web-search calls. No hosting plan or configured budget was raised.
