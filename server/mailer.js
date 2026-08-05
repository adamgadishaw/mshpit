// Minimal transactional email via Resend's HTTP API (no dependency, one fetch).
// Configured with two env vars on the web service:
//   RESEND_API_KEY  — from resend.com (free tier is plenty for password resets)
//   MAIL_FROM       — a verified sender, e.g. "Pit <noreply@mail.mshpit.com>"
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

// Which half of the configuration is missing. Reports booleans and the public
// sending domain only; never the key, and never the raw env value.
export function mailDiagnostics() {
  const hasKey = !!process.env.RESEND_API_KEY;
  const from = parseMailFrom(process.env.MAIL_FROM);
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
    reason,
  };
}

export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  if (!mailConfigured()) return { ok: false, sent: false, reason: mailDiagnostics().reason || "not-configured" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json",
        "User-Agent": "PitConcertApp/1.0 (https://mshpit.com)",
        ...(idempotencyKey ? { "Idempotency-Key": String(idempotencyKey).slice(0, 256) } : {}),
      },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const d = await r.text().catch(() => "");
      // 403 here is nearly always an unverified domain or a MAIL_FROM whose domain
      // isn't the one verified in Resend. Name that case so the log is actionable.
      const hint = r.status === 403 ? ` (check that ${parseMailFrom(process.env.MAIL_FROM).domain} is verified in Resend)` : "";
      console.warn("[mail] send failed", r.status, d.slice(0, 200) + hint);
      return { ok: false, sent: false, reason: r.status === 403 ? "sender-not-verified" : "send-failed" };
    }
    return { ok: true, sent: true };
  } catch (e) { console.warn("[mail] error", e?.message); return { ok: false, sent: false, reason: "error" }; }
}
