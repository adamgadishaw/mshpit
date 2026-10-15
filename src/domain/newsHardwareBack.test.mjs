import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../App.js', import.meta.url), 'utf8');
const syntax = parse(source, { sourceType: 'module', plugins: ['jsx'] });
let effect;
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'CallExpression' && node.callee?.name === 'useEffect'
      && source.slice(node.start, node.end).includes('BackHandler.addEventListener("hardwareBackPress"')) {
    assert.equal(effect, undefined, 'Only one Android Back listener expected');
    effect = source.slice(node.start, node.end);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(syntax.program);
assert.ok(effect);

function fixture(platform = 'android', depth = 1) {
  let listener, cleanup;
  const calls = { pop: 0, remove: 0, cancel: 0 };
  const newsStoryBackRef = { current: null };
  const stackRef = { current: Array.from({ length: depth }, () => ({})) };
  runInNewContext(effect, {
    Platform: { OS: platform }, newsStoryBackRef, stackRef,
    requestComposerPop() { calls.pop++; },
    useEffect(callback) { cleanup = callback(); },
    BackHandler: { addEventListener(event, callback) { assert.equal(event, 'hardwareBackPress'); listener = callback; return { remove() { calls.remove++; } }; } },
  });
  return { calls, back: () => listener?.(), hasListener: () => !!listener, cleanup: () => cleanup?.(),
    pending() { newsStoryBackRef.current = () => { calls.cancel++; newsStoryBackRef.current = null; }; } };
}

test('Android Back cancels the latest pending story at the Feed root, then permits normal exit', () => {
  const f = fixture(); f.pending();
  assert.equal(f.back(), true); assert.deepEqual(f.calls, { pop: 0, remove: 0, cancel: 1 });
  assert.equal(f.back(), false);
  f.pending(); assert.equal(f.back(), true); assert.equal(f.calls.cancel, 2);
});
test('Android Back dismisses the story notice before popping News or invoking its composer guard', () => {
  const f = fixture('android', 2); f.pending();
  assert.equal(f.back(), true); assert.equal(f.calls.pop, 0);
  assert.equal(f.back(), true); assert.equal(f.calls.pop, 1);
  f.cleanup(); assert.equal(f.calls.remove, 1);
});
test('iOS and web do not register the Android Back listener', () => {
  for (const platform of ['ios', 'web']) assert.equal(fixture(platform, 2).hasListener(), false);
});
