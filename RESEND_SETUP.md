# Resend production setup

Pit already sends password-reset mail through Resend in `server/mailer.js`. The
application code needs two server-only environment variables; the remaining work
is domain verification and a production smoke test.

## Recommended sender setup

Use a dedicated sending subdomain, such as `mail.mshpit.com`, to isolate Pit's
transactional-mail reputation from the root domain.

1. In Resend, open **Domains** and add `mail.mshpit.com`.
2. Use Resend's **Sign in to Cloudflare** / Domain Connect flow when available.
   It is the recommended path and adds the generated records automatically.
3. For manual setup, copy every value from Resend exactly into Cloudflare. The
   generated MX, SPF, and DKIM records must be present. Mail-related records must
   be **DNS only**, not proxied. Do not copy Resend's example values from a guide;
   use the values generated for this account and region.
4. Click **Verify DNS Records** in Resend. Verification is often quick but DNS
   propagation can take longer.
5. Create a production API key with **Sending access**. Store it only in Render;
   never put it in `app.json`, client-side `EXPO_PUBLIC_*` values, source, or chat.

Official references: [Resend's Cloudflare guide](https://resend.com/docs/knowledge-base/cloudflare),
[sender-address behavior](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend),
and [API-key handling](https://resend.com/docs/knowledge-base/how-to-handle-api-keys).

## Render variables

Set these on the production web service:

```text
RESEND_API_KEY=<new sending-only Resend key>
MAIL_FROM=Pit <noreply@mail.mshpit.com>
PUBLIC_ORIGIN=https://www.mshpit.com
```

The domain in `MAIL_FROM` must exactly match the domain verified in Resend. If
you decide to verify the root `mshpit.com` instead, use
`Pit <noreply@mshpit.com>` consistently.

Save the variables and let Render redeploy. `GET /api/health` must then report:

```json
{ "services": { "mailConfigured": true } }
```

That flag proves configuration is present, not that mail reached an inbox.

## End-to-end acceptance test

1. Use a real test account whose inbox you control.
2. Choose **Forgot password** once.
3. Confirm one Resend delivery appears in the Resend logs and one message arrives.
4. Open the reset link and set a new password within one hour.
5. Confirm the old password and old sessions no longer work, and the new password
   does work.
6. Check spam/junk and test at a second mail provider before launch.

The forgot-password response is intentionally identical for existing and unknown
addresses, so the browser cannot reveal account membership. Delivery failures are
recorded in server logs without ever printing the reset secret.

## Troubleshooting

- `mailConfigured: false`: one of `RESEND_API_KEY` or `MAIL_FROM` is missing in
  the Render service that is actually running.
- Resend `403 domain not verified`: `MAIL_FROM` does not exactly match the
  verified root/subdomain, or verification is incomplete.
- Resend `403 invalid_api_key`: rotate the key and update Render.
- Verification remains pending: confirm the authoritative nameservers are
  Cloudflare, check every generated MX/SPF/DKIM value, and keep DNS records
  unproxied. Resend's domain screen shows record-level errors.
- Resend `429`: the team send rate was exceeded; password reset remains safe to
  retry later.

Because a Resend credential was previously pasted into chat, rotate it before
production validation. Deploy the replacement first, verify it in Resend logs,
then revoke the exposed key.
