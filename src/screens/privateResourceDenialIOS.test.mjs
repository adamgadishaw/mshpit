import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const codes = new Map(), noop = () => {};
function execute(path, imports, timers = { setTimeout, clearTimeout }) {
  const file = new URL(path, import.meta.url);
  if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, "utf8"), {
    filename: file.pathname, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", codes.get(path))(
    name => imports(name, createRequire(file)), module, module.exports, timers.setTimeout, timers.clearTimeout);
  return module.exports;
}
function createRenderer() {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [], focus() {}, scrollToEnd() {} }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
    hideInstance: noop, unhideInstance: noop, hideTextInstance: noop, unhideTextInstance: noop,
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; }, resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false, detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null, NotPendingTransition: null,
    HostTransitionContext: React.createContext(null), resetFormInstance: noop, bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 5; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return { container, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };


const { createProfileHistoryStore, profileHistoryScope } = require('../features/profileHistory/profileHistoryState.ios.mjs');
const denied = status => Object.assign(new Error('Private resource unavailable'), { status, name: 'AppError', code: 'PIT-API-001', retryable: status === 503 });
const row = { id: 'old', postId: 'review', artist: 'Private artist', venue: 'Private room', date: '2025-01-01', rating: 4 };
const page = concerts => ({ concerts, nextCursor: null, complete: true, hasMore: false, mapVisible: true });
function concertFixture() {
  const renderer = createRenderer(), reads = [], postReads = [], outputs = new Map();
  let identity = 1, invalidations = 0, members = ['older', 'newer'];
  const imports = (name, local) => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('/useIOSDetailPresentation')) return local(name + '.js');
    if (name === '../../../lib/api') return { captureApiIdentityCheck: () => { const captured = identity; return () => captured === identity; } };
    if (name === '../../../lib/iosDetailPrivacy') return { invalidateIOSDetailPrivacy: () => { invalidations++; } };
    if (name === './services/concertHistoryPrivacy.ios.js') return execute('../features/concertHistory/services/concertHistoryPrivacy.ios.js', imports);
    if (name === './services/concertHistoryApi.mjs') return {
      requestConcertHistoryPage: options => { const r = { ...deferred(), options }; reads.push(r); return r.promise; },
      readConcertHistoryPost: (id, options) => { const r = { ...deferred(), id, options }; postReads.push(r); return r.promise; },
    };
    return local(name);
  };
  const { useConcertHistory } = execute('../features/concertHistory/useConcertHistory.ios.js', imports);
  function Surface({ id }) { const result = useConcertHistory({ accountId: 'viewer', authEpoch: 1, targetId: 'target' }); outputs.set(id, result); return React.createElement('Rows', { id, rows: result.concerts }); }
  const render = () => renderer.render(React.createElement(React.Fragment, null, members.map(id => React.createElement(Surface, { key: id, id }))));
  const flush = async () => { for (let i=0; i<6; i++) { await new Promise(r => setImmediate(r)); renderer.act(noop); } };
  return { render, flush, reads, postReads, outputs,
    get invalidations() { return invalidations; },
    changeAccount() { identity++; },
    unmount(id) { members = members.filter(item => item !== id); render(); },
    close() { renderer.render(null); },
    async resolve(i, concerts) { reads[i].resolve(page(concerts)); await flush(); },
    async reject(i, status) { reads[i].reject(denied(status)); await flush(); },
  };
}
for (const status of [403, 404, 410]) test(`real independent concert resources quarantine ${status}, reject older success, and recover only their own receipt`, async () => {
  const f = concertFixture(); f.render(); await f.flush();
  await f.resolve(0, [row]); await f.resolve(1, [row]);
  const oldOpen = f.outputs.get('older').openConcert;
  void f.outputs.get('older').refresh(); void f.outputs.get('newer').refresh(); await f.flush();
  await f.reject(3, status);
  assert.equal(f.invalidations, 1);
  assert.deepEqual(f.outputs.get('older').concerts, []); assert.deepEqual(f.outputs.get('newer').concerts, []);
  await f.resolve(2, [row]);
  assert.deepEqual(f.outputs.get('older').concerts, []);
  f.render(); await f.flush(); assert.equal(f.reads.length, 4, 'denial must not trigger automatic read loops');
  oldOpen(row, () => assert.fail('obsolete review opened')); assert.equal(f.postReads.length, 0);
  void f.outputs.get('newer').retry(); await f.flush();
  await f.resolve(4, [{ ...row, id: 'fresh' }]);
  assert.deepEqual(f.outputs.get('newer').concerts.map(x => x.id), ['fresh']);
  assert.deepEqual(f.outputs.get('older').concerts, [], 'another recovery never blesses an old local map snapshot');
  void f.outputs.get('older').retry(); await f.flush(); await f.resolve(5, [{ ...row, id: 'newer-proof' }]);
  assert.deepEqual(f.outputs.get('older').concerts.map(x => x.id), ['newer-proof']);
  f.close();
});
test('real concert private post denial invalidates before navigation; account and cancelled errors cannot publish', async () => {
  const f = concertFixture(); f.render(); await f.flush(); await f.resolve(0, [row]); await f.resolve(1, [row]);
  void f.outputs.get('newer').openConcert(row, () => assert.fail('denied post opened'));
  f.postReads[0].reject(denied(410)); await f.flush();
  assert.equal(f.invalidations, 1); assert.deepEqual(f.outputs.get('older').concerts, []);
  void f.outputs.get('newer').retry(); await f.flush(); f.changeAccount(); await f.reject(2, 403);
  assert.equal(f.invalidations, 1); f.close();
  const cancelled = concertFixture(); cancelled.render(); await cancelled.flush(); cancelled.unmount('newer');
  assert.equal(cancelled.reads[1].options.signal.aborted, true);
  await cancelled.reject(1, 403); assert.equal(cancelled.invalidations, 0); cancelled.close();
});
test('real concert 503 retains useful rows, but malformed recovery cannot unmask a denied snapshot', async () => {
  const f = concertFixture(); f.render(); await f.flush(); await f.resolve(0, [row]); await f.resolve(1, [row]);
  void f.outputs.get('newer').refresh(); await f.flush(); await f.reject(2, 503);
  assert.equal(f.invalidations, 0); assert.deepEqual(f.outputs.get('newer').concerts.map(x => x.id), ['old']);
  void f.outputs.get('newer').refresh(); await f.flush(); await f.reject(3, 403);
  void f.outputs.get('newer').retry(); await f.flush(); f.reads[4].resolve({ nope: true }); await f.flush();
  assert.deepEqual(f.outputs.get('newer').concerts, []); assert.deepEqual(f.outputs.get('older').concerts, []); f.close();
});
test('bounded history tombstone retirement followed by 503 cannot drop the cold empty projection', async () => {
  let status = 403;
  const store = createProfileHistoryStore({ maxEntries: 2, fetchPage: async () => { throw denied(status); } });
  for (let i=0; i<132; i++) await store.refresh({ accountId: 'viewer', targetId: `target-${i}` });
  const params = { accountId: 'viewer', targetId: 'target-0' }, scope = profileHistoryScope('viewer', 'target-0');
  assert.equal(store.getSnapshot(scope).denied, true);
  status = 503; await store.refresh(params);
  assert.equal(store.getSnapshot(scope).denied, true); assert.deepEqual(store.getSnapshot(scope).data.posts, []);
});
test('history only publishes current nonaborted target denial; superseded/account replies stay inert', async () => {
  for (const mode of ['account', 'superseded', 'unsubscribe']) {
    const reads = []; let identity = 1, invalidations = 0;
    const store = createProfileHistoryStore({ fetchPage: options => { const r = { ...deferred(), options }; reads.push(r); return r.promise; },
      captureIdentity: () => { const captured = identity; return () => captured === identity; }, invalidatePrivacy: () => { invalidations++; } });
    const params = { accountId: 'viewer', targetId: 'target' }, scope = profileHistoryScope('viewer', 'target');
    const off = store.subscribe(scope, noop); const first = store.refresh(params);
    if (mode === 'account') identity++;
    if (mode === 'superseded') void store.refresh(params);
    if (mode === 'unsubscribe') off();
    reads[0].reject(denied(403)); await first;
    assert.equal(invalidations, 0); off();
  }
});

test('concert denial blocks automatic page starts while a fresh explicit head recovery remains allowed', async () => {
  let invalidations = 0;
  const imports = (name, local) => {
    if (name === '../../../lib/api') return { captureApiIdentityCheck: () => () => true };
    if (name === '../../../lib/iosDetailPrivacy') return { invalidateIOSDetailPrivacy: () => { invalidations++; } };
    return local(name);
  };
  const { createConcertHistoryPrivacyScope } = execute('../features/concertHistory/services/concertHistoryPrivacy.ios.js', imports);
  const scope = createConcertHistoryPrivacyScope({ accountId: 'viewer', authEpoch: 1, targetId: 'target' });
  const proof = await scope.read(async () => page([row]), { recover: true });
  await assert.rejects(scope.read(async () => { throw denied(403); }, { recover: true }));
  assert.equal(proof.current(), false); assert.equal(invalidations, 1);
  let pageStarts = 0;
  await assert.rejects(scope.read(async () => { pageStarts++; return page([row]); }), { name: 'AbortError' });
  assert.equal(pageStarts, 0);
  const fresh = await scope.read(async () => page([{ ...row, id: 'fresh' }]), { recover: true });
  assert.equal(fresh.current(), true); assert.equal(proof.current(), false);
});
