import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

// Exercise the production orchestration with deterministic device/transport
// seams, without importing React Native's platform runtime into Node tests.
const source = readFileSync(new URL("./mediaUpload.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module" });
const declaration = ast.program.body.find((node) => node.type === "ExportNamedDeclaration"
  && node.declaration?.id?.name === "uploadMediaAsset")?.declaration;
assert.ok(declaration, "The production upload helper must exist");
const productionFunction = source.slice(declaration.start, declaration.end);
const dependencyNames = ["normalizeProfileImageAsset", "prepareMediaUploadAsset", "api", "uploadPreparedMediaAsset",
  "isDurableMediaUrl", "AppError", "captureAppError"];

function fixture({ atStage = async () => {}, rejectNormalization = false } = {}) {
  const calls = [], mutations = [];
  const controller = new AbortController();
  const original = { uri: "file:///private-camera.jpg" };
  let released = 0, account = "account-a";
  const normalized = { uri: "blob:normalized-private-photo", release: () => { released += 1; } };
  const ticket = { storageScope: "private", finalizeToken: "private-finalize-token", descriptorId: "owned-a" };
  const stage = async (name, options) => { calls.push({ name, options }); await atStage(name, { controller, setAccount: (next) => { account = next; } }); };
  const dependencies = {
    normalizeProfileImageAsset: async (_asset, _purpose, options) => {
      await stage("normalize", options);
      if (rejectNormalization) throw new Error("Optional local image normalization failed");
      return normalized;
    },
    prepareMediaUploadAsset: async (asset, options) => {
      await stage("prepare", options);
      return { body: asset, contentType: "image/jpeg", fileSize: 120, name: "camera.jpg" };
    },
    api: async (path, options) => {
      const name = path.endsWith("presign") ? "presign" : "finalize";
      await stage(name, options);
      if (options.expectedAccountId !== undefined && options.expectedAccountId !== account) {
        throw Object.assign(new Error("Account changed"), { code: "IDENTITY_CHANGED" });
      }
      mutations.push({ name, account });
      return name === "presign" ? ticket : { descriptorId: ticket.descriptorId, publicUrl: "https://media.example.org/sanitized.jpg" };
    },
    uploadPreparedMediaAsset: async (_prepared, _ticket, options) => {
      await stage("transfer", options); mutations.push({ name: "transfer", account: "account-a" });
    },
    isDurableMediaUrl: (url) => /^https:\/\//u.test(url || ""),
    AppError: class AppError extends Error {},
    captureAppError: (error) => error,
  };
  const upload = new Function(...dependencyNames, `return (${productionFunction});`)(...dependencyNames.map((key) => dependencies[key]));
  return { upload: (options = { signal: controller.signal, expectedAccountId: "account-a" }) => upload(original, "avatar", options),
    calls, mutations, controller, released: () => released };
}

test("account-scoped uploads bind presign and finalize to the same initiating account", async () => {
  const f = fixture();
  assert.equal(await f.upload(), "https://media.example.org/sanitized.jpg");
  assert.deepEqual(f.calls.map((call) => call.name), ["normalize", "prepare", "presign", "transfer", "finalize"]);
  for (const call of f.calls.filter(({ name }) => ["presign", "finalize"].includes(name))) {
    assert.equal(call.options.expectedAccountId, "account-a"); assert.equal(call.options.signal, f.controller.signal);
  }
  assert.equal(f.calls.find(({ name }) => name === "transfer").options.signal, f.controller.signal);
  assert.equal(f.released(), 1);
});

test("legacy callers remain supported and optional normalization failures still use the source", async () => {
  const f = fixture({ rejectNormalization: true });
  assert.equal(await f.upload({}), "https://media.example.org/sanitized.jpg");
  assert.ok(f.calls.filter(({ name }) => ["presign", "finalize"].includes(name)).every(({ options }) => options.expectedAccountId === undefined));
  assert.equal(f.released(), 0);
});

test("explicit invalid account bindings fail before preparation or mutation", async () => {
  for (const expectedAccountId of [null, "", "   ", 12]) {
    const f = fixture();
    await assert.rejects(f.upload({ expectedAccountId }), /account identity/);
    assert.equal(f.calls.length, 0); assert.equal(f.mutations.length, 0);
  }
});

test("an already cancelled upload performs no preparation or mutation", async () => {
  const f = fixture(); f.controller.abort();
  await assert.rejects(f.upload(), { name: "AbortError" });
  assert.equal(f.calls.length, 0); assert.equal(f.mutations.length, 0);
});

for (const cancelledStage of ["normalize", "prepare", "presign", "transfer", "finalize"]) {
  test(`cancellation during ${cancelledStage} stops the next boundary and releases temporary output`, async () => {
    const f = fixture({ atStage: async (name, { controller }) => { if (name === cancelledStage) controller.abort(); } });
    await assert.rejects(f.upload(), { name: "AbortError" });
    assert.equal(f.calls.at(-1).name, cancelledStage);
    assert.equal(f.released(), 1);
    if (["normalize", "prepare"].includes(cancelledStage)) assert.equal(f.mutations.length, 0);
    if (cancelledStage === "transfer") assert.equal(f.calls.some(({ name }) => name === "finalize"), false);
  });
}

for (const changedStage of ["normalize", "prepare"]) {
  test(`an account change during ${changedStage} cannot turn the photo into a new-account upload`, async () => {
    const f = fixture({ atStage: async (name, { setAccount }) => { if (name === changedStage) setAccount("account-b"); } });
    await assert.rejects(f.upload(), { code: "IDENTITY_CHANGED" });
    assert.deepEqual(f.mutations, []);
    assert.equal(f.calls.at(-1).options.expectedAccountId, "account-a");
    assert.equal(f.calls.some(({ name }) => name === "transfer"), false);
    assert.equal(f.released(), 1);
  });
}

test("an account change during transfer cannot finalize using the replacement account", async () => {
  const f = fixture({ atStage: async (name, { setAccount }) => { if (name === "transfer") setAccount("account-b"); } });
  await assert.rejects(f.upload(), { code: "IDENTITY_CHANGED" });
  assert.deepEqual(f.mutations.map(({ name, account }) => `${name}:${account}`), ["presign:account-a", "transfer:account-a"]);
  assert.equal(f.calls.at(-1).options.expectedAccountId, "account-a");
  assert.equal(f.released(), 1);
});
