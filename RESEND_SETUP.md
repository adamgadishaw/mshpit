# Resend production setup

Pit already sends password-reset mail through Resend in `server/mailer.js`. The
application code is finished. Everything remaining is account and DNS setup that
only the owner can do.

## State as of 2026-08-05

Verified by DNS lookup against 1.1.1.1, not assumed:

| Thing | State |
|---|---|
| `mshpit.com` nameservers | Cloudflare (`lloyd`/`nola.ns.cloudflare.com`) |
| Resend SPF/MX/DKIM records | **None present, on the root or any subdomain** |
| `RESEND_API_KEY` on Render | Set, previously exposed in chat, needs rotating |
| `MAIL_FROM` on Render | Not set (`sync: false`, so Render never fills it) |
| Production `mailConfigured` | `false` |

So the domain has never been verified in Resend. A valid API key alone cannot
send; Resend answers `403` until the domain is verified.

There is also a leftover **DMARC record at `p=quarantine`** pointing its reports
at `onsecureserver.net` (GoDaddy). It uses relaxed alignment, so a Resend
subdomain sender passes once DKIM exists. It does mean a half-finished setup
lands in spam quietly rather than failing loudly.

## Step by step, from zero

### 1. Create the Resend account

1. Go to <https://resend.com> and sign up. Email plus password is fine; there is
   no Google account requirement.
2. Free tier covers password resets comfortably (3,000/month at time of writing).

### 2. Add the sending domain

Use a dedicated subdomain, `mail.mshpit.com`, so transactional mail cannot
damage the root domain's reputation.

1. In the Resend sidebar choose **Domains**, then **Add Domain**.
2. Enter `mail.mshpit.com` and pick the region closest to Render's region.
3. Resend shows a table of DNS records: one MX, one or two TXT (SPF), and a TXT
   DKIM record at `resend._domainkey`.

### 3. Put the records in Cloudflare

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

### 4. Verify

Back in Resend, click **Verify DNS Records**. It usually passes in a few minutes.
The domain must read **Verified** before anything will send.

To check from your own machine:

```bash
nslookup -type=txt resend._domainkey.mail.mshpit.com 1.1.1.1
```

### 5. Create a fresh API key

1. **API Keys → Create API Key**.
2. Name it `pit-production`, permission **Sending access** only, restricted to
   `mail.mshpit.com`.
3. Copy it once. Put it **only** into Render. Never into `app.json`, any
   `EXPO_PUBLIC_*` value, source control, or a chat window.

### 6. Set the Render variables

Render dashboard → the Pit web service → **Environment**:

```text
RESEND_API_KEY=<the new sending-only key>
MAIL_FROM=Pit <noreply@mail.mshpit.com>
```

`PUBLIC_ORIGIN` is already pinned in the Blueprint. Save and let Render redeploy.

The domain in `MAIL_FROM` must match the verified domain exactly. Verifying the
root instead means `Pit <noreply@mshpit.com>`.

### 7. Confirm, then revoke the old key

`GET /api/health` reports exactly what is missing:

```json
{ "services": { "mail": {
  "configured": true, "apiKeyPresent": true,
  "fromValid": true, "fromDomain": "mail.mshpit.com", "reason": null } } }
```

`reason` is `missing-api-key`, `missing-from`, `invalid-from`, or
`missing-api-key-and-from` while incomplete. `fromDomain` is there so a mismatch
against the verified domain is visible without reading env vars.

Once the new key is confirmed working in Resend's logs, **revoke the old one**.

## Testing the code path before DNS is ready

Resend allows sending from its shared `onboarding@resend.dev` address without any
domain verification, but only to the address that owns the Resend account. Setting
`MAIL_FROM=Pit <onboarding@resend.dev>` proves the whole reset flow end to end
while DNS propagates. It cannot stay in production, since no other user would ever
receive mail. Confirm the sender is still offered on your plan.

## End-to-end acceptance test

1. Use a real test account whose inbox you control.
2. Choose **Forgot password** once.
3. Confirm one Resend delivery appears in the Resend logs and one message arrives.
4. Open the reset link and set a new password within one hour.
5. Confirm the old password and old sessions no longer work, and the new does.
6. Check spam/junk and test at a second mail provider before launch. The
   `p=quarantine` DMARC policy makes this step matter more than usual.

The forgot-password response is intentionally identical for existing and unknown
addresses, so the browser cannot reveal account membership. Delivery failures are
recorded in server logs without ever printing the reset secret.

## Troubleshooting

- `mail.reason: missing-from`: `MAIL_FROM` is unset on the service that is
  actually running. It is `sync: false`, so it must be set by hand.
- `mail.reason: invalid-from`: the value is set but unparseable, e.g. a bare
  display name with no address. `server/mailer.js` refuses to attempt the send.
- Resend `403` / `sender-not-verified` in logs: `mail.fromDomain` does not match
  the verified domain, or verification never completed.
- Resend `403 invalid_api_key`: rotate the key and update Render.
- Verification stays pending: confirm Cloudflare is authoritative, check every
  generated value, and keep the records unproxied. Resend's domain screen shows
  record-level errors.
- Resend `429`: team send rate exceeded; password reset is safe to retry later.

Official references: [Resend's Cloudflare guide](https://resend.com/docs/knowledge-base/cloudflare),
[sender-address behavior](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend),
and [API-key handling](https://resend.com/docs/knowledge-base/how-to-handle-api-keys).
