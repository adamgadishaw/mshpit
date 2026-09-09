import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { captureAccountMutation, accountMutationIsCurrent } from "./accountMutation.mjs";

const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const provider = ast.program.body.find(node => node.declaration?.id?.name === "StoreProvider").declaration;
const callback = provider.body.body.flatMap(node => node.type === "VariableDeclaration" ? node.declarations : [])
  .find(node => node.id?.name === "exportMyData").init;
// Replace only platform-loading seams, not the production control flow/guards.
const implementation = source.slice(callback.start, callback.end)
  .replace('import("expo-file-system")', "loadFileSystem()")
  .replace('import("expo-sharing")', "loadSharing()");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(done => setImmediate(done));

function fixture(stage, { shareFailure = false, switchDuringShare = false, createFailure = false, writeFailure = false, switchDuringWrite = false } = {}) {
  const barrier = deferred(), calls = [];
  const sessionRef = { current: { id: "a", handle: "alice" } }, accountMutationEpochRef = { current: 1 };
  const switchAccount = next => { sessionRef.current = next ? { id: next, handle: next } : null; accountMutationEpochRef.current++; };
  const fileSystem = { Paths: { cache: "fixture-private-cache" }, File: class {
    constructor(folder, name) { this.uri = `fixture://${folder}/${name}`; calls.push("file"); }
    create(options) { calls.push("create"); assert.equal(options.overwrite, false); if (createFailure) throw new Error("fixture already exists"); }
    write() { calls.push("write"); if (switchDuringWrite) switchAccount("b"); if (writeFailure) throw new Error("fixture write failed"); }
    delete() { calls.push("delete"); }
  } };
  const dependencies = {
    session: sessionRef.current, sessionRef, accountMutationEpochRef, captureAccountMutation, accountMutationIsCurrent,
    requestAccountExport: async (_password, options) => { calls.push("request"); assert.equal(options.expectedAccountId, "a"); if (stage === "request") await barrier.promise; return { account: "a", messages: ["fixture-private-content"] }; },
    loadFileSystem: async () => { calls.push("modules"); if (stage === "modules") await barrier.promise; return fileSystem; },
    loadSharing: async () => ({
      isAvailableAsync: async () => { calls.push("availability"); if (stage === "availability") await barrier.promise; return true; },
      shareAsync: async () => { calls.push("share"); if (switchDuringShare) switchAccount("b"); if (shareFailure) throw new Error("fixture share unavailable"); },
    }),
    captureAppError: error => error, window: undefined, document: undefined,
  };
  const run = new Function(...Object.keys(dependencies), `return (${implementation});`)(...Object.values(dependencies));
  return { run, calls, release: barrier.resolve, switchAccount };
}

for (const stage of ["request", "modules", "availability"]) {
  for (const transition of ["logout", "switch", "roundtrip"]) {
    test(`native export ${stage} cannot write or share a departed account after ${transition}`, async () => {
      const f = fixture(stage), pending = f.run("fixture-password");
      await tick();
      f.switchAccount(transition === "logout" ? null : "b");
      if (transition === "roundtrip") f.switchAccount("a");
      f.release();
      const result = await pending;
      assert.equal(result.ok, false);
      assert.equal(result.stale, true);
      assert.equal(f.calls.some(value => ["file", "create", "write", "share"].includes(value)), false);
    });
  }
}

for (const options of [{}, { shareFailure: true }, { switchDuringShare: true }]) {
  test(`native export retires only its temporary file after share handoff ${JSON.stringify(options)}`, async () => {
    const f = fixture(null, options);
    const result = await f.run("fixture-password");
    assert.equal(result.ok, !options.shareFailure);
    assert.deepEqual(f.calls, ["request", "modules", "availability", "file", "create", "write", "share", "delete"]);
  });
}

test("failed file creation does not delete a preexisting cache file owned by another invocation", async () => {
  const f = fixture(null, { createFailure: true });
  assert.equal((await f.run("fixture-password")).ok, false);
  assert.deepEqual(f.calls, ["request", "modules", "availability", "file", "create"]);
});

for (const options of [{ writeFailure: true }, { switchDuringWrite: true }]) {
  test(`a failed or superseded native write cleans its owned file without share handoff ${JSON.stringify(options)}`, async () => {
    const f = fixture(null, options);
    assert.equal((await f.run("fixture-password")).ok, false);
    assert.deepEqual(f.calls, ["request", "modules", "availability", "file", "create", "write", "delete"]);
  });
}
