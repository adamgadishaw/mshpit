import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createNewsDeskEditor } from "./newsDeskEditor.js";
import { newsDeskEditorRoutes } from "./newsDeskEditorRoutes.js";

const AT = Date.parse("2026-10-10T12:00:00Z");
const BASE = "/api/moderation/news-desk/editor/drafts";
const URLS = ["https://www.nme.com/news/audit-fixture-tour", "https://pitchfork.com/news/audit-fixture-tour"];

function fixture(t, { publish = true } = {}) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE users(id TEXT PRIMARY KEY,is_banned INTEGER DEFAULT 0,dormant_at INTEGER,suspended_until INTEGER);
    INSERT INTO users(id) VALUES ('fixture-news');
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,popularity REAL,data TEXT);
    CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT,artist TEXT,artist_key TEXT,venue TEXT,city TEXT,date TEXT,overall REAL,review TEXT,kind TEXT,created_at INTEGER);
    CREATE TABLE moderation_actions(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT,target_type TEXT,target_id TEXT,reason TEXT,prior_state TEXT,next_state TEXT,request_id TEXT,created_at INTEGER);`);
  let providerCalls = 0, articleCalls = 0, authorityGuard = () => {};
  const editor = createNewsDeskEditor({ database, env: { NEWS_DESK_ACCOUNT_ID: "fixture-news" }, now: () => AT,
    fetchArticle: async () => {
      articleCalls += 1;
      assert.equal(database.isTransaction, false, "article fetching never holds a database transaction");
      await Promise.resolve();
      assert.equal(database.isTransaction, false);
      return "<title>Fixture Band Announce World Tour</title><p>The dates are confirmed.</p>";
    },
    summarize: async reports => {
      providerCalls += 1;
      assert.equal(database.isTransaction, false, "the paid request runs before the short audited save");
      await Promise.resolve();
      assert.equal(database.isTransaction, false);
      return { publish, headline: "Fixture band announces world tour", summary: "Independent outlets confirm the dates.",
        body: "The fixture band is touring.", category: "tour", artists: [], supporting: reports,
        reason: publish ? "" : "fixture declined", costUsd: 0.01 };
    },
  });
  const insert = database.prepare("INSERT INTO news_reports(url,source_id,title,category,published_at,fetched_at) VALUES (?,?,?,'tour',?,?)");
  URLS.forEach((url, index) => insert.run(url, ["nme", "pitchfork"][index], "Fixture Band Announce World Tour", AT - 1000, AT));
  class ApiError extends Error {
    constructor(status, message, code) { super(message); this.status = status; this.code = code; }
  }
  const routes = newsDeskEditorRoutes({ database, editor, ApiError, now: () => AT, rateLimit() {},
    requireAdmin: () => { authorityGuard(); return { id: "fixture-admin", email_verified_at: AT }; } });
  const context = (id) => ({ body: { reportUrls: URLS }, params: { id }, requestId: "fixture-request", setHeader() {} });
  return {
    database, editor,
    calls: () => ({ providerCalls, articleCalls }),
    setAuthorityGuard: guard => { authorityGuard = guard; },
    draft: () => routes[`POST ${BASE}`](context()),
    publish: id => routes[`POST ${BASE}/:id/publish`]({ ...context(id), body: { expectedRevision: 0 } }),
    discard: id => routes[`POST ${BASE}/:id/discard`](context(id)),
    refuseAudit: action => database.exec(`CREATE TRIGGER refuse_editor_audit BEFORE INSERT ON moderation_actions
      WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END`),
    allowAudit: () => database.exec("DROP TRIGGER refuse_editor_audit"),
  };
}

for (const publish of [true, false]) {
  test(`an audit failure rolls back a ${publish ? "written" : "declined"} draft but preserves settled paid usage`, async t => {
    const f = fixture(t, { publish });
    f.refuseAudit("news_draft_written");
    await assert.rejects(f.draft(), /synthetic audit failure/u);
    assert.equal(f.database.isTransaction, false);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM news_drafts").get().n, 0);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM moderation_actions").get().n, 0);
    assert.deepEqual({ ...f.database.prepare("SELECT status,charged_usd FROM news_desk_receipts").get() }, { status: "settled", charged_usd: 0.01 });
    assert.deepEqual(f.calls(), { providerCalls: 1, articleCalls: 2 });
    f.allowAudit();
    const saved = await f.draft();
    assert.equal(saved.draft.status, publish ? "draft" : "declined");
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM moderation_actions WHERE target_id=? AND action='news_draft_written'").get(saved.draft.id).n, 1);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM news_desk_receipts WHERE status='settled'").get().n, 2, "an explicit paid retry keeps both charges");
  });
}

test("publication audit failure rolls back post, story, report ownership and draft state together", async t => {
  const f = fixture(t);
  const { draft } = await f.draft();
  f.refuseAudit("news_draft_published");
  await assert.rejects(f.publish(draft.id), /synthetic audit failure/u);
  assert.equal(f.database.isTransaction, false);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM posts").get().n, 0);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM news_stories").get().n, 0);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM news_reports WHERE story_id IS NOT NULL").get().n, 0);
  assert.deepEqual({ ...f.database.prepare("SELECT status,story_post_id FROM news_drafts WHERE id=?").get(draft.id) }, { status: "draft", story_post_id: null });
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM moderation_actions").get().n, 1, "the earlier draft audit remains");
  assert.deepEqual({ ...f.database.prepare("SELECT status,charged_usd FROM news_desk_receipts").get() }, { status: "settled", charged_usd: 0.01 });
  f.allowAudit();
  const published = await f.publish(draft.id);
  assert.equal(published.draft.status, "published");
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM posts").get().n, 1);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM news_reports WHERE story_id IS NOT NULL").get().n, 2);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM moderation_actions WHERE action='news_draft_published'").get().n, 1);
  await assert.rejects(f.publish(draft.id), error => error.code === "CONFLICT");
  assert.equal(f.calls().providerCalls, 1, "publication retries are not paid requests");
});

for (const boundary of ["before insert", "after audit"]) {
  test(`authority loss ${boundary} rolls back draft and audit while retaining settled spend`, async t => {
    const f = fixture(t);
    let observed = false;
    f.setAuthorityGuard(() => {
      if (!f.database.isTransaction) return;
      const audited = f.database.prepare("SELECT COUNT(*) n FROM moderation_actions").get().n > 0;
      if ((boundary === "before insert" && !audited) || (boundary === "after audit" && audited)) {
        observed = true;
        throw Object.assign(new Error("Synthetic authority withdrawal"), { code: "AUTH_REQUIRED" });
      }
    });
    await assert.rejects(f.draft(), error => error.code === "AUTH_REQUIRED");
    assert.equal(observed, true, "the fresh guard runs inside the requested transaction boundary");
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM news_drafts").get().n, 0);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM moderation_actions").get().n, 0);
    assert.deepEqual({ ...f.database.prepare("SELECT status,charged_usd FROM news_desk_receipts").get() }, { status: "settled", charged_usd: 0.01 });
    assert.equal(f.database.isTransaction, false);
    f.setAuthorityGuard(() => {});
    const retry = await f.draft();
    assert.equal(retry.draft.status, "draft", "failed authorization releases the in-flight guard for an explicit authorized retry");
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM news_desk_receipts").get().n, 2);
  });
}

test("discard audit failure preserves the saved draft and succeeds atomically on retry", async t => {
  const f = fixture(t);
  const { draft } = await f.draft();
  const before = f.database.prepare("SELECT * FROM news_drafts WHERE id=?").get(draft.id);
  f.refuseAudit("news_draft_discarded");
  await assert.rejects(f.discard(draft.id), /synthetic audit failure/u);
  assert.equal(f.database.isTransaction, false);
  assert.deepEqual(f.database.prepare("SELECT * FROM news_drafts WHERE id=?").get(draft.id), before);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM moderation_actions WHERE action='news_draft_discarded'").get().n, 0);
  f.allowAudit();
  const discarded = await f.discard(draft.id);
  assert.equal(discarded.draft.status, "discarded");
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM moderation_actions WHERE action='news_draft_discarded' AND target_id=?").get(draft.id).n, 1);
  assert.equal(f.calls().providerCalls, 1);
});

test("editor audit callbacks execute only inside their synchronous mutation transaction", async t => {
  const f = fixture(t);
  const seen = [];
  const saved = await f.editor.draft({ reportUrls: URLS, onSaved: draft => {
    assert.equal(f.database.isTransaction, true);
    seen.push(`saved:${draft.status}`);
  } });
  f.editor.publish(saved.id, { onPublished: ({ draft, postId }) => {
    assert.equal(f.database.isTransaction, true);
    assert.ok(f.database.prepare("SELECT id FROM posts WHERE id=?").get(postId));
    seen.push(`published:${draft.status}`);
  } });
  const other = f.database.prepare("SELECT * FROM news_drafts WHERE id=?").get(saved.id);
  f.database.prepare("INSERT INTO news_drafts(id,status,reports,result,cost_usd,created_at,updated_at) VALUES (?,'draft',?,?,0,?,?)")
    .run("00000000-fixture-discard", other.reports, other.result, AT, AT);
  f.editor.discard("00000000-fixture-discard", { onDiscarded: draft => {
    assert.equal(f.database.isTransaction, true);
    seen.push(`discarded:${draft.status}`);
  } });
  assert.deepEqual(seen, ["saved:draft", "published:published", "discarded:discarded"]);
  assert.equal(f.database.isTransaction, false);
});
