import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { defaultMediaEdit } from "../domain/mediaEdit.mjs";
import { mediaSourceClientAssetId } from "../domain/mediaUploadIdentity.mjs";
import { finalizeMediaSourceV1, resumeExistingMediaSourceV1 } from "./mediaAssetFinalize.mjs";

const source = readFileSync(new URL("./mediaAssetUpload.js", import.meta.url), "utf8");
const body = parse(source, { sourceType: "module" }).program.body
  .filter((node) => node.type !== "ImportDeclaration")
  .map((node) => node.type === "ExportNamedDeclaration" ? node.declaration : node)
  .map((node) => source.slice(node.start, node.end)).join("\n");
const upload = new Function("api", "isDurableMediaUrl", "prepareMediaUploadAsset", "uploadPreparedMediaAsset",
  "finalizeMediaSourceV1", "resumeExistingMediaSourceV1", "defaultMediaEdit", "mediaSourceClientAssetId",
  `${body}\nreturn uploadOriginalMediaAsset;`)(
  () => { throw new Error("Unexpected default transport"); },
  (url) => /^https:\/\//u.test(url || ""),
  () => { throw new Error("Unexpected device preparation"); },
  () => { throw new Error("Unexpected device transfer"); },
  finalizeMediaSourceV1, resumeExistingMediaSourceV1, defaultMediaEdit, mediaSourceClientAssetId,
);

function fixture({ boundary = () => {}, resume = false } = {}) {
  const calls = [], mutations = [], stages = [];
  const controller = new AbortController();
  let account = "a";
  const asset = { id: "local-a", uri: "file:///camera.jpg", kind: "image", width: 64, height: 64,
    ...(resume ? { assetId: "remote-a" } : {}) };
  const ready = { id: "remote-a", status: "ready", url: "https://media.example.org/verified.jpg" };
  const step = async (name) => { calls.push(name); await boundary(name, { controller, setAccount: (next) => { account = next; } }); };
  const services = {
    prepareAsset: async () => { await step("prepare"); return { fileSize: 64, contentType: "image/jpeg", name: "camera.jpg" }; },
    uploadPrepared: async () => { await step("transfer"); },
    apiCall: async (path, options) => {
      const kind = path.endsWith("/finalize") ? "finalize" : options.method === "POST" ? "create" : "read";
      await step(kind);
      assert.equal(options.expectedAccountId, "a", "Every request must retain the initiating account");
      assert.equal(options.signal, controller.signal);
      if (!account) throw Object.assign(new Error("Session expired"), { status: 401 });
      if (account !== options.expectedAccountId) throw Object.assign(new Error("Account changed"), { status: 409, code: "IDENTITY_CHANGED" });
      mutations.push(kind);
      return kind === "create" ? { asset: { id: "remote-a", status: "pending" }, upload: { private: true } } : { asset: ready };
    },
  };
  return { calls, mutations, stages, controller,
    run: (options = {}) => upload({ asset, expectedAccountId: "a", signal: controller.signal, onStage: (value) => stages.push(value), ...options }, services) };
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
