import {
  LEGACY_ARTIST_DEATH_DATE_CUTOFF,
  isLegacyArtistMemorial,
} from "../src/domain/artistLegacy.mjs";

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
        OR (${table}.artist_key IS NULL
          AND pit_artist_identity(remembered.name)=pit_artist_identity(${table}.artist)
          AND 1=(SELECT COUNT(*) FROM artists exact_artist
            WHERE pit_artist_identity(exact_artist.name)=pit_artist_identity(${table}.artist)))
      )
  )`;
}

// Public archive/directory queries use this narrower policy: modern memorials
// may retain their historical concert record, while the pre-1970 educational
// subset has no per-date service pages. The identity and calendar checks mirror
// artistHasLegacyMemorial so SQL and request-time decisions cannot drift.
export function artistHasNoLegacyMemorialSql(alias = "p") {
  const table = sqlAlias(alias);
  return `NOT EXISTS (
    SELECT 1 FROM artist_memorials memorial
    JOIN artists remembered
      ON remembered.norm=memorial.artist_key AND remembered.mbid=memorial.artist_mbid
    WHERE memorial.status='published' AND memorial.artist_mbid IS NOT NULL
      AND memorial.death_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(memorial.death_date)=memorial.death_date
      AND memorial.death_date<'${LEGACY_ARTIST_DEATH_DATE_CUTOFF}'
      AND (
        (${table}.artist_key IS NOT NULL AND ${table}.artist_key=remembered.norm)
        OR (${table}.artist_key IS NULL
          AND pit_artist_identity(remembered.name)=pit_artist_identity(${table}.artist)
          AND 1=(SELECT COUNT(*) FROM artists exact_artist
            WHERE pit_artist_identity(exact_artist.name)=pit_artist_identity(${table}.artist)))
      )
  )`;
}

const memorialLookupStatements = new WeakMap();
const legacyMemorialLookupStatements = new WeakMap();

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
        AND ((?<>'' AND remembered.norm=?) OR (?='' AND ?<>''
          AND pit_artist_identity(remembered.name)=pit_artist_identity(?)
          AND 1=(SELECT COUNT(*) FROM artists exact_artist
            WHERE pit_artist_identity(exact_artist.name)=pit_artist_identity(?))))
      LIMIT 1`);
    memorialLookupStatements.set(database, statement);
  }
  return !!statement.get(key, key, key, name, name, name);
}

// The shared classifier owns the date boundary; this lookup owns the stronger
// database identity boundary. A stale memorial MBID or ambiguous display name
// can never freeze a different catalog artist.
export function artistHasLegacyMemorial(database, { artistKey = null, artist = null } = {}) {
  if (!database?.prepare) throw new TypeError("Legacy artist visibility requires a database");
  const key = String(artistKey || "").trim().toLocaleLowerCase();
  const name = String(artist || "").trim();
  if (!key && !name) return false;
  let statement = legacyMemorialLookupStatements.get(database);
  if (!statement) {
    statement = database.prepare(`SELECT memorial.status,memorial.death_date
      FROM artist_memorials memorial
      JOIN artists remembered
        ON remembered.norm=memorial.artist_key AND remembered.mbid=memorial.artist_mbid
      WHERE memorial.status='published' AND memorial.artist_mbid IS NOT NULL
        AND ((?<>'' AND remembered.norm=?) OR (?='' AND ?<>''
          AND pit_artist_identity(remembered.name)=pit_artist_identity(?)
          AND 1=(SELECT COUNT(*) FROM artists exact_artist
            WHERE pit_artist_identity(exact_artist.name)=pit_artist_identity(?))))
      LIMIT 1`);
    legacyMemorialLookupStatements.set(database, statement);
  }
  return isLegacyArtistMemorial(statement.get(key, key, key, name, name, name));
}
