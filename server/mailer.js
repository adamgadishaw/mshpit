// Minimal transactional email via Resend's HTTP API (no dependency, one fetch).
// Configured with two env vars on the web service:
//   RESEND_API_KEY  — from resend.com (free tier is plenty for password resets)
//   MAIL_FROM       — a verified sender, e.g. "Mshpit <noreply@mail.mshpit.com>"
// Optional MAIL_REPLY_TO points replies at a monitored Google Workspace inbox.
// When either is absent it's a graceful no-op that returns { ok:false, sent:false }
// so the reset flow still works (the caller decides what to do with an un-sent mail).

// A malformed MAIL_FROM is worth catching here rather than at Resend, which
// rejects it as a generic 403 that reads identically to an unverified domain.
// Accepts "addr@host" or "Display Name <addr@host>"; returns the sending domain
// so operators can see at a glance whether it matches the domain they verified.
export function parseMailFrom(raw) {
  const value = String(raw || "").trim();
  if (!value) return { ok: false, reason: "missing", address: null, domain: null };
  const angled = value.match(/<([^>]*)>\s*$/);
  const address = (angled ? angled[1] : value).trim();
  if (!/^[^\s@<>",;]+@[^\s@<>",;.]+(\.[^\s@<>",;.]+)+$/.test(address)) {
    return { ok: false, reason: "invalid", address: null, domain: null };
  }
  return { ok: true, reason: null, address, domain: address.split("@").pop().toLowerCase() };
}

export function mailConfigured() {
  return !!process.env.RESEND_API_KEY && parseMailFrom(process.env.MAIL_FROM).ok;
}

// Provider/network failures can carry request payloads, addresses, URLs, or
// credentials in their human-readable message. Hosted logs only need a bounded
// failure class for diagnosis and alert grouping.
export function mailFailureLabel(error) {
  const name = String(error?.name || "Error").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || "Error";
  const code = String(error?.code || "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
  return code ? `${name}/${code}` : name;
}

// Which half of the configuration is missing. Reports booleans and the public
// sending domain only; never the key, and never the raw env value.
export function mailDiagnostics() {
  const hasKey = !!process.env.RESEND_API_KEY;
  const from = parseMailFrom(process.env.MAIL_FROM);
  const replyToPresent = !!String(process.env.MAIL_REPLY_TO || "").trim();
  const replyTo = parseMailFrom(process.env.MAIL_REPLY_TO);
  let reason = null;
  if (!hasKey && !from.ok) reason = "missing-api-key-and-from";
  else if (!hasKey) reason = "missing-api-key";
  else if (from.reason === "missing") reason = "missing-from";
  else if (from.reason === "invalid") reason = "invalid-from";
  return {
    configured: hasKey && from.ok,
    apiKeyPresent: hasKey,
    fromPresent: !!String(process.env.MAIL_FROM || "").trim(),
    fromValid: from.ok,
    fromDomain: from.domain,
    replyToPresent,
    replyToValid: replyToPresent ? replyTo.ok : null,
    replyToDomain: replyToPresent && replyTo.ok ? replyTo.domain : null,
    warning: replyToPresent && !replyTo.ok ? "invalid-reply-to" : null,
    reason,
  };
}

export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  if (!mailConfigured()) return { ok: false, sent: false, reason: mailDiagnostics().reason || "not-configured" };
  try {
    const replyTo = parseMailFrom(process.env.MAIL_REPLY_TO);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json",
        "User-Agent": "PitConcertApp/1.0 (https://mshpit.com)",
        ...(idempotencyKey ? { "Idempotency-Key": String(idempotencyKey).slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [to],
        subject,
        html,
        text,
        ...(replyTo.ok ? { reply_to: String(process.env.MAIL_REPLY_TO).trim() } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      // 403 here is nearly always an unverified domain or a MAIL_FROM whose domain
      // isn't the one verified in Resend. Name that case so the log is actionable.
      // Never log the provider body: it may echo the recipient or authored mail.
      const reason = r.status === 403 ? "sender-not-verified" : "provider-rejected";
      console.warn(`[mail] send failed status=${r.status} reason=${reason}`);
      return { ok: false, sent: false, reason: r.status === 403 ? "sender-not-verified" : "send-failed" };
    }
    return { ok: true, sent: true };
  } catch (e) {
    console.warn(`[mail] transport error cause=${mailFailureLabel(e)}`);
    return { ok: false, sent: false, reason: "error" };
  }
}
