import { MEDIA_POST_MAX_ATTACHMENTS } from "../src/domain/mediaUploadPolicy.mjs";

export const POST_MEDIA_MAX_POSITION = MEDIA_POST_MAX_ATTACHMENTS - 1;

function positionCheck(maximum) {
  return new RegExp(
    `CHECK\\s*\\(\\s*position\\s+BETWEEN\\s+0\\s+AND\\s+${maximum}\\s*\\)`,
    "iu",
  );
}

function postMediaTableSql(tableName) {
  return `CREATE TABLE ${tableName} (
    post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    asset_id   TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL CHECK (position BETWEEN 0 AND ${POST_MEDIA_MAX_POSITION}),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, position),
    UNIQUE (asset_id)
  )`;
}

// This is a rollback-compatible constraint relaxation: the table shape, keys,
// column types, and row identities do not change, while an older binary can
// continue reading/writing positions 0..7 after the current binary admits 0..19.
// The caller holds BEGIN IMMEDIATE, so a failed copy/drop/rename rolls back as a
// unit and no API process can observe a half-migrated table.
export function ensurePostMediaCapacity(database) {
  const table = database.prepare(`SELECT sql FROM sqlite_master
    WHERE type='table' AND name='post_media'`).get();
  const sql = String(table?.sql || "");
  if (!sql) throw new Error("post_media schema is missing");
  if (positionCheck(POST_MEDIA_MAX_POSITION).test(sql)) {
    return { migrated: false, rowCount: Number(database.prepare("SELECT COUNT(*) count FROM post_media").get().count) };
  }
  if (!positionCheck(7).test(sql)) {
    throw new Error("post_media has an unexpected position constraint; refusing an unsafe rebuild");
  }

  const expectedColumns = ["post_id", "asset_id", "position", "created_at"];
  const columns = database.prepare("PRAGMA table_info(post_media)").all().map((entry) => String(entry.name));
  if (columns.join("|") !== expectedColumns.join("|")) {
    throw new Error("post_media has an unexpected table shape; refusing an unsafe rebuild");
  }
  const invalid = database.prepare(`SELECT post_id,position FROM post_media
    WHERE position < 0 OR position > ? ORDER BY post_id,position LIMIT 1`).get(POST_MEDIA_MAX_POSITION);
  if (invalid) throw new Error(`post_media contains an out-of-range position: ${invalid.post_id}:${invalid.position}`);

  const rowCount = Number(database.prepare("SELECT COUNT(*) count FROM post_media").get().count);
  database.exec(postMediaTableSql("post_media_capacity_v2"));
  database.exec(`INSERT INTO post_media_capacity_v2 (post_id,asset_id,position,created_at)
    SELECT post_id,asset_id,position,created_at FROM post_media ORDER BY post_id,position`);
  const copiedCount = Number(database.prepare("SELECT COUNT(*) count FROM post_media_capacity_v2").get().count);
  if (copiedCount !== rowCount) throw new Error("post_media capacity rebuild did not preserve every row");

  database.exec(`
    DROP TABLE post_media;
    ALTER TABLE post_media_capacity_v2 RENAME TO post_media;
    CREATE INDEX idx_post_media_asset ON post_media(asset_id);
  `);
  const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check(post_media)").all();
  if (foreignKeyErrors.length > 0) throw new Error("post_media capacity rebuild failed its foreign-key check");
  return { migrated: true, rowCount };
}