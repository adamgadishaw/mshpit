const sqlAlias = (value) => {
  const alias = String(value || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError("Invalid tour-date SQL alias");
  return alias;
};

// A memorial is a permanent public identity fact only after publication and
// only while its immutable MusicBrainz identity still matches the catalog row.
// Name-only legacy tour dates are suppressed solely when that display name is
// unique, preventing a same-named act from inheriting another artist's death.
export function tourDateHasNoPublishedMemorialSql(alias = "td") {
  const table = sqlAlias(alias);
  return `NOT EXISTS (
    SELECT 1 FROM artist_memorials memorial
    JOIN artists remembered
      ON remembered.norm=memorial.artist_key AND remembered.mbid=memorial.artist_mbid
    WHERE memorial.status='published' AND memorial.artist_mbid IS NOT NULL
      AND (
        (${table}.artist_key IS NOT NULL AND ${table}.artist_key=remembered.norm)
        OR (${table}.artist_key IS NULL AND remembered.name=${table}.artist COLLATE NOCASE
          AND 1=(SELECT COUNT(*) FROM artists exact_artist
            WHERE exact_artist.name=${table}.artist COLLATE NOCASE))
      )
  )`;
}

const memorialLookupStatements = new WeakMap();

export function artistHasPublishedMemorial(database, { artistKey = null, artist = null } = {}) {
  if (!database?.prepare) throw new TypeError("Memorial visibility requires a database");
  const key = String(artistKey || "").trim().toLocaleLowerCase();
  const name = String(artist || "").trim();
  if (!key && !name) return false;
  let statement = memorialLookupStatements.get(database);
  if (!statement) {
    statement = database.prepare(`SELECT 1 FROM artist_memorials memorial
      JOIN artists remembered
        ON remembered.norm=memorial.artist_key AND remembered.mbid=memorial.artist_mbid
      WHERE memorial.status='published' AND memorial.artist_mbid IS NOT NULL
        AND ((?<>'' AND remembered.norm=?) OR (?='' AND ?<>'' AND remembered.name=? COLLATE NOCASE
          AND 1=(SELECT COUNT(*) FROM artists exact_artist
            WHERE exact_artist.name=? COLLATE NOCASE)))
      LIMIT 1`);
    memorialLookupStatements.set(database, statement);
  }
  return !!statement.get(key, key, key, name, name, name);
}
