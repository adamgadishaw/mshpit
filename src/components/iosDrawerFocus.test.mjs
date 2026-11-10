import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { transformSync } from '@babel/core';
import { iosFeedFilterChoices, iosMenuSections } from '../domain/iosMenuSections.mjs';
const require = createRequire(import.meta.url);
const nodes = tree => !tree ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
function fixture() {
  const states = [], refs = [], memos = [], effects = [], pending = [], focus = [], calls = [];
  let ri = 0, mi = 0, ei = 0, si = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: {
      useState: initial => { const i = si++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
      useRef: value => refs[ri++] ||= { current: value },
      useMemo: (create, deps) => { const i = mi++; if (!same(memos[i]?.deps, deps)) memos[i] = { deps, value: create() }; return memos[i].value; },
      useLayoutEffect: (create, deps) => { const i = ei++; if (!same(effects[i]?.deps, deps)) pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, create, cleanup: create() }; }); },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { AccessibilityInfo: { setAccessibilityFocus: node => focus.push(node) }, findNodeHandle: node => node?.tag,
      Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: x => x, absoluteFill: {}, hairlineWidth: 1 }, useWindowDimensions: () => ({ width: 393 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) },
    '../theme': { colors: {}, font: 'System' }, '../domain/iosMenuSections.mjs': { iosFeedFilterChoices, iosMenuSections },
    './Avatar': 'Avatar', './BrandMark': 'BrandMark', './Icon': 'Icon', '../hooks/useReducedMotion': () => false,
  };
  const code = transformSync(readFileSync(new URL('./IosMenuDrawer.ios.jsx', import.meta.url), 'utf8'), {
    filename: 'IosMenuDrawer.ios.jsx', babelrc: false, configFile: false,
    plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')],
  }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(key => { assert.ok(key in modules, key); return modules[key]; }, module, module.exports);
  const props = { visible: true, onClose: () => calls.push('close'), openerRef: { current: { tag: 9 } },
    session: { id: 'fan', role: 'fan', name: 'Fan', handle: 'fan' }, unread: 0, activity: 0,
    actions: { inbox: () => calls.push('inbox') }, onProfile: () => calls.push('profile'), onLogin: () => calls.push('login'), onLogout: () => calls.push('logout') };
  return { calls, focus, props,
    render: (overrides = {}) => { ri = mi = ei = si = 0; const tree = module.exports.default({ ...props, ...overrides }); while (pending.length) pending.shift()(); return tree; },
    unmount: () => effects.forEach(effect => effect.cleanup?.()),
    replay: () => { effects.forEach(effect => effect.cleanup?.()); effects.forEach(effect => { effect.cleanup = effect.create(); }); },
  };
}
const button = (tree, label) => nodes(tree).find(node => node.type === 'Pressable' && node.props.accessibilityLabel === label);
for (const method of ['close button', 'scrim', 'escape', 'requestClose']) {
  test(`drawer ${method} restores its opener exactly once after dismissal`, () => {
    const f = fixture(), tree = f.render();
    const closes = nodes(tree).filter(node => node.props.accessibilityLabel === 'Close side menu');
    const close = method === 'close button' ? closes[1].props.onPress : method === 'scrim' ? closes[0].props.onPress : method === 'escape' ? nodes(tree).find(node => node.props.accessibilityViewIsModal).props.onAccessibilityEscape : tree.props.onRequestClose;
    close(); close(); assert.deepEqual(f.calls, ['close']); assert.deepEqual(f.focus, []);
    const hidden = f.render({ visible: false }); hidden.props.onDismiss(); tree.props.onDismiss();
    assert.deepEqual(f.focus, [9]);
  });
}
for (const destination of ['inbox', 'profile', 'login', 'logout']) {
  test(`drawer ${destination} leaves focus to the destination`, () => {
    const f = fixture(), tree = f.render(destination === 'login' ? { session: null } : {});
    const target = destination === 'inbox' ? button(tree, 'Inbox') : destination === 'profile' ? button(tree, "View Fan's profile") : destination === 'login' ? button(tree, 'Sign in to Mshpit') : nodes(tree).find(node => node.type === 'Pressable' && nodes(node).some(child => child.type === 'Text' && child.props.children === 'Sign out'));
    target.props.onPress(); tree.props.onRequestClose();
    assert.deepEqual(f.calls, ['close', destination]);
    const hidden = f.render({ visible: false }); tree.props.onDismiss(); hidden.props.onDismiss();
    assert.deepEqual(f.focus, []);
  });
}
test('old dismissal and controls cannot affect a reopened drawer, even after it closes', () => {
  const f = fixture(), old = f.render(); old.props.onRequestClose();
  const hidden = f.render({ visible: false }), next = f.render();
  old.props.onDismiss(); hidden.props.onDismiss(); old.props.onRequestClose(); button(old, 'Inbox').props.onPress();
  assert.deepEqual(f.calls, ['close']); assert.deepEqual(f.focus, []);
  next.props.onRequestClose(); f.render({ visible: false }); old.props.onDismiss(); hidden.props.onDismiss();
  assert.deepEqual(f.focus, []); next.props.onDismiss(); assert.deepEqual(f.focus, [9]);
});
test('unmount revokes dismissal, onShow and destination callbacks', () => {
  const f = fixture(), tree = f.render(); tree.props.onRequestClose(); f.unmount();
  tree.props.onDismiss(); tree.props.onShow(); button(tree, 'Inbox').props.onPress();
  assert.deepEqual(f.focus, []); assert.deepEqual(f.calls, ['close']);
});
test('ordinary rerenders and StrictMode effect replay preserve cancel ownership', () => {
  const f = fixture(); f.render(); f.replay(); const tree = f.render(); tree.props.onRequestClose();
  const hidden = f.render({ visible: false }); f.replay(); hidden.props.onDismiss();
  assert.deepEqual(f.focus, [9]);
});
test('external hiding without cancellation does not restore potentially stale focus', () => {
  const f = fixture(), tree = f.render(); const hidden = f.render({ visible: false });
  tree.props.onDismiss(); hidden.props.onDismiss(); assert.deepEqual(f.focus, []);
});

test('Feed disclosure exposes one controlled radio selection and closes before selecting', () => {
  const f = fixture(); f.props.feedFilter = 'local'; f.props.onSelectFeedFilter = value => f.calls.push(value);
  let tree = f.render(); const disclosure = button(tree, 'Feed filters');
  assert.equal(disclosure.props.accessibilityState.expanded, false); assert.equal(nodes(tree).some(node => node.props.accessibilityRole === 'radio'), false);
  disclosure.props.onPress(); tree = f.render();
  assert.equal(button(tree, 'Feed filters').props.accessibilityState.expanded, true);
  const radios = nodes(tree).filter(node => node.props.accessibilityRole === 'radio');
  assert.deepEqual(radios.map(node => node.props.accessibilityLabel), ['Following', 'Local', 'For You', 'News']);
  assert.deepEqual(radios.map(node => node.props.accessibilityState.checked), [false, true, false, false]);
  radios[3].props.onPress(); radios[0].props.onPress(); assert.deepEqual(f.calls, ['close', 'news']);
  f.render({ visible: false }); f.props.feedFilter = 'news'; tree = f.render();
  assert.equal(nodes(tree).find(node => node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel === 'News').props.accessibilityState.checked, true);
  radios[1].props.onPress(); assert.deepEqual(f.calls, ['close', 'news']);
  tree.props.onRequestClose(); f.render({ visible: false }).props.onDismiss(); assert.deepEqual(f.focus, [9]);
});
test('Feed guest disclosure explains sign-in without offering private radio choices', () => {
  const f = fixture(); f.props.session = null;
  button(f.render(), 'Feed filters').props.onPress(); const tree = f.render();
  assert.equal(nodes(tree).some(node => node.props.accessibilityRole === 'radio'), false);
  button(tree, 'Sign in for your feed').props.onPress(); tree.props.onDismiss();
  assert.deepEqual(f.calls, ['close', 'login']); assert.deepEqual(f.focus, []);
});
test('Feed disclosure and radio callbacks cannot cross an account handoff', () => {
  const f = fixture(); f.props.onSelectFeedFilter = value => f.calls.push(value);
  button(f.render(), 'Feed filters').props.onPress(); const old = f.render();
  const oldRadio = nodes(old).find(node => node.props.accessibilityRole === 'radio');
  f.props.session = { id: 'B', name: 'Second', handle: 'second', role: 'fan' };
  const current = f.render(); assert.equal(button(current, 'Feed filters').props.accessibilityState.expanded, false);
  oldRadio.props.onPress(); button(old, 'Feed filters').props.onPress(); assert.deepEqual(f.calls, []);
});
