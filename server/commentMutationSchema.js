import { withImmediateWrite } from "./databaseTransaction.js";

// Retry metadata is bounded to one key/hash per retained comment, not an
// independent receipt log. It follows the comment's existing author/post
// cascades. Soft removal deliberately retains the key: expiring it would let a
// delayed retry silently republish content. No extra copy of the body is kept.
export function ensureCommentMutationSchema(database) {
  return withImmediateWrite(database, () => {
    const columns = new Set(database.prepare("PRAGMA table_info(comments)").all().map((row) => row.name));
    if (!columns.size) throw new Error("Comments table is required for retry identity migration");
    if (!columns.has("client_mutation_id")) database.exec(`ALTER TABLE comments ADD COLUMN client_mutation_id TEXT
      CHECK (client_mutation_id IS NULL OR (length(client_mutation_id) BETWEEN 8 AND 100
        AND client_mutation_id NOT GLOB '*[^A-Za-z0-9_-]*'))`);
    if (!columns.has("client_mutation_hash")) database.exec(`ALTER TABLE comments ADD COLUMN client_mutation_hash TEXT
      CHECK (client_mutation_hash IS NULL OR (length(client_mutation_hash)=64
        AND client_mutation_hash NOT GLOB '*[^a-f0-9]*'))`);
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_client_mutation
      ON comments(user_id,client_mutation_id) WHERE client_mutation_id IS NOT NULL`);
  });
}
