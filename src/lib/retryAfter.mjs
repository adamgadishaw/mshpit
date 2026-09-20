const MAX_RETRY_AFTER_MS = 60 * 60_000;
const ARTIST_CAMPAIGN_MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;

// Retry-After is only a manual-retry hint. Ignore unrelated/auth failures and
// malformed values; no caller should ever schedule an unbounded/NaN timer.
export function retryAfterDelayMs(value, { status, retryable, code, now = Date.now() } = {}) {
  if (![429, 502, 503, 504].includes(Number(status)) || retryable === false || typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 100) return null;
  let delay;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    delay = Number(text) * 1000;
  } else if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) {
    delay = Date.parse(text) - now;
  } else return null;
  if (!Number.isFinite(delay) || delay < 0) return null;
  const maximum = code === "ARTIST_CAMPAIGN_LIMIT" ? ARTIST_CAMPAIGN_MAX_RETRY_AFTER_MS : MAX_RETRY_AFTER_MS;
  return Math.min(maximum, Math.ceil(delay));
}
