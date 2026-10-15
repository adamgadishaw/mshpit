import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
const require = createRequire(import.meta.url);
const file = new URL('../components/media-player/MshpitVideoPlayer.jsx', import.meta.url);
const localRequire = createRequire(file);
const code = transformSync(readFileSync(file, 'utf8'), {
  filename: 'MshpitVideoPlayer.jsx', babelrc: false, configFile: false,
  plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')],
}).code;
const nodes = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const text = tree => nodes(tree).filter(n => n.type === 'Text').map(n => n.props.children).flat().join(' ');
function fixture(platform = 'android') {
  let status = 'readyToPlay', error = null, active = true, cursor = 0, pending = [], playerInitialized = false;
  const slots = [], listeners = new Map(), calls = { pause: 0, play: 0, retry: 0 };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const player = { status, currentTime: 0, duration: 25, playing: false, videoTrack: { size: { width: 1080, height: 1920 } },
    pause() { calls.pause++; this.playing = false; }, play() { calls.play++; this.playing = true; },
    addListener(name, callback) { const set = listeners.get(name) || new Set(); set.add(callback); listeners.set(name, set); return { remove() { set.delete(callback); } }; },
  };
  const react = {
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useCallback(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { callback, deps }; return slots[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  const jsx = (type, props) => ({ type, props });
  const componentRequire = name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { Platform: { OS: platform }, StyleSheet: { create: v => v, absoluteFillObject: {} }, View: 'View', Text: 'Text', Pressable: 'Pressable', Linking: { openURL: async () => {} } };
    if (name === 'expo') return { useEvent: () => ({ status, error }) };
    if (name === 'expo-video') return { VideoView: 'VideoView', useVideoPlayer: (_uri, setup) => { if (!playerInitialized) { setup?.(player); playerInitialized = true; } return player; } };
    if (name.endsWith('/theme')) return { colors: {}, radius: {} };
    if (name.endsWith('/Icon')) return 'Icon';
    if (name.endsWith('/ClipPoster')) return 'ClipPoster';
    if (name.endsWith('/useAppActive')) return () => active;
    return localRequire(name);
  };
  const module = { exports: {} }; new Function('require', 'module', 'exports', code)(componentRequire, module, module.exports);
  const props = { uri: 'https://media.example.test/clip.mp4', onRetry: () => calls.retry++ };
  return { player, calls, render() { cursor = 0; pending = []; const tree = module.exports.default(props); pending.forEach(run => run()); return tree; },
    status(next, nextError = null) { status = next; error = nextError; }, active(next) { active = next; },
    unmount() { slots.forEach(s => s?.cleanup?.()); }, listenerCount() { return [...listeners.values()].reduce((n, s) => n + s.size, 0); },
  };
}
test('rebuffering retains the painted frame and native controls, then clears without blocking input', () => {
  const f = fixture(); let tree = f.render();
  assert.ok(nodes(tree).some(n => n.type === 'ClipPoster'));
  nodes(tree).find(n => n.type === 'VideoView').props.onFirstFrameRender();
  tree = f.render(); assert.ok(!nodes(tree).some(n => n.type === 'ClipPoster'));
  f.status('loading'); tree = f.render();
  assert.match(text(tree), /Buffering video/);
  assert.equal(nodes(tree).find(n => n.type === 'VideoView').props.nativeControls, true);
  assert.ok(!nodes(tree).some(n => n.type === 'ClipPoster'));
  const cue = nodes(tree).find(n => n.props?.accessibilityLiveRegion === 'polite' && text(n).includes('Buffering video'));
  assert.equal(cue.props.pointerEvents, 'none');
  f.status('readyToPlay'); assert.doesNotMatch(text(f.render()), /Buffering video/);
  f.unmount(); assert.equal(f.listenerCount(), 0);
});
test('a native error supersedes buffering and offers retry with appropriate device wording', () => {
  const f = fixture('ios'); let tree = f.render(); nodes(tree).find(n => n.type === 'VideoView').props.onFirstFrameRender(); f.render();
  f.status('error', new Error('decode failed')); tree = f.render();
  assert.match(text(tree), /This video could not play/); assert.doesNotMatch(text(tree), /Buffering video|browser/);
  const retry = nodes(tree).find(n => n.type === 'Pressable' && text(n).includes('Try again')); retry.props.onPress(); assert.equal(f.calls.retry, 1);
  f.unmount();
});
test('iOS and web inactivity still pause without automatically restarting on return', () => {
  for (const platform of ['ios', 'web']) {
    const f = fixture(platform); f.render(); f.player.play(); f.active(false); f.render();
    assert.equal(f.player.playing, false); assert.equal(f.calls.pause, 1);
    f.active(true); f.render(); assert.equal(f.calls.play, 1); f.unmount();
  }
});

test('Android delegates background pausing to the fullscreen-aware SDK instead of interrupting its activity', () => {
  const f = fixture('android'); const tree = f.render();
  assert.equal(f.player.staysActiveInBackground, false, 'real background playback remains disabled in the native player');
  assert.equal(nodes(tree).find(n => n.type === 'VideoView').props.fullscreenOptions.enable, true);
  f.player.play(); f.active(false); f.render();
  assert.equal(f.calls.pause, 0, 'an internal fullscreen AppState edge must not add a JS pause');
  assert.equal(f.player.playing, true);
  f.active(true); f.render(); assert.equal(f.calls.play, 1); f.unmount();
});
test('a pending web play interrupted by backgrounding does not leave a false playback error', async t => {
  const f = fixture('web'); t.after(() => f.unmount()); let tree = f.render(), rejectPlay;
  const pendingPlay = new Promise((resolve, reject) => { rejectPlay = reject; });
  nodes(tree).find(n => n.type === 'VideoView').props.ref.current = { nativeRef: { current: { play: () => pendingPlay } } };
  nodes(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Play video')).props.onPress();
  f.active(false); f.render(); rejectPlay(new Error('play interrupted by pause'));
  await new Promise(setImmediate); f.active(true); tree = f.render();
  assert.doesNotMatch(text(tree), /Playback could not start/); assert.equal(f.calls.pause, 1); f.unmount();
});
test('an active web playback rejection remains visible and retryable', async t => {
  const f = fixture('web'); t.after(() => f.unmount()); let tree = f.render();
  nodes(tree).find(n => n.type === 'VideoView').props.ref.current = { nativeRef: { current: { play: () => Promise.reject(new Error('unsupported source')) } } };
  nodes(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Play video')).props.onPress();
  await new Promise(setImmediate); tree = f.render(); assert.match(text(tree), /Playback could not start.*Try again/); f.unmount();
});
