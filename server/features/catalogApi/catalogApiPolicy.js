import { ApiError } from "../../errors.js";

export const CATALOG_AUDIENCE = "pit-catalog-v1";
export const CATALOG_TYPES = Object.freeze(["artist", "venue", "event"]);
export const CATALOG_SCOPES = Object.freeze(CATALOG_TYPES.flatMap(type =>
  ["read", "propose", "commit"].map(action => `catalog:${type}:${action}`)));
export const CATALOG_LIMITS = Object.freeze({
  page: 50, leaseMs: 20 * 60_000, maxLeaseMs: 60 * 60_000,
  active: 2, dailyClaims: 100, dailyCommits: 100,
  workRows: 10_000, proposalRows: 10_000, receiptRows: 20_000, auditRows: 100_000,
  proposalBytes: 20_000, receiptBytes: 32_768, retentionMs: 72 * 3_600_000,
  pilotEntities: 6, pairingMs: 5 * 60_000, grantMs: 30 * 60_000, grantRows: 1000,
});
const on = value => /^(1|true|yes|on)$/iu.test(String(value || "").trim());
export const catalogApiEnabled = env => on(env?.PIT_CATALOG_API_ENABLED);
export const catalogCommitEnabled = env => on(env?.PIT_CATALOG_API_COMMIT_ENABLED);
export function catalogType(value) {
  if (!CATALOG_TYPES.includes(value)) throw new ApiError(400, "Choose a catalog entity type.", "VALIDATION_FAILED");
  return value;
}
export function catalogKey(value) {
  if (typeof value !== "string" || !value || value.length > 600 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ApiError(400, "Choose a valid catalog key.", "VALIDATION_FAILED");
  }
  return value;
}
export function catalogObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new ApiError(400, "The catalog request has unsupported fields.", "VALIDATION_FAILED");
  }
  return value;
}
export function catalogConflict() {
  return new ApiError(409, "This catalog work changed. Read the current page before continuing.", "CONFLICT");
}
