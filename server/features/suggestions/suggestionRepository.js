const SUGGESTION_COLUMNS = `id,client_mutation_id,category,body,surface,status,
  created_at,updated_at,closed_at`;

export function createSuggestionRepository(database) {
  if (!database?.prepare || typeof database.exec !== "function") {
    throw new TypeError("Product suggestions require a database");
  }

  const byId = database.prepare(`SELECT ${SUGGESTION_COLUMNS} FROM product_suggestions WHERE id=?`);
  const byMutationId = database.prepare(`SELECT ${SUGGESTION_COLUMNS}
    FROM product_suggestions WHERE client_mutation_id=?`);
  const insert = database.prepare(`INSERT INTO product_suggestions
    (id,client_mutation_id,category,body,surface,status,created_at,updated_at,closed_at)
    VALUES (?,?,?,?,?,'new',?,?,NULL)
    ON CONFLICT(client_mutation_id) DO NOTHING`);
  const updateStatus = database.prepare(`UPDATE product_suggestions
    SET status=?,updated_at=?,closed_at=? WHERE id=?`);
  const pruneExpired = database.prepare(`DELETE FROM product_suggestions
    WHERE (closed_at IS NOT NULL AND closed_at<?)
       OR (closed_at IS NULL AND created_at<?)`);
  const listStatements = new Map();

  function listStatement({ status, category, before }) {
    const cacheKey = `${status ? 1 : 0}:${category ? 1 : 0}:${before ? 1 : 0}`;
    if (listStatements.has(cacheKey)) return listStatements.get(cacheKey);
    const where = [];
    if (status) where.push("status=?");
    if (category) where.push("category=?");
    if (before) where.push("(created_at<? OR (created_at=? AND id<?))");
    const statement = database.prepare(`SELECT ${SUGGESTION_COLUMNS} FROM product_suggestions
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC,id DESC LIMIT ?`);
    listStatements.set(cacheKey, statement);
    return statement;
  }

  return Object.freeze({
    findById(id) {
      return byId.get(id) || null;
    },

    findByMutationId(clientMutationId) {
      return byMutationId.get(clientMutationId) || null;
    },

    insertSuggestion({ id, clientMutationId, category, body, surface = null, at }) {
      const inserted = insert.run(id, clientMutationId, category, body, surface, at, at).changes === 1;
      return {
        inserted,
        row: byMutationId.get(clientMutationId) || null,
      };
    },

    listSuggestions({ status = null, category = null, before = null, limit }) {
      const args = [];
      if (status) args.push(status);
      if (category) args.push(category);
      if (before) args.push(before.createdAt, before.createdAt, before.id);
      args.push(limit);
      return listStatement({ status, category, before }).all(...args);
    },

    updateStatus({ id, status, updatedAt, closedAt }) {
      const changed = updateStatus.run(status, updatedAt, closedAt, id).changes === 1;
      return changed ? byId.get(id) || null : null;
    },

    prune({ closedBefore, unresolvedBefore }) {
      return pruneExpired.run(closedBefore, unresolvedBefore).changes;
    },

    transaction(work) {
      if (typeof work !== "function") throw new TypeError("Suggestion transactions require work");
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          database.exec("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Suggestion transaction and rollback both failed");
        }
        throw error;
      }
    },
  });
}
