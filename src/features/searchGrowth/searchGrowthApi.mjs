export const SEARCH_GROWTH_PATH = "/api/moderation/search-growth";
export const SEARCH_GROWTH_MODES = Object.freeze(["paused", "monitor", "prioritize"]);

function actor(accountId) {
  if (typeof accountId !== "string" || !accountId.trim()) throw new TypeError("Search Growth requires an administrator account.");
  return accountId.trim();
}
export function validateSearchGrowth(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || typeof payload.enabled !== "boolean" || typeof payload.configured !== "boolean"
    || !SEARCH_GROWTH_MODES.includes(payload.mode)
    || !payload.connection || typeof payload.connection.state !== "string"
    || !payload.totals || !payload.limits || !payload.measurement
    || !Array.isArray(payload.opportunities) || !Array.isArray(payload.history)
    || typeof payload.running !== "boolean" || typeof payload.truncated !== "boolean") {
    throw new TypeError("Search Growth returned an invalid status. Refresh before changing its mode.");
  }
  return payload;
}
export async function readSearchGrowth({ accountId, signal } = {}, { apiCall } = {}) {
  const expectedAccountId = actor(accountId);
  if (typeof apiCall !== "function") throw new TypeError("Search Growth transport is unavailable.");
  return validateSearchGrowth(await apiCall(SEARCH_GROWTH_PATH, {
    expectedAccountId, signal, silent: true, context: "Reading Search Growth",
  }));
}
export async function setSearchGrowthMode({ accountId, mode, expectedMode, signal } = {}, { apiCall } = {}) {
  const expectedAccountId = actor(accountId);
  if (!SEARCH_GROWTH_MODES.includes(mode) || !SEARCH_GROWTH_MODES.includes(expectedMode)) throw new TypeError("Refresh the current Search Growth mode before changing it.");
  if (typeof apiCall !== "function") throw new TypeError("Search Growth transport is unavailable.");
  const payload = validateSearchGrowth(await apiCall(SEARCH_GROWTH_PATH, {
    method: "POST", body: { mode, expectedMode }, expectedAccountId, signal, silent: true,
    context: "Changing Search Growth mode",
  }));
  if (payload.mode !== mode) throw new Error("The server did not confirm the requested mode. Refresh status before trying again.");
  return payload;
}
