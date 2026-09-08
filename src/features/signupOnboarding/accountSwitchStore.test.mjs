import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createAuthTransitions } from "../../domain/authTransitions.mjs";

const source = readFileSync(new URL("../../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const provider = ast.program.body.find((node) => node.declaration?.id?.name === "StoreProvider").declaration;
const callback = provider.body.body.flatMap((node) => node.type === "VariableDeclaration" ? node.declarations : [])
  .find((node) => node.id?.name === "switchLinkedAccount").init;
const productionCallback = source.slice(callback.start, callback.end);
function fixture() {
  const sessionRef = { current: { id: "a" } }, accountMutationEpochRef = { current: 4 };
  const calls = [], adopted = [];
  let resolve, reject;
  const pending = new Promise((done, fail) => { resolve = done; reject = fail; });
  const request = (...args) => { calls.push(args); return pending; };
  const absorb = (...args) => adopted.push(args);
  let intent = null;
  const transitions = createAuthTransitions({ read: () => intent, write: (value) => { intent = value; }, revoke: async () => {} });
  const performAuthentication = (send, accept) => transitions.run({ request: send, accept });
  const run = new Function("sessionRef", "accountMutationEpochRef", "switchLinkedAccountRequest", "absorbServerUser", "performAuthentication", "logout",
    `return (${productionCallback});`)(sessionRef, accountMutationEpochRef, request, absorb, performAuthentication, () => transitions.signOut());
  return { run, calls, adopted, resolve, reject, sessionRef, accountMutationEpochRef };
}

test("account switching never sends a stale or missing source identity", async () => {
  const f = fixture();
  for (const [target, sourceId] of [["b", undefined], ["b", "c"], ["a", "a"], [null, "a"]]) {
    assert.equal((await f.run(target, { expectedAccountId: sourceId })).ok, false);
  }
  assert.deepEqual(f.calls, []);
});
test("a confirmed exact target is adopted through the existing private-cache reset", async () => {
  const f = fixture(), user = { id: "b", emailVerified: true };
  const pending = f.run("b", { expectedAccountId: "a" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls, [["a", "b"]]);
  f.resolve({ user });
  assert.deepEqual(await pending, { ok: true });
  assert.deepEqual(f.adopted, [[user, { announce: true }]]);
});
test("a late switch cannot overwrite logout, another account, or a newer identity epoch", async () => {
  for (const mode of ["logout", "account", "epoch"]) {
    const f = fixture(), pending = f.run("b", { expectedAccountId: "a" });
    if (mode === "epoch") f.accountMutationEpochRef.current++;
    else f.sessionRef.current = mode === "logout" ? null : { id: "c" };
    f.resolve({ user: { id: "b" } });
    assert.equal((await pending).stale, true);
    assert.deepEqual(f.adopted, []);
  }
});
test("failed, malformed or wrong-target responses never report a completed switch", async () => {
  for (const response of [{}, { user: { id: "c" } }, { user: { id: "a" } }]) {
    const f = fixture(), pending = f.run("b", { expectedAccountId: "a" });
    f.resolve(response);
    assert.equal((await pending).ok, false);
    assert.deepEqual(f.adopted, []);
  }
  const f = fixture(), pending = f.run("b", { expectedAccountId: "a" });
  f.reject(new Error("Network unavailable"));
  assert.equal((await pending).ok, false);
  assert.deepEqual(f.adopted, []);
});
