import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createSessionValidationCoordinator, sessionValidationOutcome } from "./sessionValidation.mjs";
import { createSessionValidationRetry } from "./sessionValidationRetry.mjs";
import { createAuthTransitions } from "./authTransitions.mjs";
import { apiIdentityBarrierDecision } from "./apiIdentityState.mjs";
import { createRequestControl } from "../lib/requestControl.mjs";
import { retryAfterDelayMs } from "../lib/retryAfter.mjs";

const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const provider = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body
  .find((node) => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "StoreProvider")?.declaration;
const effect = provider.body.body.find((node) => node.type === "ExpressionStatement"
  && node.expression?.callee?.name === "useEffect"
  && source.slice(node.start, node.end).includes("const runValidation = async"))?.expression.arguments[0];
assert.ok(effect, "The production identity validation effect must exist");
const validationEffect = source.slice(effect.start, effect.end);
const authDeclaration = (name) => {
  const node = provider.body.body.find((node) => node.type === 'VariableDeclaration' && node.declarations.some((declaration) => declaration.id.name === name));
  assert.ok(node, name + ' must exist');
  return source.slice(node.start, node.end);
};
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
function fixture({ confirmed = true, account = confirmed ? member : null, intent = null } = {}) {
  const state = { ready: confirmed, session: account };
  const sessionRef = { current: account }, authReadyRef = { current: confirmed };
  const authValidationSequenceRef = { current: 0 };
  const requests = [], retired = [], adoptions = [], timers = new Map();
  let timerId = 0, coordinator, authState = intent, revoked = 0;
  const authTransitions = createAuthTransitions({
    read: () => authState, write: (value) => { authState = value; },
    revoke: async () => { revoked += 1; },
  });
  class AppError extends Error {
    constructor(message, properties) { super(message); Object.assign(this, properties); }
  }
  const transportBindings = {
    AppError, captureAppError: (error) => error, apiIdentityBarrierDecision, createRequestControl, retryAfterDelayMs,
    Platform: { OS: "test" }, apiBaseForRuntime: () => "https://synthetic.invalid",
    reviewAllowsRequest: () => true, photoCreditUrlFromLinkHeader: () => null,
    fetch: (url, options) => new Promise((resolve, reject) => { requests.push({ url, options, resolve, reject }); }),
  };
  const transport = new Function(...Object.keys(transportBindings), `${apiBody}\nreturn { api, configureApiIdentity };`)(...Object.values(transportBindings));
  transport.configureApiIdentity(account?.id, { ready: confirmed });
  const dependencies = {
    ...transport, sessionRef, authReadyRef, authValidationSequenceRef, authTransitions,
    sessionValidationOutcome, createSessionValidationRetry: () => createSessionValidationRetry({ random: () => 0 }),
    createSessionValidationCoordinator: (options) => {
      coordinator = createSessionValidationCoordinator(options);
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
    Platform: { OS: "test" }, AppState: { addEventListener: () => ({ remove() {} }) },
  };
  const cleanup = new Function(...Object.keys(dependencies), `return (${validationEffect})();`)(...Object.values(dependencies));
  const authDependencies = {
    ...dependencies, accountMutationEpochRef: { current: 0 },
    switchLinkedAccountRequest: async (_actor, target) => ({ user: { id: target } }),
    localCommandError: () => ({ ok: false }), captureAppError() {}, AppError,
    broadcastAuthEpoch() {}, playHistoryRequestRef: { current: { sequence: 0 } }, playlistRequestRef: { current: { sequence: 0 } },
    setPlayHistory() {}, setPlayHistoryAccountId() {}, setPlayHistoryNextCursor() {}, setPlayHistoryErrorMode() {}, setPlayHistoryStatus() {},
    setMyPlaylistsForAccount() {}, setMyPlaylistsStatus() {}, setFriendsListening() {}, resetStaffState() {}, staffStateScopeRef: { current: null },
    remove() {}, clearStoredTheme() {}, purgeProductAnalyticsAccount() {},
    draftsRef: { current: [] }, follows: [], load() {}, save() {}, purgeAccountLocalPrivacy: () => ({ purged: false }),
  };
  const auth = new Function(...Object.keys(authDependencies), authDeclaration('performAuthentication') + '\n' + authDeclaration('logout') + '\n' + authDeclaration('switchLinkedAccount') + '\nreturn { performAuthentication, logout, switchLinkedAccount };')(...Object.values(authDependencies));
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
  return { state, requests, retired, adoptions, timers, coordinator, respond, finish, fireRetry, cleanup, authTransitions,
    ...auth, sessionRef, authReadyRef, authValidationSequenceRef, adopt: dependencies.absorbServerUser,
    get revoked() { return revoked; } };
}


for (const reply of [
  { label: 'old account', text: JSON.stringify({ user: member }), status: 200 },
  { label: 'guest', text: JSON.stringify({ user: null }), status: 200 },
  { label: '401', text: JSON.stringify({ error: 'expired' }), status: 401 },
  { label: '503', text: JSON.stringify({ error: 'offline' }), status: 503 },
]) {
  test('pending /api/me ' + reply.label + ' cannot overwrite successful switch', async (t) => {
    const f = fixture(); t.after(f.cleanup);
    const pending = f.coordinator.validate({ force: true }); await tick();
    const replacement = { id: 'synthetic-B' };
    assert.equal((await f.switchLinkedAccount(replacement.id, { expectedAccountId: member.id })).ok, true);
    f.respond(0, reply.text, reply.status); await pending;
    assert.equal(f.state.session.id, replacement.id); assert.equal(f.state.ready, true);
    assert.deepEqual(f.retired, []); assert.equal(f.timers.size, 0);
  });
  test('pending /api/me ' + reply.label + ' cannot resurrect after logout', async (t) => {
    const f = fixture(); t.after(f.cleanup);
    const pending = f.coordinator.validate({ force: true }); await tick();
    await f.logout();
    f.respond(0, reply.text, reply.status); await pending;
    assert.equal(f.state.session, null); assert.equal(f.state.ready, true);
    assert.deepEqual(f.adoptions, []); assert.equal(f.timers.size, 0);
  });
}
test('rejected account switch leaves confirmed account while old validation is fenced', async (t) => {
  const f = fixture(); t.after(f.cleanup);
  const pending = f.coordinator.validate({ force: true }); await tick();
  await assert.rejects(f.performAuthentication(async () => { throw Object.assign(new Error('rejected'), { status: 401 }); }, () => assert.fail('adopted')));
  f.respond(0, JSON.stringify({ user: null })); await pending;
  assert.equal(f.state.session, member); assert.equal(f.state.ready, true);
  assert.equal(f.authTransitions.blocked(), false); assert.deepEqual(f.retired, []);
  assert.equal((await f.finish(JSON.stringify({ user: member }))).result.outcome, 'same-account');
});
test('cold-start network failure recovers through strict retry', async (t) => {
  const f = fixture({ confirmed: false }); t.after(f.cleanup);
  assert.equal((await f.finish(JSON.stringify({ error: 'offline' }), 503)).result.outcome, 'transient-failure');
  assert.equal(f.state.ready, false); assert.equal(f.timers.size, 1);
  const pending = f.fireRetry(); await tick(); f.respond(1, JSON.stringify({ user: member })); await pending;
  assert.equal(f.state.ready, true); assert.equal(f.state.session.id, member.id); assert.equal(f.timers.size, 0);
});
test('retry scheduled before successful login validates the replacement account', async (t) => {
  const f = fixture(); t.after(f.cleanup);
  await f.finish(JSON.stringify({ error: 'offline' }), 503);
  const replacement = { id: 'synthetic-B' };
  await f.performAuthentication(async () => ({ user: replacement }), ({ user }) => f.adopt(user));
  const pending = f.fireRetry(); await tick(); f.respond(1, JSON.stringify({ user: replacement })); await pending;
  assert.equal(f.state.ready, true); assert.equal(f.state.session.id, replacement.id); assert.equal(f.timers.size, 0);
});

for (const reply of [{ user: null }, { user: { id: 'synthetic-B' } }]) {
  test('unmounted identity effect ignores late ' + (reply.user ? 'replacement account' : 'guest') + ' response', async () => {
    const f = fixture();
    const pending = f.coordinator.validate({ force: true }); await tick();
    f.cleanup(); f.respond(0, JSON.stringify(reply)); await pending;
    assert.equal(f.state.session, member); assert.equal(f.state.ready, true);
    assert.deepEqual(f.retired, []); assert.deepEqual(f.adoptions, []); assert.equal(f.timers.size, 0);
  });
}
test('unmount removes a scheduled recovery timer', async () => {
  const f = fixture(); await f.finish(JSON.stringify({ error: 'offline' }), 503);
  assert.equal(f.timers.size, 1); f.cleanup(); assert.equal(f.timers.size, 0);
});
