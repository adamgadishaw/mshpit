import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const base = "/api/moderation/news-desk/editor";

test("real HTTP preserves the manual category and corrects only the existing article with session, CAS and audit guards", { timeout: 120_000 }, async t => {
  const probe = createServer();
  await new Promise(done => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const directory = mkdtempSync(join(tmpdir(), "pit-news-category-http-"));
  const environment = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA"]
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(environment, { NODE_ENV: "test", RENDER: "true", PORT: String(port), PUBLIC_ORIGIN: origin,
    PIT_DATA_DIR: directory, PIT_NEWS_CATEGORY_FIXTURE: "1", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true",
    NEWS_DESK_ACCOUNT_ID: "category_publisher", MEDIA_PUBLIC_BASE_URL: "https://media.example.test",
    NEWS_DESK_ENABLED: "false", PIT_MEDIA_API_ENABLED: "false", BACKUP_ENABLED: "false",
    EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", CACHE_WARM_ENABLED: "false", TOURDATE_REFRESH_ENABLED: "false" });
  const child = fork(join(root, "server/index.js"), [], {
    cwd: root, env: environment,
    execArgv: ["--max-old-space-size=192", "--import", pathToFileURL(join(root, "scripts/fixtures/news-category-server-preload.mjs")).href],
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
  });
  let output = "", outbound = 0, fixture, address, exited = false;
  const pending = new Map();
  child.stdout.on("data", data => { output = (output + data).slice(-10_000); });
  child.stderr.on("data", data => { output = (output + data).slice(-10_000); });
  child.on("message", message => {
    if (message.kind === "fixture") fixture = message;
    if (message.kind === "listener-bound") address = message.address;
    if (message.kind === "outbound-blocked") outbound++;
    if (message.kind === "reply") pending.get(message.id)?.(message);
  });
  const exit = new Promise(done => child.once("exit", () => { exited = true; done(); }));
  t.after(async () => {
    if (!exited) child.kill();
    await exit;
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const deadline = Date.now() + 25_000;
  while (!fixture || !address) {
    if (exited || Date.now() > deadline) assert.fail(`Fixture server did not start: ${output}`);
    await new Promise(done => setTimeout(done, 25));
  }
  assert.equal(address, "127.0.0.1");
  let sequence = 0;
  const ipc = (operation, postId, value) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture IPC timed out: ${operation}`)); }, 10_000);
    pending.set(id, message => { clearTimeout(timer); pending.delete(id); message.error ? reject(new Error(message.error)) : done(message.result); });
    child.send({ id, operation, postId, value });
  });
  const request = async (path, { user = fixture.users.editor, method = "PATCH", body } = {}) => {
    const response = await fetch(origin + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000), headers: {
      Origin: origin, "Content-Type": "application/json",
      ...(user ? { Cookie: user.cookie, "X-Pit-Expected-Account": user.id } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const story = {
    headline: "Fixture artist releases a new studio album",
    summary: "The album arrives before a world tour, following the artist's earlier chart success.",
    body: "A past single topped the chart and won a Grammy award during a previous world tour. "
      + "The new album brings together the reported music and its documented creative context.",
    category: "release",
    sources: [
      { kind: "article", name: "NME", url: "https://www.nme.com/news/category-fixture" },
      { kind: "article", name: "Stereogum", url: "https://www.stereogum.com/category-fixture" },
      { kind: "article", name: "Pitchfork", url: "https://pitchfork.com/news/category-fixture" },
    ],
    photo: { assetId: "ma_category_photo", name: "Fixture photographer", url: "https://example.test/photo-rights" },
    idempotencyKey: "category-fixture-create-0001",
  };
  const saved = await request(`${base}/drafts/self-written`, { method: "POST", body: story });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.draft.category, "release");
  const published = await request(`${base}/drafts/${saved.data.draft.id}/publish`, { method: "POST", body: {} });
  assert.equal(published.status, 200, JSON.stringify(published.data));
  const postId = published.data.postId;
  const snapshot = () => ipc("snapshot", postId);
  const original = await snapshot();
  assert.equal(original.publicStory.category, "release");
  assert.equal(original.article.articleSection, "New music");
  assert.match(original.html, /Mshpit News · New music/u);
  assert.equal(original.story.body, story.body.trim());
  assert.equal(original.post.user_id, fixture.users.publisher.id);
  assert.equal(original.media[0].asset_id, story.photo.assetId);
  assert.equal(original.paidReceipts, 0);

  await ipc("seed-legacy-category", postId);
  const before = await snapshot();
  const path = `${base}/stories/${postId}/category`;
  const correction = { category: "release", expectedCategory: "charts", expectedUpdatedAt: before.story.updated_at };
  const status = async (wanted, body = correction, options = {}) => {
    const result = await request(path, { body, ...options });
    assert.equal(result.status, wanted, JSON.stringify(result.data));
    return result;
  };
  await status(401, correction, { user: null });
  await status(403, correction, { user: fixture.users.fan });
  await status(403, correction, { user: fixture.users.publisher });
  await status(403, correction, { user: fixture.users.unverified });
  await status(409, correction, { user: fixture.users.revoked });
  await ipc("restrict-editor", postId, "fan");
  await status(403);
  await ipc("restrict-editor", postId, "editor");
  for (const extra of [{ category: "other" }, { expectedUpdatedAt: String(correction.expectedUpdatedAt) },
    { expectedCategory: "release" }, { expectedUpdatedAt: correction.expectedUpdatedAt - 1 }, { body: "replace" }]) {
    await status("body" in extra || "category" in extra || typeof extra.expectedUpdatedAt === "string" ? 400 : 409, { ...correction, ...extra });
  }
  assert.equal((await request(`${base}/stories/news_missing_fixture/category`, { body: correction })).status, 404);
  await ipc("set-origin", postId, "generated");
  await status(404);
  await ipc("set-origin", postId, "self_written");
  await ipc("remove-post", postId, true);
  await status(404);
  await ipc("remove-post", postId, false);
  await ipc("set-post-kind", postId, "review");
  await status(404);
  await ipc("set-post-kind", postId, "status");
  await ipc("restrict-publisher", postId, true);
  await status(409);
  await ipc("restrict-publisher", postId, false);
  await ipc("refuse-audit", postId);
  await status(500);
  await ipc("clear-audit-trigger", postId);
  let current = await snapshot();
  assert.deepEqual(current.story, before.story, "audit failure rolls back the correction");
  assert.deepEqual(current.audit, []);
  await ipc("revoke-during-audit", postId);
  await status(401);
  await ipc("clear-audit-trigger", postId);
  current = await snapshot();
  assert.deepEqual(current.story, before.story, "precommit session recheck rolls back the story and audit");
  assert.deepEqual(current.audit, []);
  const corrected = await status(200);
  assert.equal(corrected.data.changed, true);
  assert.equal(corrected.headers.get("cache-control"), "private, no-store");
  current = await snapshot();
  assert.deepEqual(current.story, { ...before.story, category: "release", updated_at: corrected.data.updatedAt });
  for (const field of ["post", "media", "comments", "likes"]) assert.deepEqual(current[field], before[field], `${field} stays intact`);
  assert.equal(current.story.created_at, original.story.created_at);
  assert.equal(current.audit.length, 1);
  assert.equal(current.audit[0].actor_id, fixture.users.editor.id);
  assert.deepEqual(JSON.parse(current.audit[0].prior_state), { category: "charts", updatedAt: correction.expectedUpdatedAt });
  assert.deepEqual(JSON.parse(current.audit[0].next_state), { category: "release", updatedAt: corrected.data.updatedAt });
  assert.equal(current.publicStory.category, "release");
  assert.equal(current.article.articleSection, "New music");
  assert.equal(current.article.dateModified, new Date(corrected.data.updatedAt).toISOString());
  assert.match(current.html, /Mshpit News · New music/u);
  await status(409, correction, { user: fixture.users.admin });
  const unchanged = await status(200, { category: "release", expectedCategory: "release", expectedUpdatedAt: corrected.data.updatedAt });
  assert.equal(unchanged.data.changed, false);
  assert.equal(unchanged.data.updatedAt, corrected.data.updatedAt);
  assert.equal((await snapshot()).audit.length, 1, "retries and no-ops do not duplicate correction audits");
  const adminCorrection = await status(200, { category: "tour", expectedCategory: "release", expectedUpdatedAt: corrected.data.updatedAt }, { user: fixture.users.admin });
  assert.equal(adminCorrection.data.changed, true, "a verified administrator can correct a manual story too");
  const adminSnapshot = await snapshot();
  assert.equal(adminSnapshot.audit.length, 2);
  assert.equal(adminSnapshot.audit[1].actor_id, fixture.users.admin.id);
  assert.deepEqual(adminSnapshot.post, before.post);
  assert.equal(outbound, 0, "actual runtime made no outbound/provider call");
  assert.equal((await snapshot()).paidReceipts, 0);
});
