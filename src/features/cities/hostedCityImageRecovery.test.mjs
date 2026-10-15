import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
import * as attempts from '../../domain/imageAttemptPolicy.mjs';
import { isHostedCityImage } from '../../components/cities/cityImagePolicy.mjs';
const require = createRequire(import.meta.url);
const code = path => transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { filename: path, babelrc: false, configFile: false,
  plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')], }).code;
const hookCode = code('../../hooks/useImageAttempt.js'), componentCode = code('../../components/cities/CityImage.jsx');
const nodes = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
function fixture(uri = 'https://www.mshpit.com/images/cities/toronto.webp') {
  const slots = []; let cursor = 0, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => slots[i] = typeof next === 'function' ? next(slots[i]) : next]; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn, deps }; return slots[i].value; },
  };
  const run = (source, resolver) => { const module = { exports: {} }; new Function('require', 'module', 'exports', source)(resolver, module, module.exports); return module.exports; };
  const hook = run(hookCode, dep => dep === 'react' ? react : attempts).default;
  const jsx = (type, props, key) => ({ type, props, key });
  const component = run(componentCode, dep => {
    if (dep === 'react') return react;
    if (dep === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (dep === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: v => v, absoluteFill: {} } };
    if (dep === 'expo-image') return { Image: 'NativeImage' };
    if (dep.endsWith('/useImageAttempt')) return { default: hook, __esModule: true };
    if (dep.endsWith('/cityImagePolicy.mjs')) return { isHostedCityImage };
    if (dep.endsWith('/theme')) return { colors: {} };
    return dep.endsWith('/SmartImage') ? 'SmartImage' : 'Icon';
  }).default;
  const props = { uri, accessibilityLabel: 'Toronto city photo', previewWidth: 900, onPress() {} };
  const expand = n => typeof n?.type === 'function' ? expand(n.type(n.props)) : n;
  const render = () => { cursor = 0; tree = expand(component(props)); return tree; };
  render(); return { props, render, get image() { return nodes(tree).find(n => n.type === 'NativeImage'); }, get tree() { return tree; },
    get retry() { return nodes(tree).find(n => n.props?.accessibilityRole === 'button' && n.props.accessibilityLabel?.includes('Retry photo')); } };
}

test('hosted City images stay direct and retain the cached native instance on unrelated renders', () => {
  const f = fixture(), image = f.image;
  assert.equal(image.props.source.uri, f.props.uri); assert.equal(image.props.cachePolicy, 'memory-disk');
  f.render(); assert.equal(f.image.key, image.key); assert.equal(f.image.props.source, image.props.source);
  assert.equal(f.tree.props.onPress, f.props.onPress);
});
test('a hosted404 exposes one explicit retry and can retry the same URL without opening the gallery', () => {
  const f = fixture(), primary = f.image;
  primary.props.onError({ error: 'HTTP 404' }); f.render();
  assert.equal(f.image, undefined); assert.ok(f.retry); assert.equal(f.tree.props.onPress, undefined);
  const retry = f.retry; f.render(); assert.equal(f.image, undefined, 'unrelated renders do not start a retry loop');
  retry.props.onPress(); f.render(); const retried = f.image;
  assert.equal(retried.props.source.uri, primary.props.source.uri); assert.notEqual(retried.key, primary.key);
  primary.props.onError({ error: 'late original404' }); f.render(); assert.equal(f.image.key, retried.key);
  retried.props.onDisplay(); f.render(); assert.equal(f.retry, undefined);
});
test('reusing a City tile for another city rejects the previous native error', () => {
  const f = fixture(), previous = f.image;
  f.props.uri = 'https://www.mshpit.com/images/cities/vancouver.webp'; f.render();
  const current = f.image; assert.notEqual(current.key, previous.key);
  previous.props.onError({ error: 'old city404' }); f.render(); assert.equal(f.image.key, current.key);
});
test('non-hosted City photos keep the existing SmartImage proxy policy and size hints', () => {
  const f = fixture('https://public.example.test/fan.jpg');
  assert.equal(f.tree.type, 'SmartImage'); assert.equal(f.tree.props.previewWidth, 900);
});
