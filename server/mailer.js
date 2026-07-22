// Minimal transactional email via Resend's HTTP API (no dependency, one fetch).
// Configured with two env vars on the web service:
//   RESEND_API_KEY  — from resend.com (free tier is plenty for password resets)
//   MAIL_FROM       — a verified sender, e.g. "Pit <noreply@mshpit.com>"
// When the key is absent it's a graceful no-op that returns { ok:false, sent:false }
// so the reset flow still works (the caller decides what to do with an un-sent mail).
export function mailConfigured() {
  return !!process.env.RESEND_API_KEY && !!(process.env.MAIL_FROM || "").trim();
}

export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  if (!mailConfigured()) return { ok: false, sent: false, reason: "not-configured" };
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
    if (!r.ok) { const d = await r.text().catch(() => ""); console.warn("[mail] send failed", r.status, d.slice(0, 200)); return { ok: false, sent: false, reason: "send-failed" }; }
    return { ok: true, sent: true };
  } catch (e) { console.warn("[mail] error", e?.message); return { ok: false, sent: false, reason: "error" }; }
}
