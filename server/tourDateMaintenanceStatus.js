// One bounded last-pass record. No artist/city inputs, request URLs, headers,
// credentials, response payloads or raw exception messages are retained.
const KEY = "tourdates:last-pass:v1";
const STAGES = new Set(["starting", "selection", "artist_fetch", "artist_write", "city_fetch", "city_write", "country_fetch", "country_write", "reconciliation", "complete"]);
const STATES = new Set(["running", "succeeded", "failed", "cancelled"]);
const CATEGORIES = new Set(["provider_refused", "provider_rate_limited", "provider_unavailable", "provider_timeout", "provider_network", "provider_response_invalid", "provider_refresh_failed", "aborted"]);
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function tourDateFailureLocation(error) {
  const stack = typeof error?.stack === "string" ? error.stack.slice(0, 16000) : "";
  // Fixed known module names only, never arbitrary paths or function names.
  return stack.replaceAll("\\", "/").match(/server\/(?:tourdates|ticketmasterMarketCoverage|artistBillingIdentity|musicEventClassification|tourDateMetadata)\.js:\d{1,7}:\d{1,7}/)?.[0] || null;
}

export function recordTourDateMaintenancePass(database, { state, stage, at = Date.now(), startedAt = at,
  category = null, error, rows = null, providerSuccesses = null, providerFailures = null } = {}) {
  if (!STATES.has(state) || !STAGES.has(stage) || count(at) === null || count(startedAt) === null) return false;
  const record = { state, stage, at, startedAt, category: CATEGORIES.has(category) ? category : null,
    location: tourDateFailureLocation(error), rows: count(rows), providerSuccesses: count(providerSuccesses), providerFailures: count(providerFailures) };
  database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(KEY, JSON.stringify(record));
  return true;
}

export function collectTourDateMaintenanceStatus(database, { at = Date.now() } = {}) {
  const empty = { state: "unverified", at: null, lastSuccessAt: null, stage: null, category: null,
    location: null, rows: null, providerSuccesses: null, providerFailures: null };
  try {
    const get = database.prepare("SELECT value FROM app_meta WHERE key=?");
    const lastSuccessAt = count(Number(get.get("tourdates:last-refresh:v1")?.value));
    const text = get.get(KEY)?.value;
    if (typeof text !== "string" || text.length > 2048) return { ...empty, lastSuccessAt };
    const record = JSON.parse(text);
    if (!record || !STATES.has(record.state) || !STAGES.has(record.stage) || count(record.at) === null || record.at > at) return { ...empty, lastSuccessAt };
    const location = typeof record.location === "string" && /^server\/(?:tourdates|ticketmasterMarketCoverage|artistBillingIdentity|musicEventClassification|tourDateMetadata)\.js:\d{1,7}:\d{1,7}$/.test(record.location) ? record.location : null;
    return { state: record.state, at: record.at, lastSuccessAt, stage: record.stage,
      category: CATEGORIES.has(record.category) ? record.category : null, location,
      rows: count(record.rows), providerSuccesses: count(record.providerSuccesses), providerFailures: count(record.providerFailures) };
  } catch { return empty; }
}
