import assert from "node:assert/strict";
import test from "node:test";
import { loadNewsroomMedia, uploadNewsroomMedia } from "./newsroomMedia.mjs";
import { emptyNewsroomForm, newsroomArticlePayload, newsroomDraftEnvelope, restoreNewsroomDraft } from "../../domain/newsroomComposition.mjs";
const ready = { id: "ma_fixture_video", kind: "video", status: "ready", url: "https://media.example.test/clip.mp4", posterUrl: "https://media.example.test/poster.jpg" };
test("article uploads reuse the general pipeline with exact account and wait for verified video", async () => {
  let options;
  const media = await uploadNewsroomMedia({ accountId: "editor", asset: { id: "local", file: "transient" }, kind: "video" }, {
    uploadOriginal: async (input) => { options = input; return { ...ready, assetId: ready.id, uri: ready.url, posterUri: ready.posterUrl }; },
  });
  assert.equal(options.expectedAccountId, "editor"); assert.equal(options.postWhileConverting, false);
  assert.equal(media.uri, ready.url); assert.equal(media.file, undefined);
});
test("refresh resumes an existing remote identity, account-fences every read, and performs no new source upload", async () => {
  const reads = [], resumed = [];
  const result = await loadNewsroomMedia({ accountId: "editor", assetId: ready.id, kind: "video" }, {
    apiCall: async (path, options) => { reads.push({ path, options }); return { asset: { ...ready, status: "upload_pending" } }; },
    uploadOriginal: async (input) => { resumed.push(input); return { ...ready, assetId: ready.id, uri: ready.url, posterUri: ready.posterUrl }; },
  });
  assert.equal(reads[0].options.expectedAccountId, "editor"); assert.equal(resumed[0].asset.assetId, ready.id);
  assert.equal(resumed[0].asset.file, undefined); assert.equal(result.status, "ready");
});
test("late media after account cancellation, mismatched IDs, private URLs and unready clips are rejected", async () => {
  const controller = new AbortController();
  await assert.rejects(loadNewsroomMedia({ accountId: "editor", assetId: ready.id, kind: "video", signal: controller.signal }, {
    apiCall: async () => { controller.abort(); return { asset: ready }; },
  }), { name: "AbortError" });
  for (const patch of [{ id: "ma_other" }, { kind: "image" }, { url: "blob:private" }, { posterUrl: null }]) {
    await assert.rejects(loadNewsroomMedia({ accountId: "editor", assetId: ready.id, kind: "video" }, { apiCall: async () => ({ asset: { ...ready, ...patch } }) }));
  }
  await assert.rejects(uploadNewsroomMedia({ accountId: "editor", asset: {}, kind: "video" }, {
    uploadOriginal: async () => ({ assetId: ready.id, kind: "video", status: "processing", uri: ready.url, posterUri: ready.posterUrl }),
  }), /not ready/u);
});
test("retention saves video identity and credits, never files or private URLs; unfinished pre-transfer selection remains visible", () => {
  const form = { ...emptyNewsroomForm(), video: { assetId: ready.id, file: "secret", uri: "blob:private" }, videoName: "Filmmaker", videoUrl: "https://example.test/rights", videoCredit: "License" };
  const retained = restoreNewsroomDraft("editor", newsroomDraftEnvelope("editor", form, null, null, 100), 101);
  assert.deepEqual(retained.form.video, { assetId: ready.id });
  assert.equal(retained.form.videoCredit, "License"); assert.equal(restoreNewsroomDraft("different", retained, 101), null);
  assert.equal(newsroomArticlePayload(retained.form).video.name, "Filmmaker");
  assert.deepEqual(newsroomDraftEnvelope("editor", { ...form, video: { pending: true, file: "secret" } }).form.video, { pending: true });
});
