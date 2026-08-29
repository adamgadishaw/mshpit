import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./mediaAssetUpload.js", import.meta.url), "utf8");
const upload = source.slice(source.indexOf("export async function uploadOriginalMediaAsset"));
const includes = (text, needle) => assert.ok(text.includes(needle), `Expected source to include: ${needle}`);
const excludes = (text, needle) => assert.ok(!text.includes(needle), `Expected source not to include: ${needle}`);

test("the client uploader is original-only and cannot accept any media transformation", () => {
  includes(upload, "export async function uploadOriginalMediaAsset");
  includes(upload, "const sourceRecipe = defaultMediaEdit(kind, { durationMs: asset.durationMs })");
  excludes(upload, "renderedAsset");
  excludes(upload, "asset.edit");
  excludes(upload, "videoEditRequiresExport");
  excludes(upload, "mediaImageRequiresRender");
  excludes(upload, "createAndUploadRenderVariant");
  excludes(upload, "stableMediaUploadToken");
  excludes(source, "uploadStudioMediaAsset");
});

test("source finalization is the single metadata save boundary", () => {
  const recipe = source.indexOf("const sourceRecipe = defaultMediaEdit(kind, { durationMs: asset.durationMs })");
  const finalizeBody = source.indexOf("const sourceFinalizeBody =");
  const finalize = source.indexOf("result = await finalizeMediaSourceV1");
  assert.ok(recipe >= 0 && recipe < finalizeBody);
  assert.ok(finalizeBody < finalize);
  includes(source.slice(finalizeBody, finalize), "editRecipe: sourceRecipe");
  includes(source.slice(finalizeBody, finalize), 'deliveryMode: "server"');
  includes(source.slice(finalizeBody, finalize), "altText:");
  includes(source.slice(finalize), "body: sourceFinalizeBody");
  excludes(upload, 'method: "PATCH"');
  includes(upload, "const finalAsset = result?.asset ||");
  includes(upload, "const authoritativeDurationMs = finalAsset.durationMs ?? sourceDurationMs ?? asset.durationMs");
  includes(upload, "const authoritativeOriginalRecipe = finalAsset.editRecipe");
});

test("unknown picker dimensions and duration are omitted instead of fabricated", () => {
  const finalizeBody = source.slice(
    source.indexOf("const sourceFinalizeBody ="),
    source.indexOf("let assetId =", source.indexOf("const sourceFinalizeBody =")),
  );
  includes(finalizeBody, "sourceWidth === null ? {} : { width: sourceWidth }");
  includes(finalizeBody, "sourceHeight === null ? {} : { height: sourceHeight }");
  includes(finalizeBody, "sourceDurationMs !== null ? { durationMs: sourceDurationMs }");
  excludes(finalizeBody, "Math.max(1");
  includes(source, "body: sourceFinalizeBody");
});

test("an interrupted upload resumes by stable asset id without re-reading the device source", () => {
  const branch = source.slice(source.indexOf("if (assetId)"), source.indexOf("} else {", source.indexOf("if (assetId)")));
  includes(branch, "resumeExistingMediaSourceV1");
  includes(branch, "onRemoteDraft");
  excludes(branch, "prepareAsset");
});

test("finalizer lifecycle is forwarded without a redundant post-verification save", () => {
  const finalize = source.indexOf("result = await finalizeMediaSourceV1");
  assert.ok(finalize >= 0);
  includes(source.slice(finalize), "onStage,");
  excludes(upload, 'onStage?.("saving-source")');
  excludes(upload, 'context: "Saving original media details"');
});

test("verified uploads stop drafts from pointing at released staging files", () => {
  includes(source, "durableLocalUri: null");
  includes(source, "draftManaged: false");
  includes(source, "edit: authoritativeOriginalRecipe");
});

test("source transfer forwards byte progress and exposes cancellable remote draft identity", () => {
  includes(source, 'onProgress: (progress) => onProgress?.({ ...progress, stage: "uploading-source" })');
  const created = source.indexOf("assetId = created.asset.id");
  const transfer = source.indexOf("await uploadPrepared(sourcePrepared", created);
  assert.ok(created >= 0 && transfer > created);
  includes(source.slice(created, transfer), 'created.asset.status !== "ready"');
  includes(source.slice(created, transfer), "onRemoteDraft?.({ assetId, duplicate: !!created.duplicate, sourceUploaded: false })");
  includes(source.slice(transfer), "onRemoteDraft?.({ assetId, duplicate: !!created.duplicate, sourceUploaded: true })");
});

test("video publication still requires the server verifier's durable poster", () => {
  excludes(upload, "posterAsset");
  includes(upload, 'kind === "video" && !finalAsset.posterUrl');
  includes(upload, "posterTimeMs: finalAsset.posterTimeMs ?? authoritativeOriginalRecipe.coverMs ?? 0");
});
