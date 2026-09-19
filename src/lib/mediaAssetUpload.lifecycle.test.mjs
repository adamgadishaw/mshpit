import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { defaultMediaEdit, mediaSourceMaxBytes, mediaSourceSizeAllowed } from "../domain/mediaEdit.mjs";
import { mediaUploadLimitLabel, MEDIA_PHOTO_SOURCE_MAX_BYTES, MEDIA_VIDEO_SOURCE_MAX_BYTES } from "../domain/mediaUploadPolicy.mjs";
import { mediaSourceClientAssetId } from "../domain/mediaUploadIdentity.mjs";
import { finalizeMediaSourceV1, resumeExistingMediaSourceV1 } from "./mediaAssetFinalize.mjs";
import { boundedMediaRequest, recoverMediaRequest } from "../domain/mediaRequestRecovery.mjs";
import { mediaUploadTimeoutMs } from "../domain/mediaUploadDeadline.mjs";

const source = readFileSync(new URL("./mediaAssetUpload.js", import.meta.url), "utf8");
const body = parse(source, { sourceType: "module" }).program.body
  .filter((node) => node.type !== "ImportDeclaration")
  .map((node) => node.type === "ExportNamedDeclaration" ? node.declaration : node)
  .map((node) => source.slice(node.start, node.end)).join("\n");
const uploadWithFinalizer = (finalize = finalizeMediaSourceV1) => new Function("api", "isDurableMediaUrl", "prepareMediaUploadAsset", "uploadPreparedMediaAsset",
  "finalizeMediaSourceV1", "resumeExistingMediaSourceV1", "defaultMediaEdit", "mediaSourceClientAssetId",
  "boundedMediaRequest", "recoverMediaRequest", "mediaUploadTimeoutMs", "mediaSourceMaxBytes", "mediaSourceSizeAllowed", "mediaUploadLimitLabel",
  `${body}\nreturn uploadOriginalMediaAsset;`)(
  () => { throw new Error("Unexpected default transport"); },
  (url) => /^https:\/\//u.test(url || ""),
  () => { throw new Error("Unexpected device preparation"); },
  () => { throw new Error("Unexpected device transfer"); },
  finalize, resumeExistingMediaSourceV1, defaultMediaEdit, mediaSourceClientAssetId,
  boundedMediaRequest, recoverMediaRequest, mediaUploadTimeoutMs, mediaSourceMaxBytes, mediaSourceSizeAllowed, mediaUploadLimitLabel,
);
const upload = uploadWithFinalizer();

function fixture({ boundary = () => {}, resume = false, readyPatch = {} } = {}) {
  const calls = [], mutations = [], stages = [], requests = [], drafts = [];
  const controller = new AbortController();
  let account = "a";
  const asset = { id: "local-a", uri: "file:///camera.jpg", kind: "image", width: 64, height: 64,
    ...(resume ? { assetId: "remote-a" } : {}) };
  const ready = { id: "remote-a", status: "ready", url: "https://media.example.org/verified.jpg", ...readyPatch };
  const step = async (name) => { calls.push(name); await boundary(name, { controller, setAccount: (next) => { account = next; } }); };
  const services = {
    recovery: { wait: async () => {} },
    prepareAsset: async () => { await step("prepare"); return { fileSize: 64, contentType: "image/jpeg", name: "camera.jpg" }; },
    uploadPrepared: async () => { await step("transfer"); },
    apiCall: async (path, options) => {
      requests.push({ path, options });
      const kind = path.endsWith("/finalize") ? "finalize" : options.method === "POST" ? "create" : "read";
      await step(kind);
      assert.equal(options.expectedAccountId, "a", "Every request must retain the initiating account");
      assert.equal(options.signal instanceof AbortSignal, true);
      if (controller.signal.aborted) assert.equal(options.signal.aborted, true);
      if (!account) throw Object.assign(new Error("Session expired"), { status: 401 });
      if (account !== options.expectedAccountId) throw Object.assign(new Error("Account changed"), { status: 409, code: "IDENTITY_CHANGED" });
      mutations.push(kind);
      return kind === "create" ? { asset: { id: "remote-a", status: "pending" }, upload: { private: true } } : { asset: ready };
    },
  };
  return { calls, mutations, stages, controller, requests, drafts, asset,
    run: (options = {}, overrides = {}) => upload({ asset, expectedAccountId: "a", signal: controller.signal,
      onStage: (value) => stages.push(value), onRemoteDraft: (value) => drafts.push(value), ...options }, { ...services, ...overrides }) };
}

test("create, transfer and finalize preserve one initiating account", async () => {
  const f = fixture(); assert.equal((await f.run()).assetId, "remote-a");
  assert.deepEqual(f.calls, ["prepare", "create", "transfer", "finalize"]);
  assert.equal(f.stages.at(-1), "ready");
});

test("ready media releases its browser File reference and replaces the local URL with verified delivery", async () => {
  const f = fixture();
  const selectedFile = new Blob(["camera original"]);
  const ready = await f.run({ asset: { ...f.asset, uri: "blob:camera", file: selectedFile, runtimeFile: selectedFile } });
  assert.equal(ready.runtimeFile, null);
  assert.equal(ready.file, null);
  assert.equal(ready.uri, "https://media.example.org/verified.jpg");
  assert.equal(ready.assetId, "remote-a");
});

test("source-byte kind overrides missing picker video metadata and still requires a verified poster", async () => {
  const f = fixture({ readyPatch: { url: "https://media.example.org/verified.mp4", posterUrl: "https://media.example.org/poster.jpg", durationMs: 42_000 } });
  const ready = await f.run({ asset: { ...f.asset, kind: "image", width: 0, height: 0, durationMs: 0 } }, {
    prepareAsset: async () => ({ kind: "video", contentType: "video/quicktime", fileSize: 80, name: "camera.mov" }),
  });
  const body = f.requests.find(({ path }) => path.endsWith("/finalize")).options.body;
  assert.equal(body.deliveryMode, undefined);
  assert.equal(body.durationMs, undefined);
  assert.equal(body.width, undefined);
  assert.equal(body.height, undefined);
  assert.deepEqual(body.editRecipe, defaultMediaEdit("video", { durationMs: 0 }));
  assert.equal(ready.kind, "video");
  assert.equal(ready.durationMs, 42_000);
  assert.equal(ready.posterUrl, "https://media.example.org/poster.jpg");
  assert.equal(f.drafts.at(-1).kind, "video", "Retry must retain the byte-sniffed source kind.");

  const missingPoster = fixture();
  await assert.rejects(missingPoster.run({}, {
    prepareAsset: async () => ({ kind: "video", contentType: "video/mp4", fileSize: 80, name: "camera.mp4" }),
  }), { code: "VIDEO_POSTER_REQUIRED" });
});

test("a byte-sniffed image cannot keep a stale picker video recipe", async () => {
  const f = fixture();
  const ready = await f.run({ asset: { ...f.asset, kind: "video", durationMs: 10_000 } }, {
    prepareAsset: async () => ({ kind: "image", contentType: "image/jpeg", fileSize: 80, name: "photo.jpg" }),
  });
  const body = f.requests.find(({ path }) => path.endsWith("/finalize")).options.body;
  assert.equal(body.deliveryMode, "server");
  assert.equal(body.durationMs, undefined);
  assert.deepEqual(body.editRecipe, defaultMediaEdit("image", { durationMs: 0 }));
  assert.equal(ready.kind, "image");
});

test("sniffed size limits apply before create or transfer, including unclassified originals", async () => {
  for (const kind of ["image", "video"]) {
    const limit = kind === "video" ? MEDIA_VIDEO_SOURCE_MAX_BYTES : MEDIA_PHOTO_SOURCE_MAX_BYTES;
    const f = fixture();
    await assert.rejects(f.run({}, { prepareAsset: async () => ({ kind, contentType: `${kind}/fixture`, fileSize: limit + 1, name: "untyped" }) }), { status: 413, retryable: false });
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.drafts, []);
  }
  const f = fixture({ readyPatch: { posterUrl: "https://media.example.org/poster.jpg" } });
  const ready = await f.run({}, { prepareAsset: async () => ({ kind: "video", contentType: "video/mp4", fileSize: MEDIA_PHOTO_SOURCE_MAX_BYTES + 1, name: "untyped" }) });
  assert.equal(ready.kind, "video", "A valid clip must not inherit the smaller photo ceiling.");
  assert.equal(f.requests[0].options.body.fileSize, MEDIA_PHOTO_SOURCE_MAX_BYTES + 1);
});

test("failed verification retains the original File and local handle for a deliberate retry", async () => {
  const f = fixture({ boundary: (step) => { if (step === "finalize") throw Object.assign(new Error("Busy"), { status: 429, code: "RATE_LIMITED" }); } });
  const file = new Blob(["original"]);
  const asset = { ...f.asset, uri: "blob:pending", runtimeFile: file };
  await assert.rejects(f.run({ asset }), { status: 429 });
  assert.equal(asset.runtimeFile, file);
  assert.equal(asset.uri, "blob:pending");
  assert.equal(f.stages.includes("ready"), false);
});

test("resuming an owner draft binds the read and skips device bytes", async () => {
  const f = fixture({ resume: true }); assert.equal((await f.run()).status, "ready");
  assert.deepEqual(f.calls, ["read"]);
});

test("a saved remote-only draft resumes without a vanished camera-roll URL", async () => {
  const f = fixture({ resume: true });
  assert.equal((await f.run({ asset: { ...f.asset, uri: "", runtimeFile: null } })).status, "ready");
  assert.deepEqual(f.calls, ["read"], "resume must not re-read or re-upload private device bytes");
});

test("resumed uploads adopt authoritative source kind and cannot bypass the video poster requirement", async () => {
  const f = fixture({ resume: true, readyPatch: { kind: "video", url: "https://media.example.org/clip.mp4", posterUrl: "https://media.example.org/poster.jpg" } });
  const ready = await f.run();
  assert.equal(ready.kind, "video");
  const missing = fixture({ resume: true, readyPatch: { kind: "video", url: "https://media.example.org/clip.mp4" } });
  await assert.rejects(missing.run(), { code: "VIDEO_POSTER_REQUIRED" });
});

test("a new selection without a local source or server identity still fails before any work", async () => {
  const f = fixture();
  await assert.rejects(f.run({ asset: { ...f.asset, uri: "" } }), { code: "MEDIA_SOURCE_INVALID" });
  assert.deepEqual(f.calls, []);
});

test("an expired owner source uploads its retained local original once under the same account", async () => {
  const f = fixture({ resume: true, boundary: (name) => {
    if (name === "read") throw Object.assign(new Error("Gone"), { status: 404, serverCode: "NOT_FOUND" });
  } });
  assert.equal((await f.run()).status, "ready");
  assert.deepEqual(f.calls, ["read", "prepare", "create", "transfer", "finalize"]);
  assert.deepEqual(f.drafts[1], { retiredAssetId: "remote-a" });
  assert.equal(f.requests.every(({ options }) => options.expectedAccountId === "a"), true);
});

test("missing remote-only sources never fetch a public URL as a replacement original", async () => {
  for (const uri of ["", "https://media.example.org/private-original.mp4"]) {
    const f = fixture({ resume: true, boundary: (name) => {
      if (name === "read") throw Object.assign(new Error("Gone"), { status: 404, serverCode: "NOT_FOUND" });
    } });
    await assert.rejects(f.run({ asset: { ...f.asset, uri } }), { code: "MEDIA_SOURCE_MISSING" });
    assert.deepEqual(f.calls, ["read"]);
  }
});

test("auth, identity, temporary and ambiguous missing errors never restart the local source", async () => {
  for (const error of [
    { status: 401 }, { status: 403 }, { status: 409, serverCode: "IDENTITY_CHANGED" },
    { status: 409, serverCode: "CONFLICT" },
    { status: 503, serverCode: "MEDIA_STORAGE_UNAVAILABLE" }, { status: 404 },
    { status: 404, serverCode: "ROUTE_NOT_FOUND" }, { code: "MEDIA_ASSET_INVALID" },
  ]) {
    const f = fixture({ resume: true, boundary: (name) => { if (name === "read") throw Object.assign(new Error("Cannot resume"), error); } });
    await assert.rejects(f.run());
    assert.equal(f.calls.every((name) => name === "read"), true, JSON.stringify(error));
    assert.equal(f.drafts.some((draft) => draft.retiredAssetId), false);
  }
});

test("sign-out while the expired-source fallback prepares cannot issue a fresh upload", async () => {
  const f = fixture({ resume: true, boundary: (name, { setAccount }) => {
    if (name === "read") throw Object.assign(new Error("Gone"), { status: 404, serverCode: "NOT_FOUND" });
    if (name === "prepare") setAccount(null);
  } });
  await assert.rejects(f.run(), { status: 401 });
  assert.deepEqual(f.calls, ["read", "prepare", "create"]);
  assert.deepEqual(f.mutations, []);
});

test("a failed fresh finalize cannot loop back into missing-source replacement", async () => {
  const f = fixture({ resume: true, boundary: (name) => {
    if (name === "read" || name === "finalize") throw Object.assign(new Error("Gone"), { status: 404, serverCode: "NOT_FOUND" });
  } });
  await assert.rejects(f.run(), { status: 404, serverCode: "NOT_FOUND" });
  assert.deepEqual(f.calls, ["read", "prepare", "create", "transfer", "finalize"]);
  assert.equal(f.drafts.filter((draft) => draft.retiredAssetId).length, 1);
});

test("cancellation at the missing-source read cannot restart device preparation", async () => {
  const f = fixture({ resume: true, boundary: (name, { controller }) => {
    if (name === "read") {
      controller.abort();
      throw Object.assign(new Error("Gone"), { status: 404, serverCode: "NOT_FOUND" });
    }
  } });
  await assert.rejects(f.run(), { name: "AbortError" });
  assert.deepEqual(f.calls, ["read"]);
  assert.equal(f.drafts.some((draft) => draft.retiredAssetId), false);
});

test("missing or invalid account identity rejects before reading a private device file", async () => {
  for (const expectedAccountId of [undefined, null, "", "  ", 1]) {
    const f = fixture(); await assert.rejects(f.run({ expectedAccountId }), { code: "MEDIA_ACCOUNT_REQUIRED" });
    assert.deepEqual(f.calls, []);
  }
});

for (const stage of ["prepare", "create", "transfer", "finalize"]) {
  test(`cancellation during ${stage} cannot continue or report a ready upload`, async () => {
    const f = fixture({ boundary: (name, { controller }) => { if (name === stage) controller.abort(); } });
    await assert.rejects(f.run(), { name: "AbortError" });
    assert.equal(f.calls.at(-1), stage);
    assert.equal(f.stages.includes("ready"), false);
  });
}

for (const stage of ["prepare", "transfer"]) {
  test(`account change during ${stage} cannot create or finalize for the replacement account`, async () => {
    const f = fixture({ boundary: (name, { setAccount }) => { if (name === stage) setAccount("b"); } });
    await assert.rejects(f.run(), { code: "IDENTITY_CHANGED" });
    assert.deepEqual(f.mutations, stage === "prepare" ? [] : ["create"]);
    assert.equal(f.stages.includes("ready"), false);
  });
}

test("session expiry during binary transfer stops finalization without retrying or attaching media", async () => {
  const f = fixture({ boundary: (name, { setAccount }) => { if (name === "transfer") setAccount(null); } });
  await assert.rejects(f.run(), { status: 401 });
  assert.deepEqual(f.calls, ["prepare", "create", "transfer", "finalize"]);
  assert.equal(f.stages.includes("ready"), false);
});

test("temporary creation failures recover with the identical client upload identity and one source PUT", async () => {
  let creates = 0;
  const f = fixture({ boundary: (name) => {
    if (name === "create" && ++creates < 3) throw Object.assign(new Error("Storage preparing"), { status: 503, serverCode: "MEDIA_STORAGE_UNAVAILABLE" });
  } });
  const before = JSON.stringify(f.asset);
  assert.equal((await f.run()).assetId, "remote-a");
  assert.deepEqual(f.calls, ["prepare", "create", "create", "create", "transfer", "finalize"]);
  const creations = f.requests.filter(({ path }) => path === "/api/media/assets");
  assert.equal(new Set(creations.map(({ options }) => JSON.stringify(options.body))).size, 1);
  assert.equal(creations.every(({ options }) => options.silent === true), true);
  assert.equal(JSON.stringify(f.asset), before, "Recovery never changes the selected source or draft");
  assert.deepEqual(f.drafts, [{ assetId: "remote-a", kind: "image", duplicate: false, sourceUploaded: false }, { assetId: "remote-a", kind: "image", duplicate: false, sourceUploaded: true }]);
});

test("exhausted creation recovery preserves selection and cannot upload bytes or report ready", async () => {
  const f = fixture({ boundary: (name) => { if (name === "create") throw Object.assign(new Error("Still unavailable"), { status: 503 }); } });
  await assert.rejects(f.run(), { status: 503 });
  assert.deepEqual(f.calls, ["prepare", "create", "create", "create"]);
  assert.equal(f.asset.uri, "file:///camera.jpg");
  assert.equal(f.asset.id, "local-a");
  assert.deepEqual(f.drafts, []);
  assert.equal(f.stages.includes("ready"), false);
});

test("cancel during creation backoff issues no second request and retains the draft", async () => {
  const f = fixture({ boundary: (name) => { if (name === "create") throw Object.assign(new Error("Unavailable"), { status: 503 }); } });
  await assert.rejects(f.run({}, { recovery: { wait: async () => f.controller.abort() } }), { name: "AbortError" });
  assert.deepEqual(f.calls, ["prepare", "create"]);
  assert.equal(f.asset.uri, "file:///camera.jpg");
  assert.equal(f.stages.includes("ready"), false);
});

test("account change while creation is recovering cannot adopt the replacement account", async () => {
  let creates = 0;
  const f = fixture({ boundary: (name, { setAccount }) => {
    if (name === "create" && ++creates === 1) { setAccount("b"); throw Object.assign(new Error("Unavailable"), { status: 503 }); }
  } });
  await assert.rejects(f.run(), { code: "IDENTITY_CHANGED" });
  assert.deepEqual(f.calls, ["prepare", "create", "create"]);
  assert.deepEqual(f.mutations, []);
  assert.equal(f.stages.includes("ready"), false);
});

test("cancelling a device preparation that ignores abort settles before its late result", async () => {
  const f = fixture(); let release;
  const pending = f.run({}, { prepareAsset: () => new Promise((done) => { release = done; }) });
  f.controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  release({ fileSize: 64, contentType: "image/jpeg", name: "camera.jpg" });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(f.requests, []);
  assert.equal(f.stages.includes("ready"), false);
});

test("cancelled non-aborting PUT never reports late progress or advances to finalization", async () => {
  const f = fixture(); const progress = []; let release, report;
  let started;
  const entered = new Promise((done) => { started = done; });
  const pending = f.run({ onProgress: (value) => progress.push(value) }, {
    uploadPrepared: (_source, _ticket, options) => { report = options.onProgress; started(); return new Promise((done) => { release = done; }); },
  });
  await entered; f.controller.abort(); await assert.rejects(pending, { name: "AbortError" });
  report({ fraction: 1 }); release(); await new Promise((done) => setImmediate(done));
  assert.deepEqual(progress, []);
  assert.equal(f.calls.includes("finalize"), false);
  assert.equal(f.stages.includes("ready"), false);
});

test("the final fallback owner read adopts only the expected opaque asset identity", async () => {
  for (const returnedId of ["remote-a", "remote-other"]) {
    const calls = [], stages = [];
    // Force the defensive GET branch while executing the actual upload body.
    const run = uploadWithFinalizer(async () => null);
    const pending = run({ asset: { id: "local-a", uri: "file:///camera.jpg", kind: "image" }, expectedAccountId: "a", onStage: (stage) => stages.push(stage) }, {
      prepareAsset: async () => ({ fileSize: 64, contentType: "image/jpeg", name: "camera.jpg" }),
      apiCall: async (path) => {
        calls.push(path);
        return { asset: { id: path === "/api/media/assets" ? "remote-a" : returnedId, status: "ready", url: "https://media.example.org/verified.jpg" } };
      },
    });
    if (returnedId === "remote-a") assert.equal((await pending).assetId, "remote-a");
    else { await assert.rejects(pending, { code: "MEDIA_FINALIZE_PENDING" }); assert.equal(stages.includes("ready"), false); }
    assert.deepEqual(calls, ["/api/media/assets", "/api/media/assets/remote-a"]);
  }
});
