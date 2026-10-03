import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after, before, beforeEach } from "node:test";

// Actual route table, request parsing, sessions, transactions and projections;
// only the ready-photo bytes/verification ledger are synthetic local fixtures.
const directory = mkdtempSync(join(tmpdir(), "pit-news-publishing-http-"));
Object.assign(process.env, { PIT_DATA_DIR: directory, PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true", NODE_ENV: "test",
  NEWS_DESK_ACCOUNT_ID: "publishing_fixture_account", MEDIA_PUBLIC_BASE_URL: "https://media.example.test",
  NEWS_DESK_ENABLED: "false", PIT_MEDIA_API_ENABLED: "false", PIT_CATALOG_API_ENABLED: "false" });
delete process.env.ANTHROPIC_API_KEY;
const realFetch = globalThis.fetch;
const external = [];
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== "127.0.0.1") { external.push(url.origin); throw new Error("Synthetic test forbids outbound requests"); }
  return realFetch(input, options);
};
const { db, q, DATABASE_PATH } = await import("../../db.js");
const { routes } = await import("../../api.js");
const { createSession, parseCookies, COOKIE, resetRateLimitsForTests } = await import("../../auth.js");
const { readAuthorizedRequest } = await import("../../requestAuthorization.js");
const { readJsonBody, assertUnsafeRequestOrigin } = await import("../../requestSecurity.js");
const { errorEnvelope } = await import("../../errors.js");
const base = "/api/moderation/news-desk/editor";
let origin, dropResponse = null, sequence = 0;
function matchRoute(method, pathname) {
  const direct = routes[`${method} ${pathname}`];
  if (direct) return { handler: direct, params: {} };
  const segments = pathname.split("/");
  for (const [key, handler] of Object.entries(routes)) {
    const [verb, pattern] = key.split(" "), expected = pattern.split("/");
    if (verb !== method || expected.length !== segments.length) continue;
    const params = {};
    if (expected.every((segment, index) => segment.startsWith(":")
      ? (params[segment.slice(1)] = segments[index], true) : segment === segments[index])) return { handler, params };
  }
  return null;
}
const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  try {
    const url = new URL(req.url, origin);
    assertUnsafeRequestOrigin(req.method, req.headers, new Set([origin]));
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const authorized = await readAuthorizedRequest({ token, expectedAccount: req.headers["x-pit-expected-account"],
      method: req.method, pathname: url.pathname, readBody: () => ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? readJsonBody(req) : {} });
    const match = matchRoute(req.method, url.pathname);
    assert.ok(match, "The requested route must exist in the production table");
    const result = await match.handler({ ...authorized, token, requestId, query: Object.fromEntries(url.searchParams), params: match.params,
      ip: "synthetic-publishing-http", ua: "synthetic", request: req, setHeader: (key, value) => res.setHeader(key, value) });
    if (dropResponse === url.pathname) { dropResponse = null; res.destroy(); return; }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result));
  } catch (error) {
    const envelope = errorEnvelope(error, requestId);
    res.writeHead(envelope.status, { "Content-Type": "application/json" }); res.end(JSON.stringify(envelope));
  }
});
before(async () => {
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => resetRateLimitsForTests());
after(async () => {
  server.closeAllConnections(); await new Promise(done => server.close(done));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM news_desk_receipts").get().n, 0, "self-written work never reserves paid calls");
  db.close(); globalThis.fetch = realFetch;
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  rmSync(directory, { recursive: true, force: true });
  assert.deepEqual(external, []);
});
function actor(role = "editor", verified = true) {
  const id = `publishing_editor_${++sequence}`, at = Date.now();
  q.insertUser.run(id, `${id}@example.test`, id, id, "synthetic-unused-hash", role, "Toronto", null, null, "NP", "#000000", at);
  db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus',onboarding_version=1 WHERE id=?").run(verified ? at : 0, id);
  return { id, cookie: `${COOKIE}=${createSession(id).token}` };
}
q.insertUser.run("publishing_fixture_account", "publisher@example.test", "Synthetic publisher", "publishing_fixture_account",
  "synthetic-unused-hash", "moderator", "Toronto", null, null, "NP", "#000000", Date.now());
function article(user) {
  const suffix = ++sequence, id = `ma_publishing_photo_${suffix}`, variant = `mv_publishing_photo_${suffix}`, at = Date.now();
  const source = `users/${user.id}/post/source-${suffix}.jpg`, render = `users/${user.id}/post/render-${suffix}.jpg`;
  for (const [key, scope] of [[source, "private"], [render, "public"]]) db.prepare("INSERT INTO media_objects(object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at) VALUES (?, ?,?,'post',1024,'issued',?,?)").run(key, user.id, scope, at, at);
  db.prepare(`INSERT INTO media_assets(id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,original_name,mime_type,byte_size,width,height,orientation,metadata_status,codec_status,source_verified_at,status,edit_recipe,render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,'synthetic','post','image',?,?,'private','photo','image/jpeg',1024,640,480,0,'declared','not_applicable',?,'ready','{}','ready',?,?,?)`).run(id, user.id, id, source, "pit-private:" + source, at, variant, at, at);
  db.prepare(`INSERT INTO media_variants(id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,'synthetic','render',?,?,'image/jpeg',1024,640,480,'verified','synthetic',?,'private_derivative_v1',?,?)`).run(variant, id, variant, render, "https://media.example.test/" + render, at, at, at);
  return { idempotencyKey: `publishing-save-${suffix}`, headline: "Synthetic band release a new studio album",
    summary: "The new record follows their previous chart success and world tour.",
    body: "Earlier songs topped the charts and won awards during a world tour. "
      + "The new album includes reported songs and confirmed creative details. ".repeat(120), category: "release",
    sources: [{ kind: "article", name: "NME", url: "https://www.nme.com/news/publishing-fixture" },
      { kind: "article", name: "Stereogum", url: "https://www.stereogum.com/publishing-fixture" },
      { kind: "article", name: "Pitchfork", url: "https://pitchfork.com/news/publishing-fixture" },
      { kind: "article", name: "Yonhap", url: "https://en.yna.co.kr/view/publishing-fixture" }],
    photo: { assetId: id, name: "Synthetic photographer", url: "https://example.test/photo-rights", credit: "Original image" } };
}
async function request(path, { user, expectedAccount = user?.id, method = "GET", body } = {}) {
  const response = await globalThis.fetch(origin + path, { method, redirect: "error", signal: AbortSignal.timeout(10_000), headers: {
    Origin: origin, ...(user ? { Cookie: user.cookie } : {}), ...(expectedAccount ? { "X-Pit-Expected-Account": expectedAccount } : {}),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
const post = (path, user, body) => request(path, { user, method: "POST", body });
const save = async (user, value) => {
  const response = await post(base + "/drafts/self-written", user, value);
  assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data.draft;
};
const publish = (user, draft, body = { expectedRevision: draft.revision }) => post(`${base}/drafts/${draft.id}/publish`, user, body);
const row = draft => db.prepare("SELECT * FROM news_drafts WHERE id=?").get(draft.id);
const audits = (draft, action = "news_draft_published") => db.prepare("SELECT COUNT(*) n FROM moderation_actions WHERE target_id=? AND action=?").get(draft.id, action).n;

test("lost save response reopens one exact article, photo and all sources; edited intent cannot reuse its receipt", async () => {
  const user = actor(), value = article(user);
  dropResponse = base + "/drafts/self-written";
  await assert.rejects(post(dropResponse, user, value));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM news_drafts WHERE created_by=?").get(user.id).n, 1);
  const draft = await save(user, value), again = await save(user, value);
  assert.equal(draft.id, again.id); assert.equal(audits(draft, "news_draft_written"), 1);
  const overview = await request(base, { user });
  const reopened = overview.data.drafts.recent.find(item => item.id === draft.id);
  assert.equal(reopened.body, value.body.trim()); assert.equal(reopened.category, "release");
  assert.equal(reopened.photo.assetId, value.photo.assetId); assert.equal(reopened.photo.status, "ready");
  assert.equal(reopened.sources.filter(source => source.kind === "article").length, 4);
  assert.equal(reopened.photo.source.url, value.photo.url);
  const changed = { ...value, summary: "The editor revised this article after its interrupted save." };
  assert.equal((await post(base + "/drafts/self-written", user, changed)).status, 409);
  assert.notEqual((await save(user, { ...changed, idempotencyKey: value.idempotencyKey + "-edited" })).id, draft.id);
});

test("HTTP publish refuses missing/malformed or stale revisions and admits only the refreshed draft", async () => {
  const user = actor(), draft = await save(user, article(user));
  for (const body of [{}, null, [], { expectedRevision: null }, { expectedRevision: "0" }, { expectedRevision: false },
    { expectedRevision: -1 }, { expectedRevision: 0.5 }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { expectedRevision: 0, extra: true }]) {
    const response = await publish(user, draft, body); assert.equal(response.status, 400, JSON.stringify(response.data));
    if (body && Object.keys(body).length === 0 && !Array.isArray(body))
      assert.equal(response.data.error, "Update or reload Newsroom, then review the current draft before publishing.");
    assert.equal(row(draft).status, "draft"); assert.equal(audits(draft), 0);
  }
  const concurrent = new DatabaseSync(DATABASE_PATH);
  try {
    const updated = { ...JSON.parse(row(draft).result), summary: "A second editor's reviewed update to the album announcement." };
    concurrent.prepare("UPDATE news_drafts SET result=?,revision=revision+1 WHERE id=? AND revision=0").run(JSON.stringify(updated), draft.id);
  } finally { concurrent.close(); }
  assert.equal((await publish(user, draft)).status, 409);
  const current = (await request(base, { user })).data.drafts.recent.find(item => item.id === draft.id);
  assert.equal(current.revision, 1); assert.match(current.summary, /second editor/u);
  const published = await publish(user, current);
  assert.equal(published.status, 200, JSON.stringify(published.data)); assert.equal(published.data.draft.revision, 2);
  assert.equal(audits(draft), 1); assert.equal((await publish(user, current)).status, 409);
});

test("concurrent publish and lost-response retries commit one story, media association and audit", async () => {
  const user = actor(), value = article(user), draft = await save(user, value);
  const attempts = await Promise.all([publish(user, draft), publish(user, draft)]);
  assert.deepEqual(attempts.map(result => result.status).sort(), [200, 409]);
  assert.equal(audits(draft), 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM post_media WHERE asset_id=?").get(value.photo.assetId).n, 1);
  const other = await save(user, article(user));
  dropResponse = `${base}/drafts/${other.id}/publish`;
  await assert.rejects(publish(user, other));
  assert.equal((await publish(user, other)).status, 409);
  const current = (await request(base, { user })).data.drafts.recent.find(item => item.id === other.id);
  assert.equal(current.status, "published"); assert.equal(audits(other), 1);
  const publicPost = await request("/api/posts/" + current.postId);
  assert.equal(publicPost.status, 200); assert.equal(publicPost.data.post.news.category, "release");
});

test("HTTP authorization and source/photo boundaries reject unauthorized publishing without a partial story", async () => {
  const user = actor(), value = article(user), draft = await save(user, value);
  for (const [other, status] of [[undefined, 401], [actor("fan"), 403], [actor("editor", false), 403]])
    assert.equal((await publish(other, draft)).status, status);
  assert.equal((await request(`${base}/drafts/${draft.id}/publish`, { user, expectedAccount: actor().id, method: "POST", body: { expectedRevision: 0 } })).status, 409);
  for (const restriction of ["is_banned=1", "suspended_until=" + (Date.now() + 60_000), "role='fan'", "email_verified_at=0"]) {
    const other = actor(); db.prepare(`UPDATE users SET ${restriction} WHERE id=?`).run(other.id);
    assert.equal((await publish(other, draft)).status, 403);
  }
  const revoked = actor(); db.prepare("DELETE FROM sessions WHERE user_id=?").run(revoked.id);
  assert.equal((await publish(revoked, draft)).status, 409);
  const invalid = { ...value, idempotencyKey: value.idempotencyKey + "-invalid", sources: value.sources.slice(0, 2) };
  assert.equal((await post(base + "/drafts/self-written", user, invalid)).status, 400);
  const foreign = actor(), foreignDraft = await save(foreign, { ...value, idempotencyKey: value.idempotencyKey + "-foreign" });
  assert.equal(foreignDraft.photo.status, "unavailable");
  const deniedPhoto = await publish(foreign, foreignDraft);
  assert.equal(deniedPhoto.status, 409, JSON.stringify(deniedPhoto.data));
  assert.equal(deniedPhoto.data.code, "CONFLICT");
  db.prepare("UPDATE media_variants SET status='failed' WHERE asset_id=?").run(value.photo.assetId);
  assert.equal((await publish(user, draft)).status, 409);
  for (const item of [draft, foreignDraft]) { assert.equal(row(item).status, "draft"); assert.equal(row(item).story_post_id, null); assert.equal(audits(item), 0); }
});

test("save, publish and discard rollback on audit failure or access withdrawn inside the transaction", async () => {
  const user = actor(), value = article(user);
  db.exec("CREATE TEMP TRIGGER fail_news_save_audit BEFORE INSERT ON moderation_actions WHEN NEW.action='news_draft_written' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
  try { assert.equal((await post(base + "/drafts/self-written", user, value)).status, 500); }
  finally { db.exec("DROP TRIGGER fail_news_save_audit"); }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM news_drafts WHERE created_by=?").get(user.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM news_editor_save_receipts WHERE actor_id=?").get(user.id).n, 0);
  for (const action of ["news_draft_written", "news_draft_published", "news_draft_discarded"]) {
    const draft = action === "news_draft_written" ? null : await save(user, { ...article(user), idempotencyKey: `rollback-${++sequence}` });
    const before = draft ? row(draft) : null;
    db.exec(`CREATE TEMP TRIGGER revoke_news_audit AFTER INSERT ON moderation_actions WHEN NEW.action='${action}' BEGIN DELETE FROM sessions WHERE user_id='${user.id}'; END`);
    try {
      const response = action === "news_draft_written" ? await post(base + "/drafts/self-written", user, value)
        : action === "news_draft_published" ? await publish(user, draft) : await post(`${base}/drafts/${draft.id}/discard`, user, {});
      assert.equal(response.status, 401, JSON.stringify(response.data));
    } finally { db.exec("DROP TRIGGER revoke_news_audit"); }
    if (draft) { assert.deepEqual(row(draft), before); assert.equal(audits(draft, action), 0); }
    else assert.equal(db.prepare("SELECT COUNT(*) n FROM news_editor_save_receipts WHERE actor_id=? AND idempotency_key=?").get(user.id, value.idempotencyKey).n, 0);
  }
  const recovered = await save(user, value);
  const before = row(recovered);
  db.exec("CREATE TEMP TRIGGER fail_news_publish_audit BEFORE INSERT ON moderation_actions WHEN NEW.action='news_draft_published' BEGIN SELECT RAISE(ABORT,'synthetic publication audit failure'); END");
  try { assert.equal((await publish(user, recovered)).status, 500); }
  finally { db.exec("DROP TRIGGER fail_news_publish_audit"); }
  assert.deepEqual(row(recovered), before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM post_media WHERE asset_id=?").get(value.photo.assetId).n, 0);
  assert.equal(audits(recovered), 0);
  const published = await publish(user, recovered);
  assert.equal(published.status, 200, JSON.stringify(published.data)); assert.equal(audits(recovered), 1);
});
