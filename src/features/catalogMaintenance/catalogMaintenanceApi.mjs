export const CATALOG_MAINTENANCE_PATH = "/api/moderation/catalog-maintenance";
export const CATALOG_MODES = Object.freeze(["catch_up", "maintenance", "paused"]);

function actor(accountId) {
  if (typeof accountId !== "string" || !accountId.trim()) throw new TypeError("Catalog upkeep requires an administrator account.");
  return accountId.trim();
}

export function validateCatalogMaintenance(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || !Object.hasOwn(payload, "catalog") || (payload.catalog !== null
      && (!CATALOG_MODES.includes(payload.catalog.mode) || !payload.catalog.limits || !payload.catalog.progress))) {
    throw new TypeError("Catalog upkeep returned an invalid status. Refresh before changing its mode.");
  }
  return payload;
}

export async function readCatalogMaintenance({ accountId, signal } = {}, { apiCall } = {}) {
  const expectedAccountId = actor(accountId);
  if (typeof apiCall !== "function") throw new TypeError("Catalog upkeep transport is unavailable.");
  return validateCatalogMaintenance(await apiCall(CATALOG_MAINTENANCE_PATH, {
    expectedAccountId, signal, silent: true, context: "Reading catalog upkeep",
  }));
}

export async function setCatalogMaintenanceMode({ accountId, mode, expectedMode, signal } = {}, { apiCall } = {}) {
  const expectedAccountId = actor(accountId);
  if (!CATALOG_MODES.includes(mode)) throw new TypeError("Choose a supported catalog upkeep mode.");
  if (expectedMode !== undefined && !CATALOG_MODES.includes(expectedMode)) throw new TypeError("Refresh the current catalog upkeep mode.");
  if (typeof apiCall !== "function") throw new TypeError("Catalog upkeep transport is unavailable.");
  const payload = validateCatalogMaintenance(await apiCall(CATALOG_MAINTENANCE_PATH, {
    method: "POST", body: { mode, ...(expectedMode ? { expectedMode } : {}) }, expectedAccountId, signal, silent: true,
    context: "Changing catalog upkeep mode",
  }));
  if (payload.catalog?.mode !== mode) throw new Error("The server did not confirm the requested mode. Refresh status before trying again.");
  return payload;
}
