import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./mediaAssetUpload.js", import.meta.url), "utf8");

test("stable upload reconciles mutable recipe and alt text after source finalize", () => {
  const finalizeBody = source.indexOf("const sourceFinalizeBody =");
  const finalize = source.indexOf("result = await finalizeMediaSourceV1", source.indexOf("verifying-source"));
  const patch = source.indexOf('method: "PATCH"', finalize);
  const variants = source.indexOf("result = await createAndUploadRenderVariant", patch);
  assert.ok(finalizeBody >= 0 && finalizeBody < finalize, "source finalize body is assembled before finalization");
  assert.ok(finalize >= 0, "source finalize call is present");
  assert.ok(patch > finalize, "owner metadata PATCH follows source finalization");
  assert.ok(variants > patch, "derived variants are created only after metadata reconciliation");
  assert.match(source.slice(finalizeBody, finalize), /editRecipe:\s*edit/,
    "the chosen coverMs inside the normalized edit recipe reaches initial source finalization");
  assert.match(source.slice(finalizeBody, finalize), /altText:/);
  assert.match(source.slice(finalize, patch), /body:\s*sourceFinalizeBody/);
  assert.match(source.slice(patch, variants), /editRecipe:\s*edit/);
  assert.match(source.slice(patch, variants), /altText:/);
});

test("verified recipe derivatives are reused after an ambiguous response unless a staged replacement is pending", () => {
  assert.match(source, /const photoRevisionPending =/);
  assert.match(source, /result\?\.revisionPending/);
  assert.match(source, /result\?\.asset\?\.revisionPending/);
  assert.match(source, /result\?\.recipeChanged/);
  assert.match(source, /renderPrepared && \(photoRevisionPending \|\| !\(result\?\.asset\?\.renderState === "ready" && result\?\.asset\?\.url\)\)/);
  assert.match(source, /renderState === "ready" && result\?\.asset\?\.url/);
  assert.match(source, /clientVariantId: stableMediaUploadToken\(`\$\{localId\}:render`, "studio-render"\)/);
});

test("reopening a stable asset reconciles by asset id without re-reading the device source", () => {
  const branch = source.slice(source.indexOf("if (assetId)"), source.indexOf("} else {", source.indexOf("if (assetId)")));
  assert.match(branch, /resumeExistingMediaSourceV1/);
  assert.doesNotMatch(branch, /prepareAsset/);
  assert.match(source, /sourceFinalizeBody/);
});

test("verified uploads stop drafts from pointing at released staging files", () => {
  assert.match(source, /durableLocalUri:\s*null/);
  assert.match(source, /draftManaged:\s*false/);
});

test("verified clips fail closed before cover PATCH or client-poster replacement", () => {
  assert.match(source, /resumeExistingMediaSourceV1/);
  assert.doesNotMatch(source, /prepareAsset\(posterAsset/);
  assert.doesNotMatch(source, /role:\s*"poster"/);
});

test("source and photo-render transfers forward byte progress", () => {
  assert.match(source, /onProgress:\s*\(progress\) => onProgress\?\.\(\{ \.\.\.progress, stage: "uploading-source" \}\)/);
  assert.match(source, /onProgress:\s*\(progress\) => onProgress\?\.\(\{ \.\.\.progress, stage: "uploading-render" \}\)/);
  assert.match(source, /onProgress,\s*apiCall,\s*uploadPrepared/);
});

test("new remote drafts are exposed before transfer so explicit cancellation can retire them", () => {
  const created = source.indexOf("assetId = created.asset.id");
  const upload = source.indexOf("await uploadPrepared(sourcePrepared", created);
  assert.ok(created >= 0 && upload > created);
  assert.match(source.slice(created, upload), /created\.asset\.status !== "ready"/);
  assert.match(source.slice(created, upload), /onRemoteDraft\?\.\(\{ assetId, duplicate: !!created\.duplicate, sourceUploaded: false \}\)/);
  assert.match(source.slice(upload), /onRemoteDraft\?\.\(\{ assetId, duplicate: !!created\.duplicate, sourceUploaded: true \}\)/);
});

test("client-authored renders consume only the sanitized finalized variant URL", () => {
  const finalize = source.indexOf("const finalized = await apiCall", source.indexOf("async function createAndUploadRenderVariant"));
  const end = source.indexOf("\n}\n", finalize);
  const boundary = source.slice(finalize, end);
  assert.match(boundary, /const sanitizedUrl = finalized\?\.variant\?\.url/);
  assert.match(boundary, /finalized\?\.variant\?\.status !== "verified"/);
  assert.match(boundary, /asset: \{ \.\.\.finalized\.asset, url: sanitizedUrl \}/);
});

test("video publication depends on the verifier poster, never a local preview artifact", () => {
  const upload = source.slice(source.indexOf("export async function uploadStudioMediaAsset"));
  assert.doesNotMatch(upload, /posterAsset/);
  assert.match(upload, /editRecipe:\s*edit/);
  assert.match(upload, /kind === "video" && !finalAsset\.posterUrl/);
  assert.match(upload, /posterTimeMs:\s*finalAsset\.posterTimeMs \?\? edit\.coverMs \?\? 0/);
});
