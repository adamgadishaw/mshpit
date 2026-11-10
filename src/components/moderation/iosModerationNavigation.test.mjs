import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { transformSync } from '@babel/core';
import { parse } from '@babel/parser';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../../screens/AdminScreen.jsx', import.meta.url), 'utf8');
const tabLiteral = source.match(/const TABS = (\[[\s\S]*?\n  \])\.filter/)[1];
const tabs = new Function('contentReportCount', 'bannedCount', 'deathWatch', 'pending', `return ${tabLiteral}`)(5, 2, {data:{counts:{pending:3}}}, [{id:'one'}]);
const nodes = tree => !tree ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
function fixture({ width = 393, fontScale = 1, reduced = false, insets = { top: 59, bottom: 34, left: 0, right: 0 } } = {}) {
  const refs = [], memos = [], effects = [], pending = [], focus = [], calls = [];
  let ri = 0, mi = 0, ei = 0, si = 0; const states = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: {
      useState: initial => { const i = si++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
      useRef: value => refs[ri++] ||= { current: value },
      useMemo: (create, deps) => { const i = mi++; if (!same(memos[i]?.deps, deps)) memos[i] = { deps, value: create() }; return memos[i].value; },
      useLayoutEffect: (create, deps) => { const i = ei++; if (!same(effects[i]?.deps, deps)) pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, create, cleanup: create() }; }); },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Keyboard: { dismiss: () => calls.push('keyboard') }, AccessibilityInfo: { setAccessibilityFocus: node => focus.push(node) }, findNodeHandle: node => node?.tag,
      Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: x => x, absoluteFill: {}, hairlineWidth: 1 }, useWindowDimensions: () => ({ width, fontScale }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => insets },
    '../../theme': { colors: {}, font: 'System' }, '../Icon': 'Icon', '../../hooks/useReducedMotion': () => reduced,
  };
  const code = transformSync(readFileSync(new URL('./IosModerationNavigation.ios.jsx', import.meta.url), 'utf8'), {
    filename: 'IosModerationNavigation.ios.jsx', babelrc: false, configFile: false,
    plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')],
  }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(key => { assert.ok(key in modules, key); return modules[key]; }, module, module.exports);
  const props = { tabs, activeTab: 'reports', session: { id: 'owner', role: 'admin' },
    onChange: key => calls.push(key), onClose: () => calls.push('back') };
  return { calls, focus, props,
    render: (overrides = {}) => { ri = mi = ei = si = 0; const tree = module.exports.default({ ...props, ...overrides }); while (pending.length) pending.shift()(); for (const n of nodes(tree)) if (n.props.ref) n.props.ref.current = { tag: n.props.accessibilityLabel || n.props.children }; return tree; },
    unmount: () => effects.forEach(effect => effect.cleanup?.()),
    replay: () => { effects.forEach(effect => effect.cleanup?.()); effects.forEach(effect => { effect.cleanup = effect.create(); }); },
  };
}

const button = (tree, label) => nodes(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label);
const modal = tree => nodes(tree).find(n => n.type === 'Modal');
const open = f => { button(f.render(), 'Open moderation menu').props.onPress(); return f.render(); };

test('all 14 authorized sections live in a right drawer, never in the compact header', () => {
  const f = fixture(), closed = f.render();
  assert.equal(modal(closed).props.visible, false);
  const header = nodes(closed).find(n => n.props.testID === 'ios-moderation-header');
  assert.deepEqual(nodes(header).filter(n => n.type === 'Pressable').map(n => n.props.accessibilityLabel), ['Back from moderation', 'Open moderation menu']);
  const tree = open(f), drawer = nodes(tree).find(n => n.props.testID === 'ios-moderation-drawer');
  const scroll = nodes(drawer).find(n => n.type === 'ScrollView');
  assert.equal(nodes(scroll).filter(n => n.type === 'Pressable').length, 14);
  assert.equal(nodes(tree).find(n => n.props.style?.alignItems === 'flex-end').props.style.flex, 1);
  assert.equal(drawer.props.style[0].borderTopLeftRadius, 20);
  assert.equal(modal(tree).props.presentationStyle, 'overFullScreen');
  assert.equal(drawer.props.accessibilityViewIsModal, true);
  assert.equal(drawer.props.onAccessibilityEscape, modal(tree).props.onRequestClose);
  assert.ok(button(tree, 'Reports, 5 open')); assert.ok(button(tree, 'Members, 2 banned'));
  assert.ok(button(tree, 'Requests, 1 pending')); assert.ok(button(tree, 'Artist alerts, 3 pending'));
});

test('moderators only see permitted destinations and non-staff get no navigation', () => {
  const f = fixture(); const props = { session: { id: 'mod', role: 'moderator' } };
  button(f.render(props), 'Open moderation menu').props.onPress();
  const tree = f.render(props), scroll = nodes(tree).find(n => n.type === 'ScrollView');
  assert.equal(nodes(scroll).filter(n => n.type === 'Pressable').length, 4);
  for (const label of ['Overview','Analytics','Catalog','Newsroom','Email','Badges']) assert.equal(button(tree,label),undefined);
  for (const role of ['fan','artist','editor',null]) assert.equal(f.render({session:{id:'member',role}}),null);
});

for (const method of ['close','scrim','escape','request']) test(`${method} cancels once and restores the opener after native dismissal`, () => {
  const f = fixture(), tree = open(f), native = modal(tree);
  const close = method === 'close' ? button(tree,'Close moderation menu').props.onPress
    : method === 'scrim' ? nodes(tree).find(n => n.type === 'Pressable' && n.props.accessible === false).props.onPress
      : method === 'escape' ? nodes(tree).find(n => n.props.accessibilityViewIsModal).props.onAccessibilityEscape : native.props.onRequestClose;
  native.props.onShow(); assert.deepEqual(f.focus,['Close moderation menu']);
  close(); close(); assert.equal(modal(f.render()).props.visible,false);
  native.props.onDismiss(); modal(f.render()).props.onDismiss();
  assert.deepEqual(f.focus,['Close moderation menu','Open moderation menu']);
  assert.deepEqual(f.calls,['keyboard']);
});

test('selection navigates once and focuses the selected section, not the menu button', () => {
  const f = fixture(), tree = open(f);
  button(tree,'Members, 2 banned').props.onPress(); button(tree,'Reports, 5 open').props.onPress();
  modal(tree).props.onRequestClose(); const hidden = f.render({activeTab:'members'});
  modal(hidden).props.onDismiss(); modal(tree).props.onDismiss();
  assert.deepEqual(f.calls,['keyboard','members']); assert.deepEqual(f.focus,['Members']);
  assert.equal(modal(hidden).props.visible,false);
});

test('unmounted or revoked controls cannot select, close, reopen or steal focus', () => {
  for (const revoke of ['unmount','role']) {
    const f=fixture(), closed=f.render(), tree=open(f), native=modal(tree);
    if(revoke==='unmount')f.unmount();else f.render({session:{id:'owner',role:'fan'}});
    button(tree,'Members, 2 banned').props.onPress(); native.props.onRequestClose(); native.props.onShow(); native.props.onDismiss();
    button(closed,'Open moderation menu').props.onPress(); button(closed,'Back from moderation').props.onPress();
    assert.deepEqual(f.calls,['keyboard']); assert.deepEqual(f.focus,[]);
  }
});

test('late close callbacks cannot affect a reopened menu', () => {
  const f=fixture(), old=open(f); modal(old).props.onRequestClose(); const hidden=f.render();
  button(hidden,'Open moderation menu').props.onPress(); const fresh=f.render();
  modal(old).props.onDismiss(); modal(hidden).props.onDismiss(); button(old,'Members, 2 banned').props.onPress();
  assert.equal(modal(f.render()).props.visible,true); assert.deepEqual(f.focus,[]);
  modal(fresh).props.onRequestClose(); f.render(); modal(old).props.onDismiss(); assert.deepEqual(f.focus,[]);
  modal(fresh).props.onDismiss(); assert.deepEqual(f.focus,['Open moderation menu']);
  assert.deepEqual(f.calls,['keyboard','keyboard']);
});

test('reduced motion, safe areas and large text retain scroll and full labels', () => {
  for(const width of [320,393,440,844])for(const fontScale of [0.8,1,1.5,3.2]) {
    const insets={top:59,bottom:34,left:width===844?59:0,right:width===844?59:0};
    const f=fixture({width,fontScale,insets,reduced:true}),tree=open(f),drawer=nodes(tree).find(n=>n.props.testID==='ios-moderation-drawer');
    assert.equal(modal(tree).props.animationType,'none');
    assert.ok(drawer.props.style[1].width<=width-insets.left-insets.right-24);
    assert.equal(drawer.props.style[1].paddingTop,67);assert.equal(drawer.props.style[1].paddingBottom,34);
    const scroll=nodes(drawer).find(n=>n.type==='ScrollView');assert.equal(scroll.props.style.flex,1);assert.equal(scroll.props.style.minHeight,0);
    for(const n of nodes(tree).filter(n=>n.type==='Text')) { assert.equal(n.props.numberOfLines,undefined);assert.equal(n.props.maxFontSizeMultiplier,undefined);assert.notEqual(n.props.allowFontScaling,false); }
    for(const n of nodes(tree).filter(n=>n.type==='Pressable'&&n.props.accessible!==false)) {
      const style=typeof n.props.style==='function'?n.props.style({pressed:false})[0]:n.props.style; assert.ok(style.minHeight>=44);
    }
  }
});

test('only iOS hides legacy chips and resets section scrolling; existing role checks remain', () => {
  const ast=parse(source,{sourceType:'module',plugins:['jsx']});
  const find=(node,predicate)=>!node||typeof node!=='object'?null:predicate(node)?node:Object.values(node).flatMap(v=>Array.isArray(v)?v:[v]).map(v=>find(v,predicate)).find(Boolean);
  const guard=find(ast,n=>n.type==='ConditionalExpression'&&n.consequent.type==='JSXElement'&&n.consequent.openingElement.name.name==='IosModerationNavigation');
  assert.ok(guard); assert.equal(source.slice(guard.test.start,guard.test.end),'Platform.OS === "ios"');
  const legacy=source.slice(guard.alternate.start,guard.alternate.end);assert.match(legacy,/accessibilityLabel="Moderation sections"/);assert.match(legacy,/TABS.filter/);
  assert.match(source,/key=\{artistRequestScope\}/);assert.match(source,/if \(!isMod\(session\?\.role\)\)/);
  assert.match(source,/key=\{Platform.OS === "ios" \? activeTab : undefined\}/);
  assert.match(readFileSync(new URL('./IosModerationNavigation.jsx',import.meta.url),'utf8'),/return null/);
});
