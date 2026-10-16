import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createRecommendationPreferenceCoordinator, recommendationPreferenceMutationKey } from "../domain/recommendationPreferenceMutation.mjs";
import { captureAccountMutation, accountMutationIsCurrent } from "../domain/accountMutation.mjs";
import { apiIdentityBarrierDecision } from "../domain/apiIdentityState.mjs";
import { createRequestControl } from "./requestControl.mjs";
import { retryAfterDelayMs } from "./retryAfter.mjs";
import { recommendationPreferenceStorageKey, purgeAccountLocalPrivacy } from "../domain/accountLocalPrivacy.mjs";

// Execute the actual Store handlers, transport, queue and logout purge against
// synthetic identities, mocked fetch and an in-memory persistence adapter.
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function declarations(source, names) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const matches = new Map();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) {
        if (names.includes(declaration.id?.name)) matches.set(declaration.id.name, `const ${source.slice(declaration.start, declaration.end)};`);
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'loc' || key === 'tokens') continue;
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(ast.program);
  return names.map(name => { assert.ok(matches.has(name), `actual Store declaration ${name}`); return matches.get(name); }).join('\n');
}

const apiSource = readFileSync(new URL("./api.js", import.meta.url), 'utf8');
const apiAst = parse(apiSource, { sourceType: 'module' });
const apiBody = apiAst.program.body.flatMap(node => {
  if (node.type === 'ImportDeclaration' || (node.type === 'ExportNamedDeclaration' && !node.declaration)) return [];
  const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
  return [apiSource.slice(declaration.start, declaration.end)];
}).join('\n');
const storeBody = declarations(readFileSync(new URL("../store.js", import.meta.url), 'utf8'), ['notInterested', 'undoNotInterested']);

function fixture({ deferUpdates = false } = {}) {
  const requests = [], persisted = new Map(), gates = [];
  const bindings = {
    Platform: { OS: 'test' }, apiBaseForRuntime: () => 'https://synthetic.invalid',
    reviewAllowsRequest: () => true,
    AppError: class extends Error { constructor(message, options = {}) { super(message); Object.assign(this, options); } },
    captureAppError: error => error,
    createRequestControl, apiIdentityBarrierDecision, retryAfterDelayMs,
    photoCreditUrlFromLinkHeader: () => null,
    fetch: (url, options) => { const gate = deferred(); requests.push({ url, options }); gates.push(gate); return gate.promise; },
  };
  const transport = new Function(...Object.keys(bindings), `${apiBody}\nreturn { api, configureApiIdentity };`)(...Object.values(bindings));
  const sessionRef = { current: { id: 'synthetic-a' } }, accountMutationEpochRef = { current: 1 };
  let hidden = new Set();
  const stateUpdates = [];
  const storeBindings = {
    currentMutationActor: () => sessionRef.current,
    sessionRef, accountMutationEpochRef, captureAccountMutation, accountMutationIsCurrent,
    recommendationPreferenceMutationKey, recommendationPreferenceStorageKey,
    recommendationPreferenceRevisionRef: { current: 0 },
    recommendationPreferenceMutationsRef: { current: createRecommendationPreferenceCoordinator() },
    setRecommendationHiddenIds: update => {
      if (deferUpdates) stateUpdates.push(update);
      else hidden = update(hidden);
    },
    save: (key, value) => persisted.set(key, structuredClone(value)),
    loadRecommendationHiddenIds: accountId => new Set(persisted.get(recommendationPreferenceStorageKey(accountId)) || []),
    track: () => {}, api: transport.api,
  };
  const actions = new Function(...Object.keys(storeBindings), `${storeBody}\nreturn { notInterested, undoNotInterested };`)(...Object.values(storeBindings));
  const transition = id => {
    accountMutationEpochRef.current++;
    sessionRef.current = id ? { id } : null;
    hidden = new Set();
    transport.configureApiIdentity(id);
  };
  transport.configureApiIdentity('synthetic-a');
  const purge = accountId => purgeAccountLocalPrivacy({
    accountId, drafts: [], follows: {},
    load: (key, fallback) => persisted.get(key) ?? fallback,
    save: (key, value) => persisted.set(key, structuredClone(value)),
    remove: key => persisted.delete(key),
  });
  return {
    ...actions, requests, persisted, gates, transition, purge,
    flushStateUpdates() { while (stateUpdates.length) hidden = stateUpdates.shift()(hidden); },
    hidden: () => [...hidden],
    setHidden: values => { hidden = new Set(values); },
    pendingStateUpdates: () => stateUpdates.length,
  };
}

test('old queued recommendation intent must not dispatch after A -> B -> A', async () => {
  const f = fixture();
  const first = f.notInterested('synthetic-post').catch(error => error);
  const undo = f.undoNotInterested('synthetic-post').catch(error => error);
  const queued = f.notInterested('synthetic-post').catch(error => error);
  await flush();
  assert.equal(f.requests.length, 1, 'the real coordinator serializes hide, Undo, and hide');
  f.transition('synthetic-b');
  f.transition('synthetic-a');
  f.gates[0].resolve(json({ ok: true }));
  await flush();
  const oldDispatches = f.requests.length;
  if (f.gates[1]) f.gates[1].resolve(json({ ok: true }));
  await Promise.all([first, undo, queued]);
  assert.equal(oldDispatches, 1, 'retired account epoch must suppress queued fetch; server receives the same A header after A -> B -> A');
});

test('late failed undo must not recreate purged recommendation cache after logout', async () => {
  const f = fixture();
  const pending = f.undoNotInterested('synthetic-private-recommendation').catch(error => error);
  await flush();
  assert.equal(f.requests.length, 1);
  const key = recommendationPreferenceStorageKey('synthetic-a');
  f.transition(null);
  f.purge('synthetic-a'); // Execute the production logout purge against only an in-memory adapter.
  f.gates[0].resolve(json({ error: 'synthetic failure' }, 503));
  await pending;
  assert.equal(f.persisted.has(key), false, 'a retired operation must not recreate account data after the logout purge');
});

test('active-account failed undo still restores the preference for retry', async () => {
  const f = fixture();
  const pending = f.undoNotInterested('synthetic-post').catch(error => error);
  await flush();
  f.gates[0].resolve(json({ error: 'synthetic failure' }, 503));
  await pending;
  assert.deepEqual(f.persisted.get(recommendationPreferenceStorageKey('synthetic-a')), ['synthetic-post']);
});

test('old queued Undo must not dispatch after A -> B -> A', async () => {
  const f = fixture();
  const first = f.undoNotInterested('synthetic-post').catch(error => error);
  const queued = f.undoNotInterested('synthetic-post').catch(error => error);
  await flush();
  assert.equal(f.requests.length, 1);
  f.transition('synthetic-b');
  f.transition('synthetic-a');
  f.gates[0].resolve(json({ ok: true }));
  await flush();
  const dispatches = f.requests.length;
  if (f.gates[1]) f.gates[1].resolve(json({ ok: true }));
  await Promise.all([first, queued]);
  assert.equal(dispatches, 1);
});

test('late failed hide cannot roll back a new login of the same account', async () => {
  const f = fixture();
  const old = f.notInterested('synthetic-post').catch(error => error);
  await flush();
  f.transition('synthetic-b');
  f.transition('synthetic-a');
  const key = recommendationPreferenceStorageKey('synthetic-a');
  f.persisted.set(key, ['synthetic-post', 'new-login-preference']);
  f.gates[0].resolve(json({ error: 'synthetic failure' }, 503));
  await old;
  assert.deepEqual(f.persisted.get(key), ['synthetic-post', 'new-login-preference']);
});

for (const action of ['notInterested', 'undoNotInterested']) {
  for (const phase of ['optimistic', 'rollback']) {
    test(`deferred ${action} ${phase} updater cannot cross an account epoch`, async () => {
      for (const transition of ['logout', 'switch', 'roundtrip']) {
        const f = fixture({ deferUpdates: true });
        const pending = f[action]('synthetic-retired-post').catch(error => error);
        if (phase === 'rollback') {
          f.flushStateUpdates();
          await flush();
          f.gates[0].resolve(json({ error: 'synthetic failure' }, 503));
          await pending;
        }
        assert.equal(f.pendingStateUpdates(), 1);
        f.transition(transition === 'logout' ? null : 'synthetic-b');
        f.purge('synthetic-a');
        if (transition === 'roundtrip') f.transition('synthetic-a');
        f.setHidden(['replacement-login-preference']);
        if (transition !== 'logout') {
          f.persisted.set(recommendationPreferenceStorageKey(transition === 'switch' ? 'synthetic-b' : 'synthetic-a'), ['replacement-login-preference']);
        }
        const before = [...f.persisted.entries()];
        // React may defer a functional updater beyond the synchronous logout
        // purge and even until a new account/login has begun rendering.
        f.flushStateUpdates();
        await pending;
        assert.deepEqual([...f.persisted.entries()], before, transition);
        assert.deepEqual(f.hidden(), ['replacement-login-preference'], transition);
        if (phase === 'optimistic') assert.equal(f.requests.length, 0);
      }
    });
  }
  test(`deferred active-account ${action} still applies and rolls back`, async () => {
    const f = fixture({ deferUpdates: true });
    const original = action === 'undoNotInterested' ? ['synthetic-post'] : [];
    const optimistic = action === 'undoNotInterested' ? [] : ['synthetic-post'];
    f.setHidden(original);
    const pending = f[action]('synthetic-post').catch(error => error);
    f.flushStateUpdates();
    assert.deepEqual(f.hidden(), optimistic);
    await flush();
    f.gates[0].resolve(json({ error: 'synthetic failure' }, 503));
    await pending;
    f.flushStateUpdates();
    assert.deepEqual(f.hidden(), original);
    assert.deepEqual(f.persisted.get(recommendationPreferenceStorageKey('synthetic-a')), original);
  });
}
