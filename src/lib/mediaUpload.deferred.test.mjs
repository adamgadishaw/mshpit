import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { validMediaUploadTicket } from "../domain/mediaUploadTicket.mjs";
import { mediaPutStatusAccepted } from "../domain/mediaUploadPolicy.mjs";
import { normalizeMediaTransferProgress } from "../domain/mediaTransferProgress.mjs";

// Execute the production functions with a deferred platform-module seam. The
// import replacement leaves their branch order and cancellation checks intact.
const source = readFileSync(new URL("./mediaUpload.web.js", import.meta.url), "utf8");
const declarations = parse(source, { sourceType: "module" }).program.body
  .map(node => node.type === "ExportNamedDeclaration" ? node.declaration : node);

test("the web transport preserves the native/default public API and common upload orchestration", () => {
  const nativeSource = readFileSync(new URL("./mediaUpload.js", import.meta.url), "utf8");
  const exportedFunctions = text => parse(text, { sourceType: "module" }).program.body
    .filter(node => node.type === "ExportNamedDeclaration" && node.declaration?.type === "FunctionDeclaration")
    .map(node => ({ name: node.declaration.id.name, implementation: text.slice(node.declaration.start, node.declaration.end).replaceAll("\r\n", "\n") }));
  const nativeFunctions = exportedFunctions(nativeSource), webFunctions = exportedFunctions(source);
  assert.deepEqual(webFunctions.map(entry => entry.name), nativeFunctions.map(entry => entry.name));
  // Only uploadPreparedMediaAsset adds the awaited platform load/abort guard.
  // Shared presign/finalize identity checks, preparation and durable URL policy
  // remain identical to the default implementation tested by lifecycle suites.
  for (const entry of nativeFunctions.filter(entry => entry.name !== "uploadPreparedMediaAsset")) {
    assert.equal(webFunctions.find(web => web.name === entry.name).implementation, entry.implementation, entry.name);
  }
});

function productionFunction(name, dependencies) {
  const node = declarations.find(entry => entry?.type === "FunctionDeclaration" && entry.id.name === name);
  assert.ok(node, `${name} must exist`);
  const implementation = source.slice(node.start, node.end)
    .replaceAll('import("expo-file-system")', "loadFileSystem()");
  return new Function(...Object.keys(dependencies), `return (${implementation});`)(...Object.values(dependencies));
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

for (const explicitCrop of [true, false]) {
  test(`web profile normalization failure ${explicitCrop ? "preserves the selected crop and never starts uploading" : "retains original-photo fallback"}`, async () => {
    const failedCrop = new Error("Profile normalization failed");
    const preparationReached = new Error("Original-photo preparation reached");
    const asset = explicitCrop ? { profileCrop: { x: 0, y: 0, width: 1, height: 1 } } : {};
    const captures = [];
    let preparationCalls = 0;
    const upload = productionFunction("uploadMediaAsset", {
      normalizeProfileImageAsset: async () => { throw failedCrop; },
      capturedUploadError: (error, options) => { captures.push(options); return error; },
      prepareMediaUploadAsset: async original => {
        preparationCalls++;
        assert.equal(original, asset);
        throw preparationReached;
      },
    });
    await assert.rejects(upload(asset, "avatar"), error => error === (explicitCrop ? failedCrop : preparationReached));
    assert.equal(preparationCalls, explicitCrop ? 0 : 1);
    assert.deepEqual(captures, explicitCrop ? [{ context: "Preparing your profile photo" }] : []);
  });
}
const ticket = {
  storageScope: "private", storageLocator: "pit-private:users/test/original/asset.jpg",
  uploadUrl: "https://storage.example.org/original", method: "PUT",
  requiredHeaders: { "Content-Type": "image/jpeg", "If-None-Match": "*" },
};

test("browser File preparation never loads the device file-system module", async () => {
  const calls = [];
  const file = { size: 20, type: "image/jpeg" }, optimized = { size: 12 };
  const prepare = productionFunction("bodyFor", {
    Platform: { OS: "web" },
    optimizedWebImage: async value => { assert.equal(value, file); calls.push("optimize"); return optimized; },
    loadFileSystem: () => { throw new Error("Unexpected native module load"); },
  });
  assert.equal(await prepare({ file }), optimized);
  assert.equal(await prepare({ file }, { optimizeWeb: false }), file);
  assert.deepEqual(calls, ["optimize"]);
});

test("URI preparation waits for File and preserves the streaming file instance", async () => {
  const module = deferred(), calls = [];
  class File {
    constructor(uri) { this.uri = uri; this.size = 20; calls.push("construct"); }
  }
  const prepare = productionFunction("bodyFor", {
    Platform: { OS: "android" }, optimizedWebImage: null,
    loadFileSystem: () => { calls.push("load"); return module.promise; },
  });
  const pending = prepare({ uri: "file:///camera.jpg" });
  assert.deepEqual(calls, ["load"]);
  module.resolve({ File });
  const file = await pending;
  assert.ok(file instanceof File);
  assert.equal(file.uri, "file:///camera.jpg");
  assert.deepEqual(calls, ["load", "construct"]);
});

function transferFixture(platform = "android") {
  const module = deferred(), caller = new AbortController(), deadline = new AbortController();
  const calls = [], progress = [], captures = [];
  let timedOut = false;
  caller.signal.addEventListener("abort", () => deadline.abort());
  const prepared = { contentType: "image/jpeg", fileSize: 20, body: {
    createUploadTask(url, options) {
      calls.push("task");
      assert.equal(url, ticket.uploadUrl);
      assert.equal(options.uploadType, "binary-content");
      assert.equal(options.signal, deadline.signal);
      assert.equal(options.sessionType, "foreground");
      return {
        uploadAsync: async () => { calls.push("upload"); return { status: 200 }; },
        release: () => calls.push("release"),
      };
    },
  } };
  const transfer = productionFunction("uploadPreparedMediaAsset", {
    Platform: { OS: platform }, validMediaUploadTicket, mediaPutStatusAccepted, normalizeMediaTransferProgress,
    mediaUploadTimeoutMs: () => 45_000,
    createMediaUploadDeadline: () => ({ signal: deadline.signal, get timedOut() { return timedOut; }, dispose: () => calls.push("dispose") }),
    loadFileSystem: () => { calls.push("load"); return module.promise; },
    uploadBinaryWithProgress: async options => { calls.push("web"); assert.equal(options.signal, deadline.signal); return { status: 200 }; },
    capturedUploadError: (error, options) => { captures.push(options); return error; },
    AppError: class extends Error {}, captureAppError: error => error,
  });
  return {
    start: () => transfer(prepared, ticket, { signal: caller.signal, onProgress: value => progress.push(value) }),
    resolve: () => module.resolve({ UploadType: { BINARY_CONTENT: "binary-content" } }),
    reject: error => module.reject(error),
    cancel: () => caller.abort(),
    timeout: () => { timedOut = true; deadline.abort(); },
    calls, progress, captures,
  };
}

test("web transfer uses byte-progress transport without loading native file-system code", async () => {
  const f = transferFixture("web");
  assert.equal(await f.start(), null);
  assert.deepEqual(f.calls, ["web", "dispose"]);
  assert.equal(f.progress.at(-1).fraction, 1);
});

test("a native transfer waits for the module and releases the foreground upload task", async () => {
  const f = transferFixture(), pending = f.start();
  assert.deepEqual(f.calls, ["load"]);
  f.resolve();
  assert.equal(await pending, null);
  assert.deepEqual(f.calls, ["load", "task", "upload", "release", "dispose"]);
  assert.equal(f.progress.at(-1).fraction, 1);
});

for (const transition of ["cancel", "timeout"]) {
  test(`${transition} during deferred file-system loading never starts a native upload`, async () => {
    const f = transferFixture(), pending = f.start();
    f[transition]();
    f.resolve();
    await assert.rejects(pending, { name: "AbortError" });
    assert.deepEqual(f.calls, ["load", "dispose"]);
    assert.equal(f.progress.length, 1, "no completion progress follows cancellation");
    if (transition === "cancel") assert.deepEqual(f.captures, []);
    else assert.equal(f.captures[0].timedOut, true);
  });
}

test("a deferred module failure follows the existing upload failure path and disposes the deadline", async () => {
  const f = transferFixture(), pending = f.start(), error = new Error("Fixture module unavailable");
  f.reject(error);
  await assert.rejects(pending, value => value === error);
  assert.deepEqual(f.calls, ["load", "dispose"]);
  assert.equal(f.captures.length, 1);
});
