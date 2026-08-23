import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./mediaAssetUpload.js", import.meta.url), "utf8");

test("stable upload reconciles mutable recipe and alt text after source finalize", () => {
  const finalize = source.indexOf("result = await finalizeMediaSourceV1", source.indexOf("verifying-source"));
  const patch = source.indexOf('method: "PATCH"', finalize);
  const variants = source.indexOf("result = await createAndUploadVariant", patch);
  assert.ok(finalize >= 0, "source finalize call is present");
  assert.ok(patch > finalize, "owner metadata PATCH follows source finalization");
  assert.ok(variants > patch, "derived variants are created only after metadata reconciliation");
  assert.match(source.slice(finalize, patch), /body:\s*\{[\s\S]*editRecipe:\s*edit/,
    "the chosen coverMs inside the normalized edit recipe reaches initial source finalization");
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
  assert.match(source, /posterPrepared && !reusingVerifiedVideoSource && !result\?\.asset\?\.posterUrl/);
  assert.match(source, /clientVariantId: stableMediaUploadToken\(`\$\{localId\}:\$\{role\}`/);
});

test("reopening a stable asset reconciles by asset id without re-reading the device source", () => {
  const branch = source.slice(source.indexOf("if (assetId)"), source.indexOf("} else {", source.indexOf("if (assetId)")));
  assert.match(branch, /Checking your PIT media source/);
  assert.doesNotMatch(branch, /prepareAsset/);
  assert.match(source, /result = await apiCall\(`\/api\/media\/assets\/\$\{encodeURIComponent\(assetId\)\}`/);
});

test("verified uploads stop drafts from pointing at released staging files", () => {
  assert.match(source, /durableLocalUri:\s*null/);
  assert.match(source, /draftManaged:\s*false/);
});

test("verified clips fail closed before cover PATCH or client-poster replacement", () => {
  const guard = source.indexOf("if (reusingVerifiedVideoSource)");
  const existingBranch = source.indexOf("if (assetId)", guard);
  assert.ok(guard >= 0);
  assert.ok(existingBranch > guard, "the verified-video guard runs before existing-source reconciliation");
  assert.match(source.slice(guard, existingBranch), /VIDEO_COVER_REEDIT_UNAVAILABLE/);
  assert.match(source, /posterPrepared && !reusingVerifiedVideoSource && !result\?\.asset\?\.posterUrl/);
});

test("source, photo-render and video-cover transfers forward byte progress", () => {
  assert.match(source, /onProgress:\s*\(progress\) => onProgress\?\.\(\{ \.\.\.progress, stage: "uploading-source" \}\)/);
  assert.match(source, /stage: role === "poster" \? "uploading-poster" : "uploading-render"/);
  assert.match(source, /onProgress,\s*apiCall,\s*uploadPrepared/);
});

test("new remote drafts are exposed before transfer so explicit cancellation can retire them", () => {
  const created = source.indexOf("assetId = created.asset.id");
  const upload = source.indexOf("await uploadPrepared(sourcePrepared", created);
  assert.ok(created >= 0 && upload > created);
  assert.match(source.slice(created, upload), /created\.asset\.status !== "ready"/);
  assert.match(source.slice(created, upload), /onRemoteDraft\?\.\(\{ assetId, duplicate: !!created\.duplicate \}\)/);
});
