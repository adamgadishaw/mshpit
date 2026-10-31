import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { LIMITS } from "../src/domain/validation.mjs";
import { twoThousandWordReview } from "../scripts/fixtures/concert-review-text.mjs";

// Actual index.js HTTP/body/auth routes and SQLite, with the established local
// preload preventing every outbound connection and binding only loopback.
test("long concert reviews cross the real HTTP and SQLite boundaries without truncation", { timeout: 45000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const reservation = createServer();
  await new Promise(done => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const directory = mkdtempSync(join(tmpdir(), "pit-auth-real-browser-"));
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  Object.assign(env, { NODE_ENV: "test", PORT: String(port), PUBLIC_ORIGIN: origin, PIT_DATA_DIR: directory,
    PIT_AUTH_BROWSER_FIXTURE: "1", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true", ADMIN_PASSWORD: "Synthetic-local-password1", ADMIN_EMAIL: "owner@example.test",
    EMAIL_VERIFICATION_ENABLED: "true", EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", BACKUP_ENABLED: "false",
    TOURDATE_REFRESH_ENABLED: "false", TOURDATE_DEMAND_REFRESH_ENABLED: "false", ARTIST_GENRE_REFRESH_ENABLED: "false", ARTIST_PHOTO_SEED_ENABLED: "false",
    ARTIST_DEATH_WATCH_SCHEDULER_ENABLED: "false", CACHE_WARM_ENABLED: "false" });
  const child = fork(join(root, "server/index.js"), [], { cwd: root, env,
    execArgv: ["--import", pathToFileURL(join(root, "scripts/fixtures/auth-real-server-preload.mjs")).href], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let fixture, bound, output = "";
  child.on("message", message => { if (message.kind === "fixture") fixture = message; if (message.kind === "listener-bound") bound = message.address; });
  child.stdout.on("data", bytes => { output = (output + bytes).slice(-4000); });
  child.stderr.on("data", bytes => { output = (output + bytes).slice(-4000); });
  let database;
  try {
    const deadline = Date.now() + 20000;
    while (!fixture || !bound) { assert.equal(child.exitCode, null, output); assert.ok(Date.now() < deadline, output); await new Promise(done => setTimeout(done, 40)); }
    assert.equal(bound, "127.0.0.1");
    const member = fixture.readers[0];
    const request = async (path, body, method = "POST", serialized = JSON.stringify(body)) => {
      const response = await fetch(origin + path, { method, headers: { Cookie: member.cookie, "X-Pit-Expected-Account": member.id, Origin: origin, "Content-Type": "application/json" }, body: serialized, signal: AbortSignal.timeout(10000) });
      return { status: response.status, data: await response.json() };
    };
    const base = { artist: "Fixture Artist", city: "Toronto", overall: 2, clientMutationId: "http_long_review_001", review: twoThousandWordReview };
    const created = await request("/api/posts", base);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.post.review, twoThousandWordReview);
    const id = created.data.id;
    const databasePath = join(directory, "pit.db");
    database = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(database.prepare("SELECT review FROM posts WHERE id=?").get(id).review, twoThousandWordReview);
    const edited = await request(`/api/posts/${id}`, { review: twoThousandWordReview + " A fine encore." }, "PATCH");
    assert.equal(edited.status, 200); assert.equal(edited.data.post.review, twoThousandWordReview + " A fine encore.");
    const boundary = { ...base, clientMutationId: "http_long_boundary_001", review: "" };
    const escaped = JSON.stringify(boundary).replace('"review":""', '"review":"' + "\\u4e50\\u58f0".repeat(LIMITS.concertReview / 2) + '"');
    assert.ok(Buffer.byteLength(escaped) < 256 * 1024);
    const accepted = await request("/api/posts", boundary, "POST", escaped);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal(accepted.data.post.review, "乐声".repeat(LIMITS.concertReview / 2));
    assert.equal(database.prepare("SELECT review FROM posts WHERE id=?").get(accepted.data.id).review.length, LIMITS.concertReview);
    const overflow = await request("/api/posts", { ...base, clientMutationId: "http_long_overflow_001", review: "x".repeat(LIMITS.concertReview + 1) });
    assert.equal(overflow.status, 400); assert.equal(overflow.data.code, "VALIDATION_FAILED");
    const tooLarge = await request("/api/posts", { ...base, clientMutationId: "http_body_overflow_001", transportPadding: "x".repeat(256 * 1024) });
    assert.equal(tooLarge.status, 413); assert.equal(tooLarge.data.code, "REQUEST_TOO_LARGE");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM posts WHERE user_id=?").get(member.id).count, 2, "Neither overflow creates a row");
  } finally {
    database?.close();
    if (child.exitCode === null) { const exited = new Promise(done => child.once("exit", done)); child.kill(); await exited; }
    rmSync(directory, { recursive: true, force: true });
  }
});
