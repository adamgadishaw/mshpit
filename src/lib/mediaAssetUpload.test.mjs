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

test("verifier-measured duration is authoritative when the constant original recipe is saved", () => {
  const recipe = source.indexOf("const sourceRecipe = defaultMediaEdit(kind, { durationMs: asset.durationMs })");
  const finalizeBody = source.indexOf("const sourceFinalizeBody =");
  const finalize = source.indexOf("result = await finalizeMediaSourceV1", source.indexOf('onStage?.("verifying-source")'));
  const patch = source.indexOf('method: "PATCH"', finalize);
  assert.ok(recipe >= 0 && recipe < finalizeBody);
  assert.ok(finalizeBody < finalize);
  assert.ok(patch > finalize);
  includes(source.slice(finalizeBody, finalize), "editRecipe: sourceRecipe");
  includes(source.slice(finalizeBody, finalize), 'deliveryMode: "server"');
  includes(source.slice(finalizeBody, finalize), "altText:");
  includes(source.slice(finalize, patch), "body: sourceFinalizeBody");
  const authoritativeDuration = source.indexOf("const authoritativeDurationMs =", finalize);
  const authoritativeRecipe = source.indexOf("const authoritativeOriginalRecipe =", authoritativeDuration);
  assert.ok(authoritativeDuration > finalize && authoritativeDuration < patch);
  assert.ok(authoritativeRecipe > authoritativeDuration && authoritativeRecipe < patch);
  includes(source.slice(authoritativeDuration, patch), "result?.asset?.durationMs ?? sourceDurationMs ?? asset.durationMs");
  includes(source.slice(authoritativeDuration, patch), "defaultMediaEdit(kind, { durationMs: authoritativeDurationMs })");
  includes(source.slice(patch), "editRecipe: authoritativeOriginalRecipe");
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
  excludes(branch, "prepareAsset");
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
