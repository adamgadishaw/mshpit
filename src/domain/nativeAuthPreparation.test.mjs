import test from "node:test";
import assert from "node:assert/strict";
import { createAuthTransitions } from "./authTransitions.mjs";
import { withNativeAuthPreparation } from "./nativeAuthPreparation.mjs";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function setup() {
  let stored = { phase: "signed-in", revision: "initial" }, n = 0;
  const calls = [], gate = deferred();
  const auth = withNativeAuthPreparation(createAuthTransitions({ read: () => stored, write: value => { stored = value; }, nonce: () => String(++n), revoke: async () => calls.push("logout") }));
  auth.attachPreparation({ prepare: () => gate.promise, reset: () => calls.push("reset"), cancelPreparation: () => calls.push("cancel") });
  const options = { request: async () => { calls.push("credentials"); return { user: { id: "B" } }; }, accept: value => value };
  return { auth, calls, gate, options };
}
test("native account change awaits revocation before existing credential queue", async () => {
  const f = setup(), task = f.auth.run(f.options); assert.deepEqual(f.calls, []);
  f.gate.resolve({ ok: true }); await task; assert.deepEqual(f.calls, ["credentials", "cancel"]);
});
test("offline preparation preserves account and never changes credentials", async () => {
  const f = setup(), task = f.auth.run(f.options); f.gate.resolve({ ok: false, error: new Error("offline") });
  await assert.rejects(task, /offline/); assert.equal(f.auth.snapshot().phase, "signed-in"); assert.deepEqual(f.calls, ["cancel"]);
});
test("logout and abort fence delayed preflight; only newest attempt can proceed", async () => {
  const f = setup(), first = f.auth.run(f.options), second = f.auth.run(f.options);
  f.gate.resolve({ ok: true }); assert.equal((await first).kind, "cancelled"); await second;
  assert.equal(f.calls.filter(value => value === "credentials").length, 1);
  const g = setup(), pending = g.auth.run(g.options); const signOut = g.auth.signOut();
  assert.deepEqual(g.calls, ["reset"]); g.gate.resolve({ ok: true }); assert.equal((await pending).kind, "cancelled"); await signOut;
  assert.equal(g.calls.includes("credentials"), false);
  const h = setup(), signal = new AbortController(), aborted = h.auth.run({ ...h.options, signal: signal.signal });
  signal.abort(); h.gate.resolve({ ok: true }); assert.equal((await aborted).kind, "cancelled"); assert.equal(h.calls.includes("credentials"), false);
});
