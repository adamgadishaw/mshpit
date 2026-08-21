import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./mediaAssetUpload.js", import.meta.url), "utf8");

test("stable upload reconciles mutable recipe and alt text after source finalize", () => {
  const finalize = source.indexOf("result = await apiCall", source.indexOf("verifying-source"));
  const patch = source.indexOf('method: "PATCH"', finalize);
  const variants = source.indexOf("result = await createAndUploadVariant", patch);
  assert.ok(finalize >= 0, "source finalize call is present");
  assert.ok(patch > finalize, "owner metadata PATCH follows source finalization");
  assert.ok(variants > patch, "derived variants are created only after metadata reconciliation");
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
  assert.match(source, /posterPrepared && !result\?\.asset\?\.posterUrl/);
  assert.match(source, /clientVariantId: stableToken\(`\$\{localId\}:\$\{role\}`/);
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
