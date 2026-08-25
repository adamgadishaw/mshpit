import { ARTIST_MEMORIAL_SPOTLIGHT_MS } from "../../../src/domain/artistMemorial.mjs";

const MEMORIAL_COLUMNS = `artist_key,artist_mbid,artist_name,status,death_date,summary,thank_you,
  accomplishments,source_url,source_title,published_at,spotlight_started_at,
  created_at,updated_at`;

const INSERT_COLUMNS = [
  "artist_key", "artist_mbid", "artist_name", "status", "death_date", "summary", "thank_you",
  "accomplishments", "source_url", "source_title", "published_at", "spotlight_started_at",
  "created_at", "updated_at",
];
const UPDATE_COLUMNS = INSERT_COLUMNS.filter((column) => !["artist_key", "created_at"].includes(column));
const LEGACY_COLUMNS = ["source_hostname", "source_verified_at", "first_published_at", "spotlight_ends_at"];

function legacyValue(column, record) {
  if (column === "source_hostname") return new URL(record.sourceUrl).hostname.toLowerCase();
  if (column === "source_verified_at") return record.updatedAt;
  if (column === "first_published_at") return record.publishedAt;
  if (column === "spotlight_ends_at") {
    return record.spotlightStartedAt == null
      ? null
      : record.spotlightStartedAt + ARTIST_MEMORIAL_SPOTLIGHT_MS;
  }
  throw new TypeError("Unsupported legacy artist memorial column");
}

export function createArtistMemorialRepository(database) {
  if (!database?.prepare || typeof database.exec !== "function") {
    throw new TypeError("Artist memorials require a database");
  }

  const byArtistKey = database.prepare(`SELECT ${MEMORIAL_COLUMNS}
    FROM artist_memorials WHERE artist_key=?`);
  const presentColumns = new Set(database.prepare("PRAGMA table_info(artist_memorials)").all()
    .map((entry) => String(entry.name).toLowerCase()));
  const legacyColumns = LEGACY_COLUMNS.filter((column) => presentColumns.has(column));
  const persistedColumns = [...INSERT_COLUMNS, ...legacyColumns];
  const updatedColumns = [...UPDATE_COLUMNS, ...legacyColumns];
  const upsertStatement = database.prepare(`INSERT INTO artist_memorials (
      ${persistedColumns.join(",")}
    ) VALUES (${persistedColumns.map(() => "?").join(",")})
    ON CONFLICT(artist_key) DO UPDATE SET
      ${updatedColumns.map((column) => `${column}=excluded.${column}`).join(",")}`);
  const listStatements = new Map();
  const searchStatements = new Map();
  const publishedByKeysStatements = new Map();

  function listStatement({ status, query }) {
    const cacheKey = `${status ? 1 : 0}:${query ? 1 : 0}`;
    if (listStatements.has(cacheKey)) return listStatements.get(cacheKey);
    const where = [];
    if (status) where.push("status=?");
    if (query) where.push("INSTR(LOWER(artist_name),LOWER(?))>0");
    const statement = database.prepare(`SELECT ${MEMORIAL_COLUMNS}
      FROM artist_memorials
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY updated_at DESC,artist_key ASC LIMIT ?`);
    listStatements.set(cacheKey, statement);
    return statement;
  }

  function searchStatement(query) {
    const cacheKey = query ? "query" : "all";
    if (searchStatements.has(cacheKey)) return searchStatements.get(cacheKey);
    const statement = database.prepare(`SELECT ${MEMORIAL_COLUMNS}
      FROM artist_memorials
      WHERE status='published' ${query ? "AND INSTR(LOWER(artist_name),LOWER(?))>0" : ""}
      ORDER BY artist_name COLLATE NOCASE ASC,artist_key ASC LIMIT ?`);
    searchStatements.set(cacheKey, statement);
    return statement;
  }

  function publishedByKeysStatement(count) {
    if (publishedByKeysStatements.has(count)) return publishedByKeysStatements.get(count);
    const placeholders = Array.from({ length: count }, () => "?").join(",");
    const statement = database.prepare(`SELECT ${MEMORIAL_COLUMNS}
      FROM artist_memorials WHERE status='published' AND artist_key IN (${placeholders})`);
    publishedByKeysStatements.set(count, statement);
    return statement;
  }

  return Object.freeze({
    findByArtistKey(artistKey) {
      return byArtistKey.get(artistKey) || null;
    },

    listAdmin({ status = null, query = null, limit = 50 } = {}) {
      const args = [];
      if (status) args.push(status);
      if (query) args.push(query);
      args.push(limit);
      return listStatement({ status, query }).all(...args);
    },

    findPublishedForSearch({ query = null, limit = 20 } = {}) {
      return searchStatement(query).all(...(query ? [query, limit] : [limit]));
    },

    findPublishedByArtistKeys(artistKeys) {
      if (!Array.isArray(artistKeys) || artistKeys.length === 0) return [];
      return publishedByKeysStatement(artistKeys.length).all(...artistKeys);
    },

    upsert(record) {
      const values = [
        record.artistKey,
        record.artistMbid,
        record.artistName,
        record.status,
        record.deathDate,
        record.summary,
        record.thankYou,
        JSON.stringify(record.accomplishments),
        record.sourceUrl,
        record.sourceTitle,
        record.publishedAt,
        record.spotlightStartedAt,
        record.createdAt,
        record.updatedAt,
        ...legacyColumns.map((column) => legacyValue(column, record)),
      ];
      upsertStatement.run(...values);
      return byArtistKey.get(record.artistKey) || null;
    },

    transaction(work) {
      if (typeof work !== "function") throw new TypeError("Artist memorial transactions require work");
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          database.exec("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Artist memorial transaction and rollback both failed");
        }
        throw error;
      }
    },
  });
}
