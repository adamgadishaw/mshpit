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

// Actual SuggestionBoxScreen, React lifecycle, Root route and Root Back.
// Native widgets, alerts and the named submission service are synthetic.
const rootSource = readFileSync(new URL('../../App.js', import.meta.url), 'utf8');
const route = rootSource.split('\n').find(line => line.includes('overlay = <SuggestionBoxScreen'));
const rootAST = require('@babel/parser').parse(rootSource, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'Root');
const closeNames = ['runAfterComposerClose', 'requestComposerPop', 'back'];
const closeSource = rootAST.body.body.flatMap(statement => statement.type === 'VariableDeclaration' ? statement.declarations : [])
  .filter(node => closeNames.includes(node.id?.name)).map(node => `const ${node.id.name} = ${rootSource.slice(node.init.start, node.init.end)};`).join('\n');
const actualRootBack = new Function('composerCloseGuardRef', 'popStack', 'Platform', `const web = false; const authNavigationAbortRef = { current: null }; ${closeSource} return back;`);

const routeCode = transformSync(`export default function route({ Platform, session, chatAuthEpoch, nav, navigationRef, linkedNavigationRef, linkedNavigationScope, back, composerCloseGuardRef, SuggestionBoxScreen }) {
  ${route.replace('else if', 'if')} return overlay;
}`, { babelrc: false, configFile: false, plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')] }).code;
const routeModule = { exports: {} };
new Function('require', 'module', 'exports', routeCode.replace('overlay =', 'var overlay ='))(require, routeModule, routeModule.exports);
function fixture({ platform = 'ios', strict = false, keyed = true, guard = true, probe = null } = {}) {
  const renderer = createRenderer(), requests = [], alerts = [];
  const linkedNavigationRef = { current: createIOSLinkedNavigation() }; linkedNavigationRef.current.mount();
  let account = 'A', epoch = 1, closeMode = 'normal', closed = 0, rootClose = null;
  let surface = 'menu';
  let frame = { suggestion: { surface } };
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
    if (name === '../hooks/useIOSSuggestionComposer') return hook;
    if (name === '../theme') return { colors: {}, radius: {}, shadow: {}, space: value => value };
    if (name === '../features/suggestions/suggestionService') return { submitSuggestion: (...args) => {
      const request = { ...deferred(), args }; requests.push(request); return request.promise;
    } };
    if (name.startsWith('../components/')) return name.split('/').at(-1);
    return local(name);
  };
  const actualHook = execute(`../hooks/useIOSSuggestionComposer${platform === 'ios' ? '.ios' : ''}.js`, imports);
  hook = { __esModule: true, default: args => { observed = actualHook.default(args); return observed; } };
  function LayoutProbe() {
    React.useLayoutEffect(() => {
      if (probed) return;
      probed = true; observed.changeBody('Mount draft');
      if (probe === 'send') observed.send(); else observed.close();
    }, []);
    return null;
  }
  const Suggestion = execute('./SuggestionBoxScreen.jsx', imports).default;
  const proceed = () => {
    if (closeMode === 'throw') throw new Error('navigation failed');
    if (closeMode === 'noop') return;
    linkedNavigationRef.current.invalidate(); navigationRef.current.stack.pop(); closed++;
  };
  const back = actualRootBack(guardRef, proceed, native.Platform);
  rootClose = back;
  const f = {
    renderer, requests, alerts, guardRef, navigationRef, linkedNavigationRef,
    all: () => nodes(renderer.container), find: predicate => { const node = f.all().find(predicate); assert.ok(node, 'expected rendered node'); return node; },
    get input() { return f.find(n => n.type === 'TextInput'); },
    get send() { return f.find(n => n.type === 'Button' && /^(Send suggestion|Sending suggestion)/.test(n.props.title)); },
    get done() { return f.find(n => n.type === 'Button' && n.props.title === 'Done'); },
    get header() { return f.find(n => n.type === 'SheetHeader'); },
    button: label => f.find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label),
    act: callback => renderer.act(callback),
    press(label) { let value; f.act(() => { value = f.button(label).props.onPress(); }); return value; },
    select(label = 'Something did not work') { return f.press(label); },
    edit(value) { f.act(() => f.input.props.onChangeText(value)); },
    submit() { let value; f.act(() => { value = f.send.props.onPress(); }); return value; },
    back() { f.act(() => rootClose()); },
    headerBack() { f.act(() => f.header.props.onClose()); },
    render() {
      const element = routeModule.exports.default({ Platform: native.Platform, session: account ? { id: account } : null, chatAuthEpoch: epoch,
        nav: frame, navigationRef, linkedNavigationRef, linkedNavigationScope: linkedNavigationRef.current.account(account, epoch), back, composerCloseGuardRef: guard ? guardRef : null, SuggestionBoxScreen: Suggestion });
      renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null, React.createElement(React.Suspense, { fallback: React.createElement('Fallback') }, keyed ? element : React.cloneElement(element, { key: 'same' }), probe ? React.createElement(LayoutProbe) : null, React.createElement(MaybeSuspend))));
    },
    scope({ id = account, authEpoch = epoch, nextSurface = surface, newFrame = false } = {}) {
      account = id; epoch = authEpoch;
      if (surface !== nextSurface || newFrame) { linkedNavigationRef.current.invalidate(); surface = nextSurface; frame = { suggestion: { surface } }; navigationRef.current.stack = [{}, frame]; }
      f.render();
    },
    suspend(value) { suspended = value; f.render(); },
    get surface() { return surface; }, get closed() { return closed; },
    mode(value) { closeMode = value; },
    async settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(() => {}); },
    async complete(result, index = requests.length - 1) { requests[index].resolve(result ?? receipt(requests[index].args[0].clientMutationId)); await f.settle(); },
    async reject(index = requests.length - 1) { requests[index].reject(new Error('offline')); await f.settle(); },
    close: () => renderer.render(null),
  };
  f.render(); return f;
}
const receipt = key => ({ id: 'sg_confirmed123', reference: 'IRMED123', duplicate: false, clientMutationId: key });
const hasText = (f, text) => f.all().some(node => typeof node.text === 'string' && node.text.includes(text));


test('same-render draft edits and duplicate Send submit latest anonymous payload once; pending edits are fenced', async () => {
  const f = fixture(), input = f.input.props.onChangeText, select = f.button('Something did not work').props.onPress,
    toggle = f.button('Include the menu section with this suggestion').props.onPress, send = f.send.props.onPress;
  f.act(() => { input('Latest synthetic suggestion'); select(); toggle(); send(); send(); input('stale'); select(); toggle(); });
  assert.equal(f.requests.length, 1);
  const payload = f.requests[0].args[0];
  assert.deepEqual(payload, { category: 'bug', body: 'Latest synthetic suggestion', clientMutationId: payload.clientMutationId, surface: 'menu' });
  assert.match(payload.clientMutationId, /^sgc_/); assert.equal(f.input.props.value, payload.body); assert.equal(f.input.props.editable, false);
  assert.equal(f.button('Something did not work').props.accessibilityState.checked, true); assert.equal(f.send.props.loading, true);
  f.back(); f.headerBack(); assert.equal(f.closed, 0); assert.equal(f.alerts.length, 1); assert.equal(f.alerts[0][0], 'Suggestion sending');
  await f.complete(); f.act(() => { send(); input('stale'); }); assert.equal(f.requests.length, 1); assert.ok(hasText(f, 'Suggestion received')); f.close();
});
for (const entry of ['root', 'header', 'standalone']) test(`${entry} dirty Back keeps or discards once and invalidates old prompts`, () => {
  const f = fixture({ guard: entry !== 'standalone' }); f.edit('Keep this note');
  const back = entry === 'root' ? () => f.back() : () => f.headerBack();
  back(); assert.equal(f.closed, 0); assert.equal(f.alerts[0][0], 'Discard suggestion?');
  f.act(() => f.alerts[0][2][0].onPress()); assert.equal(f.input.props.value, 'Keep this note');
  back(); f.act(() => { f.alerts[1][2][1].onPress(); f.alerts[1][2][1].onPress(); f.alerts[0][2][1].onPress(); });
  assert.equal(f.closed, 1); f.close();
});
for (const change of ['category', 'surface']) test(`${change} alone is a meaningful dirty draft`, () => {
  const f = fixture(); if (change === 'category') f.select(); else f.press('Include the menu section with this suggestion');
  f.back(); assert.equal(f.closed, 0); assert.equal(f.alerts[0][0], 'Discard suggestion?'); f.close();
});
for (const result of [undefined, null, {}, { ok: false }, { ok: true, id: 'sg_xx' }, { id: 'sg_xx' }, { id: 123 }, { reference: 'BAD' },
  { id: 'sg_confirmed123', reference: 'IRMED123', duplicate: false, clientMutationId: 'sgc_wrong_key_123' }]) test(`malformed result ${JSON.stringify(result)} retains draft, unlocks explicit retry with same key`, async () => {
  const f = fixture(); f.edit('Keep the full text'); f.submit(); f.requests[0].resolve(result); await f.settle();
  assert.equal(f.input.props.value, 'Keep the full text'); assert.equal(f.input.props.editable, true); assert.equal(f.requests.length, 1);
  assert.ok(hasText(f, 'Pit did not confirm that suggestion. Try again.')); assert.equal(hasText(f, 'Suggestion received'), false);
  f.submit(); assert.equal(f.requests.length, 2); assert.deepEqual(f.requests[0].args, f.requests[1].args); await f.complete(); f.close();
});
for (const modification of [{ reference: 'WRONG' }, { duplicate: 'yes' }, { ok: false }, { clientMutationId: undefined }]) test(`mismatched normalized receipt ${JSON.stringify(modification)} never confirms`, async () => {
  const f = fixture(); f.edit('Keep this text'); f.submit(); await f.complete({ ...receipt(f.requests[0].args[0].clientMutationId), ...modification });
  assert.equal(f.input.props.value, 'Keep this text'); assert.ok(hasText(f, 'Pit did not confirm')); f.close();
});
for (const error of [new Error('offline'), Object.assign(new Error('Tell us a little more before sending.'), { name: 'SuggestionValidationError' }),
  Object.assign(new Error('slow down'), { status: 429 }), Object.assign(new Error('Private backend text'), { name: 'SuggestionConfirmationError' })]) test(`thrown ${error.name}/${error.status || ''} retains key and canonical safe error`, async () => {
  const f = fixture(); f.edit('Keep retrying manually'); f.submit(); f.requests[0].reject(error); await f.settle();
  assert.equal(f.input.props.value, 'Keep retrying manually'); assert.equal(f.requests.length, 1); assert.equal(f.send.props.loading, false);
  const expected = error.name === 'SuggestionValidationError' ? error.message : error.status === 429 ? 'You have sent several suggestions recently.' : 'Pit did not confirm that suggestion.';
  assert.ok(hasText(f, expected)); assert.equal(hasText(f, 'Private backend text'), false);
  f.submit(); assert.deepEqual(f.requests[1].args, f.requests[0].args); await f.complete(); f.close();
});
for (const change of ['body', 'category', 'surface']) test(`edit ${change} after attempted outcome creates one fresh intent; unedited retry keeps its key`, async () => {
  const f = fixture(); f.edit('Original note'); f.submit(); await f.reject(); const first = f.requests[0].args[0].clientMutationId;
  f.submit(); assert.equal(f.requests[1].args[0].clientMutationId, first); await f.reject();
  if (change === 'body') f.edit('New note'); else if (change === 'category') f.select(); else f.press('Include the menu section with this suggestion');
  f.submit(); assert.notEqual(f.requests[2].args[0].clientMutationId, first); await f.reject();
  f.submit(); assert.equal(f.requests[3].args[0].clientMutationId, f.requests[2].args[0].clientMutationId); await f.complete(); f.close();
});
test('no opt-in, unsafe surface and guest submit contain no automatic context or owner fields', async () => {
  for (const surface of ['menu', 'https://example.test/private?name=synthetic']) {
    const f = fixture(); f.scope({ id: null, nextSurface: surface }); f.edit('Anonymous note'); f.submit();
    assert.deepEqual(Object.keys(f.requests[0].args[0]).sort(), ['body', 'category', 'clientMutationId']);
    if (surface.startsWith('http')) assert.equal(f.all().some(n => n.props?.accessibilityRole === 'checkbox'), false);
    await f.complete(); assert.ok(hasText(f, 'Suggestion received')); f.close();
  }
});
for (const duplicate of [true, false]) test(`valid normalized receipt duplicate=${duplicate} confirms and Done navigates once`, async () => {
  const f = fixture(); f.edit('Confirmed note'); const send = f.send.props.onPress; f.submit();
  await f.complete({ ...receipt(f.requests[0].args[0].clientMutationId), duplicate }); assert.ok(hasText(f, 'Suggestion received')); assert.ok(hasText(f, 'IRMED123'));
  const done = f.done.props.onPress; f.act(() => { send(); done(); done(); }); assert.equal(f.requests.length, 1); assert.equal(f.closed, 1); f.close();
});
for (const boundary of ['account', 'epoch', 'logout', 'surface', 'route', 'unmount', 'route-before-render']) test(`${boundary} revokes old Send, edit, close, alert and completion`, async () => {
  for (const keyed of [true, false]) for (const pending of [false, true]) {
    const f = fixture({ keyed }); f.edit('Private draft'); const send = f.send.props.onPress, edit = f.input.props.onChangeText,
      toggle = f.button('Include the menu section with this suggestion').props.onPress, back = f.header.props.onClose;
    if (pending) f.submit(); else f.back();
    if (boundary === 'account' || boundary === 'logout') { f.scope({ id: boundary === 'logout' ? null : 'B' }); f.scope({ id: 'A' }); }
    else if (boundary === 'epoch') { f.scope({ authEpoch: 2 }); f.scope({ authEpoch: 1 }); }
    else if (boundary === 'surface') { f.scope({ nextSurface: 'feed' }); f.scope({ nextSurface: 'menu' }); }
    else if (boundary === 'route') { f.scope({ newFrame: true }); f.scope({ newFrame: true }); }
    else if (boundary === 'unmount') f.close();
    else { f.linkedNavigationRef.current.invalidate(); f.navigationRef.current.stack.pop(); }
    f.act(() => { send(); edit('stale'); toggle(); back(); f.alerts[0]?.[2][1]?.onPress(); });
    if (pending) await f.complete();
    assert.equal(f.requests.length, pending ? 1 : 0); assert.equal(f.closed, 0);
    if (!['unmount', 'route-before-render'].includes(boundary)) assert.equal(f.input.props.value, ''); f.close();
  }
});
test('exact Root frame A-B-A before render cannot revive old controls', () => {
  const f = fixture({ keyed: false }); f.edit('Private'); const frame = f.navigationRef.current.stack.at(-1), send = f.send.props.onPress, edit = f.input.props.onChangeText;
  f.back(); const discard = f.alerts[0][2][1].onPress;
  f.linkedNavigationRef.current.invalidate(); f.navigationRef.current.stack.pop(); f.navigationRef.current.stack.push(frame);
  f.act(() => { send(); edit('stale'); discard(); }); assert.equal(f.requests.length, 0); assert.equal(f.closed, 0);
  f.render(); assert.equal(f.input.props.value, ''); f.close();
});
for (const mode of ['noop', 'throw']) test(`${mode} navigation preserves draft and confirmation for a usable later close`, async () => {
  const f = fixture(); f.edit('Draft'); f.mode(mode); f.back(); f.act(() => f.alerts[0][2][1].onPress());
  assert.equal(f.closed, 0); f.edit('Still editable'); f.submit(); await f.complete(); const sendCount = f.requests.length;
  f.act(() => f.done.props.onPress()); assert.equal(f.closed, 0); assert.ok(hasText(f, 'Suggestion received'));
  f.mode('normal'); f.act(() => f.done.props.onPress()); assert.equal(f.closed, 1); assert.equal(f.requests.length, sendCount); f.close();
});
test('old pending alert becomes inert after settlement and cannot block current edits', async () => {
  const f = fixture(); f.edit('Draft'); f.submit(); f.back(); const notice = f.alerts[0]; await f.reject();
  f.edit('Current draft'); f.act(() => notice[2][0].onPress()); assert.equal(f.input.props.value, 'Current draft'); f.back();
  assert.equal(f.alerts[1][0], 'Discard suggestion?'); f.act(() => f.alerts[1][2][1].onPress()); assert.equal(f.closed, 1); f.close();
});
for (const probe of ['send', 'alert']) test(`StrictMode ${probe} layout replay preserves command/draft but retires old alert`, async () => {
  const f = fixture({ strict: true, probe }); assert.equal(f.input.props.value, 'Mount draft'); assert.equal(typeof f.guardRef.current, 'function');
  if (probe === 'send') { assert.equal(f.requests.length, 1); f.submit(); assert.equal(f.requests.length, 1); await f.complete(); assert.ok(hasText(f, 'Suggestion received')); }
  else { assert.equal(f.alerts.length, 1); f.act(() => f.alerts[0][2][1].onPress()); assert.equal(f.closed, 0); f.back(); f.act(() => f.alerts[1][2][1].onPress()); assert.equal(f.closed, 1); }
  f.close(); assert.equal(f.guardRef.current, null);
});
for (const hidden of [true, false]) for (const success of [true, false]) test(`Suspense settlement hidden=${hidden}, success=${success} preserves command and retires old presentation`, async () => {
  const f = fixture(); f.edit('Preserved note'); const send = f.send.props.onPress, edit = f.input.props.onChangeText, close = f.header.props.onClose;
  f.submit(); f.suspend(true); f.back(); assert.equal(f.closed, 0); assert.equal(typeof f.guardRef.current, 'function'); f.act(() => send()); assert.equal(f.requests.length, 1);
  if (hidden) { if (success) await f.complete(); else await f.reject(); }
  f.suspend(false); f.act(() => { send(); edit('stale'); close(); }); assert.equal(f.requests.length, 1); assert.equal(f.closed, 0);
  if (!hidden) { assert.equal(f.input.props.value, 'Preserved note'); assert.equal(f.send.props.loading, true); if (success) await f.complete(); else await f.reject(); }
  if (success) assert.ok(hasText(f, 'Suggestion received'));
  else { assert.equal(f.input.props.value, 'Preserved note'); f.submit(); assert.equal(f.requests.length, 2); assert.deepEqual(f.requests[1].args, f.requests[0].args); await f.complete(); }
  f.close();
});
test('hidden dirty draft blocks Root Back, keeps text, and removes only its own guard on true unmount', () => {
  const f = fixture(); f.edit('Private'); f.suspend(true); f.back(); f.back(); assert.equal(f.closed, 0); assert.equal(f.alerts.length, 0);
  f.suspend(false); assert.equal(f.input.props.value, 'Private'); f.back(); assert.equal(f.alerts.length, 1); f.close(); assert.equal(f.guardRef.current, null);
  const g = fixture(); g.edit('Private'); g.suspend(true); const successor = () => {}; g.guardRef.current = successor; g.close(); assert.equal(g.guardRef.current, successor);
});
for (const sent of [false, true]) test(`hidden ${sent ? 'confirmed' : 'pristine'} draft may close; captured guard after unmount is inert`, async () => {
  const f = fixture(); if (sent) { f.edit('Sent'); f.submit(); await f.complete(); }
  f.suspend(true); f.back(); f.back(); assert.equal(f.closed, 1); f.close(); assert.equal(f.guardRef.current, null);
  const g = fixture(); const guard = g.guardRef.current; g.close(); let proceeded = 0, cancelled = 0;
  guard({ proceed: () => proceeded++, cancel: () => cancelled++ }); assert.equal(proceeded, 0); assert.equal(cancelled, 1);
});
for (const platform of ['android', 'web']) test(`${platform} keeps legacy same-tick requests, payload, close, pending edits and truthy receipt behavior`, async () => {
  const f = fixture({ platform }); f.edit('Legacy'); const send = f.send.props.onPress;
  assert.equal(f.guardRef.current, null); f.act(() => { send(); send(); }); assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[0].args, f.requests[1].args); assert.deepEqual(Object.keys(f.requests[0].args[0]).sort(), ['body', 'category', 'clientMutationId']);
  f.edit('Legacy pending edit'); assert.equal(f.input.props.value, 'Legacy pending edit'); f.back(); assert.equal(f.closed, 1); assert.equal(f.alerts.length, 0);
  f.requests.forEach(request => request.resolve({ reference: 'LEGACY' })); await f.settle(); assert.ok(hasText(f, 'Suggestion received')); f.close();
});

test('runtime ownership and anonymous state remain local with no persistence or extra transport', () => {
  const hook = readFileSync(new URL('../hooks/useIOSSuggestionComposer.ios.js', import.meta.url), 'utf8');
  assert.doesNotMatch(hook, /AsyncStorage|localStorage|SecureStore|console\.|\btrack\(|\bfetch\(|from ["'].*(?:store|lib\/api)["']/);
});
