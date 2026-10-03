// Synthetic fixture is embedded to keep this isolated patch within its five-file scope.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";

if (process.env.PIT_NEWS_MINIMUM_FIXTURE === "1") {
  const directory = resolve(process.env.PIT_DATA_DIR || ".");
  assert.equal(process.env.PIT_NEWS_MINIMUM_FIXTURE, "1");
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("pit-news-minimum-http-"));
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(typeof process.send, "function");
  const denied = () => { process.send({ kind: "outbound-blocked" }); throw new Error("Fixture outbound network disabled"); };
  globalThis.fetch = async () => denied();
  http.request = denied; http.get = denied; https.request = denied; https.get = denied;
  net.connect = denied; net.createConnection = denied; tls.connect = denied; net.Socket.prototype.connect = denied;
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function fixtureListen(port) {
    assert.equal(arguments.length, 1);
    assert.equal(port, Number(process.env.PORT));
    this.once("listening", () => process.send({ kind: "listener-bound", address: this.address().address, port: this.address().port }));
    return listen.call(this, { port: 0, host: "127.0.0.1" });
  };
  syncBuiltinESMExports();

  const { db, q } = await import("../../db.js");
  const { createSession, destroySession, COOKIE } = await import("../../auth.js");
  const { ensureNewsDeskSchema, createNewsDeskReader } = await import("./newsDeskService.js");
  const at = Date.now();
  ensureNewsDeskSchema(db);
  const users = {};
  for (const [name, role] of [["editor", "editor"], ["collaborator", "editor"], ["outsider", "editor"], ["admin", "admin"], ["fan", "fan"], ["unverified", "editor"], ["revoked", "editor"], ["publisher", "moderator"]]) {
    const id = `workspace_${name}`;
    q.insertUser.run(id, `${id}@example.test`, id, id, "synthetic-unused-hash", role, "Toronto", null, null, "NC", "#123456", at);
    db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus',onboarding_version=1 WHERE id=?").run(name === "unverified" ? 0 : at, id);
    const session = createSession(id);
    users[name] = { id, cookie: `${COOKIE}=${session.token}` };
    if (name === "revoked") destroySession(session.token);
  }
  for (const count of [499, 500, 750, 1001]) {
  const sourceKey = `users/workspace_editor/post/minimum-source-${count}.jpg`;
  const renderKey = `users/workspace_editor/post/minimum-safe-${count}.jpg`;
  const photoUrl = `https://media.example.test/${renderKey}`;
  for (const [key, scope] of [[sourceKey, "private"], [renderKey, "public"]]) {
    db.prepare(`INSERT INTO media_objects(object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
      VALUES (?,'workspace_editor',?,'post',4096,'issued',?,?)`).run(key, scope, at, at);
  }
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
      original_name,mime_type,byte_size,width,height,orientation,metadata_status,codec_status,status,
      edit_recipe,recipe_version,finalize_hash,source_verified_at,render_state,render_variant_id,created_at,updated_at)
    VALUES ('ma_workspace_photo_${count}','workspace_editor','minimum-photo-${count}',?,'post','image',?,?,'private',
      'category.jpg','image/jpeg',4096,1200,1500,0,'declared','not_applicable','ready','{}',1,?,?,'ready','mv_workspace_photo_${count}',?,?)`)
    .run("a".repeat(64), sourceKey, `pit-private:${sourceKey}`, "b".repeat(64), at, at, at);
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
      status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES ('mv_workspace_photo_${count}','ma_workspace_photo_${count}','minimum-render-${count}',?,'render',?,?,'image/jpeg',2048,1200,1500,
      'verified',?,?,'private_derivative_v1',?,?)`).run("c".repeat(64), renderKey, photoUrl, "d".repeat(64), at, at, at);

  }
  process.on("message", ({ id, operation } = {}) => {
    try {
    if (operation !== "snapshot") throw new Error("Unknown fixture operation");
    process.send({ kind: "reply", id, result: {
      drafts: db.prepare("SELECT id,status,result,story_post_id FROM news_drafts").all(),
      posts: db.prepare("SELECT id,review FROM posts WHERE user_id='workspace_publisher'").all(),
      stories: db.prepare("SELECT body,sources FROM news_stories").all(),
      audits: db.prepare("SELECT action FROM moderation_actions WHERE action LIKE 'news_draft_%'").all(),
      paid: db.prepare("SELECT COUNT(*) n FROM news_desk_receipts").get().n,
    } });
    } catch (error) { process.send({ kind: "reply", id, error: error.message }); }
  });
  process.send({ kind: "fixture", users });
  await import("../../index.js");
} else {
  test("real isolated HTTP save/publish enforces 500 words without a 750-word maximum", { timeout: 45000 }, async t => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const directory = mkdtempSync(join(tmpdir(), "pit-news-minimum-http-"));
    const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { NODE_ENV: "test", RENDER: "true", PORT: "3000", PUBLIC_ORIGIN: "http://127.0.0.1",
      PIT_DATA_DIR: directory, PIT_NEWS_MINIMUM_FIXTURE: "1", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true",
      NEWS_DESK_ACCOUNT_ID: "workspace_publisher", MEDIA_PUBLIC_BASE_URL: "https://media.example.test", ADMIN_EMAIL: "workspace_admin@example.test",
      NEWS_DESK_ENABLED: "false", PIT_MEDIA_API_ENABLED: "false", BACKUP_ENABLED: "false",
      EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", CACHE_WARM_ENABLED: "false", TOURDATE_REFRESH_ENABLED: "false" });
    const child = fork(fileURLToPath(import.meta.url), [], { cwd: root, env, execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
    let output = "", fixture, listener, outbound = 0, exited = false;
    const pending = new Map();
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-10000); });
    child.on("message", message => {
      if (message.kind === "fixture") fixture = message;
      if (message.kind === "listener-bound") listener = message;
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
    const deadline = Date.now() + 25000;
    while (!fixture || !listener) { if (exited || Date.now() > deadline) assert.fail(output); await new Promise(done => setTimeout(done, 25)); }
    assert.equal(listener.address, "127.0.0.1");
    const origin = `http://127.0.0.1:${listener.port}`, base = "/api/moderation/news-desk/editor/drafts";
    const request = async (path, body, expected = 200) => {
      const response = await fetch(origin + path, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers: {
        Origin: "http://127.0.0.1", "Content-Type": "application/json", Cookie: fixture.users.editor.cookie, "X-Pit-Expected-Account": fixture.users.editor.id,
      }, body: JSON.stringify(body) });
      const data = await response.json();
      assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)} ${response.status === 500 ? output : ""}`);
      return data;
    };
    const article = count => ({ headline: "Synthetic band announces a new studio album",
      summary: "Independent music reports confirm the new album and its release plans.",
      body: Array.from({ length: count }, (_, index) => `album${index + 1}`).join(" "), idempotencyKey: `minimum-fixture-${count}`,
      sources: [{ kind: "article", name: "NME", url: "https://www.nme.com/news/minimum-fixture" },
        { kind: "article", name: "Stereogum", url: "https://www.stereogum.com/minimum-fixture" },
        { kind: "article", name: "Pitchfork", url: "https://pitchfork.com/news/minimum-fixture" }],
      photo: { assetId: `ma_workspace_photo_${count}`, name: "Synthetic photographer", url: "https://example.test/photo-rights", credit: "Synthetic attribution" } });
    const denied = await request(base + "/self-written", article(499), 400);
    assert.match(denied.error?.message || denied.message || JSON.stringify(denied), /at least 500 words/u);
    for (const count of [500, 750, 1001]) {
      const value = article(count), saved = (await request(base + "/self-written", value)).draft;
      assert.equal(saved.wordCount, count);
      assert.equal((await request(base + "/self-written", value)).draft.id, saved.id, "retry keeps one draft");
      const published = await request(`${base}/${saved.id}/publish`, {});
      assert.equal(published.draft.status, "published");
      assert.equal(published.draft.body, value.body);
      assert.equal(published.draft.photo.assetId, value.photo.assetId);
      assert.equal(published.draft.sources.filter(source => source.kind === "article").length, 3);
      assert.equal(published.draft.sources.find(source => source.kind === "photo").credit, value.photo.credit);
    }
    const snapshot = await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture IPC timeout")), 10000);
      pending.set("snapshot", message => { clearTimeout(timer); message.error ? reject(new Error(message.error)) : done(message.result); });
      child.send({ id: "snapshot", operation: "snapshot" });
    });
    assert.equal(snapshot.drafts.length, 3); assert.equal(snapshot.posts.length, 3); assert.equal(snapshot.stories.length, 3);
    assert.deepEqual(snapshot.stories.map(story => story.body.split(/\s+/u).length).sort((a,b) => a-b), [500,750,1001]);
    assert.equal(snapshot.audits.filter(audit => audit.action === "news_draft_written").length, 3);
    assert.equal(snapshot.audits.filter(audit => audit.action === "news_draft_published").length, 3);
    assert.equal(snapshot.paid, 0); assert.equal(outbound, 0);
  });
}
