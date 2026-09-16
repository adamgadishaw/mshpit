// Short-lived directory recovery only. A caller must first prove that exactly
// one provider identity has the requested name; this is never catalog authority.
export const ARTIST_FALLBACK_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const ARTIST_FALLBACK_CACHE_MAX_ROWS = 5_000;
const PREFIX = "dzresolve:v1:";
const NAMESPACE = "key >= 'dzresolve:v1:' AND key < 'dzresolve:v1;'";
const EVICTION_BATCH = 500;
const SAVEPOINT = "pit_artist_fallback_cache_write";

function checkedName(value) {
  if (typeof value !== "string" || value.length > 240) return null;
  const name = value.trim();
  if (!name || [...name].length > 120 || /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(name)) return null;
  const normalized = name.normalize("NFKC").toLowerCase();
  return [...normalized].length <= 120 ? { name, normalized } : null;
}

function checkedArtist(requested, artist) {
  const name = checkedName(artist?.name);
  const id = artist?.deezerId;
  const deezerId = typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? String(id) : id;
  if (!requested || !name || name.normalized !== requested.normalized
      || typeof deezerId !== "string" || !/^[1-9][0-9]{0,15}$/u.test(deezerId)
      || !Number.isSafeInteger(Number(deezerId))) return null;
  return { name: name.name, deezerId };
}

export function isOptionalArtistCacheStorageFailure(error) {
  // Node SQLite reports extended numeric result codes. Match only capacity or
  // read-only failures; corruption, schema errors, and programming bugs surface.
  const code = error?.code === "ERR_SQLITE_ERROR" && Number.isSafeInteger(error?.errcode)
    ? error.errcode & 0xff : null;
  return new Set([5, 6, 8, 13]).has(code); // BUSY, LOCKED, READONLY, FULL
}

export function createArtistFallbackCache(database, { clock = Date.now } = {}) {
  if (typeof database?.prepare !== "function" || typeof database?.exec !== "function" || typeof clock !== "function") {
    throw new TypeError("Artist fallback cache requires SQLite and a clock.");
  }
  let indexedWrites = true;
  try {
    database.exec(`CREATE INDEX IF NOT EXISTS idx_provider_cache_deezer_resolution_recency
      ON provider_cache(updated_at DESC,key ASC) WHERE ${NAMESPACE}`);
  } catch (error) {
    if (!isOptionalArtistCacheStorageFailure(error)) throw error;
    indexedWrites = false;
  }
  const read = database.prepare("SELECT data,updated_at,expires_at FROM provider_cache WHERE key=?");
  const write = database.prepare(`INSERT INTO provider_cache(key,data,updated_at,expires_at) VALUES(?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,expires_at=excluded.expires_at`);
  const trim = indexedWrites ? database.prepare(`DELETE FROM provider_cache WHERE key IN (
    SELECT key FROM provider_cache INDEXED BY idx_provider_cache_deezer_resolution_recency
    WHERE ${NAMESPACE} ORDER BY updated_at DESC,key ASC
    LIMIT ${EVICTION_BATCH} OFFSET ${ARTIST_FALLBACK_CACHE_MAX_ROWS})`) : null;
  const overflow = indexedWrites ? database.prepare(`SELECT 1 FROM provider_cache
    INDEXED BY idx_provider_cache_deezer_resolution_recency WHERE ${NAMESPACE}
    ORDER BY updated_at DESC,key ASC LIMIT 1 OFFSET ${ARTIST_FALLBACK_CACHE_MAX_ROWS}`) : null;
  const now = () => {
    const at = clock();
    return Number.isSafeInteger(at) && at >= 0 && Number.isSafeInteger(at + ARTIST_FALLBACK_CACHE_TTL_MS) ? at : null;
  };

  return Object.freeze({
    get(name) {
      const requested = checkedName(name);
      const at = now();
      if (!requested || at === null) return null;
      let row;
      try { row = read.get(PREFIX + requested.normalized); }
      catch (error) {
        if (isOptionalArtistCacheStorageFailure(error)) return null;
        throw error;
      }
      if (!row || !Number.isSafeInteger(row.updated_at) || row.updated_at < 0
          || row.updated_at > at || row.expires_at !== row.updated_at + ARTIST_FALLBACK_CACHE_TTL_MS
          || row.expires_at <= at || typeof row.data !== "string" || row.data.length > 1_024) return null;
      let value;
      try { value = JSON.parse(row.data); }
      catch { return null; }
      if (!value || typeof value !== "object" || Array.isArray(value)
          || Object.keys(value).length !== 2 || !Object.hasOwn(value, "name") || !Object.hasOwn(value, "deezerId")) return null;
      return checkedArtist(requested, value);
    },
    remember(name, artist) {
      const requested = checkedName(name);
      const value = checkedArtist(requested, artist);
      const at = now();
      if (!indexedWrites || !value || at === null) return false;
      let started = false;
      try {
        database.exec(`SAVEPOINT ${SAVEPOINT}`);
        started = true;
        write.run(PREFIX + requested.normalized, JSON.stringify(value), at, at + ARTIST_FALLBACK_CACHE_TTL_MS);
        trim.run();
        // Normally at most one row is evicted. An externally oversized cache
        // may need more work; do not accept a write that cannot restore the hard
        // cap within one bounded batch, and never touch another cache namespace.
        if (overflow.get()) {
          database.exec(`ROLLBACK TO ${SAVEPOINT}; RELEASE ${SAVEPOINT}`);
          return false;
        }
        database.exec(`RELEASE ${SAVEPOINT}`);
        return true;
      } catch (error) {
        // SQLITE_FULL can automatically roll back the transaction. Otherwise
        // unwind our savepoint before treating the optional cache as unavailable.
        if (started && database.isTransaction) database.exec(`ROLLBACK TO ${SAVEPOINT}; RELEASE ${SAVEPOINT}`);
        if (isOptionalArtistCacheStorageFailure(error)) return false;
        throw error;
      }
    },
  });
}
