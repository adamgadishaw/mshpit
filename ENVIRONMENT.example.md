# Environment configuration example

Use these names as a local/server-only configuration reference. Keep real
credentials in the deployment provider or an untracked `.env` file.
`EXPO_PUBLIC_*` values, if added, are embedded into browser bundles.

```dotenv
NODE_ENV=development
PUBLIC_ORIGIN=http://localhost:8081

# The locked Owner receives protected approvals and daily health readouts.
# During the legacy ADMIN_EMAIL migration, set both values to the same address.
OWNER_EMAIL=
ADMIN_EMAIL=
# One-time explicit approval for a v1 Owner lock/transfer. It must equal the
# confirmed OWNER_EMAIL account; it has no effect after the v2 lock exists.
OWNER_MIGRATION_EMAIL=
ADMIN_PASSWORD=
ALERT_EMAIL=ops@mshpit.com

# Google Workspace receives replies at @mshpit.com. Resend sends automated mail
# from its separately verified mail.mshpit.com subdomain.
RESEND_API_KEY=
MAIL_FROM=Mshpit <noreply@mail.mshpit.com>
MAIL_REPLY_TO=support@mshpit.com

# Production defaults to a 09:00 America/Toronto founder digest. Local and
# staging environments stay off even if this flag is mistakenly enabled.
SITE_HEALTH_DIGEST_ENABLED=false
SITE_HEALTH_DIGEST_HOUR=9

# Closed Lounges with messages are hidden from members and retained only for
# authorized moderation/legal review. Keep the default approval-pending policy
# until product/legal approves a maximum retention period; this setting never
# enables purging. An optional review date can be recorded for policy follow-up.
LOUNGE_ARCHIVE_RETENTION_POLICY=approval-pending
# LOUNGE_ARCHIVE_REVIEW_DAYS=90

# Enables the low-frequency worker that checks exact catalog identities for
# possible musician deaths. The in-app staff setting is a separate kill switch.
# Candidates require Wikidata + MusicBrainz agreement, remain staff-only, and
# can never publish a memorial automatically. Use a truthful contact address in
# the provider User-Agent and confirm provider terms before production use.
ARTIST_DEATH_WATCH_SCHEDULER_ENABLED=false
ARTIST_DEATH_WATCH_USER_AGENT=Mshpit memorial watch/1.0 (https://www.mshpit.com; support@mshpit.com)

# Slowly fills missing public artist genres from exact stored MusicBrainz IDs.
# This never name-searches, never promotes catalog crawl labels, waits more than
# one second between calls, and stores a durable cursor/check time so deploys do
# not restart the work. Each five-minute slice makes at most 30 exact requests
# (about 33 seconds of provider activity at the shared 1.1s gate) and completes
# the current 1,633-artist first pass in about 4.6 hours. After that, the 180-day
# per-artist checks make most slices bounded DB scans with no provider calls.
# Keep staging off so only one service owns the provider.
ARTIST_GENRE_REFRESH_ENABLED=false
ARTIST_GENRE_REFRESH_BATCH=30

# Non-production email fails closed unless a recipient is explicitly allowed.
EMAIL_ALLOWED_RECIPIENTS=
```
