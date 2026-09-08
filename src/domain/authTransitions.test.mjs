import assert from "node:assert/strict";
import test from "node:test";
import { createAuthTransitions } from "./authTransitions.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const fixture = ({ state = null, revoke = async () => {}, exclusive } = {}) => {
  const storage = { state };
  let index = 0;
  const options = { read: () => storage.state, write: (value) => { storage.state = value; }, revoke, exclusive, nonce: () => `intent-${++index}` };
  return { transitions: createAuthTransitions(options), storage, options };
};

test("failed logout is durable and does not unlock on retry or reload", async () => {
  let offline = true, attempts = 0;
  const { transitions, options } = fixture({ revoke: async () => { attempts++; if (offline) throw new Error("offline"); } });
  assert.equal((await transitions.signOut()).kind, "pending");
  assert.equal(transitions.blocked(), true);
  const reloaded = createAuthTransitions(options);
  assert.equal(reloaded.blocked(), true);
  offline = false;
  assert.equal((await reloaded.reconcile()).kind, "revoked");
  assert.equal(reloaded.blocked(), true, "acknowledgment must not permit an old late cookie to restore identity");
  assert.equal(attempts, 2);
});

test("explicit successful login unlocks a signed-out browser", async () => {
  const { transitions } = fixture();
  await transitions.signOut();
  let adopted = null;
  const result = await transitions.run({ request: async () => ({ user: { id: "A" } }), accept: ({ user }) => { adopted = user.id; return { ok: true }; } });
  assert.equal(result.ok, true);
  assert.equal(adopted, "A");
  assert.equal(transitions.blocked(), false);
});

for (const operation of ["login", "reset", "signup", "switch"]) {
  test(`${operation} completing after logout cannot adopt and is revoked afterwards`, async () => {
    const response = deferred(), calls = [];
    const { transitions } = fixture({ revoke: async () => { calls.push("revoke"); } });
    const request = transitions.run({ request: async () => { calls.push(operation); return response.promise; }, accept: () => { calls.push("adopt"); } });
    await tick();
    const logout = transitions.signOut();
    assert.deepEqual(calls, [operation]);
    response.resolve({ user: { id: "A" } });
    assert.equal((await request).stale, true);
    assert.equal((await logout).kind, "revoked");
    assert.deepEqual(calls, [operation, "revoke"]);
    assert.equal(transitions.blocked(), true);
  });
}

test("leaving a pending form queues cookie revocation, not just local cancellation", async () => {
  const response = deferred(), controller = new AbortController(), calls = [];
  const { transitions } = fixture({ revoke: async () => { calls.push("revoke"); } });
  const run = transitions.run({ signal: controller.signal, request: () => response.promise, accept: () => calls.push("adopt"), onCancel: () => { calls.push("clear-private"); void transitions.signOut(); } });
  await tick();
  controller.abort();
  assert.equal(transitions.blocked(), true);
  assert.deepEqual(calls, ["clear-private"]);
  response.resolve({ user: { id: "A" } });
  assert.equal((await run).stale, true);
  await tick();
  assert.deepEqual(calls, ["clear-private", "revoke"]);
});

test("unmount after committed success does not undo the accepted login", async () => {
  const controller = new AbortController();
  const { transitions } = fixture();
  const result = await transitions.run({ signal: controller.signal, request: async () => ({ user: { id: "A" } }), accept: () => { controller.abort(); return { ok: true }; }, onCancel: () => assert.fail("already accepted") });
  assert.equal(result.ok, true);
  assert.equal(transitions.blocked(), false);
});

test("aborted-before-start never sends credentials", async () => {
  const controller = new AbortController(); controller.abort();
  const { transitions } = fixture();
  assert.equal((await transitions.run({ signal: controller.signal, request: () => assert.fail("sent"), accept: () => {} })).stale, true);
});

test("newer login supersedes older response and queued logout without revoking the new login", async () => {
  const first = deferred(), calls = [];
  const { transitions } = fixture({ revoke: async () => calls.push("revoke") });
  const a = transitions.run({ request: () => first.promise, accept: () => calls.push("A") });
  await tick();
  const logout = transitions.signOut();
  const b = transitions.run({ request: async () => ({ user: { id: "B" } }), accept: () => { calls.push("B"); return { ok: true }; } });
  first.resolve({ user: { id: "A" } });
  assert.equal((await a).stale, true);
  assert.equal((await logout).stale, true);
  assert.equal((await b).ok, true);
  assert.deepEqual(calls, ["B"]);
});

test("unknown login outcome stays blocked and revokes; rejected credentials can retry", async () => {
  const calls = [];
  const { transitions } = fixture({ revoke: async () => calls.push("revoke") });
  await assert.rejects(transitions.run({ request: async () => { throw new Error("timeout"); }, accept: () => assert.fail("adopted") }), /timeout/);
  await tick();
  assert.equal(transitions.blocked(), true);
  assert.deepEqual(calls, ["revoke"]);
  await assert.rejects(transitions.run({ request: async () => { throw Object.assign(new Error("wrong password"), { status: 401 }); }, accept: () => {} }), /wrong password/);
  assert.equal(transitions.blocked(), true);
  assert.equal((await transitions.run({ request: async () => ({ user: { id: "A" } }), accept: () => ({ ok: true }) })).ok, true);
});

test("account choice cannot unlock a previously signed-out cookie", async () => {
  const { transitions } = fixture();
  await transitions.signOut();
  await transitions.run({ request: async () => ({ chooseAccount: true, accounts: [{ id: "A" }, { id: "B" }] }), accept: () => ({ ok: true, chooseAccount: true }) });
  assert.equal(transitions.blocked(), true);
  assert.equal(transitions.pending(), false);
});

test("two tabs serialize cookie writes and old-tab reconciliation cannot revoke the new login", async () => {
  let shared = null, serial = Promise.resolve(), id = 0;
  const calls = [], response = deferred();
  const options = {
    read: () => shared, write: (value) => { shared = value; }, nonce: () => `${++id}`,
    revoke: async () => calls.push("revoke"),
    exclusive: (work) => { const next = serial.then(work); serial = next.catch(() => {}); return next; },
  };
  const a = createAuthTransitions(options), b = createAuthTransitions(options);
  const first = a.run({ request: () => response.promise, accept: () => assert.fail("old A adopted") });
  await tick();
  const logout = b.signOut();
  const second = b.run({ request: async () => ({ user: { id: "B" } }), accept: () => ({ ok: true }) });
  response.resolve({ user: { id: "A" } });
  assert.equal((await first).stale, true);
  await logout;
  assert.equal((await second).ok, true);
  assert.equal(a.blocked(), false);
  assert.deepEqual(calls, []);
});
