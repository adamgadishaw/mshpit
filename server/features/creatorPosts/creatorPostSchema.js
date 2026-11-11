import { withImmediateWrite } from "../../databaseTransaction.js";

export function ensureCreatorPostSchema(db) {
  return withImmediateWrite(db, () => {
    if (!db.prepare("PRAGMA table_info(posts)").all().some(row => row.name === "creator_update")) {
      db.exec("ALTER TABLE posts ADD COLUMN creator_update TEXT CHECK(creator_update IS NULL OR json_valid(creator_update))");
    }
    // Only a reviewed claim/ownership service may populate this registry. There
    // is deliberately no public create/grant endpoint in the posting feature.
    db.exec(`CREATE TABLE IF NOT EXISTS creator_entities (
      entity_type TEXT NOT NULL CHECK(entity_type IN ('venue','event')),
      entity_key TEXT NOT NULL, name TEXT NOT NULL,
      owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','held','removed')),
      PRIMARY KEY(entity_type,entity_key)
    );
    CREATE INDEX IF NOT EXISTS idx_creator_entities_owner ON creator_entities(owner_id,entity_type);
    CREATE TABLE IF NOT EXISTS creator_follows (
      account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('artist','venue','event')), entity_key TEXT NOT NULL,
      following INTEGER NOT NULL DEFAULT 1 CHECK(following IN (0,1)),
      notify_updates INTEGER NOT NULL DEFAULT 1 CHECK(notify_updates IN (0,1)),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(account_id,entity_type,entity_key)
    );
    CREATE INDEX IF NOT EXISTS idx_creator_followers ON creator_follows(entity_type,entity_key,following,notify_updates,account_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_post_notice ON notifications(user_id,post_id) WHERE type='creator_update';
    CREATE INDEX IF NOT EXISTS idx_creator_posts_entity ON posts(json_extract(creator_update,'$.entityType'),json_extract(creator_update,'$.entityKey'),created_at DESC,id DESC)
      WHERE creator_update IS NOT NULL AND removed=0;`);
  });
}
