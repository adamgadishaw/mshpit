import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

// Execute App's actual completion callback against deterministic Store and
// navigation seams; do not duplicate its account guards in the test fixture.
const source = readFileSync(new URL("../../../App.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const root = ast.program.body.find((node) => node.type === "FunctionDeclaration" && node.id?.name === "Root");
const callback = root?.body.body.flatMap((node) => node.type === "VariableDeclaration" ? node.declarations : [])
  .find((node) => node.id?.name === "finishSignupOnboarding")?.init;
assert.ok(callback, "The production signup completion callback must exist");
const productionCallback = source.slice(callback.start, callback.end);

function fixture() {
  const sessionRef = { current: { id: "account-a", emailVerified: true } };
  const calls = [], navigations = [], verifiedActions = [];
  let resolve, reject;
  const result = new Promise((done, fail) => { resolve = done; reject = fail; });
  const completeSignupOnboarding = (options) => { calls.push(options); return result; };
  const replace = (route) => navigations.push(route);
  const requireVerifiedMutation = (kind, run) => { verifiedActions.push(kind); run(); };
  const finish = new Function("sessionRef", "completeSignupOnboarding", "replace", "requireVerifiedMutation",
    `return (${productionCallback});`)(sessionRef, completeSignupOnboarding, replace, requireVerifiedMutation);
  return { finish, sessionRef, calls, navigations, verifiedActions, resolve, reject };
}

test("setup completion rejects missing, switched or already-canceled account before mutation", async () => {
  const aborted = new AbortController(); aborted.abort();
  for (const options of [{}, { expectedAccountId: "account-b" }, { expectedAccountId: "account-a", signal: aborted.signal }]) {
    const f = fixture();
    assert.deepEqual(await f.finish(options), { ok: false, stale: true, error: "Your account changed. Reopen setup." });
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.navigations, []);
  }
});

test("an account change or logout after completion starts cannot redirect the new session", async () => {
  for (const nextSession of [null, { id: "account-b", emailVerified: true }]) {
    const f = fixture(), controller = new AbortController();
    const pending = f.finish({ destination: "artists", expectedAccountId: "account-a", signal: controller.signal });
    assert.deepEqual(f.calls, [{ expectedAccountId: "account-a", signal: controller.signal }]);
    f.sessionRef.current = nextSession;
    f.resolve({ ok: true, user: { id: "account-a", onboardingVersion: 1 } });
    await pending;
    assert.deepEqual(f.navigations, []);
    assert.deepEqual(f.verifiedActions, []);
  }
});

test("successful completion still opens the chosen destination after setup's normal unmount abort", async () => {
  for (const [destination, route] of [["shows", { nearby: true, nearbyTab: "shows" }], ["artists", { pickArtists: true }], ["review", { logging: true }]]) {
    const f = fixture(), controller = new AbortController();
    const pending = f.finish({ destination, expectedAccountId: "account-a", signal: controller.signal });
    // Store publishes the confirmed version first, unmounting setup. Its
    // cleanup aborts the screen controller before App resumes this callback.
    f.sessionRef.current = { id: "account-a", emailVerified: true, onboardingVersion: 1 };
    controller.abort();
    f.resolve({ ok: true, user: f.sessionRef.current });
    assert.equal((await pending).ok, true);
    assert.deepEqual(f.navigations, [route]);
    assert.deepEqual(f.verifiedActions, destination === "review" ? ["review"] : []);
  }
});

test("a failed or rejected completion never opens a destination", async () => {
  const failed = fixture();
  const failure = { ok: false, error: "Please retry." };
  const pending = failed.finish({ destination: "shows", expectedAccountId: "account-a" });
  failed.resolve(failure);
  assert.equal(await pending, failure);
  assert.deepEqual(failed.navigations, []);

  const rejected = fixture();
  const rejectedPending = rejected.finish({ destination: "review", expectedAccountId: "account-a" });
  rejected.reject(new Error("Network unavailable"));
  await assert.rejects(rejectedPending, /Network unavailable/);
  assert.deepEqual(rejected.navigations, []);
  assert.deepEqual(rejected.verifiedActions, []);
});

test("deferring setup does not trigger a selected review or artist action", async () => {
  const f = fixture();
  const pending = f.finish({ destination: "feed", expectedAccountId: "account-a" });
  f.resolve({ ok: true, user: { id: "account-a", onboardingVersion: 1 } });
  assert.equal((await pending).ok, true);
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.verifiedActions, []);
});
