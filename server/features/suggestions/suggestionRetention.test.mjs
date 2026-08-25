import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { pruneProductSuggestions } from "./suggestionRetention.js";

test("scheduled suggestion retention removes expired terminal and unresolved bodies", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE product_suggestions (
    id TEXT PRIMARY KEY, client_mutation_id TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
    body TEXT NOT NULL, surface TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, closed_at INTEGER
  )`);
  const day = 24 * 60 * 60 * 1000;
  const at = 500 * day;
  const insert = database.prepare(`INSERT INTO product_suggestions
    (id,client_mutation_id,category,body,surface,status,created_at,updated_at,closed_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  insert.run("sg_closed_old", "sgc_closed_old_123", "idea", "expired closed body", null, "closed", at - 100 * day, at - 100 * day, at - 91 * day);
  insert.run("sg_open_old", "sgc_open_old_12345", "bug", "expired unresolved body", null, "new", at - 366 * day, at - 366 * day, null);
  insert.run("sg_current", "sgc_current_123456", "idea", "keep this body", null, "planned", at - 20 * day, at - 20 * day, null);

  try {
    assert.equal(pruneProductSuggestions({ database, at }), 2);
    assert.deepEqual(database.prepare("SELECT id,body FROM product_suggestions").all().map((row) => ({ ...row })), [
      { id: "sg_current", body: "keep this body" },
    ]);
  } finally {
    database.close();
  }
});
