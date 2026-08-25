# Google Workspace and Resend production mail

Google Workspace and Resend have different jobs and both remain required:

- Google Workspace receives and sends human mail at `@mshpit.com`.
- Resend sends Pit's automated verification, welcome, reset, alert, and opted-in
  announcement mail from the isolated `mail.mshpit.com` subdomain.

Changing the apex MX to Google does not move the application to Gmail SMTP, and
the Google MX must not replace Resend's subdomain authentication records.

## State verified on 2026-08-25

Verified by DNS lookup against 1.1.1.1, not assumed:

| Thing | State |
|---|---|
| `mshpit.com` nameservers | Cloudflare (`lloyd`/`nola.ns.cloudflare.com`) |
| Google Workspace MX | Published at the apex: `smtp.google.com` |
| Google Workspace DKIM | Published at `google._domainkey.mshpit.com` |
| Google Workspace SPF | **Missing at the apex** |
| DMARC | `p=quarantine`, but aggregate reports still go to the stale GoDaddy `onsecureserver.net` address |
| Resend DKIM | Published at `resend._domainkey.mail.mshpit.com` |
| Resend return path | MX and SPF published at `send.mail.mshpit.com` |
| Render secrets/sender | Private dashboard state; verify in Moderation -> Email and with a test delivery |

The screenshot's `www.mshpit.com is now configured` wording does not mean email
addresses should end in `@www.mshpit.com`. Public DNS confirms the receiving
domain is the correct apex, `mshpit.com`.

## Immediate Cloudflare actions

1. Add the one missing Google Workspace SPF TXT record at the apex (`@`):

   ```text
   v=spf1 include:_spf.google.com ~all
   ```

   There is currently no apex SPF record. If another sender is ever added at the
   apex, merge it into this single SPF record; never publish two SPF records at
   one hostname.
2. Create and monitor `support@mshpit.com` (mailbox, alias, or group) before the
   app promises it publicly. Create a separate `ops@mshpit.com` inbox/alias for
   incident alerts if desired.
3. Replace the stale DMARC `rua=mailto:dmarc_rua@onsecureserver.net` destination
   with an address or reporting service you control. Do that only after the
   destination exists; keep the current `p=quarantine` policy while reviewing
   reports.
4. Leave every existing Resend record under `mail.mshpit.com` / `send.mail.mshpit.com`
   in place and DNS-only.

## Resend setup and verification

### 1. Confirm the Resend account

Use the existing Resend account. Rotate any API key ever pasted into chat, and
keep the replacement restricted to sending from `mail.mshpit.com`.

### 2. Confirm the sending domain

Use a dedicated subdomain, `mail.mshpit.com`, so transactional mail cannot
damage the root domain's reputation.

In Resend -> Domains, `mail.mshpit.com` should read **Verified**. Public DNS has
the expected record families, but the provider dashboard remains authoritative
for the account-specific verification state.

### 3. Preserve the records in Cloudflare

Resend offers a **Sign in to Cloudflare** button. Use it if you can; it writes
the records itself and skips this whole section. Manually:

1. Log in to Cloudflare, choose `mshpit.com`, open **DNS → Records**.
2. For each row Resend shows, click **Add record** and copy the Type, Name, and
   Value **exactly** as generated for your account. Do not copy values out of a
   tutorial; DKIM keys are unique per domain.
3. Set every mail record's proxy status to **DNS only** (grey cloud, not orange).
   Proxying breaks mail authentication.
4. Cloudflare may append the zone automatically. If Resend says the name is
   `send.mail`, entering `send.mail` yields `send.mail.mshpit.com`. Confirm the
   final name reads correctly before saving.

### 4. Re-verify after DNS changes

Back in Resend, click **Verify DNS Records**. It usually passes in a few minutes.
The domain must read **Verified** before anything will send.

To check from your own machine:

```bash
nslookup -type=txt resend._domainkey.mail.mshpit.com 1.1.1.1
```

### 5. Keep a fresh API key

1. **API Keys → Create API Key**.
2. Name it `pit-production`, permission **Sending access** only, restricted to
   `mail.mshpit.com`.
3. Copy it once. Put it **only** into Render. Never into `app.json`, any
   `EXPO_PUBLIC_*` value, source control, or a chat window.

### 6. Set the Render variables

Render dashboard → the Pit web service → **Environment**:

```text
RESEND_API_KEY=<the new sending-only key>
MAIL_FROM=Mshpit <noreply@mail.mshpit.com>
MAIL_REPLY_TO=support@mshpit.com
ALERT_EMAIL=ops@mshpit.com
OWNER_EMAIL=<the same address as ADMIN_EMAIL during Owner migration>
OWNER_MIGRATION_EMAIL=<the same confirmed address, required once for the v1 lock/transfer>
SITE_HEALTH_DIGEST_ENABLED=true
SITE_HEALTH_DIGEST_HOUR=9
```

`PUBLIC_ORIGIN` is already pinned in the Blueprint. Save and let Render redeploy.

`OWNER_MIGRATION_EMAIL` is an explicit one-time deployment approval, not a
second account. The migration refuses to create a replacement member or adopt
an unconfirmed mailbox. After the database stores the v2 Owner lock, changing
any of these email variables cannot transfer ownership; the migration variable
may then be removed from Render.

The domain in `MAIL_FROM` must match the Resend-verified sending domain exactly.
Do not change it to the Google Workspace apex merely because Workspace now owns
the receiving MX. `MAIL_REPLY_TO` is the bridge into the monitored Workspace
inbox. `ALERT_EMAIL` is deliberately separate from `ADMIN_EMAIL`: changing
`ADMIN_EMAIL` transfers Pit's bootstrap-root identity and revokes admin sessions.

## Founder operations mail

Production sends the database-locked Owner a code-owned site-health template once
per Toronto calendar day, at or after 09:00 by default. A durable `app_meta`
claim is scoped to the Owner identity version plus an opaque digest of its user
ID, so a legacy Owner's same-day claim cannot suppress the locked Founder's
delivery. It suppresses duplicates through restarts and rolling deploys; failed
delivery uses bounded retries with the same Owner-scoped provider idempotency
key. No email address is stored in a dedupe key. Staging and local development
cannot enable this production mail accidentally.

The readout contains only operational aggregates: database readiness, configuration
booleans, verified-local-backup age, mail outcome counts, media cleanup counts,
distinct serious error-pattern count, pending-approval count, release identifier,
and process uptime. It excludes member identities, recipients, search terms,
messages, posts, paths, raw URLs, bucket names, addresses, and credentials.

A production release also records and emails one hash-chained security receipt per
Render commit and Owner identity. A v1 receipt for that commit therefore cannot
consume the locked v2 Founder's receipt. This happens only after the web process
is listening; it is a live process stamp, not proof that every public route or
external provider is healthy.

The app cannot email while it is down and cannot prove Render build/control-plane
status, public DNS, Google Workspace delivery, public reachability, or the latest
off-host backup upload from its own process. Keep Render deployment notifications
and an independent uptime monitor addressed to a staffed inbox. The digest reports
off-host backup configuration, not independent remote-upload completion evidence.

### 7. Confirm, then revoke the old key

Moderation -> Email reports the private configuration state to administrators:

```json
{ "mail": {
  "configured": true, "apiKeyPresent": true,
  "fromValid": true, "fromDomain": "mail.mshpit.com",
  "replyToPresent": true, "replyToValid": true,
  "replyToDomain": "mshpit.com", "reason": null, "warning": null } }
```

`reason` is `missing-api-key`, `missing-from`, `invalid-from`, or
`missing-api-key-and-from` while incomplete. `warning` is `invalid-reply-to`
when the optional Workspace address is malformed. Diagnostics expose domains and
presence only, never credentials or full inbox addresses. The public health
route intentionally does not expose mail topology.

Once the new key is confirmed working in Resend's logs, **revoke the old one**.

## Testing the code path before DNS is ready

Resend allows sending from its shared `onboarding@resend.dev` address without any
domain verification, but only to the address that owns the Resend account. Setting
`MAIL_FROM=Mshpit <onboarding@resend.dev>` proves the whole reset flow end to end
while DNS propagates. It cannot stay in production, since no other user would ever
receive mail. Confirm the sender is still offered on your plan.

## End-to-end acceptance test

1. Use a real test account whose inbox you control.
2. Choose **Forgot password** once.
3. Confirm one Resend delivery appears in the Resend logs and one message arrives.
4. Open the reset link and set a new password within one hour.
5. Confirm the old password and old sessions no longer work, and the new does.
6. Reply to the message and confirm it reaches `MAIL_REPLY_TO`.
7. Check spam/junk and test at a second mail provider before launch. The
   `p=quarantine` DMARC policy makes this step matter more than usual.

The forgot-password response is intentionally identical for existing and unknown
addresses, so the browser cannot reveal account membership. Delivery failures are
recorded in server logs without ever printing the reset secret.

## Troubleshooting

- `mail.reason: missing-from`: `MAIL_FROM` is unset on the service that is
  actually running. It is `sync: false`, so it must be set by hand.
- `mail.reason: invalid-from`: the value is set but unparseable, e.g. a bare
  display name with no address. `server/mailer.js` refuses to attempt the send.
- `mail.warning: invalid-reply-to`: automated delivery can continue, but replies
  are omitted until `MAIL_REPLY_TO` is corrected.
- Resend `403` / `sender-not-verified` in logs: `mail.fromDomain` does not match
  the verified domain, or verification never completed.
- Resend `403 invalid_api_key`: rotate the key and update Render.
- Verification stays pending: confirm Cloudflare is authoritative, check every
  generated value, and keep the records unproxied. Resend's domain screen shows
  record-level errors.
- Resend `429`: team send rate exceeded; password reset is safe to retry later.

Official references: [Resend's Cloudflare guide](https://resend.com/docs/knowledge-base/cloudflare),
[sender-address behavior](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend),
[API-key handling](https://resend.com/docs/knowledge-base/how-to-handle-api-keys),
[Google Workspace MX](https://support.google.com/a/answer/87127), and
[Google Workspace SPF](https://support.google.com/a/answer/33786).
