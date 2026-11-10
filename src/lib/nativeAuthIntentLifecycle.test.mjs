import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { registerHooks } from "node:module";
import { createJsonPersistence } from "./persistenceAdapter.mjs";
import { createAuthIntentPersistence } from "./authIntentPersistence.mjs";
import { AUTH_INTENT_KEY, createAuthTransitions } from "../domain/authTransitions.mjs";
import { cleanEmail, cleanName, cleanHandle, isEmail, isHandle, isName, isPassword } from "../domain/validation.mjs";
import { profileGenreSelection, PROFILE_GENRE_OPTIONS } from "../domain/genrePreferences.mjs";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "./persist" && context.parentURL?.endsWith("/src/lib/diagnostics.js")) {
    return nextResolve(new URL("./persist.js", context.parentURL).href, context);
  }
  return nextResolve(specifier, context);
} });
const { AppError } = await import("./diagnostics.js");
const moduleBody = (name) => {
  const text = readFileSync(new URL(name, import.meta.url), "utf8");
  return parse(text, { sourceType: "module" }).program.body.flatMap((node) => {
    if (node.type === "ImportDeclaration" || (node.type === "ExportNamedDeclaration" && !node.declaration)) return [];
    const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    return [text.slice(declaration.start, declaration.end)];
  }).join("\n");
};
const durabilityBody = moduleBody("./authIntentDurability.native.js");
const transitionsBody = moduleBody("./authTransitions.js");
const storeSource = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const provider = parse(storeSource, { sourceType: "module", plugins: ["jsx"] }).program.body
  .find((node) => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "StoreProvider").declaration;
const storeAuthBody = provider.body.body.filter((node) => node.type === "VariableDeclaration"
  && node.declarations.some(({ id }) => ["performAuthentication", "switchLinkedAccount", "login", "signup"].includes(id.name)))
  .map((node) => storeSource.slice(node.start, node.end)).join("\n");

function storeAuth(transitions) {
  const state = { user: { id: "synthetic-a" }, requests: 0, adoptions: 0, logouts: 0 };
  const sessionRef = { current: state.user };
  const bindings = {
    authTransitions: transitions, authValidationSequenceRef: { current: 0 }, accountMutationEpochRef: { current: 0 }, sessionRef,
    logout: () => { state.logouts++; state.user = sessionRef.current = null; return transitions.signOut(); },
    absorbServerUser: (user) => { state.adoptions++; state.user = sessionRef.current = user; },
    switchLinkedAccountRequest: async (_actor, target) => { state.requests++; return { user: { id: target } }; },
    api: async () => { state.requests++; return { created: true, user: { id: "synthetic-b" } }; },
    localCommandError: () => ({ ok: false }), captureAppError() {}, AppError,
    remoteIdentityValidationEnabled: () => true, LOCAL_AUTH_FALLBACK: false, track() {},
    cleanEmail, cleanName, cleanHandle, isEmail, isHandle, isName, isPassword, profileGenreSelection,
    TERMS_VERSION: "fixture", locationCenter: () => null,
  };
  const auth = new Function(...Object.keys(bindings), `${storeAuthBody}\nreturn { login, signup, switchLinkedAccount };`)(...Object.values(bindings));
  return { ...auth, state };
}

// Re-execute the actual native adapter for each simulated process. Only its
// SQLite backing survives; the adapter's volatile Map and all auth memory die.
const source = readFileSync(new URL("./persist.native.js", import.meta.url), "utf8");
const body = parse(source, { sourceType: "module" }).program.body
  .filter((node) => node.type !== "ImportDeclaration")
  .map((node) => node.type === "ExportNamedDeclaration" ? node.declaration : node)
  .map((node) => source.slice(node.start, node.end)).join("\n");
const loadNativeAdapter = new Function("Storage", "createJsonPersistence", "AUTH_INTENT_KEY", `${body}\nreturn { load, save };`);

function device() {
  const disk = new Map();
  const faults = { write: () => false, ignore: () => false, afterWrite: () => {}, read: false };
  const storage = {
    getItemSync: (key) => { if (faults.read) throw new Error("fixture read failure"); return disk.get(key) ?? null; },
    setItemSync: (key, value) => {
      if (faults.write(JSON.parse(value), key)) throw new Error("fixture write failure");
      if (faults.ignore(JSON.parse(value), key)) return;
      disk.set(key, value);
      faults.afterWrite(JSON.parse(value), key);
    },
    removeItemSync: (key) => disk.delete(key),
  };
  const restart = (revoke) => {
    const persistence = loadNativeAdapter(storage, createJsonPersistence, AUTH_INTENT_KEY);
    const confirmAuthIntent = new Function("Storage", "AUTH_INTENT_KEY", "AppError", "captureAppError",
      `${durabilityBody}\nreturn confirmAuthIntent;`)(storage, AUTH_INTENT_KEY, AppError, (error) => error);
    // Execute the real native confirmation and production coordinator wiring,
    // not a parallel test-only version of the new durability boundary.
    const bindings = { Platform: { OS: "ios" }, ...persistence, AUTH_INTENT_KEY,
      createAuthIntentPersistence, createAuthTransitions, confirmAuthIntent,
      api: (path) => { assert.equal(path, "/api/logout"); return revoke(); },
    };
    return new Function(...Object.keys(bindings), `${transitionsBody}\nreturn authTransitions;`)(...Object.values(bindings));
  };
  return { disk, faults, restart };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const signIn = (transitions, id = "synthetic-a") => transitions.run({ request: async () => ({ user: { id } }), accept: () => ({ ok: true }) });

for (const phase of ["pending", "signed-in"]) {
  for (const operation of ["login", "signup", "switch"]) {
    test(`actual Store ${operation} handles failed ${phase} persistence without adopting a false success`, async () => {
      const f = device(), transitions = f.restart(async () => {});
      await signIn(transitions);
      const store = storeAuth(transitions), original = store.state.user;
      f.faults.write = (value) => value.phase === phase;
      const result = operation === "switch"
        ? await store.switchLinkedAccount("synthetic-b", { expectedAccountId: "synthetic-a" })
        : operation === "login" ? await store.login("fixture@example.test", "Password123")
          : await store.signup({ name: "Fixture", handle: "fixture", email: "fixture@example.test", password: "Password123",
            genres: [PROFILE_GENRE_OPTIONS[0]], ageBand: "18_plus", agreedToTerms: true });
      await settle();
      assert.equal(result.ok, false);
      const message = typeof result.error === "string" ? result.error : result.error.userMessage;
      if (operation === "signup") {
        assert.match(message, phase === "pending" ? /storage.*creating your account again/i : /may already have been created.*storage.*logging in/i);
        assert.equal(result.outcome, phase === "pending" ? undefined : "uncertain");
      } else assert.match(message, /save this sign-in.*storage.*signing in again/i);
      assert.equal(store.state.adoptions, 0);
      assert.equal(store.state.requests, phase === "pending" ? 0 : 1);
      assert.equal(store.state.logouts, phase === "pending" ? 0 : 1);
      assert.equal(store.state.user, phase === "pending" ? original : null);
    });
  }
}

test("failed pending write prevents a switch request and preserves the prior confirmed account", async () => {
  const f = device(); let revoked = 0, requests = 0, accepted = 0, retired = 0;
  const first = f.restart(async () => { revoked++; }); await signIn(first);
  f.faults.write = (value) => value.phase === "pending";
  await assert.rejects(first.run({ request: async () => { requests++; return { user: { id: "synthetic-b" } }; },
    accept: () => { accepted++; }, onUncertain: () => { retired++; } }), { code: "PIT-STORE-004" });
  assert.deepEqual({ requests, accepted, retired, revoked }, { requests: 0, accepted: 0, retired: 0, revoked: 0 });
  assert.equal(first.blocked(), false);
  assert.equal(f.restart(async () => { revoked++; }).blocked(), false);
});

test("failed signed-in commit never adopts success, stays blocked after restart, and allows a deliberate retry", async () => {
  const f = device(); let revoked = 0, accepted = 0, retired = 0;
  const first = f.restart(async () => { revoked++; });
  f.faults.write = (value) => value.phase === "signed-in";
  await assert.rejects(first.run({ request: async () => ({ user: { id: "synthetic-a" } }),
    accept: () => { accepted++; }, onUncertain: () => { retired++; } }), { code: "PIT-STORE-004" });
  await settle();
  assert.deepEqual({ accepted, retired, revoked }, { accepted: 0, retired: 1, revoked: 1 });
  assert.equal(first.blocked(), true);
  const restarted = f.restart(async () => { revoked++; });
  assert.equal(restarted.blocked(), true);
  await restarted.reconcile(); assert.equal(revoked, 2);
  f.faults.write = () => false;
  assert.equal((await signIn(restarted)).ok, true);
  assert.equal(f.restart(async () => assert.fail("retry is durable")).blocked(), false);
});

test("a raw SQLite read failure cannot acknowledge the adapter's signed-in memory fallback", async () => {
  const f = device(), first = f.restart(async () => {});
  let accepted = false;
  await assert.rejects(first.run({ request: async () => {
    f.faults.read = true;
    f.faults.write = (value) => value.phase === "signed-in";
    return { user: { id: "synthetic-a" } };
  }, accept: () => { accepted = true; } }), { code: "PIT-STORE-004" });
  await settle(); f.faults.read = false;
  assert.equal(accepted, false);
  assert.equal(f.restart(async () => {}).blocked(), true);
});

for (const phase of ["pending", "signed-in"]) {
  test(`a read failure after a successful ${phase} write never reports false sign-in success`, async () => {
    const f = device(), first = f.restart(async () => {});
    await signIn(first);
    let accepted = 0, requests = 0, observedWrittenPhase;
    f.faults.afterWrite = (value) => {
      if (value.phase === phase) {
        observedWrittenPhase = JSON.parse(f.disk.get(AUTH_INTENT_KEY)).phase;
        f.faults.read = true;
      }
    };
    await assert.rejects(first.run({
      request: async () => { requests++; return { user: { id: "synthetic-b" } }; },
      accept: () => { accepted++; },
    }), { code: "PIT-STORE-004", authIntentPhase: phase });
    await settle(); f.faults.read = false;
    assert.equal(observedWrittenPhase, phase, "the write succeeded before readback became unavailable");
    assert.equal(accepted, 0);
    assert.equal(requests, phase === "pending" ? 0 : 1);
    assert.equal(first.blocked(), phase === "signed-in");
    assert.equal(f.restart(async () => {}).blocked(), phase === "signed-in");
  });
}

test("a saturated order and silently rejected commit cannot acknowledge an older pending phase", async () => {
  const f = device();
  f.disk.set(AUTH_INTENT_KEY, JSON.stringify({ revision: "saturated", phase: "signed-out", order: Number.MAX_SAFE_INTEGER }));
  const first = f.restart(async () => {});
  f.faults.ignore = (value) => value.phase === "signed-in";
  await assert.rejects(signIn(first), { code: "PIT-STORE-004" });
  await settle();
  assert.equal(first.blocked(), true);
});

test("preflight and restoration failure report storage trouble without revoking an unchanged cookie", async () => {
  const f = device(); let revoked = 0;
  const first = f.restart(async () => { revoked++; }); await signIn(first);
  f.faults.write = () => true;
  await assert.rejects(signIn(first, "synthetic-b"), { code: "PIT-STORE-004" });
  assert.equal(first.blocked(), false);
  assert.equal(revoked, 0);
});

test("storage failure cannot stop explicit logout from blocking locally and retrying offline revocation", async () => {
  const f = device(), first = f.restart(async () => { throw new Error("offline"); });
  await signIn(first);
  f.faults.write = () => true;
  assert.equal((await first.signOut()).kind, "pending");
  assert.equal(first.blocked(), true);
  assert.equal((await first.reconcile()).kind, "pending");
});

for (const boundary of ["logout", "new login", "cancel"]) {
  test(`old cookie response after ${boundary} cannot adopt or overwrite a newer auth intent`, async () => {
    const f = device(); let revoked = 0, accepted = 0;
    const first = f.restart(async () => { revoked++; }), response = deferred(), controller = new AbortController();
    const old = first.run({ request: () => response.promise, signal: controller.signal, accept: () => { accepted++; } });
    await settle();
    let next;
    if (boundary === "logout") next = first.signOut();
    if (boundary === "new login") next = signIn(first, "synthetic-b");
    if (boundary === "cancel") controller.abort();
    f.faults.write = (value) => value.phase === "signed-in";
    response.resolve({ user: { id: "synthetic-a" } });
    assert.equal((await old).stale, true);
    if (boundary === "new login") await assert.rejects(next, { code: "PIT-STORE-004" });
    else await next;
    await settle();
    assert.equal(accepted, 0);
    assert.equal(first.blocked(), true);
    assert.ok(revoked > 0);
    assert.equal(f.restart(async () => {}).blocked(), true);
  });
}

test("offline native logout stays blocked after process recreation and revokes on reconnect", async () => {
  const f = device();
  const first = f.restart(async () => { throw new Error("offline"); });
  assert.equal((await first.signOut()).kind, "pending");
  assert.equal(first.blocked(), true);
  assert.equal(f.disk.has(AUTH_INTENT_KEY), true);
  let revocations = 0;
  const restarted = f.restart(async () => { revocations += 1; });
  assert.equal(restarted.blocked(), true, "A still-valid cookie must not restore the signed-out account");
  assert.equal((await restarted.reconcile()).kind, "revoked");
  assert.equal(revocations, 1);
  assert.equal(restarted.blocked(), true, "Acknowledgment alone cannot unlock a late cookie");
});

test("process death during native sign-in preserves the pending-cookie barrier", async () => {
  const f = device(), first = f.restart(async () => {});
  void first.run({ request: () => new Promise(() => {}), accept: () => assert.fail("Process died before adoption") });
  assert.equal(first.pending(), true);
  const restarted = f.restart(async () => {});
  assert.equal(restarted.pending(), false);
  assert.equal(restarted.blocked(), true);
  assert.equal((await restarted.reconcile()).kind, "revoked");
});

test("deliberate successful native sign-in unlocks durably without persisting account data", async () => {
  const f = device(), first = f.restart(async () => {});
  await first.signOut();
  const signedIn = f.restart(async () => {});
  const result = await signedIn.run({
    request: async () => ({ user: { id: "private-account-identity" } }),
    accept: () => ({ ok: true }),
  });
  assert.equal(result.ok, true);
  const restarted = f.restart(async () => assert.fail("Successful sign-in must not be revoked"));
  assert.equal(restarted.blocked(), false);
  assert.equal((await restarted.reconcile()).kind, "skipped");
  assert.equal(f.disk.get(AUTH_INTENT_KEY).includes("private-account-identity"), false);
});
