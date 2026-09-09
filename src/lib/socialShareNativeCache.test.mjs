import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { socialShareFileName } from "../domain/socialShareCard.mjs";

// Execute the real adapter with an in-memory SDK seam. No device filesystem,
// network request, private data, or external share sheet is used.
const source = readFileSync(new URL("./socialShare.native.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module" });
const body = ast.program.body.flatMap((node) => {
  if (node.type === "ImportDeclaration") return [];
  const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
  return declaration ? [source.slice(declaration.start, declaration.end)] : [];
}).join("\n");
const model = { id: "event-test", kind: "going", renderRequest: { kind: "event", eventId: "event-test", intent: "going" } };
const result = (byte) => ({ bytes: Uint8Array.of(byte), photoCreditUrl: null });
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

function fixture({ files = new Map(), apiBinary = async () => result(1), writeFails = false } = {}) {
  const requests = [];
  class File {
    constructor(base, name) { this.uri = `${base}/${name}`; }
    get exists() { return files.has(this.uri); }
    create(options) {
      assert.equal(options.overwrite, false);
      if (files.has(this.uri)) throw new Error("already exists");
      files.set(this.uri, null);
    }
    write(bytes) {
      if (writeFails) throw new Error("write failed");
      files.set(this.uri, bytes);
    }
    delete() { files.delete(this.uri); }
  }
  const bindings = {
    File, Paths: { cache: "file:///fixture-cache" },
    Date: { now: () => 1_000 }, Math: { random: () => 0.5 },
    socialShareFileName,
    apiBinary: (...args) => { requests.push(args); return apiBinary(...args); },
    process: { env: {} }, Platform: { OS: "ios" }, Clipboard: {}, Linking: {},
  };
  const adapter = new Function(...Object.keys(bindings), `${body}\nreturn {createShareCardAsset,releaseShareCardAsset};`)(...Object.values(bindings));
  return { ...adapter, files, requests };
}

test("concurrent same-ticket preparations own separate files even with identical clock and random values", async () => {
  const f = fixture();
  const [first, second] = await Promise.all([
    f.createShareCardAsset(model, { accountId: "account-a" }),
    f.createShareCardAsset(model, { accountId: "account-b" }),
  ]);
  assert.notEqual(first.fileUri, second.fileUri);
  assert.equal(first.previewUri, first.fileUri);
  assert.equal(second.previewUri, second.fileUri);
  assert.doesNotMatch(first.fileUri, /account-a|event-test/);
  f.releaseShareCardAsset(first);
  assert.equal(f.files.has(second.fileUri), true);
  assert.equal(f.files.size, 1);
  f.releaseShareCardAsset(second);
  assert.equal(f.files.size, 0);
  assert.equal(f.requests[0][1].expectedAccountId, "account-a");
  assert.equal(f.requests[1][1].expectedAccountId, "account-b");
});

test("a late cancelled response cannot write over or delete a newer retry", async () => {
  const old = deferred(), controller = new AbortController();
  let calls = 0;
  const f = fixture({ apiBinary: () => ++calls === 1 ? old.promise : Promise.resolve(result(2)) });
  const first = f.createShareCardAsset(model, { accountId: "account-a", signal: controller.signal });
  controller.abort();
  const second = await f.createShareCardAsset(model, { accountId: "account-a" });
  const rejected = assert.rejects(first, { name: "AbortError" });
  old.resolve(result(1));
  await rejected;
  assert.equal(f.files.size, 1);
  assert.deepEqual(f.files.get(second.fileUri), Uint8Array.of(2));
});

test("an already cancelled preparation never requests or creates a card", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.createShareCardAsset(model, { accountId: "account-a", signal: controller.signal }), { name: "AbortError" });
  assert.equal(f.requests.length, 0);
  assert.equal(f.files.size, 0);
});

test("a write failure cleans only its newly created partial file", async () => {
  const files = new Map([["file:///fixture-cache/unrelated.png", Uint8Array.of(7)]]);
  const f = fixture({ files, writeFails: true });
  await assert.rejects(f.createShareCardAsset(model, { accountId: "account-a" }), /write failed/);
  assert.deepEqual([...files], [["file:///fixture-cache/unrelated.png", Uint8Array.of(7)]]);
});

test("a cache collision from another runtime neither overwrites nor removes its file", async () => {
  const files = new Map(), first = fixture({ files }), second = fixture({ files });
  const existing = await first.createShareCardAsset(model, { accountId: "account-a" });
  await assert.rejects(second.createShareCardAsset(model, { accountId: "account-b" }), /already exists/);
  assert.equal(files.size, 1);
  assert.deepEqual(files.get(existing.fileUri), Uint8Array.of(1));
});
