import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { transformSync } from '@babel/core';
import { nativeFeedCanWork, retainNativeFeedForMedia } from './nativeFeedMediaRetention.mjs';

const root = { platform: 'android', accountId: 'viewer-a', tab: 'feed', frames: [{}], hasOverlay: false };
test('only direct native Feed media retains the account-scoped list', () => {
  for (const platform of ['android', 'ios']) {
    assert.equal(retainNativeFeedForMedia({ ...root, platform }), true);
    assert.equal(retainNativeFeedForMedia({ ...root, platform, frames: [{}, { photos: { images: [{ uri: 'clip.mp4' }] } }], hasOverlay: true }), true);
  }
  for (const change of [
    { platform: 'web' }, { wide: true }, { accountId: null }, { tab: 'discover' },
    { frames: [] }, { frames: null }, { frames: [{ artistName: 'artist' }] },
    { hasOverlay: true }, { frames: [{}, { auth: true }], hasOverlay: true },
    { frames: [{}, { photos: {} }, { report: true }], hasOverlay: true },
    { frames: [{}, { artistName: 'artist' }, { photos: {} }], hasOverlay: true },
    { frames: [{}, { photos: {}, auth: true }], hasOverlay: true },
    { frames: [{}, { photos: {} }], hasOverlay: false },
  ]) assert.equal(retainNativeFeedForMedia({ ...root, ...change }), false, JSON.stringify(change));
});

test('obscured native Feed work stops while the web activity policy stays unchanged', () => {
  for (const platform of ['android', 'ios']) {
    assert.equal(nativeFeedCanWork({ platform, appActive: true, visible: true }), true);
    assert.equal(nativeFeedCanWork({ platform, appActive: true, visible: false }), false);
    assert.equal(nativeFeedCanWork({ platform, appActive: false, visible: true }), false);
  }
  assert.equal(nativeFeedCanWork({ platform: 'web', appActive: true, visible: false }), true);
  assert.equal(nativeFeedCanWork({ platform: 'web', appActive: false, visible: true }), false);
});

test('the production native layer keeps one base slot and blocks hidden input and accessibility', () => {
  const require = createRequire(import.meta.url);
  const code = transformSync(readFileSync(new URL('../components/NativeFeedMediaLayer.jsx', import.meta.url), 'utf8'), {
    filename: 'NativeFeedMediaLayer.jsx', babelrc: false, configFile: false,
    plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')],
  }).code;
  const module = { exports: {} };
  const componentRequire = name => name === 'react-native' ? { View: 'View', StyleSheet: { create: s => s, absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } } } : require(name);
  new Function('require', 'module', 'exports', code)(componentRequire, module, module.exports);
  const children = { type: 'Feed' }, header = { type: 'Header' }, tabBar = { type: 'Tabs' }, media = { type: 'Viewer' };
  const visible = module.exports.default({ obscured: false, children, header, tabBar, media });
  const hidden = module.exports.default({ obscured: true, children, header, tabBar, media });
  const [base, empty] = visible.props.children, [retained, modal] = hidden.props.children;
  assert.equal(base.type, retained.type);
  assert.deepEqual(base.props.children, [header, children, tabBar]);
  assert.deepEqual(retained.props.children, base.props.children);
  assert.equal(empty, null);
  assert.equal(base.props.pointerEvents, 'auto');
  assert.equal(base.props.importantForAccessibility, 'auto');
  assert.equal(retained.props.pointerEvents, 'none');
  assert.equal(retained.props.accessibilityElementsHidden, true);
  assert.equal(retained.props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(retained.props.style[1].opacity, 0);
  assert.equal(modal.props.accessibilityViewIsModal, true);
  assert.equal(modal.props.children, media);
});
