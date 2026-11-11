import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createIOSLinkedNavigation } from "../domain/iosLinkedNavigation.mjs";
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
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: node => { node.hidden = true; }, unhideTextInstance: node => { node.hidden = false; },
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
const nodes = node => node.hidden ? [] : [node, ...(node.children || []).flatMap(nodes)];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// Actual ReportScreen, hooks, React commit/effect lifecycle, and Root's route
// expression. Native widgets and Store commands are synthetic. No network/UI.
const rootSource = readFileSync(new URL('../../App.js', import.meta.url), 'utf8');
const route = rootSource.split('\n').find(line => line.includes('overlay = <ReportScreen'));
const rootAST = require('@babel/parser').parse(rootSource, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'Root');
const closeNames = ['runAfterComposerClose', 'requestComposerPop', 'back'];
const closeSource = rootAST.body.body.flatMap(statement => statement.type === 'VariableDeclaration' ? statement.declarations : [])
  .filter(node => closeNames.includes(node.id?.name)).map(node => `const ${node.id.name} = ${rootSource.slice(node.init.start, node.init.end)};`).join('\n');
const actualRootBack = new Function('composerCloseGuardRef', 'popStack', 'Platform', `const web = false; const authNavigationAbortRef = { current: null }; ${closeSource} return back;`);

const routeCode = transformSync(`export default function route({ Platform, session, chatAuthEpoch, nav, navigationRef, linkedNavigationRef, linkedNavigationScope, back, composerCloseGuardRef, ReportScreen }) {
  ${route.replace('else if', 'if')} return overlay;
}`, { babelrc: false, configFile: false, plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')] }).code;
const routeModule = { exports: {} };
new Function('require', 'module', 'exports', routeCode.replace('overlay =', 'var overlay ='))(require, routeModule, routeModule.exports);
function fixture({ platform = 'ios', strict = false, keyed = true, guard = true, probe = null } = {}) {
  const renderer = createRenderer(), requests = [], blocks = [], alerts = [];
  const linkedNavigationRef = { current: createIOSLinkedNavigation() }; linkedNavigationRef.current.mount();
  let account = 'A', epoch = 1, closeMode = 'normal', closed = 0, rootClose = null;
  let target = { targetType: 'post', targetId: 'p1', ownerId: 'other', mediaUri: 'https://media.example/photo.jpg' };
  let frame = { reporting: target }, blocked = false;
  const navigationRef = { current: { stack: [{}, frame] } }, guardRef = { current: null };
  const native = { Platform: { OS: platform }, StyleSheet: { create: value => value }, Alert: { alert: (...args) => alerts.push(args) },
    ...Object.fromEntries(['View', 'Text', 'TextInput', 'Pressable', 'ScrollView'].map(name => [name, name])) };
  let hook, observed, probed = false, suspended = false;
  const suspension = new Promise(() => {});
  function MaybeSuspend() { if (suspended) throw suspension; return null; }
  const imports = (name, local) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return native;
    if (name === '../hooks/useIOSReportComposer') return hook;
    if (name === '../theme') return { colors: {}, radius: {} };
    if (name === '../store') return { useStore: () => ({ session: account ? { id: account } : null, chatAuthEpoch: epoch,
      isBlocked: () => blocked,
      reportContent: (...args) => { const request = { ...deferred(), args }; requests.push(request); return request.promise; },
      blockUser: (...args) => { const request = { ...deferred(), args }; blocks.push(request); return request.promise; },
    }) };
    if (name.startsWith('../components/')) return name.split('/').at(-1);
    return local(name);
  };
  const actualHook = execute(`../hooks/useIOSReportComposer${platform === 'ios' ? '.ios' : ''}.js`, imports);
  hook = { __esModule: true, default: args => { observed = actualHook.default(args); return observed; } };
  function LayoutProbe() {
    React.useLayoutEffect(() => {
      if (probed) return;
      probed = true; observed.select('harassment'); observed.changeDetails('Mount draft');
      if (probe === 'report') observed.submit(); else observed.close();
    }, []);
    return null;
  }
  const Report = execute('./ReportScreen.jsx', imports).default;
  const proceed = () => {
    if (closeMode === 'throw') throw new Error('navigation failed');
    if (closeMode === 'noop') return;
    linkedNavigationRef.current.invalidate(); navigationRef.current.stack.pop(); closed++;
  };
  const back = actualRootBack(guardRef, proceed, native.Platform);
  rootClose = back;
  const f = {
    renderer, requests, blocks, alerts, guardRef, navigationRef, linkedNavigationRef,
    all: () => nodes(renderer.container), find: predicate => { const node = f.all().find(predicate); assert.ok(node, 'expected rendered node'); return node; },
    get input() { return f.find(n => n.type === 'TextInput'); },
    get send() { return f.find(n => n.type === 'Pressable' && n.children?.some(c => c.type === 'Text' && c.children?.some(t => t.text === 'SEND REPORT'))); },
    get header() { return f.find(n => n.type === 'SheetHeader'); },
    button: label => f.find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label),
    act: callback => renderer.act(callback),
    press(label) { let value; f.act(() => { value = f.button(label).props.onPress(); }); return value; },
    select(label = 'Harassment or bullying') { return f.press(label); },
    edit(value) { f.act(() => f.input.props.onChangeText(value)); },
    submit() { let value; f.act(() => { value = f.send.props.onPress(); }); return value; },
    back() { f.act(() => rootClose()); },
    headerBack() { f.act(() => f.header.props.onClose()); },
    render() {
      const element = routeModule.exports.default({ Platform: native.Platform, session: account ? { id: account } : null, chatAuthEpoch: epoch,
        nav: frame, navigationRef, linkedNavigationRef, linkedNavigationScope: linkedNavigationRef.current.account(account, epoch), back, composerCloseGuardRef: guard ? guardRef : null, ReportScreen: Report });
      renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null, React.createElement(React.Suspense, { fallback: React.createElement('Fallback') }, keyed ? element : React.cloneElement(element, { key: 'same' }), probe ? React.createElement(LayoutProbe) : null, React.createElement(MaybeSuspend))));
    },
    scope({ id = account, authEpoch = epoch, nextTarget = target } = {}) {
      account = id; epoch = authEpoch;
      if (target !== nextTarget) { target = nextTarget; frame = { reporting: target }; navigationRef.current.stack = [{}, frame]; }
      f.render();
    },
    suspend(value) { suspended = value; f.render(); },
    get target() { return target; }, get closed() { return closed; },
    mode(value) { closeMode = value; }, blocked(value) { blocked = value; f.render(); },
    async settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(() => {}); },
    async complete(result = { ok: true, id: 'report' }, index = requests.length - 1) { requests[index].resolve(result); await f.settle(); },
    async reject(index = requests.length - 1) { requests[index].reject(new Error('offline')); await f.settle(); },
    close: () => renderer.render(null),
  };
  f.render(); return f;
}
const hasText = (f, text) => f.all().some(node => typeof node.text === 'string' && node.text.includes(text));

test('same-render select, details, and repeated Send capture the latest draft once and fence queued edits', async () => {
  const f = fixture(), select = f.button('Harassment or bullying').props.onPress, input = f.input.props.onChangeText, send = f.send.props.onPress;
  f.act(() => { select(); input('Private authored details'); send(); send(); input('late'); f.button('Spam or misleading content').props.onPress(); });
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].args, ['p1', 'Harassment or bullying', 'post', { mediaUri: f.target.mediaUri, category: 'harassment', details: 'Private authored details' }]);
  assert.equal(f.input.props.value, 'Private authored details'); assert.equal(f.input.props.editable, false);
  assert.equal(f.button('Harassment or bullying').props.accessibilityState.selected, true); assert.equal(f.send.props.disabled, true);
  f.back(); f.headerBack(); assert.equal(f.closed, 0); assert.equal(f.alerts.length, 1);
  await f.complete(); f.act(() => { send(); input('ignored'); }); assert.equal(f.requests.length, 1); assert.ok(hasText(f, 'was sent to the moderation queue'));
  f.close();
});
for (const entry of ['header', 'root', 'standalone']) test(`${entry} dirty Back keeps details or discards once; stale alerts cannot navigate`, () => {
  const f = fixture({ guard: entry !== 'standalone' });
  const input = f.input.props.onChangeText, back = entry === 'root' ? () => f.back() : () => f.headerBack();
  f.act(() => { input('Keep this'); back(); }); assert.equal(f.closed, 0); assert.equal(f.alerts[0][0], 'Discard report?');
  f.act(() => f.alerts[0][2][0].onPress()); assert.equal(f.input.props.value, 'Keep this');
  back(); const discard = f.alerts[1][2][1].onPress; f.act(() => { discard(); discard(); f.alerts[0][2][1].onPress(); }); assert.equal(f.closed, 1);
  f.close();
});
for (const result of [{ ok: false, error: 'Try later.' }, undefined, null, {}, { ok: 'yes' }, { ok: false, error: {} }, { ok: false, error: 'sent' }, { ok: false, error: 'sending' }, { ok: true }, { ok: true, id: '' }, { ok: true, id: '  ' }, { ok: true, id: 123 }, { ok: true, id: {} }, { ok: false, error: "Your report wasn't sent, so no moderator has seen it yet. Tap a reason to try again." }]) test(`failure ${JSON.stringify(result)} retains reason/details and unlocks deliberate retry`, async () => {
  const f = fixture(); f.select(); f.edit('Retain my report'); f.submit();
  // complete() deliberately defaults to a success, so resolve malformed values directly.
  f.requests[0].resolve(result); await f.settle();
  assert.equal(f.input.props.value, 'Retain my report'); assert.equal(f.input.props.editable, true); assert.equal(f.button('Harassment or bullying').props.accessibilityState.selected, true);
  assert.equal(f.requests.length, 1); assert.equal(f.closed, 0); assert.ok(hasText(f, 'Your report could not be confirmed. Your reason and details are kept here.'));
  f.submit(); assert.equal(f.requests.length, 2); await f.complete(); f.close();
});
test('thrown report failure retains draft without an unhandled rejection or automatic retry', async () => {
  const f = fixture(); f.select(); f.edit('Retain'); f.submit(); await f.reject();
  assert.equal(f.input.props.value, 'Retain'); assert.equal(f.requests.length, 1); assert.equal(f.send.props.disabled, false); f.close();
});
for (const duplicate of [true, false]) test(`explicit success duplicate=${duplicate} preserves confirmation and permits Done once before cleanup`, async () => {
  const f = fixture(); f.select(); f.submit(); await f.complete({ ok: true, id: 'r', duplicate });
  assert.ok(hasText(f, duplicate ? 'already in your open reports' : 'was sent to the moderation queue'));
  const done = f.button('Close report confirmation').props.onPress, block = f.button('Block this account').props.onPress;
  f.act(() => { done(); done(); block(); }); assert.equal(f.closed, 1); assert.equal(f.blocks.length, 0); assert.equal(f.alerts.length, 0); f.close();
});
for (const mode of ['noop', 'throw']) test(`${mode} navigation leaves confirmation usable without resending`, async () => {
  const f = fixture(); f.select(); const send = f.send.props.onPress; f.submit(); await f.complete(); f.mode(mode);
  f.press('Close report confirmation'); assert.equal(f.closed, 0); assert.ok(hasText(f, 'was sent to the moderation queue'));
  f.act(() => send()); assert.equal(f.requests.length, 1); f.mode('normal'); f.press('Close report confirmation'); assert.equal(f.closed, 1); f.close();
});
for (const boundary of ['account', 'epoch', 'logout', 'target', 'type', 'attachment', 'owner', 'unmount', 'route-before-render']) test(`${boundary} revokes pending work, stale actions and discard callbacks`, async () => {
  for (const keyed of [true, false]) for (const pending of [false, true]) {
    const f = fixture({ keyed }); f.select(); f.edit('Private'); const send = f.send.props.onPress, edit = f.input.props.onChangeText, back = f.header.props.onClose;
    if (pending) f.submit(); else f.back();
    const change = () => {
      if (boundary === 'account' || boundary === 'logout') { f.scope({ id: boundary === 'logout' ? null : 'B' }); f.scope({ id: 'A' }); }
      else if (boundary === 'epoch') { f.scope({ authEpoch: 2 }); f.scope({ authEpoch: 3 }); }
      else if (['target', 'type', 'attachment', 'owner'].includes(boundary)) {
        const original = f.target, field = { target: 'targetId', type: 'targetType', attachment: 'mediaUri', owner: 'ownerId' }[boundary];
        f.scope({ nextTarget: { ...original, [field]: field === 'targetType' ? 'comment' : 'new' } }); f.scope({ nextTarget: { ...original } });
      } else if (boundary === 'unmount') f.close();
      else { f.linkedNavigationRef.current.invalidate(); f.navigationRef.current.stack.pop(); }
    };
    change(); f.act(() => { send(); edit('Stale'); back(); f.alerts[0]?.[2][1]?.onPress(); });
    if (pending) await f.complete();
    assert.equal(f.requests.length, pending ? 1 : 0); assert.equal(f.closed, 0);
    if (!['unmount', 'route-before-render'].includes(boundary)) { assert.equal(f.input.props.value, ''); assert.equal(f.button('Harassment or bullying').props.accessibilityState.selected, false); }
    f.close();
  }
});
test('pending close notice is stale after completion and no-op dirty discard remains editable', async () => {
  const f = fixture(); f.select(); f.edit('Draft'); f.mode('noop'); f.back(); f.act(() => f.alerts[0][2][1].onPress());
  f.edit('Still editable'); assert.equal(f.input.props.value, 'Still editable'); f.submit(); f.back(); const notice = f.alerts[1];
  await f.complete({ ok: false }); f.edit('Retry details'); f.act(() => notice[2][0].onPress()); assert.equal(f.input.props.value, 'Retry details');
  f.mode('normal'); f.back(); f.act(() => f.alerts[2][2][1].onPress()); assert.equal(f.closed, 1); f.close();
});
test('block is explicit, single-flight, owner-fenced, and does not resend the confirmed report', async () => {
  const f = fixture(); f.select(); f.submit(); await f.complete(); assert.equal(f.blocks.length, 0);
  const block = f.button('Block this account').props.onPress;
  f.act(() => { block(); block(); }); assert.equal(f.blocks.length, 1); assert.deepEqual(f.blocks[0].args, ['other']);
  assert.equal(f.button('Block this account').props.disabled, true); f.press('Close report confirmation'); assert.equal(f.closed, 0);
  f.blocks[0].reject(new Error('offline')); await f.settle(); assert.ok(hasText(f, 'TRY BLOCKING AGAIN')); assert.equal(f.requests.length, 1);
  f.press('Block this account'); assert.equal(f.blocks.length, 2); f.blocks[1].resolve({ ok: true }); await f.settle();
  f.act(() => block()); assert.equal(f.blocks.length, 2); assert.ok(hasText(f, 'ACCOUNT BLOCKED')); f.close();
});
for (const boundary of ['account', 'epoch', 'target', 'unmount']) test(`block completion is fenced after ${boundary}`, async () => {
  const f = fixture({ keyed: false }); f.select(); f.submit(); await f.complete(); const block = f.button('Block this account').props.onPress; f.press('Block this account');
  if (boundary === 'unmount') f.close(); else if (boundary === 'target') f.scope({ nextTarget: { ...f.target, targetId: 'p2' } }); else f.scope(boundary === 'account' ? { id: 'B' } : { authEpoch: 2 });
  f.act(() => block()); f.blocks[0].resolve({ ok: true }); await f.settle(); assert.equal(f.blocks.length, 1); assert.equal(f.closed, 0); assert.equal(hasText(f, 'ACCOUNT BLOCKED'), false); f.close();
});
test('StrictMode replay retains one usable current guard and single-flight report; unmount clears it', async () => {
  const f = fixture({ strict: true }); assert.equal(typeof f.guardRef.current, 'function'); f.select(); f.edit('Strict');
  const send = f.send.props.onPress; f.act(() => { send(); send(); }); assert.equal(f.requests.length, 1); await f.complete();
  f.press('Close report confirmation'); assert.equal(f.closed, 1); f.close(); assert.equal(f.guardRef.current, null);
});
test('missing reason/target and guest Store validation remain intact', async () => {
  const f = fixture(); f.act(() => f.send.props.onPress()); assert.equal(f.requests.length, 0); assert.ok(hasText(f, 'Choose a reason first.'));
  f.scope({ nextTarget: { targetType: 'post' } }); f.select(); f.submit(); assert.equal(f.requests.length, 0); f.close();
  const g = fixture(); g.scope({ id: null }); g.select(); g.submit(); assert.equal(g.requests.length, 1);
  await g.complete({ ok: false, error: 'Log in to send this to the moderators.' }); assert.ok(hasText(g, 'Log in to send this to the moderators.')); assert.equal(g.input.props.value, ''); g.close();
});
for (const platform of ['android', 'web']) test(`${platform} retains original controls, payload, same-tick behavior, close and truthy result`, async () => {
  const f = fixture({ platform }); f.select(); f.edit('Legacy'); const send = f.send.props.onPress;
  assert.equal(f.guardRef.current, null); assert.equal(f.input.props.editable, undefined);
  f.act(() => { send(); send(); }); assert.equal(f.requests.length, 2); f.edit('Later legacy details'); assert.equal(f.input.props.value, 'Later legacy details');
  assert.equal(f.requests[0].args[3].details, 'Legacy'); f.requests.forEach(r => r.resolve({ ok: 'legacy truthy', duplicate: true })); await f.settle();
  assert.ok(hasText(f, 'already in your open reports')); assert.equal(f.button('Block this account').props.disabled, undefined);
  f.press('Close report confirmation'); assert.equal(f.closed, 1); assert.equal(f.alerts.length, 0); f.close();
});

test('Root committed departure cannot revive old callbacks when the exact frame is restored before render', async () => {
  const f = fixture({ keyed: false }); f.select(); f.edit('Private');
  const frame = f.navigationRef.current.stack.at(-1), send = f.send.props.onPress, edit = f.input.props.onChangeText, back = f.header.props.onClose;
  f.back(); const discard = f.alerts[0][2][1].onPress;
  f.linkedNavigationRef.current.invalidate(); f.navigationRef.current.stack.pop(); f.navigationRef.current.stack.push(frame);
  f.act(() => { send(); edit('stale'); back(); discard(); });
  assert.equal(f.requests.length, 0); assert.equal(f.closed, 0);
  f.render(); assert.equal(f.input.props.value, ''); f.select(); f.submit(); await f.complete();
  const done = f.button('Close report confirmation').props.onPress;
  f.act(() => { done(); f.navigationRef.current.stack.push(frame); done(); }); assert.equal(f.closed, 1); f.close();
});

for (const probe of ['report', 'alert']) test(`StrictMode cleanup fences an actual ${probe} started in the old layout lifetime`, async () => {
  const f = fixture({ strict: true, probe });
  assert.equal(f.input.props.value, 'Mount draft');
  if (probe === 'report') {
    assert.equal(f.requests.length, 1); assert.equal(f.send.props.disabled, true); f.submit(); assert.equal(f.requests.length, 1);
    await f.complete(); assert.ok(hasText(f, 'was sent to the moderation queue'));
  } else {
    assert.equal(f.alerts.length, 1); f.act(() => f.alerts[0][2][1].onPress()); assert.equal(f.closed, 0);
    f.back(); assert.equal(f.alerts.length, 2); f.act(() => f.alerts[1][2][1].onPress()); assert.equal(f.closed, 1);
  }
  f.close();
});

for (const kind of ['report', 'block']) for (const settleHidden of [true, false]) test(`Suspense ${kind} reconnect, settleHidden=${settleHidden}, retains single-flight and authoritative receipt`, async () => {
  const f = fixture(); f.select(); f.edit('Preserved draft');
  let action = f.send.props.onPress;
  if (kind === 'block') { f.submit(); await f.complete(); action = f.button('Block this account').props.onPress; }
  f.act(() => action()); const requests = kind === 'report' ? f.requests : f.blocks;
  f.suspend(true); assert.equal(typeof f.guardRef.current, 'function'); f.back(); assert.equal(f.closed, 0); assert.ok(f.all().some(n => n.type === 'Fallback'));
  f.act(() => action()); assert.equal(requests.length, 1);
  if (settleHidden) { requests[0].resolve(kind === 'report' ? { ok: true, id: 'legacy-report-id' } : { ok: true }); await f.settle(); }
  f.suspend(false); assert.equal(typeof f.guardRef.current, 'function');
  f.act(() => action()); assert.equal(requests.length, 1);
  if (!settleHidden) {
    if (kind === 'report') { assert.equal(f.input.props.value, 'Preserved draft'); assert.equal(f.send.props.disabled, true); }
    else assert.equal(f.button('Block this account').props.disabled, true);
    requests[0].resolve(kind === 'report' ? { ok: true, id: 'legacy-report-id' } : { ok: true }); await f.settle();
  }
  assert.ok(hasText(f, kind === 'report' ? 'was sent to the moderation queue' : 'ACCOUNT BLOCKED'));
  assert.equal(requests.length, 1); f.close();
});

for (const kind of ['report', 'block']) test(`Suspense failed ${kind} cannot replay a captured old action, but a fresh retry still works`, async () => {
  const f = fixture(); f.select(); f.edit('Kept draft');
  const edit = f.input.props.onChangeText, select = f.button('Spam or misleading content').props.onPress, close = f.header.props.onClose;
  let action = f.send.props.onPress;
  if (kind === 'block') { f.submit(); await f.complete(); action = f.button('Block this account').props.onPress; }
  f.act(() => action()); const requests = kind === 'report' ? f.requests : f.blocks;
  f.suspend(true); requests[0].resolve({ ok: false }); await f.settle(); f.suspend(false);
  f.act(() => { action(); action(); edit('stale'); select(); close(); });
  assert.equal(requests.length, 1); assert.equal(f.closed, 0); assert.equal(f.alerts.length, 0);
  if (kind === 'report') { assert.equal(f.input.props.value, 'Kept draft'); assert.equal(f.button('Harassment or bullying').props.accessibilityState.selected, true); f.submit(); }
  else f.press('Block this account');
  assert.equal(requests.length, 2); requests[1].resolve(kind === 'report' ? { ok: true, id: 'confirmed-retry' } : { ok: true }); await f.settle();
  assert.ok(hasText(f, kind === 'report' ? 'was sent to the moderation queue' : 'ACCOUNT BLOCKED')); f.close();
});

test('Root Back cannot discard a hidden dirty report; resume preserves text and true unmount removes its guard', () => {
  const f = fixture(); f.edit('Private draft'); f.suspend(true); f.back(); f.back();
  assert.equal(f.closed, 0); assert.equal(f.alerts.length, 0); assert.equal(typeof f.guardRef.current, 'function');
  f.suspend(false); assert.equal(f.input.props.value, 'Private draft'); f.back(); assert.equal(f.alerts.length, 1);
  f.act(() => f.alerts[0][2][0].onPress()); f.close(); assert.equal(f.guardRef.current, null);
});
for (const sent of [false, true]) test(`hidden ${sent ? 'confirmed' : 'pristine'} report does not trap Root Back`, async () => {
  const f = fixture(); if (sent) { f.select(); f.submit(); await f.complete(); }
  f.suspend(true); f.back(); f.back(); assert.equal(f.closed, 1); assert.equal(f.alerts.length, 0); f.close(); assert.equal(f.guardRef.current, null);
});
test('hidden old owner cleanup cannot erase a successor Root guard', () => {
  const f = fixture(); f.edit('Private'); f.suspend(true); const successor = () => {};
  f.guardRef.current = successor; f.close(); assert.equal(f.guardRef.current, successor);
});

for (const sent of [false, true]) test(`captured ${sent ? 'confirmed' : 'pristine'} Root guard cannot act after true unmount`, async () => {
  const f = fixture(); if (sent) { f.select(); f.submit(); await f.complete(); }
  const guard = f.guardRef.current; f.close(); let proceeded = 0, cancelled = 0;
  guard({ proceed: () => proceeded++, cancel: () => cancelled++ });
  assert.equal(proceeded, 0); assert.equal(cancelled, 1); assert.equal(f.guardRef.current, null);
});
