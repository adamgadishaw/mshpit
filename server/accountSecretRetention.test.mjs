import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { pruneExpiredAccountSecrets } from "./accountSecretRetention.js";

test("expired recovery and verification capabilities are removed without new traffic", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY,email_verify_hash TEXT,email_verify_expires INTEGER,reset_hash TEXT,reset_expires INTEGER);
    CREATE TABLE email_verification_receipts (token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
    INSERT INTO users VALUES ('old','verify-old',10,'reset-old',10),('fresh','verify-fresh',30,'reset-fresh',30);
    INSERT INTO email_verification_receipts VALUES ('old-receipt',10),('fresh-receipt',30);
  `);
  assert.deepEqual(pruneExpiredAccountSecrets(database, 20), {
    verificationTokens: 1,
    resetTokens: 1,
    verificationReceipts: 1,
  });
  const old = database.prepare("SELECT * FROM users WHERE id='old'").get();
  assert.equal(old.email_verify_hash, null);
  assert.equal(old.reset_hash, null);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM email_verification_receipts").get().count, 1);
  database.close();
});
