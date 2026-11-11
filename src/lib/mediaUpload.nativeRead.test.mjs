import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { resolveMediaMimeType, VIDEO_EXTENSION_BY_MIME } from "../domain/mediaMime.mjs";
import { validMediaUploadTicket } from "../domain/mediaUploadTicket.mjs";
import { mediaPutStatusAccepted } from "../domain/mediaUploadPolicy.mjs";
import { normalizeMediaTransferProgress } from "../domain/mediaTransferProgress.mjs";
import { createMediaUploadDeadline, mediaUploadTimeoutMs } from "../domain/mediaUploadDeadline.mjs";
import { catalogEntry, catalogueCode } from "./errorCatalog.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
// Exercise the installed SDK's File.slice body and RN's actual binary-Blob
// rejection, rather than a browser/Node Blob which hides the device failure.
const expo = read("../../node_modules/expo-file-system/src/File.ts");
const expoClass = parse(expo, { sourceType: "module", plugins: ["typescript"] }).program.body
  .find(node => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "File").declaration;
const sliceBody = expoClass.body.body.find(node => node.key?.name === "slice").body;
const rn = read("../../node_modules/react-native/Libraries/Blob/BlobManager.js");
const rnAst = parse(rn, { sourceType: "module", plugins: ["flow"] });
function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    const match = Array.isArray(value) ? value.map(item => find(item, predicate)).find(Boolean) : find(value, predicate);
    if (match) return match;
  }
  return null;
}
const binaryGuard = find(rnAst, node => node.type === "IfStatement" && rn.slice(node.start, node.end).includes('"Creating blobs from'));
assert.ok(binaryGuard, "The installed RN binary Blob behavior must be represented");
const guard = new Function("part", rn.slice(binaryGuard.start, binaryGuard.end));
class RNBlob { constructor(parts) { parts.forEach(guard); } }
const expoSlice = new Function("Blob", `return function(start, end, contentType) ${expo.slice(sliceBody.start, sliceBody.end)}`)(RNBlob);
const jpeg = new Uint8Array(4096); jpeg.set([0xff, 0xd8, 0xff, 0xe0]);

function fixture({ readError = false, apiError, transferError, normalizeError, platform = "ios", module = "mediaUpload.js" } = {}) {
  const calls = [], captures = [];
  let released = 0, sliced = 0, fullReads = 0, closed = 0;
  class File {
    constructor(uri) { this.uri = uri; this.size = jpeg.length; this.type = "image/jpeg"; }
    bytesSync() { fullReads++; return jpeg; }
    slice(...args) { sliced++; return expoSlice.apply(this, args); }
    open(mode) {
      calls.push({ stage: "read", mode });
      return { size: this.size, readBytes: length => {
        calls.push({ stage: "bytes", length });
        if (readError) throw new Error("file:///private-camera.jpg?secret=private-data");
        return jpeg.slice(0, length);
      }, close: () => { closed++; } };
    }
    createUploadTask(url, options) {
      calls.push({ stage: "transfer", url, options });
      return { uploadAsync: async () => {
        if (transferError) throw transferError;
        return { status: 200 };
      }, release: () => calls.push({ stage: "release-task" }) };
    }
  }
  class AppError extends Error {
    constructor(message, options = {}) {
      const code = catalogueCode(options), entry = catalogEntry(code);
      super(message || entry.message); Object.assign(this, options, { code, userMessage: entry.message, guidance: entry.guidance });
    }
  }
  const ticket = { storageScope: "private", storageLocator: "pit-private:users/fixture/avatar/photo.jpg", descriptorId: "fixture-owned",
    finalizeToken: "fixture-token", uploadUrl: "https://storage.example.org/private", method: "PUT",
    requiredHeaders: { "Content-Type": "image/jpeg", "If-None-Match": "*" } };
  const dependencies = {
    Platform: { OS: platform }, ExpoFile: File, UploadType: { BINARY_CONTENT: 0 },
    api: async (route, options) => {
      calls.push({ stage: route.endsWith("presign") ? "presign" : "finalize", options });
      if (apiError) throw apiError;
      return route.endsWith("presign") ? ticket : { descriptorId: ticket.descriptorId, publicUrl: "https://media.example.org/sanitized.jpg" };
    },
    AppError, captureAppError: (error, options) => {
      const captured = error instanceof AppError ? error : new AppError(undefined, options);
      captured.diagnosticId = "fixture-diagnostic"; captures.push({ error: captured, options }); return captured;
    },
    normalizeProfileImageAsset: async asset => {
      calls.push({ stage: "normalize" });
      if (normalizeError) throw normalizeError;
      return { ...asset, uri: "file:///normalized.jpg", release: () => { released++; } };
    },
    resolveMediaMimeType, VIDEO_EXTENSION_BY_MIME, validMediaUploadTicket, mediaPutStatusAccepted,
    normalizeMediaTransferProgress, createMediaUploadDeadline, mediaUploadTimeoutMs,
    webImageOptimizationPlan: () => ({ optimize: false }),
  };
  const source = read(`./${module}`);
  const implementation = parse(source, { sourceType: "module" }).program.body
    .filter(node => node.type !== "ImportDeclaration")
    .map(node => { const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node; return source.slice(declaration.start, declaration.end); }).join("\n");
  const helpers = new Function(...Object.keys(dependencies), `${implementation}\nreturn { firstMediaBytes, prepareMediaUploadAsset, uploadMediaAsset };`)(...Object.values(dependencies));
  return { ...helpers, File, AppError, calls, captures, counts: () => ({ released, sliced, fullReads, closed }) };
}

test("installed Expo File.slice reproduces RN typed-array Blob rejection", () => {
  const f = fixture();
  assert.throws(() => new f.File("file:///fixture.jpg").slice(0, 96), /ArrayBufferView/);
  assert.equal(f.counts().fullReads, 1);
});

test("native MIME inspection reads at most 96 bytes, read-only, without a Blob or full-file copy", async () => {
  const f = fixture(), file = new f.File("file:///fixture.jpg");
  assert.deepEqual(await f.firstMediaBytes(file), jpeg.slice(0, 96));
  assert.deepEqual(f.calls, [{ stage: "read", mode: "r" }, { stage: "bytes", length: 96 }]);
  assert.deepEqual(f.counts(), { released: 0, sliced: 0, fullReads: 0, closed: 1 });
});

test("short native files read only their available bytes and close the handle", async () => {
  const f = fixture(), file = new f.File("file:///short.jpg"); file.size = 4;
  assert.deepEqual(await f.firstMediaBytes(file), jpeg.slice(0, 4));
  assert.equal(f.calls.find(call => call.stage === "bytes").length, 4);
  assert.equal(f.counts().closed, 1);
});

for (const module of ["mediaUpload.js", "mediaUpload.web.js"]) test(`${module} keeps browser Blob inspection and signature detection`, async () => {
  const f = fixture({ platform: "web", module });
  const body = new Blob([jpeg], { type: "image/png" });
  const prepared = await f.prepareMediaUploadAsset({ file: body, fileName: "mislabelled.png" });
  assert.equal(prepared.contentType, "image/jpeg");
  assert.equal(prepared.fileSize, jpeg.length);
  assert.equal(prepared.body, body);
  assert.deepEqual(f.calls, []);
});

test("native preparation reaches owner-bound private upload and server finalization with the same measured file", async () => {
  const f = fixture();
  assert.equal(await f.uploadMediaAsset({ uri: "file:///picker.jpg" }, "avatar", { expectedAccountId: "fixture-account" }), "https://media.example.org/sanitized.jpg");
  assert.deepEqual(f.calls.map(call => call.stage), ["normalize", "read", "bytes", "presign", "transfer", "release-task", "finalize"]);
  for (const call of f.calls.filter(call => ["presign", "finalize"].includes(call.stage))) assert.equal(call.options.expectedAccountId, "fixture-account");
  assert.equal(f.calls.find(call => call.stage === "presign").options.body.fileSize, jpeg.length);
  assert.deepEqual(f.calls.find(call => call.stage === "finalize").options.body, { finalizeToken: "fixture-token" });
  assert.deepEqual(f.counts(), { released: 1, sliced: 0, fullReads: 0, closed: 1 });
});

test("native read failure closes the handle, reports safe local preparation guidance, and never requests a ticket", async () => {
  const f = fixture({ readError: true });
  await assert.rejects(f.uploadMediaAsset({ uri: "file:///picker.jpg" }, "avatar", { expectedAccountId: "fixture-account" }), error => {
    assert.equal(error.code, "PIT-UPLOAD-008");
    assert.match(error.userMessage, /device|download/i);
    assert.doesNotMatch(error.userMessage, /file:|secret=|private-data/); return true;
  });
  assert.deepEqual(f.calls.map(call => call.stage), ["normalize", "read", "bytes"]);
  assert.equal(f.counts().closed, 1); assert.equal(f.counts().released, 1);
});

test("account restrictions remain distinct from local preparation and never start a transfer", async () => {
  const accountError = Object.assign(new Error("Verify your email"), { code: "PIT-UPLOAD-006", source: "api", status: 403 });
  const f = fixture({ apiError: accountError });
  await assert.rejects(f.uploadMediaAsset({ uri: "file:///picker.jpg" }, "avatar"), error => error === accountError);
  assert.equal(f.calls.at(-1).stage, "presign"); assert.equal(f.captures.length, 0); assert.equal(f.counts().released, 1);
});

test("storage network failure stops before finalization and remains an upload error", async () => {
  const f = fixture({ transferError: new Error("Network request failed") });
  await assert.rejects(f.uploadMediaAsset({ uri: "file:///picker.jpg" }, "avatar"), { code: "PIT-UPLOAD-004" });
  assert.equal(f.calls.some(call => call.stage === "transfer"), true);
  assert.equal(f.calls.some(call => call.stage === "finalize"), false); assert.equal(f.counts().released, 1);
});

test("approved crop normalization failure has a local preparation error and cannot fall back to a different photo", async () => {
  const f = fixture({ normalizeError: new Error("native decode failed: file:///private-photo.jpg") });
  await assert.rejects(f.uploadMediaAsset({ uri: "file:///picker.jpg", profileCrop: { x: 0, y: 0, width: 1, height: 1 } }, "banner"), { code: "PIT-UPLOAD-008" });
  assert.deepEqual(f.calls.map(call => call.stage), ["normalize"]);
});
