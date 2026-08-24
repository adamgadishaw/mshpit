import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./mediaUpload.js", import.meta.url), "utf8");

test("legacy photo callers persist only the owner-bound server-sanitized finalize result", () => {
  const uploadFunction = source.slice(source.indexOf("export async function uploadMediaAsset"));
  const presign = uploadFunction.indexOf('api("/api/media/presign"');
  const privateGuard = uploadFunction.indexOf('ticket?.storageScope !== "private"', presign);
  const put = uploadFunction.indexOf("await uploadPreparedMediaAsset", privateGuard);
  const finalize = uploadFunction.indexOf('api("/api/media/finalize"', put);
  const returnPublic = uploadFunction.indexOf("return finalized.publicUrl", finalize);
  assert.ok(presign >= 0 && privateGuard > presign && put > privateGuard && finalize > put && returnPublic > finalize);
  assert.match(uploadFunction.slice(privateGuard, put), /finalizeToken/);
  assert.match(uploadFunction.slice(privateGuard, put), /descriptorId/);
  assert.match(uploadFunction.slice(finalize, returnPublic), /finalized\?\.descriptorId !== ticket\.descriptorId/);
  assert.match(uploadFunction.slice(finalize, returnPublic), /isDurableMediaUrl\(finalized\?\.publicUrl\)/);
  assert.doesNotMatch(uploadFunction.slice(put), /return ticket\.publicUrl/);
});
