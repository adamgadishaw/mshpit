import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { defaultMediaEdit } from "../domain/mediaEdit.mjs";
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
  "boundedMediaRequest", "recoverMediaRequest", "mediaUploadTimeoutMs",
  `${body}\nreturn uploadOriginalMediaAsset;`)(
  () => { throw new Error("Unexpected default transport"); },
  (url) => /^https:\/\//u.test(url || ""),
  () => { throw new Error("Unexpected device preparation"); },
  () => { throw new Error("Unexpected device transfer"); },
  finalize, resumeExistingMediaSourceV1, defaultMediaEdit, mediaSourceClientAssetId,
  boundedMediaRequest, recoverMediaRequest, mediaUploadTimeoutMs,
);
const upload = uploadWithFinalizer();

function fixture({ boundary = () => {}, resume = false } = {}) {
  const calls = [], mutations = [], stages = [], requests = [], drafts = [];
  const controller = new AbortController();
  let account = "a";
  const asset = { id: "local-a", uri: "file:///camera.jpg", kind: "image", width: 64, height: 64,
    ...(resume ? { assetId: "remote-a" } : {}) };
  const ready = { id: "remote-a", status: "ready", url: "https://media.example.org/verified.jpg" };
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

test("resuming an owner draft binds the read and skips device bytes", async () => {
  const f = fixture({ resume: true }); assert.equal((await f.run()).status, "ready");
  assert.deepEqual(f.calls, ["read"]);
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
  assert.deepEqual(f.drafts, [{ assetId: "remote-a", duplicate: false, sourceUploaded: false }, { assetId: "remote-a", duplicate: false, sourceUploaded: true }]);
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
