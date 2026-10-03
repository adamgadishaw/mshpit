import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensureSignupReservationsSchema, prepareSignupReservation, consumeSignupReservation,
  cancelSignupReservation, pruneExpiredSignupReservations, SIGNUP_RESERVATION_TTL_MS } from "./signupReservations.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,pass_hash TEXT,role TEXT,email_verified_at INTEGER,is_banned INTEGER DEFAULT 0,suspended_until INTEGER,dormant_at INTEGER);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),created_at INTEGER,expires_at INTEGER);`);
  ensureSignupReservationsSchema(database); ensureSignupReservationsSchema(database);
  return database;
}
function transaction(database, work) {
  database.exec("BEGIN IMMEDIATE");
  try { const result = work(); database.exec("COMMIT"); return result; }
  catch (error) { database.exec("ROLLBACK"); throw error; }
}
const payload = { email: "pending@example.test", name: "Pending", passwordHash: "synthetic-scrypt-record" };
const prepare = (db, extra = {}) => transaction(db, () => prepareSignupReservation(db, { payload, cancelToken: "cancel", at: 1000, ...extra }));
const consume = (db, reservation, extra = {}) => transaction(db, () => consumeSignupReservation(db, {
  tokenHash: reservation.tokenHash, at: 1001, sessionTtlForRole: () => 10000,
  createAccount(data) { db.prepare("INSERT INTO users(id,email) VALUES (?,?)").run("created", data.email); return { id: "created", email: data.email }; }, ...extra,
}));

test("reservations are independent, hash-only, expiring, and never occupy durable account capacity", () => {
  const db = fixture();
  try {
    const a = prepare(db), b = prepare(db, { cancelToken: "other" });
    assert.notEqual(a.token, b.token);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, 0);
    const row = db.prepare("SELECT * FROM signup_reservations WHERE token_hash=?").get(a.tokenHash);
    assert.equal(row.token_hash, hash(a.token)); assert.equal(row.cancel_hash, hash("cancel"));
    assert.ok(!JSON.stringify(row).includes(a.token));
    assert.equal(consume(db, a, { at: 1000 + SIGNUP_RESERVATION_TTL_MS }), null, "exact expiry rejects without a pruning pass");
    assert.equal(pruneExpiredSignupReservations(db, 1000 + SIGNUP_RESERVATION_TTL_MS), 2);
    assert.equal(consume(db, a), null);
  } finally { db.close(); }
});

test("cancel affects only its submission, and consumed/superseded submissions cannot resurrect after email reuse", () => {
  const db = fixture();
  try {
    const a = prepare(db), b = prepare(db, { cancelToken: "other" }), c = prepare(db, { cancelToken: "third" });
    assert.equal(cancelSignupReservation(db, hash("third")), true);
    assert.equal(cancelSignupReservation(db, hash("third")), false);
    assert.equal(consume(db, c), null);
    assert.equal(consume(db, a).user.id, "created");
    db.exec("DELETE FROM users");
    assert.deepEqual(consume(db, b), { blocked: "account_exists" });
    assert.equal(db.prepare("SELECT payload FROM signup_reservations").get().payload, "{}");
  } finally { db.close(); }
});

test("creation failure rolls back reservation consumption and retains an exact retry", () => {
  const db = fixture();
  try {
    const reservation = prepare(db);
    assert.throws(() => consume(db, reservation, { createAccount() { throw new Error("write failed"); } }), /write failed/);
    assert.equal(db.prepare("SELECT status FROM signup_reservations").get().status, "pending");
    assert.equal(consume(db, reservation).user.id, "created");
  } finally { db.close(); }
});

test("legacy occupied emails stay unchanged; later occupation blocks anonymous consumption", () => {
  const db = fixture();
  try {
    const reservation = prepare(db);
    db.prepare("INSERT INTO users(id,email) VALUES (?,?)").run("legacy", payload.email);
    const before = db.prepare("SELECT * FROM users").all();
    ensureSignupReservationsSchema(db);
    assert.deepEqual(db.prepare("SELECT * FROM users").all(), before, "repeated schema initialization preserves existing rows");
    assert.equal(prepare(db, { cancelToken: "other" }), null);
    assert.deepEqual(consume(db, reservation), { blocked: "account_exists" });
    assert.equal(db.prepare("SELECT id FROM users").get().id, "legacy");
  } finally { db.close(); }
});

test("additional-account authorization rejects credential, role, restriction and original-session changes", () => {
  for (const mode of ["password", "role", "unverified", "banned", "suspended", "dormant", "expired", "logout"]) {
    const db = fixture();
    try {
      db.prepare("INSERT INTO users(id,email,pass_hash,role,email_verified_at) VALUES (?,?,?,?,?)")
        .run("actor", payload.email, "proof", "fan", 1);
      db.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run(hash("session"), "actor", 1000, 10000);
      const actor = db.prepare("SELECT * FROM users").get();
      const reservation = prepare(db, { actor, sessionToken: "session" });
      if (mode === "password") db.exec("UPDATE users SET pass_hash='changed'");
      if (mode === "role") db.exec("UPDATE users SET role='admin'");
      if (mode === "unverified") db.exec("UPDATE users SET email_verified_at=0");
      if (mode === "banned") db.exec("UPDATE users SET is_banned=1");
      if (mode === "suspended") db.exec("UPDATE users SET suspended_until=10000");
      if (mode === "dormant") db.exec("UPDATE users SET dormant_at=1");
      if (mode === "expired") db.exec("UPDATE sessions SET expires_at=1001");
      if (mode === "logout") db.exec("DELETE FROM sessions");
      assert.deepEqual(consume(db, reservation), mode === "logout" ? null : { blocked: "authorization_changed" }, mode);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, 1);
    } finally { db.close(); }
  }
});
