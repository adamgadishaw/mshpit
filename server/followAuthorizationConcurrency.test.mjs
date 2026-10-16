import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const worker = process.argv[2] === "--follow-worker";
const safeEnvironment = new Set(["SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "PATH", "PATHEXT", "TEMP", "TMP", "COMSPEC", "NODE_TEST_CONTEXT"]);
for (const key of Object.keys(process.env)) if (!safeEnvironment.has(key.toUpperCase())) delete process.env[key];
process.env.NODE_ENV = "test";
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
globalThis.fetch = async () => { throw new Error("Follow concurrency fixture forbids network access"); };
const directory = worker ? process.argv[3] : mkdtempSync(join(tmpdir(), "pit-follow-concurrency-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createSession, hashPassword } = await import("./auth.js");
const { readAuthorizedRequest } = await import("./requestAuthorization.js");
const waitFile = async (file) => {
  const deadline = Date.now() + 10_000;
  while (!existsSync(file)) {
    if (Date.now() >= deadline) throw new Error("Follow fixture coordination timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

if (worker) {
  const scenario = process.argv[4];
  const workerName = process.argv[5] || scenario;
  const actor = `${scenario}_actor`, target = `${scenario}_target`;
  try {
    const token = createSession(actor).token;
    writeFileSync(join(directory, `${workerName}-ready`), "ready");
    await waitFile(join(directory, `${scenario}-go`));
    const authorized = await readAuthorizedRequest({ token, expectedAccount: actor,
      method: "POST", pathname: `/api/users/${target}/follow`, readBody: () => ({ following: true }) });
    const originalExec = db.exec.bind(db);
    db.exec = (sql) => {
      // Observe the real transaction boundary. The parent holds SQLite's writer
      // lock, so authorization checks above see its previously committed state.
      if (sql === "BEGIN IMMEDIATE") writeFileSync(join(directory, `${workerName}-waiting`), "waiting");
      return originalExec(sql);
    };
    let response;
    try {
      response = routes["POST /api/users/:id/follow"]({ ...authorized, token, params: { id: target }, ip: "127.0.0.1" });
    } catch (error) { response = { status: error.status, code: error.code }; }
    writeFileSync(join(directory, `${workerName}-result.json`), JSON.stringify(response));
  } finally { db.close(); }
} else {
  const password = hashPassword("Synthetic-password1");
  after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const scenario of ["revoked", "banned", "blocked-by-target", "blocked-by-actor", "private-target", "valid"]) {
    test(`follow rechecks ${scenario} after acquiring a contended writer lock`, async () => {
      const actor = `${scenario}_actor`, target = `${scenario}_target`;
      for (const id of [actor, target]) {
        q.insertUser.run(id, `${id}@example.test`, id, id, password, "fan", null, null, null, "FF", "#123456", Date.now());
        db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
      }
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--follow-worker", directory, scenario], {
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT")),
        windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
      const ended = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Follow worker exited ${code}: ${output}`)));
      });
      // Observe rejection immediately even if the coordination phase fails first.
      void ended.catch(() => {});
      const timeout = setTimeout(() => child.kill(), 25_000);
      try {
        await waitFile(join(directory, `${scenario}-ready`));
        db.exec("BEGIN IMMEDIATE");
        writeFileSync(join(directory, `${scenario}-go`), "go");
        await waitFile(join(directory, `${scenario}-waiting`));
        if (scenario === "revoked") db.prepare("DELETE FROM sessions WHERE user_id=?").run(actor);
        if (scenario === "banned") db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(actor);
        if (scenario === "private-target") db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(target);
        if (scenario === "blocked-by-target") db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(target, actor, Date.now());
        if (scenario === "blocked-by-actor") db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(actor, target, Date.now());
        db.exec("COMMIT");
        await ended;
        const response = JSON.parse(readFileSync(join(directory, `${scenario}-result.json`)));
        const expected = scenario === "valid" ? 1 : 0;
        assert.equal(db.prepare("SELECT COUNT(*) n FROM follows WHERE follower_id=? AND followee_id=?").get(actor, target).n, expected,
          "a restriction committed before lock acquisition must prevent the new relationship");
        assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND actor_id=? AND type='follow'").get(target, actor).n, expected);
        if (scenario === "valid") assert.deepEqual(response, { following: true });
        else assert.equal(response.status, scenario === "revoked" ? 401 : scenario === "private-target" ? 404 : 403);
      } finally {
        clearTimeout(timeout);
        if (db.isTransaction) db.exec("ROLLBACK");
        if (child.exitCode === null && child.signalCode === null && child.pid) {
          const stopped = new Promise((resolve) => child.once("exit", resolve));
          child.kill();
          await stopped;
        }
      }
    });
  }
  test("concurrent duplicate follows both succeed and create one relationship and notification", async () => {
    const actor = "duplicate_actor", target = "duplicate_target";
    const children = [];
    for (const id of [actor, target]) {
      q.insertUser.run(id, `${id}@example.test`, id, id, password, "fan", null, null, null, "FF", "#123456", Date.now());
      db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
    }
    try {
      const exits = ["duplicate-a", "duplicate-b"].map((name) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--follow-worker", directory, "duplicate", name], {
          env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT")),
          windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
        });
        children.push(child);
        let output = "";
        for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
        const ended = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => child.kill(), 25_000);
          child.once("error", (error) => { clearTimeout(timeout); reject(error); });
          child.once("exit", (code) => {
            clearTimeout(timeout);
            code === 0 ? resolve() : reject(new Error(`Follow worker exited ${code}: ${output}`));
          });
        });
        void ended.catch(() => {});
        return ended;
      });
      await Promise.all(["duplicate-a", "duplicate-b"].map((name) => waitFile(join(directory, `${name}-ready`))));
      db.exec("BEGIN IMMEDIATE");
      writeFileSync(join(directory, "duplicate-go"), "go");
      await Promise.all(["duplicate-a", "duplicate-b"].map((name) => waitFile(join(directory, `${name}-waiting`))));
      db.exec("COMMIT");
      await Promise.all(exits);
      for (const name of ["duplicate-a", "duplicate-b"]) {
        assert.deepEqual(JSON.parse(readFileSync(join(directory, `${name}-result.json`))), { following: true });
      }
      assert.equal(db.prepare("SELECT COUNT(*) n FROM follows WHERE follower_id=? AND followee_id=?").get(actor, target).n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND actor_id=? AND type='follow'").get(target, actor).n, 1);
    } finally {
      if (db.isTransaction) db.exec("ROLLBACK");
      await Promise.all(children.map((child) => {
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) return Promise.resolve();
        return new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
      }));
    }
  });
}
