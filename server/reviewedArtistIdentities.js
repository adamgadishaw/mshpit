// Narrow, reviewed identity repairs, not an inferred artist roster. These facts
// come from the linked primary source; no dates, photos, genres or ownership are
// inferred. Keep this registry server-only and review every addition explicitly.
export const REVIEWED_ARTIST_IDENTITIES = Object.freeze([
  Object.freeze({
    name: "A$AP Rocky",
    mbid: "25b7b584-d952-4662-a8b9-dd8cdfbfeb64",
    aliases: Object.freeze(["ASAP Rocky"]),
    sourceUrl: "https://musicbrainz.org/artist/25b7b584-d952-4662-a8b9-dd8cdfbfeb64/aliases",
  }),
]);

const exactName = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
const identityId = (value) => typeof value === "string" ? value.toLowerCase() : "";
const ARTIST_COLUMNS = "norm,name,public_slug,search_key,genre,photo,bio,mbid,spotify_id,country,formed,popularity,rank_score,data,source,created_at,updated_at";
const statementsByDatabase = new WeakMap();

function statements(database) {
  let prepared = statementsByDatabase.get(database);
  if (!prepared) {
    prepared = {
      byNorm: database.prepare("SELECT * FROM artists WHERE norm=?"),
      // Two rows suffice to reject ambiguity, and the existing lower(mbid)
      // index bounds this read to the reviewed identity rather than the roster.
      byMbid: database.prepare("SELECT * FROM artists WHERE lower(mbid)=? LIMIT 2"),
    };
    statementsByDatabase.set(database, prepared);
  }
  return prepared;
}

// Add missing identities only. Never UPDATE/upsert: an existing rich row or an
// owner-managed artist profile must remain byte-for-byte unchanged. A matching
// MBID under a different key is already registered, not permission to duplicate
// or rename it. Conflicting identity evidence needs staff review.
export function seedReviewedArtistIdentities(database, {
  makeArtistRow,
  records = REVIEWED_ARTIST_IDENTITIES,
} = {}) {
  if (typeof makeArtistRow !== "function") throw new TypeError("Reviewed identities require an artist row builder");
  if (database.isTransaction) throw new Error("Reviewed identity seeding requires its own transaction");
  const lookup = statements(database);
  const insert = database.prepare(`INSERT INTO artists (${ARTIST_COLUMNS})
    VALUES (${ARTIST_COLUMNS.split(",").map((column) => `@${column}`).join(",")})`);
  const result = { inserted: 0, existing: 0, conflicts: 0 };
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const record of records) {
      const norm = exactName(record.name);
      const mbid = identityId(record.mbid);
      if (!norm || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(mbid)) {
        throw new TypeError("Reviewed artist identity is invalid");
      }
      const current = lookup.byNorm.get(norm);
      const matches = lookup.byMbid.all(mbid);
      if (matches.length > 1 || (current && identityId(current.mbid) !== mbid)) {
        result.conflicts += 1;
      } else if (current || matches.length === 1) {
        result.existing += 1;
      } else {
        const row = makeArtistRow(norm, { ...record }, "reviewed-identity");
        if (row.norm !== norm || identityId(row.mbid) !== mbid || row.name !== record.name) {
          throw new TypeError("Reviewed artist row does not match its identity");
        }
        insert.run(row);
        result.inserted += 1;
      }
    }
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* architecture: allow-empty-catch -- the original seed failure is rethrown below. */ }
    throw error;
  }
}

// Callers first try their existing exact catalog key/public slug. Only explicit
// reviewed names and aliases can use this fallback: never fuzzy/punctuation
// matching, never create a row on GET, never pick between duplicate MBIDs.
export function resolveReviewedArtistAlias(database, value, { records = REVIEWED_ARTIST_IDENTITIES } = {}) {
  const requested = exactName(value);
  if (!requested || requested.length > 200) return null;
  const identities = new Set(records.filter((record) =>
    [record.name, ...(record.aliases || [])].some((name) => exactName(name) === requested))
    .map((record) => identityId(record.mbid)));
  if (identities.size !== 1) return null;
  const matches = statements(database).byMbid.all(identities.values().next().value);
  return matches.length === 1 ? matches[0] : null;
}
