import { ApiError } from "../../errors.js";
import { REVIEWED_ARTIST_IDENTITIES } from "../../reviewedArtistIdentities.js";

// Risk hints only, NEVER identity/ownership resolution. This deliberately
// small set of common lookalikes is not full Unicode confusable detection.
const LOOKALIKES = new Map(Object.entries({
  "а": "a", "ɑ": "a", "α": "a", "в": "b", "β": "b", "с": "c", "ϲ": "c",
  "ԁ": "d", "е": "e", "ε": "e", "һ": "h", "н": "h", "і": "i", "ι": "i",
  "ј": "j", "κ": "k", "к": "k", "ӏ": "l", "м": "m", "μ": "m", "ո": "n",
  "о": "o", "ο": "o", "р": "p", "ρ": "p", "ѕ": "s", "т": "t", "τ": "t",
  "υ": "u", "ν": "v", "ѵ": "v", "х": "x", "χ": "x", "у": "y", "γ": "y",
  "ԝ": "w", "ω": "w", "զ": "q", "ζ": "z",
}));
const fold = (value) => String(value || "").slice(0, 200).normalize("NFKD")
  .replace(/\p{Mark}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export const artistIdentityRiskKey = (value) => [...fold(value)].map((c) => LOOKALIKES.get(c) || c).join("");
const claims = ["official", "verified", "thereal", "real"];
const explicitClaim = (value) => /(?:^|[\s_.-])(?:official|verified)(?:$|[\s_.-])/iu.test(String(value || ""));

function candidates(value) {
  const original = fold(value);
  const skeleton = artistIdentityRiskKey(value);
  const keys = new Set([original, skeleton].filter(Boolean));
  let claimed = explicitClaim(value);
  for (let round = 0; round < 2; round++) for (const key of [...keys]) for (const marker of claims) {
    if (keys.size >= 12) break;
    if (key.startsWith(marker) && key.length > marker.length + 1) { keys.add(key.slice(marker.length)); claimed = true; }
    if (key.endsWith(marker) && key.length > marker.length + 1) { keys.add(key.slice(0, -marker.length)); claimed = true; }
  }
  return { keys: [...keys], original, skeleton, claimed };
}

const statementsByDatabase = new WeakMap();
function statements(database) {
  let value = statementsByDatabase.get(database);
  if (!value) {
    value = {
      // Indexed bounded reads: no catalogue scan or provider call on signup.
      artists: database.prepare("SELECT norm,name FROM artists WHERE search_key=? LIMIT 8"),
      owner: database.prepare(`SELECT ap.artist_key FROM artist_profiles ap JOIN users u ON u.id=ap.owner_id
        WHERE ap.owner_id=? AND ap.removed=0 AND u.role='artist' AND u.verified=1
          AND lower(trim(u.artist_name))=ap.artist_key`),
    };
    statementsByDatabase.set(database, value);
  }
  return value;
}

export function assessArtistIdentityRisk(database, { name, handle, ownerId = null } = {}) {
  const queries = statements(database);
  const approvedKeys = new Set(ownerId ? queries.owner.all(ownerId).map((r) => r.artist_key) : []);
  const reasons = new Set();
  const matches = new Map();
  for (const [kind, input] of [["name", name], ["handle", handle]]) {
    if (!input) continue;
    const candidate = candidates(input);
    let matched = false;
    let ownedMatch = false;
    const record = (row, alias = false) => {
      if (approvedKeys.has(row.norm)) { ownedMatch = true; return; }
      matched = true;
      matches.set(row.norm, { artistKey: row.norm, name: row.name });
      reasons.add(alias ? "reviewed_artist_alias" : "known_artist_name");
      if (kind === "handle") reasons.add("protected_artist_handle");
    };
    for (const key of candidate.keys) {
      for (const row of queries.artists.all(key)) record(row);
      // Protect reviewed aliases even before the corresponding row is imported.
      for (const entry of REVIEWED_ARTIST_IDENTITIES) {
        if ([entry.name, ...(entry.aliases || [])].some((alias) => artistIdentityRiskKey(alias) === key)) {
          record({ norm: entry.name.trim().toLowerCase(), name: entry.name }, true);
        }
      }
    }
    if (matched && candidate.original !== candidate.skeleton) reasons.add("lookalike_artist_name");
    if (matched && candidate.claimed) reasons.add("misleading_identity_claim");
    if (kind === "name" && !matched && !ownedMatch && explicitClaim(input)) reasons.add("unreviewed_official_claim");
  }
  return { requiresReview: reasons.size > 0, reasons: [...reasons], matches: [...matches.values()].slice(0, 8),
    identityKey: artistIdentityRiskKey(name || handle) };
}

export function assertMemberIdentityAllowed(database, { name, handle, ownerId = null } = {}) {
  const handleRisk = handle ? assessArtistIdentityRisk(database, { handle, ownerId }) : null;
  const nameRisk = name ? assessArtistIdentityRisk(database, { name, ownerId }) : null;
  const misleadingName = nameRisk?.reasons.some((reason) => ["lookalike_artist_name", "misleading_identity_claim", "unreviewed_official_claim"].includes(reason));
  // Shared personal names are legitimate; artist-like handles/official claims
  // need review. A display name never confers an artist role or ownership.
  if (handleRisk?.requiresReview || misleadingName) {
    throw new ApiError(409, "That artist identity needs review. Choose a personal name and @username for now, then use Artist setup to claim or verify your artist page.", "ARTIST_IDENTITY_REVIEW_REQUIRED");
  }
}
