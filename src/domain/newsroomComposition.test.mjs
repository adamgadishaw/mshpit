import assert from "node:assert/strict";
import test from "node:test";
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
