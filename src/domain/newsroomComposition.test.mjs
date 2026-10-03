import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { emptyNewsroomForm, MAX_NEWSROOM_ARTICLE_SOURCES, newsroomArticlePayload, newsroomDraftEnvelope, newsroomSaveAttempt, restoreNewsroomDraft, NEWSROOM_DRAFT_TTL_MS } from "./newsroomComposition.mjs";

test("lost save retries preserve a key across retention; edited intent rotates once", () => {
  const form = { ...emptyNewsroomForm(), body: "reported tour detail ".repeat(1000), photo: { assetId: "ma_owned_photo", uri: "private-file", file: "secret" } };
  let sequence = 0;
  const newKey = () => `newsroom-key-${++sequence}`;
  const first = newsroomSaveAttempt(null, newsroomArticlePayload(form), newKey);
  const restored = restoreNewsroomDraft("owner-a", newsroomDraftEnvelope("owner-a", form, first, null, 100), 101);
  assert.equal(restored.form.body, form.body);
  assert.deepEqual(restored.form.photo, { assetId: "ma_owned_photo" });
  assert.equal(newsroomSaveAttempt(restored.attempt, newsroomArticlePayload(restored.form), newKey).key, first.key);
  const edited = newsroomSaveAttempt(first, newsroomArticlePayload({ ...form, summary: "Edited after the response was lost." }), newKey);
  assert.notEqual(edited.key, first.key);
  assert.equal(newsroomSaveAttempt(edited, JSON.parse(edited.payload), newKey).key, edited.key);
  assert.equal(sequence, 2);
});
test("retained drafts reject foreign accounts and expire with server draft lifetime", () => {
  const stored = newsroomDraftEnvelope("owner-a", emptyNewsroomForm(), null, null, 100);
  assert.equal(restoreNewsroomDraft("owner-b", stored, 101), null);
  assert.equal(restoreNewsroomDraft("owner-a", stored, 100 + NEWSROOM_DRAFT_TTL_MS), null);
  assert.equal(restoreNewsroomDraft("owner-a", stored, 99), null);
});

test("optional article sources persist through retention, blank rows stay local, and payloads omit only blank rows", () => {
  const form = { ...emptyNewsroomForm(), sources: [
    { name: "NME", url: "https://www.nme.com/news/one" },
    { name: "Stereogum", url: "https://www.stereogum.com/two" },
    { name: "Pitchfork", url: "https://pitchfork.com/news/three" },
    { name: "Yonhap", url: "https://en.yna.co.kr/view/four" },
    { name: "", url: "" },
  ] };
  const payload = newsroomArticlePayload(form);
  assert.equal(payload.sources.length, 4);
  const retained = restoreNewsroomDraft("owner-a", newsroomDraftEnvelope("owner-a", form, null, null, 100), 101);
  assert.equal(retained.form.sources.length, 5);
  assert.deepEqual(retained.form.sources[3], form.sources[3]);
  assert.deepEqual(retained.form.sources[4], { name: "", url: "" });
});

test("client source retention is bounded at the server's ten-source maximum", () => {
  const sources = Array.from({ length: MAX_NEWSROOM_ARTICLE_SOURCES + 2 }, (_, index) => ({ name: `Publisher ${index}`, url: `https://example.test/${index}` }));
  const form = { ...emptyNewsroomForm(), sources };
  const retained = restoreNewsroomDraft("owner-a", newsroomDraftEnvelope("owner-a", form, null, null, 100), 101);
  assert.equal(retained.form.sources.length, MAX_NEWSROOM_ARTICLE_SOURCES);
  assert.equal(newsroomArticlePayload(form).sources.length, MAX_NEWSROOM_ARTICLE_SOURCES);
});

function longEscapedArticle() {
  const words = "reported music ".repeat(1000);
  return { ...emptyNewsroomForm(), headline: "Synthetic band announces a new studio album",
    summary: "The new record includes reported songs and confirmed creative details.", category: "release",
    body: words + String.fromCharCode(34, 92).repeat((60000 - words.length) / 2),
    sources: [{ name: "NME", url: "https://www.nme.com/news/synthetic" },
      { name: "Stereogum", url: "https://www.stereogum.com/synthetic" },
      { name: "Pitchfork", url: "https://pitchfork.com/news/synthetic" }],
    photo: { assetId: "ma_synthetic_photo" }, photoName: "Synthetic photographer", photoUrl: "https://example.test/rights" };
}

async function receiptEditor(t) {
  const { createNewsDeskEditor } = await import("../../server/features/newsDesk/newsDeskEditor.js");
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  // Draft admission only: no provider, filesystem media, account or publisher.
  database.exec(`CREATE TABLE media_assets(id TEXT PRIMARY KEY, owner_id TEXT, render_variant_id TEXT, kind TEXT, purpose TEXT);
    CREATE TABLE media_variants(id TEXT PRIMARY KEY, asset_id TEXT, role TEXT, public_url TEXT);`);
  const editor = createNewsDeskEditor({ database, env: {}, now: () => 100, summarize: null,
    fetchArticle: async () => assert.fail("A self-written retry must not fetch an article") });
  const save = (payload, attempt) => editor.writeSelfWritten({ ...payload, actorId: "synthetic-editor", idempotencyKey: attempt.key });
  return { database, save };
}

test("a server-valid 60,000-unit escaped article retains complete retry and confirmed snapshots", async t => {
  const { database, save } = await receiptEditor(t);
  const form = longEscapedArticle(), payload = newsroomArticlePayload(form);
  const original = newsroomSaveAttempt(null, payload, () => "long-article-save-0001");
  assert.equal(form.body.length, 60000);
  assert.ok(original.payload.length > 100000, "JSON escaping exceeds the former persistence limit");
  const draft = save(payload, original);
  assert.equal(draft.body, form.body); assert.ok(draft.wordCount >= 1000);
  for (const savedPayload of [null, original.payload]) {
    const restored = restoreNewsroomDraft("synthetic-editor",
      JSON.parse(JSON.stringify(newsroomDraftEnvelope("synthetic-editor", form, original, savedPayload, 100))), 101);
    assert.equal(restored.attempt.payload, original.payload);
    assert.equal(restored.savedPayload, savedPayload);
    const retry = newsroomSaveAttempt(restored.attempt, newsroomArticlePayload(restored.form), () => assert.fail("An unchanged save must retain its receipt"));
    assert.equal(save(newsroomArticlePayload(restored.form), retry).id, draft.id);
  }
  assert.equal(database.prepare("SELECT COUNT(*) n FROM news_drafts").get().n, 1);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM news_desk_receipts").get().n, 0);
});

test("legacy truncated receipts replay unchanged articles but reject ambiguous tail edits at the real server", async t => {
  const { database, save } = await receiptEditor(t);
  const form = longEscapedArticle(), payload = newsroomArticlePayload(form);
  const original = newsroomSaveAttempt(null, payload, () => "legacy-article-save-0001");
  const draft = save(payload, original);
  const legacy = newsroomDraftEnvelope("synthetic-editor", form, original, original.payload, 100);
  legacy.attempt.payload = original.payload.slice(0, 100000);
  legacy.savedPayload = legacy.attempt.payload;
  const restored = restoreNewsroomDraft("synthetic-editor", legacy, 101);
  assert.equal(restored.savedPayload, null, "A prefix cannot confirm the current article is saved");
  const unchanged = newsroomSaveAttempt(restored.attempt, newsroomArticlePayload(restored.form), () => assert.fail("Do not duplicate a legacy uncertain save"));
  assert.equal(unchanged.key, original.key); assert.equal(unchanged.payload, original.payload);
  assert.equal(save(newsroomArticlePayload(restored.form), unchanged).id, draft.id);

  const editedForm = { ...restored.form, body: restored.form.body.slice(0, -1) + "x" };
  const editedPayload = newsroomArticlePayload(editedForm);
  assert.ok(JSON.stringify(editedPayload).startsWith(legacy.attempt.payload), "Only the unavailable legacy tail was edited");
  const uncertain = newsroomSaveAttempt(restored.attempt, editedPayload, () => assert.fail("Ambiguity must use the original receipt"));
  assert.equal(uncertain.key, original.key);
  assert.throws(() => save(editedPayload, uncertain), error => error.code === "CONFLICT");
  assert.equal(database.prepare("SELECT COUNT(*) n FROM news_drafts").get().n, 1);
  const afterConflict = restoreNewsroomDraft("synthetic-editor",
    newsroomDraftEnvelope("synthetic-editor", editedForm, uncertain, restored.savedPayload, 102), 103);
  assert.equal(afterConflict.attempt.payload, JSON.stringify(editedPayload), "Persist the full uncertain attempt before transport");
  assert.equal(newsroomSaveAttempt(afterConflict.attempt, editedPayload, () => assert.fail("Exact retry retains its key")).key, original.key);
  const deliberateEdit = { ...editedPayload, body: editedPayload.body.slice(0, -1) + "y" };
  const newIntent = newsroomSaveAttempt(afterConflict.attempt, deliberateEdit, () => "legacy-article-save-0002");
  assert.notEqual(newIntent.key, original.key);
  assert.notEqual(save(deliberateEdit, newIntent).id, draft.id);
  const differentPrefix = newsroomSaveAttempt(restored.attempt, { ...payload, summary: "A deliberately changed summary." }, () => "legacy-article-save-0003");
  assert.notEqual(differentPrefix.key, original.key);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM news_desk_receipts").get().n, 0);
});

test("bounded retention fits worst-case JSON expansion of every form field without slicing snapshots", () => {
  const escaped = length => "\u0000".repeat(length);
  const form = { ...emptyNewsroomForm(), headline: escaped(300), summary: escaped(1200), body: escaped(60000), category: escaped(40),
    sources: Array.from({ length: 10 }, () => ({ name: escaped(160), url: escaped(2048) })),
    photo: { assetId: "ma_" + "x".repeat(160) }, photoName: escaped(160), photoUrl: escaped(2048), photoCredit: escaped(240) };
  const attempt = newsroomSaveAttempt(null, newsroomArticlePayload(form), () => "bounded-snapshot-key");
  assert.ok(attempt.payload.length > 500000);
  const retained = newsroomDraftEnvelope("editor", form, attempt, attempt.payload, 100);
  assert.equal(retained.attempt.payload, attempt.payload);
  assert.equal(retained.savedPayload, attempt.payload);
  assert.deepEqual(JSON.parse(retained.attempt.payload), newsroomArticlePayload(retained.form));
  const oversized = "x".repeat(524289);
  const rejected = newsroomDraftEnvelope("editor", form, { key: "invalid-snapshot", payload: oversized }, oversized, 100);
  assert.equal(rejected.attempt, null); assert.equal(rejected.savedPayload, null);
  assert.equal(rejected.form.body, form.body, "Invalid snapshot metadata never erases the retained article");
  const completeAtOldLimit = JSON.stringify("x".repeat(99998));
  assert.equal(completeAtOldLimit.length, 100000);
  assert.equal(newsroomDraftEnvelope("editor", emptyNewsroomForm(), null, completeAtOldLimit, 100).savedPayload, completeAtOldLimit);
});
