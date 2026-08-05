// Email copy and rendering. Bodies are plain text with {{token}} placeholders,
// never HTML, because the body is owner-editable from the admin screen and a
// stored-HTML field would be a self-inflicted injection sink. Everything is
// escaped on the way into the HTML part, so a name containing markup arrives as
// literal text rather than markup.

const BRAND = "#FF8C42";
const INK = "#1A1206";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// A CTA URL is the one place a token expands into an attribute, so it is held to
// http/https only. A `javascript:` or `data:` target typed into the admin form
// must never reach a mail client.
export function safeUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch { return null; }
}

// Substitution is single-pass over the literal text: a value that itself looks
// like "{{name}}" is inserted as characters and never re-scanned, so stored copy
// cannot expand a token an admin did not write.
export function fillTokens(body, vars) {
  return String(body ?? "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? "") : whole);
}

export function availableTokens() {
  return ["name", "handle", "origin", "link", "unsubscribeUrl", "year"];
}

function paragraphs(text) {
  return String(text).split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
}

function layout({ heading, bodyText, ctaLabel, ctaUrl, footerHtml }) {
  const blocks = paragraphs(bodyText)
    .map((block) => `<p style="margin:0 0 16px;line-height:1.55;color:#2B2B2B">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const cta = ctaUrl && ctaLabel
    ? `<p style="margin:24px 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${BRAND};color:${INK};font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px">${escapeHtml(ctaLabel)}</a></p>`
    : "";
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:8px">
<h2 style="color:${BRAND};margin:0 0 18px">${escapeHtml(heading)}</h2>
${blocks}${cta}
<hr style="border:none;border-top:1px solid #E6E6E6;margin:28px 0 14px">
<p style="color:#8A8A8A;font-size:12px;line-height:1.5;margin:0">${footerHtml}</p>
</div>`;
}

// Built-in copy. A row in email_templates overrides these; deleting that row
// restores exactly this, which is the escape hatch for a bad edit.
export const DEFAULT_TEMPLATES = {
  welcome: {
    subject: "Welcome to Pit",
    body: `Hey {{name}}, welcome to Pit.

Pit is for the shows you actually went to. Log one, rate it, and say what it was really like. Your reviews build up into a record of everything you've seen.

The part most people miss: you can see who else is going to a show before it happens. If you're heading somewhere on your own or travelling in for a gig, that's the fastest way to not be there alone.

Start by logging the last show you went to.`,
    cta_label: "Log a show",
    cta_url: "{{origin}}",
  },
  password_reset: {
    subject: "Reset your Pit password",
    body: `Someone asked to reset the password for this Pit account.

Tap the button to set a new one. The link is valid for 1 hour.

If this wasn't you, ignore this email and nothing will change.`,
    cta_label: "Reset password",
    cta_url: "{{link}}",
  },
};

// Marketing mail must carry a working opt-out; transactional mail must not,
// because unsubscribing from your own password reset is a way to lock yourself
// out. `kind` decides which footer is legally and practically correct.
function footer({ kind, origin, unsubscribeUrl }) {
  const home = safeUrl(origin);
  const homeHtml = home ? ` &middot; <a href="${escapeHtml(home)}" style="color:#8A8A8A">mshpit.com</a>` : "";
  if (kind === "campaign") {
    const unsub = safeUrl(unsubscribeUrl);
    const unsubHtml = unsub
      ? `<a href="${escapeHtml(unsub)}" style="color:#8A8A8A">Unsubscribe</a>`
      : "Reply to this email to stop receiving announcements.";
    return `You're getting this because you have a Pit account. ${unsubHtml}${homeHtml}`;
  }
  return `This is an automatic message about your Pit account, so it has no unsubscribe link.${homeHtml}`;
}

// Renders one message. `kind` is 'transactional' or 'campaign'.
export function renderEmail({ subject, body, ctaLabel, ctaUrl, kind = "transactional", vars = {} }) {
  const filled = { ...vars, year: String(new Date().getFullYear()) };
  const finalSubject = fillTokens(subject, filled).trim() || "A message from Pit";
  const finalBody = fillTokens(body, filled);
  const finalCtaUrl = safeUrl(fillTokens(ctaUrl || "", filled));
  const finalCtaLabel = String(ctaLabel || "").trim();
  const footerHtml = footer({ kind, origin: filled.origin, unsubscribeUrl: filled.unsubscribeUrl });

  const textParts = [finalBody.trim()];
  if (finalCtaUrl) textParts.push(finalCtaLabel ? `${finalCtaLabel}: ${finalCtaUrl}` : finalCtaUrl);
  if (kind === "campaign" && filled.unsubscribeUrl) textParts.push(`Unsubscribe: ${filled.unsubscribeUrl}`);

  return {
    subject: finalSubject,
    html: layout({ heading: finalSubject, bodyText: finalBody, ctaLabel: finalCtaLabel, ctaUrl: finalCtaUrl, footerHtml }),
    text: textParts.join("\n\n"),
  };
}
