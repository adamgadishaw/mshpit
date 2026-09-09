import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-password-async-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
const { db } = await import("./db.js");
const { hashPassword, hashPasswordAsync, verifyPassword, verifyPasswordAsync, verifyPasswordForUserAsync } = await import("./auth.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

test("async password checks preserve existing exact-password hashes and Unicode", async () => {
  const password = "Exact Password-é1 ";
  const existing = hashPassword(password);
  assert.equal(await verifyPasswordAsync(password, existing), true);
  assert.equal(await verifyPasswordAsync(password.trim(), existing), false);
  assert.equal(await verifyPasswordAsync("wrong", existing), false);
  assert.equal(await verifyPasswordForUserAsync(password, undefined), false);
  assert.equal(await verifyPasswordAsync("a".repeat(101), existing), false);
  assert.equal(await verifyPasswordAsync(password, "scrypt:bad:record"), false);
  const replacement = await hashPasswordAsync(password);
  assert.equal(verifyPassword(password, replacement), true);
});

test("password hashing leaves the main event loop available while workers run", async () => {
  let completed = 0;
  const jobs = Array.from({ length: 10 }, () => hashPasswordAsync("Concurrent-test1").then(() => { completed++; }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(completed < jobs.length, "the main loop must run before the password batch completes");
  await Promise.all(jobs);
  assert.equal(completed, 10);
});
