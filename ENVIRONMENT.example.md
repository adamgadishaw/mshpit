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

# Non-production email fails closed unless a recipient is explicitly allowed.
EMAIL_ALLOWED_RECIPIENTS=
```
