import assert from "node:assert/strict";
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
