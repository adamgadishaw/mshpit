import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const worker = process.argv[2] === "--recovery-worker";
const safeEnvironment = new Set(["SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "PATH", "PATHEXT", "TEMP", "TMP", "COMSPEC", "NODE_TEST_CONTEXT"]);
// This fixture must never inherit a real mailbox, storage credential, or data directory.
for (const key of Object.keys(process.env)) if (!safeEnvironment.has(key.toUpperCase())) delete process.env[key];
process.env.NODE_ENV = "test";
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
globalThis.fetch = async () => { throw new Error("Recovery concurrency fixture forbids network access"); };
const directory = worker ? process.argv[3] : mkdtempSync(join(tmpdir(), "pit-recovery-concurrency-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { hashPassword } = await import("./auth.js");

if (worker) {
  const name = process.argv[4];
  const original = q.usersByEmail.all.bind(q.usersByEmail);
  q.usersByEmail.all = (...args) => {
    const accounts = original(...args);
    writeFileSync(join(directory, `ready-${name}`), JSON.stringify({ eligible: !accounts[0]?.reset_expires }));
    // Force both processes to inspect the same eligible snapshot, without
    // changing the route or holding a write lock during its password work.
    const deadline = Date.now() + 15_000;
    while (!(existsSync(join(directory, "ready-a")) && existsSync(join(directory, "ready-b")))) {
      if (Date.now() >= deadline) throw new Error("Recovery fixture barrier timed out");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    return accounts;
  };
  try {
    assert.deepEqual(await routes["POST /api/forgot"]({
      body: { email: "recovery-race@example.test" }, ip: "127.0.0.1", origin: "https://fixture.invalid",
      setHeader() {}, setSession() { assert.fail("Recovery request must not authenticate"); },
    }), { ok: true });
  } finally { db.close(); }
} else {
  test("concurrent recovery requests claim a persisted cooldown once across server processes", async () => {
    const children = [];
    try {
      q.insertUser.run("recovery-race", "recovery-race@example.test", "Recovery Fixture", "recovery_fixture",
        hashPassword("Synthetic-password1"), "fan", null, null, null, "RF", "#123456", Date.now());
      db.exec(`CREATE TABLE recovery_fixture_writes(old_expires INTEGER,new_expires INTEGER);
        CREATE TRIGGER recovery_fixture_track AFTER UPDATE OF reset_hash ON users
        WHEN NEW.id='recovery-race' AND NEW.reset_hash IS NOT OLD.reset_hash
        BEGIN INSERT INTO recovery_fixture_writes VALUES(OLD.reset_expires,NEW.reset_expires); END;`);
      await Promise.all(["a", "b"].map((name) => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--recovery-worker", directory, name], {
          env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT")),
          windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
        });
        children.push(child);
        let output = "";
        const timeout = setTimeout(() => { child.kill(); reject(new Error("Recovery worker exceeded 25 seconds")); }, 25_000);
        child.stdout.on("data", (chunk) => { output += chunk; });
        child.stderr.on("data", (chunk) => { output += chunk; });
        child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        child.once("exit", (code) => {
          clearTimeout(timeout);
          code === 0 ? resolve() : reject(new Error(`Recovery worker exited ${code}: ${output}`));
        });
      })));
      for (const name of ["a", "b"]) assert.equal(JSON.parse(readFileSync(join(directory, `ready-${name}`))).eligible, true);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM recovery_fixture_writes").get().n, 1,
        "the losing request must not replace the first link during its persisted cooldown");
      assert.ok(db.prepare("SELECT reset_expires FROM users WHERE id='recovery-race'").get().reset_expires > Date.now() + 45 * 60 * 1000);
    } finally {
      await Promise.all(children.map((child) => {
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) return Promise.resolve();
        return new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
      }));
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
