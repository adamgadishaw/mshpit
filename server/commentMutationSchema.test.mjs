import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensureCommentMutationSchema } from "./commentMutationSchema.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE comments(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,text TEXT NOT NULL);
    INSERT INTO comments VALUES('legacy-comment','author-one','Retained legacy body')`);
  return db;
}

test("comment retry migration is additive, repeatable and compatible with old writers", () => {
  const db = fixture();
  try {
    ensureCommentMutationSchema(db);
    ensureCommentMutationSchema(db);
    db.prepare("INSERT INTO comments(id,user_id,text) VALUES(?,?,?)").run("old-writer", "author-one", "Old writer still works");
    assert.deepEqual({ ...db.prepare("SELECT * FROM comments WHERE id='legacy-comment'").get() }, {
      id: "legacy-comment", user_id: "author-one", text: "Retained legacy body", client_mutation_id: null, client_mutation_hash: null,
    });
    assert.equal(db.prepare("SELECT COUNT(*) count FROM comments").get().count, 2);
    assert.equal(db.isTransaction, false);
  } finally { db.close(); }
});

test("comment retry schema bounds metadata and enforces per-author uniqueness", () => {
  const db = fixture();
  try {
    ensureCommentMutationSchema(db);
    const insert = db.prepare("INSERT INTO comments VALUES(?,?,?,?,?)");
    insert.run("first", "author-one", "Body", "retry_key_123", "a".repeat(64));
    assert.throws(() => insert.run("collision", "author-one", "Changed", "retry_key_123", "b".repeat(64)), /UNIQUE constraint/);
    insert.run("other-author", "author-two", "Body", "retry_key_123", "a".repeat(64));
    for (const id of ["short", "key with space", "x".repeat(101)]) {
      assert.throws(() => insert.run("invalid-key", "author-one", "Body", id, "a".repeat(64)), /CHECK constraint/);
    }
    for (const hash of ["short", "z".repeat(64), "a".repeat(65)]) {
      assert.throws(() => insert.run("invalid-hash", "author-one", "Body", "other_key_123", hash), /CHECK constraint/);
    }
  } finally { db.close(); }
});

test("comment schema changes participate in an existing caller transaction", () => {
  const db = fixture();
  try {
    db.exec("BEGIN IMMEDIATE");
    ensureCommentMutationSchema(db);
    assert.equal(db.isTransaction, true);
    db.exec("ROLLBACK");
    assert.deepEqual(db.prepare("PRAGMA table_info(comments)").all().map((row) => row.name), ["id", "user_id", "text"]);
  } finally { db.close(); }
});
