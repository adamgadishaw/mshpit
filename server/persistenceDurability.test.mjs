import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { backupSourceManifest, backupTableCounts, verifyBackupSnapshot } from "../scripts/backup-db-verification.mjs";
import { assertExistingProductionDatabase } from "./dataDirectory.js";
import { registerPitSqliteFunctions } from "./sqliteFunctions.js";
import { assertDatabaseRecoveryReady, RESTORE_GATE_KEY } from "./databaseRecovery.js";
import { prepareOfflineRestore } from "../scripts/prepare-db-restore.mjs";
import { buildStatusCreateBody } from "../src/domain/post-payload.mjs";

function runFixture(directory, script) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true,
    env: { ...process.env, NODE_ENV: "test", PIT_DATA_DIR: directory, PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false" },
  });
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const waitUntil = async (read, ready, message) => {
  const deadline = Date.now() + 12_000;
  while (true) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, message);
    await new Promise(done => setTimeout(done, 25));
  }
};

async function startHttpRecoveryFixture(directory, phase) {
  const probe = createNetServer();
  await new Promise(done => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA"]
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, {
    NODE_ENV: "test", PORT: String(port), PUBLIC_ORIGIN: origin, PIT_DATA_DIR: directory,
    PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true", PIT_RECOVERY_HTTP_FIXTURE: "1", PIT_RECOVERY_HTTP_PHASE: phase,
    PIT_VIDEO_PUBLISHING_ENABLED: "true", PIT_VIDEO_VERIFIER_HOSTPORT: "pit-video-verifier:10001",
    PIT_VIDEO_VERIFIER_SECRET: "synthetic-recovery-verifier-secret-at-least-32-bytes",
    MEDIA_ENDPOINT: "https://objects.example.test/s3", MEDIA_BUCKET: "pit-media",
    MEDIA_SOURCE_BUCKET: "pit-media-private", MEDIA_REGION: "auto",
    MEDIA_ACCESS_KEY_ID: "synthetic-access", MEDIA_SECRET_ACCESS_KEY: "synthetic-secret",
    MEDIA_PUBLIC_BASE_URL: "https://media.example.test/cdn",
    ERROR_ALERTS_ENABLED: "false", NEWS_DESK_ENABLED: "false", PIT_MEDIA_API_ENABLED: "false",
    BACKUP_ENABLED: "false", EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", CACHE_WARM_ENABLED: "false",
    TOURDATE_REFRESH_ENABLED: "false", TOURDATE_DEMAND_REFRESH_ENABLED: "false",
    ARTIST_GENRE_REFRESH_ENABLED: "false", ARTIST_PHOTO_SEED_ENABLED: "false",
    ARTIST_DEATH_WATCH_SCHEDULER_ENABLED: "false",
  });
  const child = fork(join(root, "server/index.js"), [], {
    cwd: root, env, execArgv: ["--max-old-space-size=192", "--import",
      pathToFileURL(join(root, "scripts/fixtures/recovery-http-preload.mjs")).href],
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
  });
  let fixture, address, output = "", exited = false, nextRequest = 0;
  const append = data => { output = (output + data).slice(-16_000); };
  child.stdout.on("data", append); child.stderr.on("data", append);
  child.on("message", message => {
    if (message.kind === "fixture") fixture = message;
    if (message.kind === "listener") address = message.address;
  });
  const exit = new Promise(done => child.once("exit", () => { exited = true; done(); }));
  const stop = async () => {
    if (!exited) child.kill("SIGKILL");
    await exit;
  };
  try {
    await waitUntil(() => {
      assert.equal(exited, false, `Recovery HTTP fixture exited during startup: ${output}`);
      return fixture && address && output.includes(`up on http://localhost:${port}`);
    }, Boolean, "Recovery HTTP fixture did not become ready");
    assert.equal(address, "127.0.0.1");
  } catch (error) { await stop(); throw error; }
  return {
    origin, fixture, stop,
    release: () => child.send({ kind: "release-storage" }),
    snapshot: () => new Promise((done, reject) => {
      const requestId = ++nextRequest;
      const timer = setTimeout(() => { child.off("message", receive); reject(new Error("Fixture snapshot timed out")); }, 3000);
      const receive = message => {
        if (message.kind !== "snapshot" || message.requestId !== requestId) return;
        clearTimeout(timer); child.off("message", receive); done(message);
      };
      child.on("message", receive);
      child.send({ kind: "snapshot", requestId });
    }),
  };
}

function requestJson(origin, path, { cookie, body, requestOrigin = origin } = {}) {
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  return new Promise((done, reject) => {
    const serialized = body === undefined ? null : JSON.stringify(body);
    const request = httpRequest(origin + path, {
      method: serialized ? "POST" : "GET",
      headers: { ...(cookie ? { Cookie: cookie } : {}),
        ...(serialized ? { Origin: requestOrigin, "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(serialized) } : {}) },
    }, response => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { text += chunk; });
      response.once("error", reject);
      response.once("end", () => {
        try { done({ status: response.statusCode, data: JSON.parse(text) }); }
        catch (error) { reject(error); }
      });
    });
    request.setTimeout(10_000, () => request.destroy(new Error("Loopback request timed out")));
    request.once("error", reject);
    request.end(serialized);
  });
}

async function loseHttpResponse(origin, path, options) {
  let committedResponse;
  // A real loopback proxy receives the application's whole response, then
  // resets its downstream socket before delivering any response to the client.
  const proxy = createHttpServer((request, response) => {
    const upstream = httpRequest(origin + path, { method: request.method,
      headers: { ...request.headers, host: new URL(origin).host } }, incoming => {
      let text = "";
      incoming.setEncoding("utf8");
      incoming.on("data", chunk => { text += chunk; });
      incoming.once("end", () => {
        committedResponse = { status: incoming.statusCode, data: JSON.parse(text) };
        response.destroy();
      });
      incoming.once("error", () => response.destroy());
    });
    upstream.once("error", () => response.destroy());
    request.pipe(upstream);
  });
  await new Promise(done => proxy.listen(0, "127.0.0.1", done));
  try {
    await assert.rejects(requestJson(`http://127.0.0.1:${proxy.address().port}`, path,
      { ...options, requestOrigin: origin }), { code: "ECONNRESET" });
    assert.equal(committedResponse?.status, 200, "the application completed before its response was lost");
    return committedResponse.data;
  } finally { await new Promise(done => proxy.close(done)); }
}

const seedMemberGraph = `
  import { db } from './server/db.js';
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('foreign keys must be enabled');
  if (db.prepare('PRAGMA busy_timeout').get().timeout !== 5000) throw new Error('writer contention must be bounded');
  if (db.prepare('PRAGMA synchronous').get().synchronous !== 2) throw new Error('WAL commits must use FULL durability');
  db.exec("BEGIN IMMEDIATE");
  db.prepare("INSERT INTO users (id,email,name,handle,pass_hash,extras,created_at) VALUES (?,?,?,?,?,?,?)")
    .run('durable_member','member@example.test','Durable member','durable_member','fixture-hash',JSON.stringify({theme:'night'}),1000);
  db.prepare("INSERT INTO users (id,email,name,handle,pass_hash,created_at) VALUES (?,?,?,?,?,?)")
    .run('durable_friend','friend@example.test','Durable friend','durable_friend','fixture-hash',1000);
  db.exec(\`INSERT INTO posts (id,user_id,artist,venue,date,overall,review,created_at)
      VALUES ('durable_post','durable_member','Durable Band','Durable Hall','2026-09-08',5,'A lasting memory',1000);
    INSERT INTO comments (id,post_id,user_id,text,created_at)
      VALUES ('durable_comment','durable_post','durable_friend','A lasting comment',1001);
    INSERT INTO likes VALUES ('durable_post','durable_friend');
    INSERT INTO follows VALUES ('durable_friend','durable_member');
    INSERT INTO dms (id,from_id,to_id,text,created_at)
      VALUES ('durable_message','durable_member','durable_friend','A lasting message',1002);
    INSERT INTO ratings VALUES ('durable_member','artist','durable band',5);
    INSERT INTO going (user_id,concert_key,artist,venue,date,created_at)
      VALUES ('durable_member','durable-show','Durable Band','Durable Hall','2026-09-10',1003);\`);
  db.exec("COMMIT");
`;

function assertMemberGraph(database) {
  assert.equal(database.prepare("SELECT review FROM posts WHERE id='durable_post'").get().review, "A lasting memory");
  assert.equal(database.prepare("SELECT text FROM comments WHERE id='durable_comment'").get().text, "A lasting comment");
  assert.equal(database.prepare("SELECT text FROM dms WHERE id='durable_message'").get().text, "A lasting message");
  for (const table of ["likes", "follows", "ratings", "going"]) {
    assert.equal(database.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 1, table);
  }
  assert.equal(JSON.parse(database.prepare("SELECT extras FROM users WHERE id='durable_member'").get().extras).theme, "night");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
}

test("committed member data survives a killed WAL writer while unfinished writes roll back", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-durability-crash-"));
  try {
    const killed = runFixture(directory, seedMemberGraph + `
      db.exec("BEGIN IMMEDIATE");
      db.exec("UPDATE posts SET review='Uncommitted change' WHERE id='durable_post'");
      db.exec("DELETE FROM comments WHERE id='durable_comment'");
      process.kill(process.pid, 'SIGKILL');
    `);
    assert.notEqual(killed.status, 0, "the fixture is intentionally killed without closing SQLite");
    const database = new DatabaseSync(join(directory, "pit.db"));
    registerPitSqliteFunctions(database);
    try {
      assert.equal(database.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
      assert.equal(database.prepare("PRAGMA synchronous").get().synchronous, 2, "FULL is retained for committed WAL durability");
      assertMemberGraph(database);
    } finally { database.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("an accepted video request survives process death before dispatch and recovers once after cold reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-video-acceptance-crash-"));
  try {
    const killed = runFixture(directory, seedMemberGraph + `
      import { startVideoFinalizeJob } from './server/videoFinalizeJobs.js';
      import { recordVideoProcessingRequest } from './server/videoProcessingQueue.js';
      db.exec(\`INSERT INTO media_assets
        (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,
         source_storage_scope,original_name,mime_type,byte_size,created_at,updated_at)
        VALUES ('durable_clip','durable_member','durable-client','fixture','post','video',
          'fixture-source.webm','https://example.test/fixture-source.webm','private','fixture.webm','video/webm',2048,1000,1000)\`);
      startVideoFinalizeJob({
        ownerId: 'durable_member', assetId: 'durable_clip', fingerprint: 'a'.repeat(64),
        accept: () => recordVideoProcessingRequest(db, {
          ownerId: 'durable_member', assetId: 'durable_clip', body: { editRecipe: { coverMs: 0 } },
          fingerprint: 'a'.repeat(64), at: 1000,
        }),
        run: () => { throw new Error('Killed process must not dispatch'); },
      });
      process.kill(process.pid, 'SIGKILL');
    `);
    assert.notEqual(killed.status, 0);
    const recovered = runFixture(directory, `
      import assert from 'node:assert/strict';
      import { db } from './server/db.js';
      import { startVideoFinalizeJob } from './server/videoFinalizeJobs.js';
      import { recoverInterruptedVideoProcessing, dueVideoProcessingJob,
        recordVideoProcessingRequest, noteVideoProcessingAttemptStarted, noteVideoProcessingOutcome
      } from './server/videoProcessingQueue.js';
      assert.equal(recoverInterruptedVideoProcessing(db, { at: 2000 }), 1);
      const job = dueVideoProcessingJob(db, { at: 2000 });
      assert.equal(job.asset_id, 'durable_clip');
      assert.equal(job.attempts, 0);
      assert.deepEqual(JSON.parse(job.body), { editRecipe: { coverMs: 0 } });
      let outputs = 0, admissions = 0;
      const options = {
        ownerId: job.owner_id, assetId: job.asset_id, fingerprint: job.fingerprint,
        accept: () => {
          admissions += 1;
          recordVideoProcessingRequest(db, { ownerId: job.owner_id, assetId: job.asset_id,
            body: JSON.parse(job.body), fingerprint: job.fingerprint, at: 2000 });
        },
        run: async () => {
          noteVideoProcessingAttemptStarted(db, { assetId: job.asset_id, at: 2000 });
          outputs += 1;
          return { asset: { status: 'ready' } };
        },
        onSettled: ({ error }) => noteVideoProcessingOutcome(db, { assetId: job.asset_id, error, at: 2000 }),
      };
      const first = startVideoFinalizeJob(options);
      const duplicate = startVideoFinalizeJob(options);
      assert.equal(duplicate.joined, true);
      await Promise.all([first.completion, duplicate.completion]);
      assert.equal(admissions, 1);
      assert.equal(outputs, 1);
      assert.equal(dueVideoProcessingJob(db, { at: 3000 }), null);
      assert.equal(recoverInterruptedVideoProcessing(db, { at: 3000 }), 0);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      db.close();
    `);
    assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("real HTTP lost responses survive process restart with one post, one video delivery and current-session checks",
  { timeout: 60_000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), "pit-durability-http-"));
    let server;
    try {
      server = await startHttpRecoveryFixture(directory, "hold");
      const cookie = server.fixture.cookie;
      const createBody = { clientAssetId: "http-recovery-video", purpose: "post", contentType: "video/webm",
        fileSize: 2048, name: "synthetic.webm" };
      const created = await requestJson(server.origin, "/api/media/assets", { cookie, body: createBody });
      assert.equal(created.status, 200);
      const assetId = created.data.asset.id;
      const finalizePath = `/api/media/assets/${assetId}/finalize`;
      const finalizeBody = { async: true, editRecipe: { coverMs: 0 } };
      const lostFinalize = await loseHttpResponse(server.origin, finalizePath, { cookie, body: finalizeBody });
      assert.equal(lostFinalize.finalize.state, "processing");
      await waitUntil(server.snapshot, value => value.counts.sourceHeads === 1, "Accepted video did not dispatch");
      const postBody = buildStatusCreateBody({ id: "http-recovery-post", review: "A durable HTTP clip",
        photos: [], mediaAssetIds: [assetId] });
      const lostPost = await loseHttpResponse(server.origin, "/api/posts", { cookie, body: postBody });
      const accepted = await server.snapshot();
      assert.equal(accepted.jobs.length, 1);
      assert.equal(accepted.jobs[0].state, "running");
      assert.equal(accepted.counts.verifications, 0);
      assert.equal(accepted.posts.length, 1);
      assert.equal(accepted.counts.blocked, 0);
      await server.stop(); // Hard process death: no coordinator reset or SQLite close.

      server = await startHttpRecoveryFixture(directory, "recover");
      await waitUntil(server.snapshot, value => value.counts.sourceHeads === 1, "Startup scheduler did not resume the accepted video");
      const retryFinalize = await requestJson(server.origin, finalizePath, { cookie, body: finalizeBody });
      assert.equal(retryFinalize.status, 200);
      assert.equal(retryFinalize.data.asset.id, assetId);
      const retryPost = await requestJson(server.origin, "/api/posts", { cookie, body: postBody });
      assert.equal(retryPost.status, 200);
      assert.equal(retryPost.data.duplicate, true);
      assert.equal(retryPost.data.id, lostPost.id);
      server.release();
      const complete = await waitUntil(server.snapshot, value => value.assets[0]?.status === "ready",
        "Recovered video did not commit a ready delivery");
      assert.equal(complete.counts.verifications, 1);
      assert.equal(complete.counts.posterPuts, 1);
      assert.equal(complete.counts.blocked, 0);
      assert.equal(complete.jobs.length, 0);
      assert.deepEqual(complete.variants.map(({ role, status }) => ({ role, status })),
        [{ role: "poster", status: "verified" }, { role: "render", status: "verified" }]);
      assert.deepEqual(complete.links, [{ post_id: lostPost.id, asset_id: assetId }]);
      assert.deepEqual(complete.receipts, [{ post_id: lostPost.id, state: "active" }]);
      assert.deepEqual(complete.foreignKeys, []);
      await server.stop();

      server = await startHttpRecoveryFixture(directory, "finished");
      const finalReplay = await requestJson(server.origin, finalizePath, { cookie, body: finalizeBody });
      assert.equal(finalReplay.status, 200);
      assert.equal(finalReplay.data.finalize.state, "completed");
      const finalPost = await requestJson(server.origin, "/api/posts", { cookie, body: postBody });
      assert.equal(finalPost.status, 200, finalPost.data.code);
      assert.equal(finalPost.data.id, lostPost.id);
      assert.equal(finalPost.data.duplicate, true);
      assert.equal((await requestJson(server.origin, "/api/posts", { cookie,
        body: { ...postBody, review: "Changed replay" } })).status, 409);
      const persisted = await server.snapshot();
      assert.deepEqual(persisted.assets, complete.assets);
      assert.deepEqual(persisted.variants, complete.variants);
      assert.equal(persisted.posts.length, 1);
      assert.equal(persisted.counts.verifications, 0);
      assert.equal(persisted.counts.posterPuts, 0);
      assert.equal(persisted.counts.sourceHeads, 0);
      assert.equal(persisted.counts.blocked, 0);
      assert.equal((await requestJson(server.origin, "/api/logout", { cookie, body: {} })).status, 200);
      assert.equal((await requestJson(server.origin, finalizePath, { cookie, body: finalizeBody })).status, 401);
      assert.equal((await requestJson(server.origin, "/api/posts", { cookie, body: postBody })).status, 401);
    } finally {
      await server?.stop();
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
      rmSync(directory, { recursive: true, force: true });
    }
  });

test("a real-schema backup preserves the member graph across verification and reviewed cold reopen", () => {
  const root = mkdtempSync(join(tmpdir(), "pit-durability-restore-"));
  const dataDirectory = join(root, "data");
  const backupDirectory = join(root, "backups");
  const rawDirectory = join(root, "raw-restore");
  const reviewedDirectory = join(root, "reviewed-restore");
  mkdirSync(dataDirectory);
  mkdirSync(rawDirectory);
  mkdirSync(reviewedDirectory);
  try {
    const seeded = runFixture(dataDirectory, seedMemberGraph + `
      db.exec("BEGIN IMMEDIATE");
      db.exec(\`UPDATE users SET reset_hash='old-reset',reset_expires=9000,
          email_verify_hash='old-verify',email_verify_expires=9000,signup_cancel_hash='old-cancel'
          WHERE id='durable_member';
        INSERT INTO sessions (token_hash,user_id,created_at,expires_at)
          VALUES ('old-session','durable_member',1000,9000);
        INSERT INTO email_verification_receipts (token_hash,user_id,email_hash,verified_at,expires_at)
          VALUES ('old-verification','durable_member','fixture-email-hash',1000,9000);
        INSERT INTO email_campaigns (id,name,subject,body,created_at,updated_at)
          VALUES ('durable-campaign','Fixture','Fixture','Fixture body',1000,1000);
        INSERT INTO email_queue (campaign_id,user_id,to_email,created_at)
          VALUES ('durable-campaign','durable_member','member@example.test',1000);
        INSERT INTO owner_approval_requests (id,kind,safe_summary,payload,payload_hash,token_hash,requested_at,expires_at)
          VALUES ('old-approval','security_release','Fixture','{}','fixture-payload','old-owner-token',1000,9000);
        INSERT INTO owner_approval_receipts (id,kind,decision,safe_summary,payload_hash,previous_stamp,stamp,requested_at,created_at)
          VALUES ('durable-receipt','security_release','recorded','Fixture','fixture-payload','','fixture-stamp',1000,1001);\`);
      db.exec("COMMIT");
      db.close();
    `);
    assert.equal(seeded.status, 0, seeded.stderr || seeded.stdout);
    const source = new DatabaseSync(join(dataDirectory, "pit.db"), { readOnly: true });
    registerPitSqliteFunctions(source);
    let counts;
    let manifest;
    try {
      counts = backupTableCounts(source);
      manifest = backupSourceManifest(source);
      assertMemberGraph(source);
    } finally { source.close(); }
    const backedUp = spawnSync(process.execPath, ["scripts/backup-db.mjs"], {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true,
      env: { ...process.env, NODE_ENV: "test", PIT_DATA_DIR: dataDirectory, BACKUP_DIR: backupDirectory, BACKUP_KEEP: "2" },
    });
    assert.equal(backedUp.status, 0, backedUp.stderr || backedUp.stdout);
    const [name] = readdirSync(backupDirectory).filter((entry) => /^pit-\d{8}-\d{6}\.db$/.test(entry));
    assert.ok(name);
    const snapshotPath = join(backupDirectory, name);
    assert.deepEqual(verifyBackupSnapshot(snapshotPath, counts, manifest), { ...counts, app_meta: counts.app_meta + 1 });
    assert.doesNotThrow(() => assertExistingProductionDatabase(snapshotPath));
    const raw = new DatabaseSync(snapshotPath, { readOnly: true });
    registerPitSqliteFunctions(raw);
    try {
      assertMemberGraph(raw);
      assert.equal(JSON.parse(raw.prepare("SELECT value FROM app_meta WHERE key=?").get(RESTORE_GATE_KEY).value).state, "snapshot");
      assert.throws(() => assertDatabaseRecoveryReady(raw), { code: "DATABASE_RESTORE_REVIEW_REQUIRED" });
    } finally { raw.close(); }
    copyFileSync(snapshotPath, join(rawDirectory, "pit.db"));
    const refused = runFixture(rawDirectory, "import { db } from './server/db.js'; db.close();");
    assert.notEqual(refused.status, 0, "raw snapshots must not cold-start the application");
    assert.match(refused.stderr, /DATABASE_RESTORE_REVIEW_REQUIRED/);

    const reviewedPath = join(reviewedDirectory, "pit.db");
    const invalidated = prepareOfflineRestore({ source: snapshotPath, output: reviewedPath,
      privacyReplayReference: "fixture/privacy-reviewed", credentialReviewReference: "fixture/credentials-reviewed",
      env: { PIT_DATA_DIR: dataDirectory } });
    assert.equal(invalidated.sessions, 1);
    assert.equal(invalidated.email_queue, 1);
    assert.equal(invalidated.ownerApprovalRequests, 1);
    const reopened = runFixture(reviewedDirectory, "import { db } from './server/db.js'; db.close();");
    assert.equal(reopened.status, 0, reopened.stderr || reopened.stdout);
    const restored = new DatabaseSync(reviewedPath, { readOnly: true });
    registerPitSqliteFunctions(restored);
    try {
      assertMemberGraph(restored);
      assert.doesNotThrow(() => assertDatabaseRecoveryReady(restored));
      for (const table of ["sessions", "email_verification_receipts", "email_queue"]) {
        assert.equal(restored.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, table);
      }
      const user = restored.prepare("SELECT pass_hash,reset_hash,reset_expires,email_verify_hash,email_verify_expires,signup_cancel_hash FROM users WHERE id='durable_member'").get();
      assert.deepEqual({ ...user }, { pass_hash: "fixture-hash", reset_hash: null, reset_expires: 0,
        email_verify_hash: null, email_verify_expires: 0, signup_cancel_hash: null });
      const approval = restored.prepare("SELECT status,token_hash FROM owner_approval_requests WHERE id='old-approval'").get();
      assert.deepEqual({ ...approval }, { status: "expired", token_hash: null });
      assert.equal(restored.prepare("SELECT COUNT(*) n FROM owner_approval_receipts WHERE id='durable-receipt'").get().n, 1);
      assert.equal(restored.prepare("SELECT COUNT(*) n FROM email_campaigns WHERE id='durable-campaign'").get().n, 1);
    }
    finally { restored.close(); }
    const unchanged = new DatabaseSync(snapshotPath, { readOnly: true });
    try {
      assert.equal(unchanged.prepare("SELECT COUNT(*) n FROM sessions").get().n, 1, "preparation never changes the snapshot");
      assert.equal(unchanged.prepare("SELECT COUNT(*) n FROM email_queue").get().n, 1);
      assert.throws(() => assertDatabaseRecoveryReady(unchanged), { code: "DATABASE_RESTORE_REVIEW_REQUIRED" });
    } finally { unchanged.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
