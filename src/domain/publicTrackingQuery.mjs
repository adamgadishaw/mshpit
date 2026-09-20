// These values do not select page content. Keep attribution in the address bar,
// but use the clean document's existing indexing policy and canonical identity.
// Unknown filters, credentials and functional parameters remain fail-closed.
const TRACKING_KEYS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
  "gclid", "dclid", "gbraid", "wbraid", "fbclid", "msclkid", "srsltid",
]);

export function hasOnlyPublicTrackingQuery(search = "") {
  if (typeof search !== "string" || search.length > 2048) return false;
  if (!search || search === "?") return true;
  if (!search.startsWith("?") || /[\u0000-\u0020\u007f#]/u.test(search)) return false;
  let count = 0;
  for (const [key, value] of new URLSearchParams(search)) {
    if (++count > 20 || !TRACKING_KEYS.has(key.toLowerCase()) || value.length > 512
      || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  }
  return count > 0;
}
