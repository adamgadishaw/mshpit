#!/usr/bin/env node
// Small synthetic correctness/robustness check against actual server/index.js.
// This is neither a production load test nor evidence of capacity/fairness.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deadlineMs = 20_000;
const pause = ms => new Promise(done => setTimeout(done, ms));
const round = value => Math.round(value * 10) / 10;
const checks = [], measurements = {};
let stage = "startup";
const check = async (name, work) => {
  stage = name; await work(); checks.push(name); console.log(JSON.stringify({ check: name, passed: true }));
};

async function main() {
  // Require an actual web export. Do not silently replace it with fixture HTML.
  const buildHtml = readFileSync(join(root, "dist/index.html"), "utf8");
  const slot = createServer();
  await new Promise((done, reject) => { slot.once("error", reject); slot.listen(0, "127.0.0.1", done); });
  const port = slot.address().port;
  await new Promise(done => slot.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "pit-local-robustness-")));
  const temporaryRoot = realpathSync(tmpdir());
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"]
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, {
    NODE_ENV: "test", PIT_ENV: "production", RENDER: "true", PORT: String(port), PUBLIC_ORIGIN: origin,
    PIT_DATA_DIR: directory, PIT_LOCAL_ROBUSTNESS_FIXTURE: "1", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true",
    TEMP: directory, TMP: directory, PIT_ROBUSTNESS_TEMP_PARENT: temporaryRoot,
    ADMIN_PASSWORD: "Synthetic-local-robustness-owner1", ADMIN_EMAIL: "owner@example.test",
    EMAIL_VERIFICATION_ENABLED: "true", EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", BACKUP_ENABLED: "false",
    TOURDATE_REFRESH_ENABLED: "false", TOURDATE_DEMAND_REFRESH_ENABLED: "false", ARTIST_GENRE_REFRESH_ENABLED: "false",
    ARTIST_PHOTO_SEED_ENABLED: "false", ARTIST_DEATH_WATCH_SCHEDULER_ENABLED: "false", CACHE_WARM_ENABLED: "false",
  });
  const child = fork(join(root, "server/index.js"), [], { cwd: root, env,
    execArgv: ["--import", pathToFileURL(join(root, "scripts/fixtures/local-robustness-server-preload.mjs")).href],
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let fixture, listener, exited = false, childError = false, nextId = 0, outboundBlocked = 0, helpersBlocked = 0;
  let lockArrived = false, lockDb, lockHeld = false, outputBytes = 0;
  const replies = new Map(), serverErrorClasses = new Set();
  const observedExit = new Promise(done => child.once("exit", () => { exited = true; done(); }));
  child.on("error", () => { childError = true; });
  // Never persist raw child output, credentials, request content, or local paths.
  const observeOutput = chunk => {
    outputBytes += chunk.length;
    for (const name of String(chunk).match(/\b(?:TypeError|ReferenceError|SyntaxError|SQLITE_[A-Z_]+)\b/g) || []) serverErrorClasses.add(name);
  };
  child.stdout.on("data", observeOutput); child.stderr.on("data", observeOutput);
  child.on("message", message => {
    if (message?.kind === "fixture") fixture = message;
    if (message?.kind === "listener-bound") listener = message.address;
    if (message?.kind === "outbound-blocked") outboundBlocked++;
    if (message?.kind === "helper-blocked") helpersBlocked++;
    if (message?.kind === "lock-write-attempt") lockArrived = true;
    if (message?.kind === "reply") {
      const pending = replies.get(message.id);
      if (pending) { clearTimeout(pending.timer); replies.delete(message.id);
        message.failed ? pending.reject(new Error("Private fixture command failed")) : pending.resolve(message.value); }
    }
  });
  async function waitFor(condition, label) {
    const until = Date.now() + deadlineMs;
    while (!await condition()) {
      assert.ok(!exited && !childError, "Synthetic server stopped unexpectedly");
      assert.ok(Date.now() < until, label); await pause(20);
    }
  }
  const command = action => new Promise((resolveReply, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { replies.delete(id); reject(new Error("Private fixture command timeout")); }, deadlineMs);
    replies.set(id, { resolve: resolveReply, reject, timer });
    child.send({ kind: "command", id, action });
  });
  async function request(path, { member, expected = member?.id, method = "GET", body, paced = true, barrier = false } = {}) {
    assert.ok(path.startsWith("/") && !path.startsWith("//"));
    if (paced) await pause(100);
    const started = performance.now();
    const response = await fetch(origin + path, { method, redirect: "error", headers: {
      ...(member ? { Cookie: member.cookie } : {}), ...(expected ? { "X-Pit-Expected-Account": expected } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json", Origin: origin } : {}),
      ...(barrier ? { "X-Local-Robustness-Barrier": "sqlite-lock" } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(deadlineMs) });
    const text = await response.text();
    return { status: response.status, text, headers: response.headers,
      data: text && response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : null,
      elapsedMs: round(performance.now() - started) };
  }
  try {
    await waitFor(() => fixture && listener, "Actual server startup timeout");
    assert.equal(listener, "127.0.0.1");
    assert.equal((await request("/api/health")).status, 200);
    const [alice, bob] = fixture.members;
    const postPath = `/api/posts/${fixture.postId}`;
    await check("sequential-mixed-browse-and-account-identity", async () => {
      const durations = [];
      for (const member of [alice, bob, alice]) {
        const me = await request("/api/me", { member });
        assert.equal(me.status, 200); assert.equal(me.data.user.id, member.id);
        assert.match(me.headers.get("cache-control"), /no-store/); durations.push(me.elapsedMs);
        const feed = await request("/api/feed?limit=5", { member });
        assert.equal(feed.status, 200); assert.ok(feed.data.posts.some(post => post.id === fixture.postId));
        assert.ok(feed.data.posts.length <= 5); durations.push(feed.elapsedMs);
        const profile = await request(`/api/users/${bob.id}`, { member });
        assert.equal(profile.status, 200); assert.equal(profile.data.user.id, bob.id);
        for (const key of ["email", "pass_hash", "reset_hash"]) assert.equal(Object.hasOwn(profile.data.user, key), false);
        durations.push(profile.elapsedMs);
        const search = await request("/api/artists?q=Robustness&limit=5", { member });
        assert.equal(search.status, 200); assert.ok(search.data.artists.some(artist => artist.name === "Robustness Fixture"));
        durations.push(search.elapsedMs);
      }
      const html = await request("/");
      assert.equal(html.status, 200); assert.match(html.headers.get("content-type"), /text\/html/);
      const build = buildHtml.match(/index-[a-f0-9]+\.js/)?.[0];
      assert.ok(build && html.text.includes(build));
      const head = await request("/", { method: "HEAD" });
      assert.equal(head.status, 200); assert.equal(head.text, "");
      assert.match(head.headers.get("content-type"), /text\/html/);
      const wrong = await request("/api/me", { member: alice, expected: bob.id });
      assert.equal(wrong.status, 409); assert.equal(wrong.data.code, "IDENTITY_CHANGED");
      const guest = await request("/api/me"); assert.equal(guest.status, 200); assert.equal(guest.data.user, null);
      measurements.ordinary = { requests: durations.length, minMs: Math.min(...durations), maxMs: Math.max(...durations) };
    });
    await check("repeated-desired-likes-and-idempotent-comments", async () => {
      for (const liked of [true, true, true, false, false, true, true]) {
        const result = await request(postPath + "/like", { member: alice, method: "POST", body: { liked } });
        assert.equal(result.status, 200); assert.equal(result.data.liked, liked);
        assert.deepEqual((await command("inspect")).likes, [Number(liked), 0]);
      }
      const body = { text: "Synthetic retry-safe concert comment.", clientMutationId: "robust-comment-0001" };
      let commentId;
      for (let index = 0; index < 4; index++) {
        const result = await request(postPath + "/comments", { member: alice, method: "POST", body });
        assert.equal(result.status, 200); assert.equal(result.data.commentCount, 1);
        if (index === 0) commentId = result.data.id;
        else { assert.equal(result.data.id, commentId); assert.equal(result.data.duplicate, true); }
      }
      const conflict = await request(postPath + "/comments", { member: alice, method: "POST", body: { ...body, text: "Changed synthetic comment." } });
      assert.equal(conflict.status, 409); assert.equal(conflict.data.code, "IDEMPOTENCY_MISMATCH");
      for (const suffix of ["/comments", "/like"]) {
        const commandBody = suffix === "/like" ? { liked: false } : body;
        const wrong = await request(postPath + suffix, { member: alice, expected: bob.id, method: "POST", body: commandBody });
        assert.equal(wrong.status, 409); assert.equal(wrong.data.code, "IDENTITY_CHANGED");
        assert.equal((await request(postPath + suffix, { method: "POST", body: commandBody })).status, 401);
      }
      const snapshot = await command("inspect");
      assert.deepEqual(snapshot.likes, [1, 0]); assert.deepEqual(snapshot.comments, [1, 0]);
      const comments = await request(postPath + "/comments", { member: bob });
      assert.equal(comments.data.comments.length, 1); assert.equal(comments.data.comments[0].userId, alice.id);
    });
    await check("bounded-public-read-burst-and-health-recovery", async () => {
      await pause(1100);
      const results = await Promise.all(Array.from({ length: 35 }, () => request("/api/feed?limit=1", { member: alice, paced: false })));
      assert.ok(results.every(result => [200, 429].includes(result.status)));
      const accepted = results.filter(result => result.status === 200), denied = results.filter(result => result.status === 429);
      assert.ok(accepted.length > 0 && denied.length > 0);
      for (const result of denied) {
        assert.equal(result.data.code, "RATE_LIMITED"); assert.ok(Number(result.headers.get("retry-after")) >= 1);
        assert.match(result.headers.get("cache-control"), /no-store/);
      }
      assert.equal((await request("/api/health", { paced: false })).status, 200);
      await pause(1100);
      assert.equal((await request("/api/feed?limit=1", { member: alice })).status, 200);
      assert.equal((await request("/api/me", { member: bob })).data.user.id, bob.id);
      measurements.burst = { requests: 35, accepted: accepted.length, rateLimited: denied.length, maxMs: Math.max(...results.map(result => result.elapsedMs)) };
    });
    await check("background-default-pending-bound-serialization-and-recovery", async () => {
      const held = await command("queue-start");
      assert.deepEqual(held, { active: 1, started: 1, rejected: ["capacity", "capacity"], submitted: 34 });
      assert.equal((await request("/api/me", { member: alice })).data.user.id, alice.id);
      assert.equal((await request("/api/health")).status, 200);
      const done = await command("queue-release");
      assert.equal(done.maxActive, 1); assert.equal(done.active, 0);
      assert.equal(done.acquired, 33); assert.equal(done.released, 33);
      assert.deepEqual(done.order, Array.from({ length: 32 }, (_, index) => index));
      assert.equal(done.outcomes.filter(value => value === "ok").length, 31);
      assert.equal(done.outcomes[5], "job-failed"); assert.equal(done.recovered, "recovered");
      measurements.background = { submitted: 34, admitted: 32, rejected: 2, maxActive: done.maxActive, recovered: true };
    });
    await check("separate-sqlite-writer-contention-and-integrity", async () => {
      assert.equal((await command("inspect")).busyTimeoutMs, 5000);
      lockDb = new DatabaseSync(join(directory, "pit.db"));
      lockDb.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE"); lockHeld = true;
      lockDb.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run(fixture.postId, bob.id);
      const started = performance.now();
      const body = { text: "Synthetic comment after a short separate writer lock.", clientMutationId: "robust-lock-comment-0002" };
      // Attach a rejection handler immediately while waiting for the IPC arrival.
      const writing = request(postPath + "/comments", { member: alice, method: "POST", body, paced: false, barrier: true })
        .then(value => ({ value }), () => ({ failed: true }));
      await waitFor(() => lockArrived, "Contended SQLite write was not attempted while lock held");
      await pause(250);
      lockDb.exec("COMMIT"); lockHeld = false;
      const lockHeldMs = round(performance.now() - started);
      const result = await writing; assert.equal(result.failed, undefined);
      assert.equal(result.value.status, 200); assert.equal(result.value.data.commentCount, 2);
      const replay = await request(postPath + "/comments", { member: alice, method: "POST", body });
      assert.equal(replay.status, 200); assert.equal(replay.data.id, result.value.data.id); assert.equal(replay.data.duplicate, true);
      const snapshot = await command("inspect");
      assert.deepEqual(snapshot.likes, [1, 1]); assert.deepEqual(snapshot.comments, [2, 0]);
      assert.equal(snapshot.integrity, "ok"); assert.equal(snapshot.foreignKeyViolations, 0);
      assert.equal((await request("/api/me", { member: alice })).data.user.id, alice.id);
      assert.equal((await request("/api/health")).status, 200);
      measurements.contention = { lockHeldMs, writeMs: result.value.elapsedMs, busyTimeoutMs: 5000,
        integrity: "ok", committedWritesRetained: true };
    });
  } finally {
    if (lockDb) { if (lockHeld) lockDb.exec("ROLLBACK"); lockDb.close(); }
    for (const pending of replies.values()) clearTimeout(pending.timer);
    if (!exited && child.pid) {
      child.kill("SIGTERM");
      await Promise.race([observedExit, pause(5000)]);
      if (!exited) { child.kill("SIGKILL"); await Promise.race([observedExit, pause(5000)]); }
    }
    // Only remove this invocation's resolved temporary directory after its child exits.
    assert.ok(exited || !child.pid, "Owned server did not stop; preserve its temporary directory");
    assert.equal(realpathSync(directory), directory);
    assert.equal(dirname(directory).toLowerCase(), temporaryRoot.toLowerCase());
    assert.ok(basename(directory).startsWith("pit-local-robustness-"));
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    console.log(JSON.stringify({ isolation: "actual server; synthetic temporary SQLite; loopback listener; child outbound denied",
      fixtureReady: Boolean(fixture), loopbackBound: listener === "127.0.0.1",
      outboundBlocked, helpersBlocked, discardedServerOutputBytes: outputBytes, serverErrorClasses: [...serverErrorClasses], cleanedUp: true }));
  }
}
try {
  await main();
  console.log(JSON.stringify({ passed: checks.length, measurements,
    limitation: "Small local correctness checks only. SQLite busy_timeout=5000 remains synchronous; no capacity, fairness, isolation or denial-of-service immunity claim." }));
} catch (error) {
  // Assertion objects/stacks can contain synthetic cookies, content, or paths.
  console.error(JSON.stringify({ passed: checks.length, failedStage: stage,
    errorClass: error?.name === "AssertionError" ? "AssertionError" : "HarnessError",
    harnessLine: Number(String(error?.stack || "").match(/verify-local-robustness\.mjs:(\d+):/)?.[1]) || null }));
  process.exitCode = 1;
}
