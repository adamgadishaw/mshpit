export function ensureArtistAccessRetentionTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS artist_access_revocations (
    id TEXT PRIMARY KEY,artist_key TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,
    profile_json TEXT NOT NULL CHECK(json_valid(profile_json)),review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','reviewed'))
  );
  CREATE INDEX IF NOT EXISTS idx_artist_access_revocations_key ON artist_access_revocations(artist_key,created_at DESC);
  CREATE TABLE IF NOT EXISTS artist_access_retained_content (
    revocation_id TEXT NOT NULL REFERENCES artist_access_revocations(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK(target_type IN ('post','artist_post','tour_date')),target_id TEXT NOT NULL,
    record_json TEXT NOT NULL CHECK(json_valid(record_json)),PRIMARY KEY(revocation_id,target_type,target_id)
  );
  CREATE INDEX IF NOT EXISTS idx_artist_access_retained_target ON artist_access_retained_content(target_type,target_id);
  CREATE TABLE IF NOT EXISTS artist_access_retained_media (
    revocation_id TEXT NOT NULL REFERENCES artist_access_revocations(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,url TEXT NOT NULL,object_key TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(revocation_id,url,object_key)
  );
  CREATE INDEX IF NOT EXISTS idx_artist_access_retained_media_key ON artist_access_retained_media(owner_id,object_key);
  CREATE TABLE IF NOT EXISTS artist_access_profile_items (
    revocation_id TEXT NOT NULL REFERENCES artist_access_revocations(id) ON DELETE CASCADE,
    slot TEXT NOT NULL CHECK(slot IN ('bio','avatar','banner')),value TEXT NOT NULL,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    publication TEXT NOT NULL DEFAULT 'hidden' CHECK(publication IN ('hidden','public')),
    original_public INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(revocation_id,slot)
  );`);
  const add = (table, name, definition) => {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) return;
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  add("artist_access_retained_content", "publication", "TEXT NOT NULL DEFAULT 'hidden' CHECK(publication IN ('hidden','public'))");
  add("artist_access_retained_content", "original_public", "INTEGER NOT NULL DEFAULT 0");
  add("artist_access_retained_content", "revision", "INTEGER NOT NULL DEFAULT 1");
  add("artist_access_retained_content", "superseded", "INTEGER NOT NULL DEFAULT 0");
  add("artist_profiles", "bio_author_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  add("artist_profiles", "avatar_owner_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  add("artist_profiles", "banner_owner_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  for (const slot of ["bio", "avatar", "banner"]) add("artist_profiles", `${slot}_retention_id`, "TEXT REFERENCES artist_access_revocations(id) ON DELETE SET NULL");
  add("artist_profiles", "publication_author_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  add("artist_profiles", "publication_revocation_id", "TEXT REFERENCES artist_access_revocations(id) ON DELETE SET NULL");
}

export function ensureArtistAccessRetentionSchema(db) {
  ensureArtistAccessRetentionTables(db);
  db.exec(`DROP TRIGGER IF EXISTS artist_access_keep_posts_withheld;
  DROP TRIGGER IF EXISTS artist_access_keep_artist_posts_withheld;
  CREATE TRIGGER artist_access_keep_posts_withheld BEFORE UPDATE OF removed ON posts
    WHEN NEW.removed=0 AND EXISTS(SELECT 1 FROM artist_access_retained_content c JOIN artist_access_revocations r ON r.id=c.revocation_id
      WHERE c.target_type='post' AND c.target_id=NEW.id AND c.publication='hidden' AND c.superseded=0)
    BEGIN SELECT RAISE(ABORT,'Artist access content requires retained-content review'); END;
  CREATE TRIGGER artist_access_keep_artist_posts_withheld BEFORE UPDATE OF removed ON artist_posts
    WHEN NEW.removed=0 AND EXISTS(SELECT 1 FROM artist_access_retained_content c JOIN artist_access_revocations r ON r.id=c.revocation_id
      WHERE c.target_type='artist_post' AND c.target_id=NEW.id AND c.publication='hidden' AND c.superseded=0)
    BEGIN SELECT RAISE(ABORT,'Artist access content requires retained-content review'); END;
  CREATE TRIGGER IF NOT EXISTS artist_access_erase_published_profile BEFORE DELETE ON artist_access_revocations
    BEGIN UPDATE artist_profiles SET
      bio=CASE WHEN bio_retention_id=OLD.id THEN NULL ELSE bio END,
      avatar_uri=CASE WHEN avatar_retention_id=OLD.id THEN NULL ELSE avatar_uri END,
      banner=CASE WHEN banner_retention_id=OLD.id THEN NULL ELSE banner END
      WHERE bio_retention_id=OLD.id OR avatar_retention_id=OLD.id OR banner_retention_id=OLD.id; END;`);
}

export function retainedArtistMedia(db, { ownerId, key = null, url = null }) {
  // Older isolated fixtures may intentionally omit the feature schema.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='artist_access_retained_media'").get()) return false;
  return !!db.prepare(`SELECT 1 FROM artist_access_retained_media
    WHERE owner_id=? AND ((? IS NOT NULL AND object_key=?) OR (? IS NOT NULL AND url=?)) LIMIT 1`)
    .get(ownerId, key, key, url, url);
}

export const withheldArtistTourDateSql = alias => `NOT EXISTS (
  SELECT 1 FROM artist_access_retained_content held_date JOIN artist_access_revocations held_access ON held_access.id=held_date.revocation_id
  WHERE held_date.target_type='tour_date' AND held_date.target_id=${alias}.id AND held_date.publication='hidden' AND held_date.superseded=0)`;
