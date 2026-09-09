import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { withImmediateWrite } from "./databaseTransaction.js";

function fakeDatabase({ isTransaction = false, rollbackThrows = false } = {}) {
  const statements = [];
  return {
    isTransaction,
    statements,
    exec(sql) {
      statements.push(sql);
      if (rollbackThrows && sql === "ROLLBACK") throw new Error("rollback failed");
    },
  };
}

test("withImmediateWrite begins and commits an owned transaction", () => {
  const database = fakeDatabase();
  const value = withImmediateWrite(database, () => "saved");
  assert.equal(value, "saved");
  assert.deepEqual(database.statements, ["BEGIN IMMEDIATE", "COMMIT"]);
});

test("withImmediateWrite reuses a caller-owned transaction", () => {
  const database = fakeDatabase({ isTransaction: true });
  const value = withImmediateWrite(database, () => 42);
  assert.equal(value, 42);
  assert.deepEqual(database.statements, []);
});

test("withImmediateWrite rolls back and preserves the action error", () => {
  const database = fakeDatabase();
  const failure = new Error("write failed");
  assert.throws(() => withImmediateWrite(database, () => { throw failure; }), (error) => error === failure);
  assert.deepEqual(database.statements, ["BEGIN IMMEDIATE", "ROLLBACK"]);
});

test("withImmediateWrite does not mask an action error when rollback also fails", () => {
  const database = fakeDatabase({ rollbackThrows: true });
  const failure = new Error("write failed");
  assert.throws(() => withImmediateWrite(database, () => { throw failure; }), (error) => error === failure);
  assert.deepEqual(database.statements, ["BEGIN IMMEDIATE", "ROLLBACK"]);
});

test("real SQLite rolls back every member mutation after an action failure", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE members (id TEXT PRIMARY KEY); CREATE TABLE notes (id TEXT PRIMARY KEY, member_id TEXT REFERENCES members(id))");
  try {
    const failure = new Error("second write failed");
    assert.throws(() => withImmediateWrite(database, () => {
      database.exec("INSERT INTO members VALUES ('member'); INSERT INTO notes VALUES ('note', 'member')");
      throw failure;
    }), (error) => error === failure);
    assert.equal(database.isTransaction, false);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM members").get().n, 0);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM notes").get().n, 0);
  } finally { database.close(); }
});

test("a deferred foreign-key failure during COMMIT also rolls back the owned transaction", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON; CREATE TABLE members (id TEXT PRIMARY KEY); CREATE TABLE notes (id TEXT PRIMARY KEY, member_id TEXT REFERENCES members(id) DEFERRABLE INITIALLY DEFERRED)");
  try {
    assert.throws(() => withImmediateWrite(database, () => {
      database.exec("INSERT INTO notes VALUES ('note', 'missing-member')");
    }), /FOREIGN KEY constraint failed/);
    assert.equal(database.isTransaction, false);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM notes").get().n, 0);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { database.close(); }
});
