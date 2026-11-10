import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const noop = () => {};
function createRenderer() {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true,
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: node => { node.hidden = true; }, unhideTextInstance: node => { node.hidden = false; }, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [], focus() {}, scrollToEnd() {}, scrollTo(options) { this.scrollTarget = options; } }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
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
  return { container, render(element, passive = true) { renderer.updateContainerSync(element, root, null, null); renderer.flushSyncWork(); if (passive) flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}

const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
function fixture() {
  const renderer = createRenderer(), modules = new Map(), samples = [], reactions = [], animations = [], canceled = [], calls = [];
  const previewContext = require('./nativeTabPreviewContext.mjs').NativeTabPreviewContext;
  const persisted = new Map();
  let config = { fontScale: 1, accountId: 'account-A', tabs: false, scope: {}, page: 'feed', enabled: true, reader: false, reduced: false, foreground: true, active: 'a', scrolls: true };
  const shared = initial => {
    const ref = React.useRef(null);
    if (!ref.current) { let value = initial; ref.current = { get: () => value, set: next => { value = next; } }; }
    return ref.current;
  };
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', FlatList: 'FlatList', TextInput: 'TextInput',
    StyleSheet: { create: x => x, flatten: x => Array.isArray(x) ? Object.assign({}, ...x.filter(Boolean).map(native.StyleSheet.flatten)) : x },
    useWindowDimensions: () => ({ width: 390, height: 800, fontScale: config.fontScale }),
  };
  const overrides = {
    '../lib/persist': { load: (key, fallback) => persisted.get(key) ?? fallback, save: (key, value) => persisted.set(key, value) },
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': native,
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' }, ReduceMotion: { System: 'system' },
      useSharedValue: shared,
      useAnimatedRef: () => { const ref = React.useRef(null); if (!ref.current) { const bind = node => { bind.current = node; }; ref.current = bind; } return ref.current; },
      useScrollOffset: ref => { const value = shared(0); React.useLayoutEffect(() => { const record = { ref, value, active: true }; samples.push(record); return () => { record.active = false; }; }, [ref, value]); return value; },
      useAnimatedStyle: fn => ({ ...fn(), animate: fn }), useAnimatedProps: fn => ({ ...fn(), animate: fn }),
      useAnimatedReaction: (prepare, react) => { const ref = React.useRef(null); if (!ref.current) { ref.current = {}; reactions.push(ref.current); }
        Object.assign(ref.current, { prepare, react }); React.useLayoutEffect(() => { ref.current.active = true; return () => { ref.current.active = false; }; }, []); },
      withTiming: (value, options) => { animations.push({ value, options }); return value; }, cancelAnimation: value => canceled.push(value),
    },
    'react-native-gesture-handler': { GestureDetector: p => p.children, Gesture: { Native: () => ({ simultaneousWithExternalGesture() { return this; } }) } },
    './NativeTabSwipeExclusion': { __esModule: true, default: p => p.children, useNativeTabSwipeExclusionGesture: () => null },
    '../hooks/useNativeTabPreview': { __esModule: true, default: () => React.useContext(previewContext) },
    '../hooks/useReducedMotion': () => config.reduced, '../hooks/useScreenReaderEnabled': () => config.reader, '../lib/useAppActive': () => config.foreground,
    './BrandMark': 'BrandMark', './Icon': 'Icon', './NativeTabRail': p => p.children, '../theme': { colors: {}, font: 'System' },
  };
  function execute(path) {
    if (modules.has(path)) return modules.get(path);
    const file = new URL(path, import.meta.url), local = createRequire(file);
    const code = transformSync(readFileSync(file, 'utf8'), { filename: file.pathname, babelrc: false, configFile: false,
      plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')] }).code;
    const module = { exports: {} }; modules.set(path, module.exports);
    new Function('require', 'module', 'exports', code)(name => name in overrides ? overrides[name] : name === './NativeScrollChrome.ios'
      ? execute('./NativeScrollChrome.ios.jsx') : local(name), module, module.exports);
    modules.set(path, module.exports); return module.exports;
  }
  const { NativeScrollChromeProvider: Provider, NativeScrollChromeContent: Content, NativeScrollChromeContext: Context } = execute('./NativeScrollChrome.ios.jsx');
  const Scroll = execute('./NativeTabScroll.ios.jsx').ScrollView;
  const Header = execute('./NativeAppHeader.ios.jsx').default;
  const useSelection = execute('../hooks/useIOSFeedSelection.ios.js').default;
  let chrome, selection;
  function Read() { chrome = React.useContext(Context); return null; }
  const scrollProps = { ref: node => { calls.push(["ref", node]); return node ? () => calls.push(["refCleanup", node]) : undefined; }, onContentSizeChange: (...args) => calls.push(["size", args]), contentContainerStyle: { paddingTop: 12 }, onScroll: event => calls.push(['scroll', event]), onScrollBeginDrag: event => calls.push(['drag', event]), onLayout: event => calls.push(['layout', event]) };
  function App() { selection = useSelection(config.accountId); return React.createElement(Provider, { scope: config.scope, page: config.page, enabled: config.enabled },
    React.createElement(Read), React.createElement(Header, { active: config.page, loggedIn: !!config.accountId, feedSelection: config.tabs ? selection : undefined, unread: 5, notifications: 8, onOpenInbox: () => calls.push('inbox'), onOpenNotifications: () => calls.push('notifications') }),
    React.createElement(Content, null, config.scrolls ? ['a', 'b'].map(id => React.createElement(previewContext.Provider, { key: id, value: id !== config.active },
      React.createElement(Scroll, { ...scrollProps, testID: id }, React.createElement(Scroll, { horizontal: true, testID: `rail-${id}` }, 'Cards'), React.createElement(Scroll, { testID: `nested-${id}` }, 'Nested')))) : React.createElement('Loading'))); }
  const f = {
    samples, reactions, animations, canceled, calls, persisted,
    act: callback => renderer.act(callback),
    get selection() { return selection; },
    render(next = {}) { config = { ...config, ...next }; renderer.render(React.createElement(App)); f.tick(); },
    all: () => nodes(renderer.container),
    get chrome() { return chrome; },
    node(id) { return f.all().find(node => node.props?.testID === id); },
    tick() { for (let pass = 0; pass < 3; pass++) for (const r of reactions.filter(r => r.active)) r.react(r.prepare()); },
    sample(id) { return samples.find(s => s.active && s.ref.current?.props?.testID === id); },
    metrics(id, content = 1500, height = 500) { renderer.act(() => { f.node(id).props.onLayout({ nativeEvent: { layout: { height, width: 390 } } }); f.node(id).props.onContentSizeChange(390, content); }); f.tick(); },
    offset(id, y) { f.sample(id).value.set(y); f.tick(); },
    begin(id) { f.node(id).props.onScrollBeginDrag({ nativeEvent: { contentOffset: { y: f.sample(id).value.get() } } }); f.tick(); },
    end(id, velocity = 0) { f.node(id).props.onScrollEndDrag({ nativeEvent: { contentOffset: { y: f.sample(id).value.get() }, velocity: { y: velocity } } }); f.tick(); },
    close() { renderer.render(null); },
  };
  f.render(); f.metrics('a'); f.metrics('b'); return f;
}

test('real primary observer hides/reveals overlay with stable viewport and inset', t => {
  const f = fixture(); t.after(f.close);
  assert.equal(f.samples.length, 2, 'horizontal/nested scrolls do not subscribe');
  assert.equal(f.node('a').props.contentContainerStyle.at(-1).paddingTop, 60);
  assert.equal(f.node('a').props.scrollIndicatorInsets.top, 48);
  f.begin('a'); f.offset('a', 80); assert.equal(f.chrome.shown.get(), false);
  for (const y of [120, 117, 122, 110, 90]) { f.offset('a', y); assert.equal(f.chrome.shown.get(), false); }
  f.offset('a', 86); assert.equal(f.chrome.shown.get(), true);
  assert.equal(f.node('a').props.contentContainerStyle.at(-1).paddingTop, 60, 'visibility never changes scroll geometry');
  assert.equal(f.node('a').props.onScroll instanceof Function, true);
  const event = {}; f.node('a').props.onScroll(event); assert.equal(f.calls.at(-1)[1], event);
});

test('programmatic restores, seeks and stray momentum never count as user scrolling', t => {
  const f = fixture(); t.after(f.close);
  f.offset('a', 600); assert.equal(f.chrome.shown.get(), true);
  f.node('a').props.onMomentumScrollBegin({}); f.offset('a', 800); assert.equal(f.chrome.shown.get(), true);
  f.begin('a'); f.offset('a', 820); assert.equal(f.chrome.shown.get(), true);
  f.offset('a', 864); assert.equal(f.chrome.shown.get(), false);
  f.end('a'); f.offset('a', 500); assert.equal(f.chrome.shown.get(), false);
  f.offset('a', 0); assert.equal(f.chrome.shown.get(), true);
});

test('bottom bounce and changing geometry during a gesture do not reveal hidden chrome', t => {
  const f = fixture(); t.after(f.close);
  f.metrics('a', 700, 500); f.begin('a'); f.offset('a', 180); assert.equal(f.chrome.shown.get(), false);
  for (const y of [200, 260, 240, 210, 200, 190]) { f.offset('a', y); assert.equal(f.chrome.shown.get(), false); }
  f.metrics('a', 640, 500); f.offset('a', 140); assert.equal(f.chrome.shown.get(), false);
  f.offset('a', 104); assert.equal(f.chrome.shown.get(), true);
});

test('preview, route changes and retired worklets cannot control current chrome', t => {
  const f = fixture(); t.after(f.close);
  f.begin('b'); f.offset('b', 300); assert.equal(f.chrome.shown.get(), true);
  f.begin('a'); f.offset('a', 120); assert.equal(f.chrome.shown.get(), false);
  const oldBegin = f.node('a').props.onScrollBeginDrag;
  const oldReactions = f.reactions.map(r => ({ prepare: r.prepare, react: r.react }));
  f.render({ scope: {}, active: 'b' }); assert.equal(f.chrome.shown.get(), true);
  oldBegin({ nativeEvent: { contentOffset: { y: 0 } } });
  for (const r of oldReactions) r.react({ y: 900, max: 1000, interactive: true });
  assert.equal(f.chrome.shown.get(), true);
  f.begin('b'); f.offset('b', 380); assert.equal(f.chrome.shown.get(), false);
  f.render({ enabled: false }); assert.equal(f.chrome.shown.get(), true);
  f.offset('b', 600); assert.equal(f.chrome.shown.get(), true);
  f.render({ enabled: true }); f.offset('b', 900); assert.equal(f.chrome.shown.get(), true);
});

test('hidden controls reject queued presses, VoiceOver stays visible, Reduce Motion skips sliding', t => {
  const f = fixture(); t.after(f.close);
  const press = f.all().find(n => n.props?.accessibilityLabel === 'Messages, 5 unread').props.onPress;
  f.begin('a'); f.offset('a', 100); press(); assert.ok(!f.calls.includes('inbox'));
  const header = f.all().find(n => n.type === 'AnimatedView' && n.props.animatedProps);
  assert.equal(header.props.animatedProps.animate().pointerEvents, 'none');
  assert.equal(header.props.animatedProps.animate().accessibilityElementsHidden, true);
  assert.equal(header.props.style.animate().transform[0].translateY, -48);
  f.render({ reader: true }); f.begin('a'); f.offset('a', 500); assert.equal(f.chrome.shown.get(), true);
  f.render({ reader: false, reduced: true }); f.begin('a'); f.offset('a', 600); assert.equal(f.chrome.shown.get(), false);
  assert.equal(f.animations.at(-1).options.duration, 0);
  const retired = f.reactions.map(r => r.react); f.close();
  for (const react of retired) react({ y: 900, max: 1000, interactive: true });
  assert.ok(f.canceled.length > 0);
});

test('non-scroll fallback reserves measured header space and normal titles have no animation', t => {
  const f = fixture(); t.after(f.close);
  f.begin('a'); f.offset('a', 100); assert.equal(f.chrome.shown.get(), false);
  f.render({ scrolls: false }); assert.equal(f.chrome.sources, 0); assert.equal(f.chrome.shown.get(), true);
  assert.ok(f.all().some(n => n.props?.style?.paddingTop === 48));
  const source = readFileSync(new URL('./NativeLargeTitle.ios.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /reanimated|onLayout|useScroll|height:|opacity:/);
});


test('user momentum continues direction tracking and measured header growth keeps additive insets', t => {
  const f = fixture(); t.after(f.close);
  f.begin('a'); f.offset('a', 50); f.end('a', 1);
  f.node('a').props.onMomentumScrollBegin({}); f.offset('a', 90);
  assert.equal(f.chrome.shown.get(), false);
  f.node('a').props.onMomentumScrollEnd({}); f.offset('a', 30);
  assert.equal(f.chrome.shown.get(), false, 'post-momentum seek is not an upward drag');
  f.render();
  const layout = { nativeEvent: { layout: { height: 68 } } };
  f.chrome.measure(layout); f.render();
  assert.equal(f.chrome.height, 68);
  assert.equal(f.node('a').props.contentContainerStyle.at(-1).paddingTop, 80);
  assert.equal(f.node('a').props.scrollIndicatorInsets.top, 68);
  f.begin('a'); f.offset('a', 0); assert.equal(f.chrome.shown.get(), true);
});

test('primary observer preserves native callbacks, forwarded ref cleanup, and foreground ownership', t => {
  const f = fixture(); t.after(f.close);
  const main = f.node('a');
  assert.ok(f.calls.some(([kind, node]) => kind === 'ref' && node === main));
  assert.ok(f.calls.some(([kind, size]) => kind === 'size' && size[0] === 390 && size[1] === 1500));
  const event = { nativeEvent: { layout: { height: 500, width: 390 } } };
  main.props.onLayout(event); assert.equal(f.calls.at(-1)[1], event);
  f.begin('a'); f.offset('a', 100); assert.equal(f.chrome.shown.get(), false);
  const begin = main.props.onScrollBeginDrag;
  f.render({ foreground: false }); assert.equal(f.chrome.shown.get(), true);
  begin({ nativeEvent: { contentOffset: { y: 100 } } }); f.offset('a', 500);
  assert.equal(f.chrome.shown.get(), true);
  f.render({ foreground: true }); f.offset('a', 700); assert.equal(f.chrome.shown.get(), true);
  f.close(); assert.ok(f.calls.some(([kind, node]) => kind === 'refCleanup' && node === main));
  assert.ok(f.samples.every(sample => sample.ref.current === null));
});


test('Feed tabs share canonical persisted selection and the activity bar measured animated surface', t => {
  const f = fixture(); t.after(f.close); f.render({ tabs: true });
  const bar = f.node('native-activity-bar'), tabs = f.node('native-feed-tabs');
  const animated = f.all().filter(n => n.type === 'AnimatedView' && n.props.animatedProps);
  assert.equal(animated.length, 1);
  assert.ok(nodes(animated[0]).includes(bar));
  assert.ok(nodes(bar).includes(tabs));
  assert.ok(nodes(bar).includes(f.node('native-activity-icons')));
  assert.equal(tabs.props.accessibilityRole, 'tablist');
  const choices = nodes(tabs).filter(n => n.props?.accessibilityRole === 'tab');
  assert.deepEqual(choices.map(n => n.props.accessibilityLabel), ['Following', 'Local', 'For You', 'News']);
  assert.equal(choices.find(n => n.props.accessibilityLabel === 'For You').props.accessibilityState.selected, true);
  const list = f.node('a');
  f.act(() => choices.find(n => n.props.accessibilityLabel === 'Local').props.onPress());
  assert.equal(f.selection.filter, 'local');
  assert.ok([...f.persisted.values()].includes('local'));
  assert.strictEqual(f.node('a'), list, 'tab selection does not replace scroll container');
  f.act(() => f.selection.select('news')); // the same owner is also used by the drawer
  assert.equal(nodes(f.node('native-feed-tabs')).find(n => n.props?.accessibilityLabel === 'News').props.accessibilityState.selected, true);
  f.act(() => bar.props.onLayout({ nativeEvent: { layout: { height: 92 } } }));
  f.tick(); assert.equal(f.chrome.height, 92);
  assert.equal(list.props.contentContainerStyle.at(-1).paddingTop, 104);
  assert.equal(list.props.scrollIndicatorInsets.top, 92);
  f.begin('a'); f.offset('a', 100); assert.equal(f.chrome.shown.get(), false);
  assert.equal(animated[0].props.style.animate().transform[0].translateY, -92);
  assert.equal(list.props.contentContainerStyle.at(-1).paddingTop, 104, 'hiding both rows never changes scroll layout');
});

test('Feed tab presses are revoked while hidden, after route changes, and across account handoff', t => {
  const f = fixture(); t.after(f.close); f.render({ tabs: true });
  const local = () => nodes(f.node('native-feed-tabs')).find(n => n.props?.accessibilityLabel === 'Local').props.onPress;
  const queued = local();
  f.begin('a'); f.offset('a', 100); f.act(queued); assert.equal(f.selection.filter, 'everyone');
  for (const y of [120, 117, 122, 110, 90]) { f.offset('a', y); assert.equal(f.chrome.shown.get(), false); }
  f.offset('a', 86); assert.equal(f.chrome.shown.get(), true);
  f.act(local()); assert.equal(f.selection.filter, 'local');
  const oldAccount = nodes(f.node('native-feed-tabs')).find(n => n.props?.accessibilityLabel === 'News').props.onPress;
  f.render({ accountId: 'account-B', scope: {} }); f.act(oldAccount); assert.equal(f.selection.filter, 'everyone');
  const oldRoute = local();
  f.render({ page: 'discover' }); assert.equal(f.node('native-feed-tabs'), undefined);
  f.act(oldRoute); assert.equal(f.selection.filter, 'everyone');
  f.render({ page: 'feed', accountId: null }); assert.equal(f.node('native-feed-tabs'), undefined);
});

test('Feed tabs wrap large type, keep 44-point targets, and share VoiceOver and reduced-motion policy', t => {
  const f = fixture(); t.after(f.close); f.render({ tabs: true, fontScale: 2.5, reader: true, reduced: true });
  const tabs = f.node('native-feed-tabs');
  assert.equal(tabs.props.style[1].flexWrap, 'wrap');
  for (const tab of nodes(tabs).filter(n => n.props?.accessibilityRole === 'tab')) {
    const style = tab.props.style({ pressed: false });
    assert.ok(style[0].minHeight >= 44); assert.equal(style[1].flexBasis, '45%');
    assert.ok(tab.props.accessibilityHint);
  }
  f.act(() => f.node('native-activity-bar').props.onLayout({ nativeEvent: { layout: { height: 160 } } }));
  f.begin('a'); f.offset('a', 300); assert.equal(f.chrome.shown.get(), true);
  f.render({ reader: false }); f.begin('a'); f.offset('a', 400); assert.equal(f.chrome.shown.get(), false);
  assert.equal(f.animations.at(-1).options.duration, 0);
  assert.equal(f.all().find(n => n.type === 'AnimatedView' && n.props.animatedProps).props.style.animate().transform[0].translateY, -160);
});

test('You retains exactly one upper Messages/Notifications pair with unread badges, actions and scrolling visibility', t => {
  const f = fixture(); t.after(f.close); f.render({ page: 'you' });
  const controls = () => f.all().filter(n => n.type === 'Pressable' && /^(Messages|Notifications),/.test(n.props.accessibilityLabel || ''));
  assert.deepEqual(controls().map(n => n.props.accessibilityLabel), ['Messages, 5 unread', 'Notifications, 8 unread']);
  assert.equal(f.node('native-activity-icons').children.length, 2);
  const [messages, notifications] = controls();
  f.act(messages.props.onPress); f.act(notifications.props.onPress);
  assert.deepEqual(f.calls.filter(value => typeof value === 'string'), ['inbox', 'notifications']);
  f.begin('a'); f.offset('a', 100); assert.equal(f.chrome.shown.get(), false);
  f.act(messages.props.onPress); f.act(notifications.props.onPress);
  assert.equal(f.calls.filter(value => typeof value === 'string').length, 2, 'hidden controls cannot navigate');
  f.offset('a', 60); assert.equal(f.chrome.shown.get(), true);
  f.render({ fontScale: 3 });
  assert.deepEqual(controls().map(n => n.props.accessibilityLabel), ['Messages, 5 unread', 'Notifications, 8 unread']);
  assert.equal(nodes(f.node('native-activity-icons')).filter(n => n.type === 'Text').length, 0, 'large text uses badge dots while counts remain spoken');
  for (const control of controls()) f.act(control.props.onPress);
  assert.deepEqual(f.calls.filter(value => typeof value === 'string'), ['inbox', 'notifications', 'inbox', 'notifications']);
});
