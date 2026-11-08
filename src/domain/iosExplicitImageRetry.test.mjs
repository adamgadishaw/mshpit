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
const hookCode = compile('../hooks/useImageAttempt.ios.js');
const componentCodes = Object.fromEntries(['SmartImage', 'Avatar'].map(name => [name, compile(`../components/${name}.jsx`)]));
const children = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(children) : [n, ...children(n.props?.children)];

// Native Expo Image dispatches a queued source-less error to the current props
// of its native view. Reusing one view for the fallback can route a primary
// failure into the fallback callback. Model that routing around the actual
// component and hook, retaining handlers on replaced native instances.
function fixture(name, { reuseNativeView = false, platform = "ios", store = null } = {}) {
  const slots = [], targets = new Map(), effects = []; let cursor = 0, tree, current;
  let intent = store || { listeners: new Set(), subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); } };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useLayoutEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
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
    if (dep === 'react-native') return { Platform: { OS: platform }, View: 'View', Text: 'Text', Pressable: 'Pressable', PixelRatio: { get: () => 3 }, StyleSheet: { create: v => v, absoluteFill: {} } };
    if (dep === 'expo-image') return { Image: 'NativeImage' };
    if (dep.endsWith('/feedImageRetry')) return { useFeedImageRetryPulse: () => intent };
    if (dep.endsWith('/useImageAttempt')) return { default: hook, __esModule: true };
    if (dep.endsWith('/imageLoadPolicy.mjs')) return policies;
    if (dep.endsWith('/img')) return { displaySrc: uri => uri, previewSrc: uri => 'preview:' + uri, proxied: uri => 'fallback:' + uri, isHttp: () => true, isVideoUrl: () => false };
    if (dep.endsWith('/theme')) return { colors: {}, mono: '', focusRing: {} };
    return 'UnusedChild';
  }).default;
  const props = name === 'Avatar' ? { user: { id: 'local-fixture', name: 'Local fixture', avatarUri: 'photo-a' } } : { uri: 'photo-a' };
  const render = () => {
    cursor = 0; tree = component(props); while (effects.length) effects.shift()();
    const image = children(tree).find(n => n.type === 'NativeImage');
    current = image ? reuseNativeView ? 'one-view' : image.key ?? 'one-view' : null;
    if (image) targets.set(current, image.props);
    return image;
  };
  render();
  return { render, props, get store() { return intent; },
    capturePulse() { return [...intent.listeners]; },
    pulse() { for (const fn of intent.listeners) fn(); },
    changeOwner() { intent = { listeners: new Set(), subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); } }; render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    get current() { return current; }, get image() { return children(tree).find(n => n.type === 'NativeImage'); },
    error(target) { targets.get(target).onError({ error: 'HTTP 404' }); render(); },
    display(target) { targets.get(target).onDisplay(); render(); } };
}


for (const name of ['SmartImage', 'Avatar']) {
  test(`${name}: exhausted same-URI image recovers once; source and cache keys stay unchanged`, () => {
    const f = fixture(name), first = f.image, primary = f.current;
    f.error(primary); const fallback = f.current;
    f.error(fallback); assert.equal(f.image, undefined);
    f.render(); assert.equal(f.image, undefined);
    f.pulse(); f.render(); const retry = f.current;
    assert.notEqual(retry, primary); assert.deepEqual(f.image.props.source, first.props.source);
    f.display(primary); f.display(fallback); f.error(primary); f.error(fallback);
    assert.equal(f.current, retry);
    f.error(retry); f.error(f.current); assert.equal(f.image, undefined);
    f.render(); assert.equal(f.image, undefined, 'no automatic retry');
    f.pulse(); f.render(); assert.ok(f.image); assert.notEqual(f.current, retry);
    f.error(retry); assert.ok(f.image);
  });
  test(`${name}: healthy/loading instances consume intent at acceptance, even before render`, () => {
    const f = fixture(name), first = f.current;
    f.pulse(); assert.equal(f.current, first);
    f.error(first); f.error(f.current); assert.equal(f.image, undefined);
    f.render(); assert.equal(f.image, undefined, 'failure cannot reuse the old intent');
    f.pulse(); f.render(); const retry = f.current;
    f.display(retry); f.pulse(); f.render(); assert.equal(f.current, retry);
  });
  test(`${name}: A→B→A rejects old errors AND displays`, () => {
    const f = fixture(name), a = f.current;
    const set = uri => { if (name === 'Avatar') f.props.user = { ...f.props.user, avatarUri: uri }; else f.props.uri = uri; f.render(); };
    set('photo-b'); const b = f.current; set('photo-a'); const nextA = f.current;
    assert.notEqual(a, nextA); f.display(a); f.display(b); f.error(a); f.error(b); assert.equal(f.current, nextA);
    f.error(nextA); assert.notEqual(f.current, nextA, 'old display did not mark this attempt ready');
  });
  test(`${name}: owner changes never retry exhausted images and unmount rejects handlers`, () => {
    const f = fixture(name); f.error(f.current); f.error(f.current); assert.equal(f.image, undefined);
    f.changeOwner(); f.changeOwner(); assert.equal(f.image, undefined);
    f.pulse(); f.render(); const active = f.current;
    f.unmount(); f.error(active); assert.equal(f.current, active);
  });
}

for (const name of ['SmartImage', 'Avatar']) test(`${name}: unsubscribed A listeners cannot retry an exhausted later A lifetime`, () => {
  const f = fixture(name), callbacks = f.capturePulse();
  const set = uri => { if (name === 'Avatar') f.props.user = { ...f.props.user, avatarUri: uri }; else f.props.uri = uri; f.render(); };
  set('photo-b'); set('photo-a'); f.error(f.current); f.error(f.current); assert.equal(f.image, undefined);
  for (const callback of callbacks) callback(); f.render(); assert.equal(f.image, undefined);
  f.pulse(); f.render(); assert.ok(f.image);
});

for (const name of ['SmartImage', 'Avatar']) test(`${name}: remounts never replay old gestures; scope changes keep healthy keys stable`, () => {
  const first = fixture(name), key = first.current;
  first.changeOwner(); assert.equal(first.current, key);
  first.pulse(); first.unmount();
  const fresh = fixture(name, { store: first.store });
  fresh.error(fresh.current); fresh.error(fresh.current); assert.equal(fresh.image, undefined);
  fresh.render(); assert.equal(fresh.image, undefined);
});
