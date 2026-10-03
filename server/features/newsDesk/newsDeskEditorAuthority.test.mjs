import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-news-editor-authority-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
const { db, q } = await import("../../db.js");
const { createSession, destroySession } = await import("../../auth.js");
const { readAuthorizedRequest } = await import("../../requestAuthorization.js");
const { ApiError } = await import("../../errors.js");
const { createNewsDeskEditor } = await import("./newsDeskEditor.js");
const { newsDeskEditorRoutes } = await import("./newsDeskEditorRoutes.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

const PATH = "/api/moderation/news-desk/editor/drafts";
const URLS = ["https://www.nme.com/news/authority-fixture-tour", "https://pitchfork.com/news/authority-fixture-tour"];
let sequence = 0;
const gate = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};

// These are real sessions and the production request/session guard. Only article
// and model transports are local doubles; no mail or provider is contacted.
async function fixture({ stage = "none", role = "editor", providerError = null, afterDraft = null } = {}) {
  const id = `authority_editor_${++sequence}`;
  const at = Date.now();
  q.insertUser.run(id, `${id}@example.test`, "Synthetic Editor", id, "not-a-login-credential", role,
    null, null, null, "SE", "#123456", at);
  db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus' WHERE id=?").run(at, id);
  const { token } = createSession(id);
  const controller = new AbortController(), entered = gate(), resume = gate();
  let articles = 0, providerCalls = 0;
  const editor = createNewsDeskEditor({ database: db, env: { NEWS_DESK_ACCOUNT_ID: id },
    fetchArticle: async () => {
      assert.equal(db.isTransaction, false);
      if (++articles === 1 && ["pasted", "feed"].includes(stage)) { entered.release(); await resume.promise; }
      return "<title>Fixture Band Announces New Tour</title><p>Independent reports confirm the dates.</p>";
    },
    summarize: async reports => {
      providerCalls++;
      assert.equal(db.isTransaction, false);
      if (stage === "provider") { entered.release(); await resume.promise; }
      if (providerError) throw providerError;
      return { publish: true, headline: "Fixture Band Announces New Tour", summary: "Independent reports confirm the dates.",
        body: "Synthetic news draft.", category: "tour", artists: [], supporting: reports, costUsd: 0.01 };
    },
  });
  if (stage === "feed") URLS.forEach((url, index) => db.prepare(`INSERT OR REPLACE INTO news_reports
    (url,source_id,title,category,published_at,fetched_at) VALUES (?,?,?,'tour',?,?)`)
    .run(url, ["nme", "pitchfork"][index], "Fixture Band Announces New Tour", at, at));
  const body = stage === "feed" ? { reportUrls: URLS } : { links: URLS };
  const authorized = await readAuthorizedRequest({ token, expectedAccount: id, method: "POST", pathname: PATH, readBody: async () => body });
  const routes = newsDeskEditorRoutes({ database: db, ApiError, rateLimit() {},
    editor: afterDraft ? { draft: async options => { const saved = await editor.draft(options); afterDraft({ id, token, controller }); return saved; } } : editor,
    requireAdmin(ctx) {
      const user = ctx.assertCurrentSession();
      if (!["admin", "editor"].includes(user.role)) throw new ApiError(403, "Forbidden", "FORBIDDEN");
      return user;
    },
  });
  const previousReceipts = new Set(db.prepare("SELECT token FROM news_desk_receipts").all().map(row => row.token));
  return { id, token, controller, entered, resume, editor,
    run: () => routes[`POST ${PATH}`]({ ...authorized, signal: controller.signal, setHeader() {}, requestId: `request-${id}` }),
    calls: () => ({ articles, providerCalls }),
    receipts: () => db.prepare("SELECT * FROM news_desk_receipts").all().filter(row => !previousReceipts.has(row.token)),
    saved: () => ({ drafts: db.prepare("SELECT COUNT(*) n FROM news_drafts WHERE created_by=?").get(id).n,
      audits: db.prepare("SELECT COUNT(*) n FROM moderation_actions WHERE actor_id=?").get(id).n }),
  };
}

const changes = [
  ["logout", f => destroySession(f.token), "AUTH_REQUIRED"],
  ["session revocation", f => db.prepare("DELETE FROM sessions WHERE user_id=?").run(f.id), "AUTH_REQUIRED"],
  ["expiry", f => db.prepare("UPDATE sessions SET expires_at=? WHERE user_id=?").run(Date.now() - 1, f.id), "AUTH_REQUIRED"],
  ["demotion", f => db.prepare("UPDATE users SET role='fan' WHERE id=?").run(f.id), "AUTH_REQUIRED"],
  ["suspension", f => db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, f.id), "FORBIDDEN"],
  ["ban", f => db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(f.id), "FORBIDDEN"],
  ["verification withdrawal", f => db.prepare("UPDATE users SET email_verified_at=0 WHERE id=?").run(f.id), "EMAIL_VERIFICATION_REQUIRED"],
  ["request cancellation", f => f.controller.abort(), "AbortError"],
];
for (const stage of ["pasted", "feed", "provider"]) for (const [name, change, code] of changes) {
  test(`${name} during ${stage} work prevents draft/audit and preserves incurred spend`, { timeout: 10_000 }, async () => {
    const f = await fixture({ stage });
    const pending = f.run();
    const rejected = assert.rejects(pending, error => error.code === code || error.name === code);
    await f.entered.promise;
    change(f); f.resume.release();
    await rejected;
    assert.deepEqual(f.saved(), { drafts: 0, audits: 0 });
    assert.equal(f.calls().providerCalls, stage === "provider" ? 1 : 0);
    if (stage === "pasted") assert.equal(f.calls().articles, 1, "revocation stops the next sequential article request");
    const receipts = f.receipts();
    assert.equal(receipts.length, stage === "provider" ? 1 : 0);
    if (receipts.length) { assert.equal(receipts[0].status, "settled"); assert.equal(receipts[0].charged_usd, 0.01); }
    assert.equal(db.isTransaction, false);
  });
}

for (const [name, error, status, charged] of [
  ["definite provider rejection", Object.assign(new Error("Synthetic rejection"), { status: 429 }), "settled", 0],
  ["uncertain provider failure", new Error("Synthetic connection loss"), "uncertain", null],
]) test(`revoked ${name} retains the existing receipt semantics`, async () => {
  const f = await fixture({ stage: "provider", providerError: error });
  const rejected = assert.rejects(f.run(), failure => failure.code === "AUTH_REQUIRED");
  await f.entered.promise; destroySession(f.token); f.resume.release(); await rejected;
  assert.deepEqual(f.saved(), { drafts: 0, audits: 0 });
  const receipts = f.receipts(); assert.equal(receipts.length, 1); assert.equal(receipts[0].status, status);
  if (charged === null) { assert.ok(receipts[0].charged_usd > 0); assert.equal(receipts[0].charged_usd, receipts[0].reserved_usd); }
  else assert.equal(receipts[0].charged_usd, charged);
});

for (const role of ["editor", "admin"]) test(`authorized ${role} still receives one audited draft`, async () => {
  const f = await fixture({ role }); const result = await f.run();
  assert.equal(result.draft.status, "draft"); assert.equal(result.draft.category, "tour");
  assert.deepEqual(f.saved(), { drafts: 1, audits: 1 }); assert.equal(f.receipts()[0].charged_usd, 0.01);
});

for (const cancellation of [false, true]) test(`${cancellation ? "cancellation" : "logout"} after commit fences response without erasing authorized work`, async () => {
  const f = await fixture({ afterDraft: actor => cancellation ? actor.controller.abort() : destroySession(actor.token) });
  await assert.rejects(f.run(), error => cancellation ? error.name === "AbortError" : error.code === "AUTH_REQUIRED");
  assert.deepEqual(f.saved(), { drafts: 1, audits: 1 }); assert.equal(f.receipts()[0].charged_usd, 0.01);
});
