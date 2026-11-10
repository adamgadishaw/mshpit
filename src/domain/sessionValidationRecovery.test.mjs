import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { registerHooks } from "node:module";
import { createSessionValidationCoordinator, sessionValidationOutcome } from "./sessionValidation.mjs";
import { createSessionValidationRetry } from "./sessionValidationRetry.mjs";
import { createAuthTransitions } from "./authTransitions.mjs";
import { apiIdentityBarrierDecision } from "./apiIdentityState.mjs";
import { createRequestControl } from "../lib/requestControl.mjs";
import { retryAfterDelayMs } from "../lib/retryAfter.mjs";

// Keep the real transport classification: AppError exposes its catalog code,
// not the input `kind`. An Object.assign error double would hide that boundary.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./persist" && context.parentURL?.endsWith("/src/lib/diagnostics.js")) {
      return nextResolve(new URL("./persist.js", context.parentURL).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { AppError } = await import("../lib/diagnostics.js");

const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const provider = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body
  .find((node) => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "StoreProvider")?.declaration;
const effect = provider.body.body.find((node) => node.type === "ExpressionStatement"
  && node.expression?.callee?.name === "useEffect"
  && source.slice(node.start, node.end).includes("const runValidation = async"))?.expression.arguments[0];
assert.ok(effect, "The production identity validation effect must exist");
const validationEffect = source.slice(effect.start, effect.end);
const apiSource = readFileSync(new URL("../lib/api.js", import.meta.url), "utf8");
const apiBody = parse(apiSource, { sourceType: "module" }).program.body.flatMap((node) => {
  if (node.type === "ImportDeclaration" || (node.type === "ExportNamedDeclaration" && !node.declaration)) return [];
  const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
  return [apiSource.slice(declaration.start, declaration.end)];
}).join("\n");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const member = { id: "synthetic-member", name: "Fixture member" };

// Execute the complete Store effect and API transport. Only external I/O,
// React setters and unrelated account projections are synthetic seams.
function fixture({ confirmed = true, account = confirmed ? member : null, intent = null, requestTimeoutMs } = {}) {
  const state = { ready: confirmed, session: account };
  const sessionRef = { current: account }, authReadyRef = { current: confirmed };
  const authValidationSequenceRef = { current: 0 };
  const requests = [], retired = [], adoptions = [], errors = [], timers = new Map();
  let timerId = 0, coordinator, authState = intent, revoked = 0, clock = 0, appStateListener;
  const authTransitions = createAuthTransitions({
    read: () => authState, write: (value) => { authState = value; },
    revoke: async () => { revoked += 1; },
  });
  const transportBindings = {
    AppError, captureAppError: (error) => { errors.push(error); return error; }, apiIdentityBarrierDecision,
    createRequestControl: (options) => createRequestControl({ ...options, ...(requestTimeoutMs ? { timeoutMs: requestTimeoutMs } : {}) }), retryAfterDelayMs,
    Platform: { OS: "ios" }, apiBaseForRuntime: () => "https://synthetic.invalid",
    reviewAllowsRequest: () => true, photoCreditUrlFromLinkHeader: () => null,
    fetch: (url, options) => new Promise((resolve, reject) => { requests.push({ url, options, resolve, reject }); }),
  };
  const transport = new Function(...Object.keys(transportBindings), `${apiBody}\nreturn { api, configureApiIdentity };`)(...Object.values(transportBindings));
  transport.configureApiIdentity(account?.id, { ready: confirmed });
  const dependencies = {
    ...transport, sessionRef, authReadyRef, authValidationSequenceRef, authTransitions,
    sessionValidationStatus: null,
    sessionValidationOutcome, createSessionValidationRetry: () => createSessionValidationRetry({ random: () => 0 }),
    createSessionValidationCoordinator: (options) => {
      coordinator = createSessionValidationCoordinator({ ...options, now: () => clock });
      return coordinator;
    },
    remoteIdentityValidationEnabled: () => true, ENABLE_DEMO_DATA: false,
    configureProductAnalytics() {}, resolveLegacyDraftsForIdentity() {}, adoptFeedAccount() {}, revalidateCachedFeed() {},
    setAuthReady: (value) => { state.ready = value; },
    setSession: (value) => { state.session = value; },
    retireRevalidatedAccount: (id) => { retired.push(id); },
    absorbServerUser: (user, options) => {
      adoptions.push({ user, options });
      authValidationSequenceRef.current += 1;
      sessionRef.current = user; state.session = user;
      authReadyRef.current = true; state.ready = true;
      transport.configureApiIdentity(user.id, { ready: true });
    },
    setTimeout: (work, ms) => { const id = ++timerId; timers.set(id, { work, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    invalidateIOSDetailPrivacy() {},
    Platform: { OS: "ios" }, AppState: { addEventListener: (_event, listener) => {
      appStateListener = listener;
      return { remove() {} };
    } },
  };
  const cleanup = new Function(...Object.keys(dependencies), `return (${validationEffect})();`)(...Object.values(dependencies));
  const respond = (index, text, status = 200) => {
    assert.ok(requests[index], `Expected identity request ${index}`);
    requests[index].resolve(new Response(text, { status, headers: { "Content-Type": "application/json" } }));
  };
  const finish = async (text, status = 200) => {
    const pending = coordinator.validate({ force: true });
    await tick(); respond(requests.length - 1, text, status);
    return pending;
  };
  const fireRetry = () => {
    assert.equal(timers.size, 1, "one scheduled recovery attempt");
    const [id, timer] = [...timers.entries()][0];
    timers.delete(id); timer.work();
    return coordinator.validate({ force: true });
  };
  return { state, requests, retired, adoptions, errors, timers, coordinator, respond, finish, fireRetry, cleanup, authTransitions,
    resume: () => { appStateListener("background"); clock += 61_000; appStateListener("active"); },
    get revoked() { return revoked; } };
}

const unreadableUnauthorized = [
  { label: "proxy HTML", code: "PIT-NET-001", response: () => new Response("<html>Proxy denied</html>", { status: 401 }) },
  { label: "malformed JSON", code: "PIT-API-001", response: () => new Response("{broken", { status: 401 }) },
  { label: "interrupted response body", code: "PIT-NET-001", response: () => ({
    ok: false, status: 401, headers: new Headers(), text: async () => { throw new TypeError("Connection dropped"); },
  }) },
  { label: "response body timeout", code: "PIT-NET-002", requestTimeoutMs: 20, response: (request) => ({
    ok: false, status: 401, headers: new Headers(), text: () => new Promise((_resolve, reject) => {
      request.options.signal.addEventListener("abort", () => reject(request.options.signal.reason), { once: true });
    }),
  }) },
];

for (const failure of unreadableUnauthorized) {
  for (const mode of ["foreground", "cold-start", "strict"]) {
    test(`${failure.label} with status 401 during ${mode} retries without inventing sign-out`, async (t) => {
      const f = fixture({ confirmed: mode !== "cold-start", requestTimeoutMs: failure.requestTimeoutMs }); t.after(f.cleanup);
      if (mode !== "cold-start") await f.finish(JSON.stringify({ user: member }));
      if (mode === "foreground") f.resume();
      const pending = f.coordinator.validate({ force: true, strict: mode === "strict" });
      await tick();
      const request = f.requests.at(-1);
      assert.equal(request.options.credentials, "include");
      request.resolve(failure.response(request));
      assert.equal((await pending).result.outcome, "transient-failure");
      assert.equal(f.errors.at(-1).code, failure.code);
      assert.deepEqual(f.state, { ready: mode === "foreground", session: mode === "cold-start" ? null : member });
      assert.deepEqual(f.retired, [], "an unreadable response must not purge private account state");
      assert.equal(f.revoked, 0, "recovery must not revoke the cookie");
      assert.equal(f.timers.size, 1);
      const recovered = f.fireRetry(); await tick();
      f.respond(f.requests.length - 1, JSON.stringify({ user: member }));
      assert.equal((await recovered).result.authoritative, true);
      assert.deepEqual(f.state, { ready: true, session: member });
      assert.equal(f.timers.size, 0);
    });
  }
}

const malformed = [
  ["empty body", ""], ["missing user", "{}"], ["array envelope", "[]"],
  ["false user", '{"user":false}'], ["zero user", '{"user":0}'], ["empty string user", '{"user":""}'],
  ["missing identifier", '{"user":{}}'], ["object identifier", '{"user":{"id":{}}}'],
  ["array identifier", '{"user":{"id":[]}}'], ["boolean identifier", '{"user":{"id":true}}'],
];

for (const [label, payload] of malformed) {
  test(`${label} during a confirmed identity check preserves the account and retries`, async (t) => {
    const f = fixture(); t.after(f.cleanup);
    const outcome = await f.finish(payload);
    assert.equal(outcome.result.authoritative, false);
    assert.equal(outcome.result.outcome, "invalid-response");
    assert.equal(f.state.session, member, "a malformed 200 is not a server-confirmed sign-out");
    assert.equal(f.state.ready, true, "ordinary revalidation preserves the mounted session");
    assert.deepEqual(f.retired, [], "private account state must not be purged");
    assert.deepEqual(f.adoptions, []);
    const recovered = f.fireRetry(); await tick();
    f.respond(1, JSON.stringify({ user: { ...member, name: "Recovered member" } }));
    assert.equal((await recovered).result.outcome, "same-account");
    assert.equal(f.state.session.name, "Recovered member");
    assert.equal(f.adoptions[0].options.hydrateAccount, false);
    assert.equal(f.timers.size, 0);
  });
}

test("malformed cold-start identity stays locked until a valid account arrives", async (t) => {
  const f = fixture({ confirmed: false }); t.after(f.cleanup);
  assert.equal((await f.finish("{}")).result.authoritative, false);
  assert.deepEqual(f.state, { ready: false, session: null });
  const recovered = f.fireRetry(); await tick();
  f.respond(1, JSON.stringify({ user: member }));
  assert.equal((await recovered).result.outcome, "initial-account");
  assert.deepEqual(f.state, { ready: true, session: member });
  assert.deepEqual(f.retired, []);
});

test("malformed strict account validation keeps the old identity locked until recovery", async (t) => {
  const f = fixture(); t.after(f.cleanup);
  await f.finish(JSON.stringify({ user: member }));
  const strict = f.coordinator.validate({ force: true, strict: true, reason: "auth-epoch" });
  assert.equal(f.state.ready, false);
  await tick(); f.respond(1, "{}");
  assert.equal((await strict).result.authoritative, false);
  assert.deepEqual(f.state, { ready: false, session: member });
  assert.deepEqual(f.retired, []);
  const recovered = f.fireRetry(); await tick();
  const replacement = { id: "synthetic-replacement" };
  f.respond(2, JSON.stringify({ user: replacement }));
  assert.equal((await recovered).result.outcome, "account-changed");
  assert.deepEqual(f.state, { ready: true, session: replacement });
  assert.deepEqual(f.retired, [member.id]);
});

for (const response of [{ label: "explicit guest", text: '{"user":null}', status: 200 },
  { label: "expired session", text: '{"error":"Session expired"}', status: 401 }]) {
  test(`${response.label} still retires the account without retry`, async (t) => {
    const f = fixture(); t.after(f.cleanup);
    assert.equal((await f.finish(response.text, response.status)).result.outcome, "authoritative-guest");
    assert.deepEqual(f.state, { ready: true, session: null });
    assert.deepEqual(f.retired, [member.id]);
    assert.equal(f.timers.size, 0);
  });
}

test("explicit sign-out remains stronger than a still-valid cookie", async (t) => {
  const f = fixture({ intent: { revision: "signed-out-fixture", phase: "signed-out" } }); t.after(f.cleanup);
  await f.coordinator.validate({ force: true });
  assert.deepEqual(f.state, { ready: true, session: null });
  assert.deepEqual(f.requests, [], "blocked intent must not ask /api/me to rediscover the cookie");
  assert.equal(f.revoked, 1);
  assert.equal(f.authTransitions.blocked(), true);
});

test("transient failures preserve ordinary confirmed identity and retry", async (t) => {
  const f = fixture(); t.after(f.cleanup);
  assert.equal((await f.finish('{"error":"Unavailable"}', 503)).result.outcome, "transient-failure");
  assert.deepEqual(f.state, { ready: true, session: member });
  assert.deepEqual(f.retired, []);
  assert.equal(f.timers.size, 1);
});

test("a superseded malformed response cannot retire a newer account", async (t) => {
  const f = fixture(); t.after(f.cleanup);
  const old = f.coordinator.validate({ force: true }); await tick();
  const strict = f.coordinator.validate({ force: true, strict: true, reason: "auth-epoch" });
  f.respond(0, "{}"); await tick();
  const replacement = { id: "synthetic-replacement" };
  f.respond(1, JSON.stringify({ user: replacement }));
  await Promise.all([old, strict]);
  assert.deepEqual(f.state, { ready: true, session: replacement });
  assert.deepEqual(f.retired, [member.id]);
  assert.equal(f.timers.size, 0);
});
