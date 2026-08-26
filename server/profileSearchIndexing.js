import { canonicalProfileExtras } from "./profileExtras.js";

function sqlAlias(value) {
  const alias = String(value || "u");
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new TypeError("Invalid SQL alias");
  return alias;
}

function parsedExtras(value) {
  if (value === null || value === undefined || value === "") return { valid: true, value: {} };
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { valid: false, value: {} };
      return { valid: true, value: parsed };
    } catch {
      return { valid: false, value: {} };
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) return { valid: false, value: {} };
  return { valid: true, value };
}

// Missing preference means the existing public-profile behavior remains on.
// Malformed stored metadata fails closed: a damaged compatibility envelope must
// never silently undo an account's privacy choice and make the profile crawlable.
export function profileAllowsSearchIndexing(userOrExtras) {
  const source = userOrExtras && typeof userOrExtras === "object" && !Array.isArray(userOrExtras)
    && Object.prototype.hasOwnProperty.call(userOrExtras, "extras")
    ? userOrExtras.extras
    : userOrExtras;
  const parsed = parsedExtras(source);
  if (!parsed.valid) return false;
  if (!Object.prototype.hasOwnProperty.call(parsed.value, "searchIndexingOptOut")) return true;
  if (typeof parsed.value.searchIndexingOptOut !== "boolean") return false;
  return canonicalProfileExtras(parsed.value).value.searchIndexingOptOut !== true;
}

// SQL counterpart to profileAllowsSearchIndexing(). Only the member/profile
// crawler reads use this; independently public posts deliberately do not.
export function profileAllowsSearchIndexingSql(alias = "u") {
  const safe = sqlAlias(alias);
  const extras = `${safe}.extras`;
  return `(CASE
    WHEN ${extras} IS NULL OR TRIM(${extras})='' THEN 1
    WHEN json_valid(${extras})=0 THEN 0
    WHEN json_type(${extras})<>'object' THEN 0
    WHEN json_type(${extras},'$.searchIndexingOptOut') IS NULL THEN 1
    WHEN json_type(${extras},'$.searchIndexingOptOut')='false' THEN 1
    ELSE 0
  END)=1`;
}

export function createProfileSearchIndexingPolicy(database) {
  if (!database?.prepare) throw new TypeError("Profile search-indexing policy requires a database");
  const byId = database.prepare("SELECT extras FROM users WHERE id=? LIMIT 1");
  const byHandle = database.prepare("SELECT extras FROM users WHERE handle=? LIMIT 1");

  return Object.freeze({
    allows({ id = null, handle = null } = {}) {
      const memberId = typeof id === "string" ? id.trim() : "";
      const memberHandle = typeof handle === "string" ? handle.replace(/^@+/, "").trim().toLowerCase() : "";
      const row = memberId ? byId.get(memberId) : memberHandle ? byHandle.get(memberHandle) : null;
      // The public-document repository remains authoritative for existence and
      // moderation state. This policy answers only the explicit indexing choice.
      return !row || profileAllowsSearchIndexing(row);
    },
  });
}
