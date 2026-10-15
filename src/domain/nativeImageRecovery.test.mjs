import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
import * as attempts from './imageAttemptPolicy.mjs';
import * as policies from './imageLoadPolicy.mjs';

const require = createRequire(import.meta.url);
const compile = (path) => transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  filename: path, babelrc: false, configFile: false,
  plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')],
}).code;
const hookCode = compile('../hooks/useImageAttempt.js');
const componentCodes = Object.fromEntries(['SmartImage', 'Avatar'].map(name => [name, compile(`../components/${name}.jsx`)]));
const children = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(children) : [n, ...children(n.props?.children)];

// Native Expo Image dispatches a queued source-less error to the current props
// of its native view. Reusing one view for the fallback can route a primary
// failure into the fallback callback. Model that routing around the actual
// component and hook, retaining handlers on replaced native instances.
function fixture(name, { reuseNativeView = false } = {}) {
  const slots = [], targets = new Map(); let cursor = 0, tree, current;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useMemo(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: callback(), deps }; return slots[i].value; },
    useCallback(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: callback, deps }; return slots[i].value; },
  };
  const run = (code, resolver) => { const module = { exports: {} }; new Function('require', 'module', 'exports', code)(resolver, module, module.exports); return module.exports; };
  const hook = run(hookCode, dep => dep === 'react' ? react : attempts).default;
  const jsx = (type, props, key) => ({ type, props, key });
  const component = run(componentCodes[name], dep => {
    if (dep === 'react') return react;
    if (dep === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (dep === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', PixelRatio: { get: () => 3 }, StyleSheet: { create: v => v, absoluteFill: {} } };
    if (dep === 'expo-image') return { Image: 'NativeImage' };
    if (dep.endsWith('/useImageAttempt')) return { default: hook, __esModule: true };
    if (dep.endsWith('/imageLoadPolicy.mjs')) return policies;
    if (dep.endsWith('/img')) return { displaySrc: uri => uri, previewSrc: uri => 'preview:' + uri, proxied: uri => 'fallback:' + uri, isHttp: () => true, isVideoUrl: () => false };
    if (dep.endsWith('/theme')) return { colors: {}, mono: '', focusRing: {} };
    return 'UnusedChild';
  }).default;
  const props = name === 'Avatar' ? { user: { id: 'local-fixture', name: 'Local fixture', avatarUri: 'photo-a' } } : { uri: 'photo-a' };
  const render = () => {
    cursor = 0; tree = component(props);
    const image = children(tree).find(n => n.type === 'NativeImage');
    current = image ? reuseNativeView ? 'one-view' : image.key ?? 'one-view' : null;
    if (image) targets.set(current, image.props);
    return image;
  };
  render();
  return { render, props, get current() { return current; }, get image() { return children(tree).find(n => n.type === 'NativeImage'); },
    error(target) { targets.get(target).onError({ error: 'HTTP 404' }); render(); },
    display(target) { targets.get(target).onDisplay(); render(); } };
}

for (const name of ['SmartImage', 'Avatar']) {
  test(`${name}: queued primary failures cannot discard a working native fallback`, () => {
    const f = fixture(name), primary = f.current;
    f.error(primary); const fallback = f.current;
    assert.notEqual(fallback, primary, 'each source owns its native view and callback lifetime');
    f.error(primary); assert.equal(f.current, fallback); assert.ok(f.image);
    f.display(fallback); f.error(primary); assert.equal(f.current, fallback);
    assert.equal(f.image.props.cachePolicy, 'memory-disk');
  });
  test(`${name}: recycled source changes reject the previous native view's error`, () => {
    const f = fixture(name), first = f.current;
    if (name === 'Avatar') f.props.user = { ...f.props.user, avatarUri: 'photo-b' };
    else f.props.uri = 'photo-b';
    f.render(); const second = f.current; assert.notEqual(second, first);
    f.error(first); assert.equal(f.current, second);
    f.render(); assert.equal(f.current, second, 'unrelated renders keep the cached source instance');
  });
  test(`${name}: negative control reproduces the source-less native event failure when reusing one view`, () => {
    const f = fixture(name, { reuseNativeView: true }), view = f.current;
    f.error(view); assert.ok(f.image);
    f.error(view); assert.equal(f.image, undefined);
  });
}
