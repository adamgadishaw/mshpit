import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { nativeNewsLinkFrame } from './nativeNewsLink.mjs';

const source = readFileSync(new URL('../../App.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  const nativeNewsNavigateRef = useRef(null);');
const end = source.indexOf('\n  useEffect(() => {\n    if (!web)', start);
assert.ok(start >= 0 && end > start);
const actualIngress = `(function () { ${source.slice(start, end)} })()`;
function fixture({ web = false, ready = false } = {}) {
  const refs = [], effects = [], calls = [];
  let refIndex, effectIndex, resolveInitial, rejectInitial, listener, reads = 0, subscriptions = 0;
  const initial = new Promise((resolve, reject) => { resolveInitial = resolve; rejectInitial = reject; });
  const context = {
    web, authReady: ready, nativeNewsLinkFrame,
    go: frame => calls.push(JSON.parse(JSON.stringify(frame))),
    Linking: {
      getInitialURL() { reads++; return initial; },
      addEventListener(type, callback) { assert.equal(type, 'url'); listener = callback; subscriptions++; return { remove() { listener = null; } }; },
    },
    useRef(value) { const index = refIndex++; return refs[index] ||= { current: value }; },
    useEffect(callback, deps) {
      const index = effectIndex++, previous = effects[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        previous?.cleanup?.();
        effects[index] = { callback, deps, pending: true };
      }
    },
  };
  const render = (readyValue = context.authReady) => {
    context.authReady = readyValue; refIndex = 0; effectIndex = 0;
    runInNewContext(actualIngress, context);
    for (const effect of effects) if (effect.pending) { effect.pending = false; effect.cleanup = effect.callback(); }
  };
  render();
  return {
    calls, render, reads: () => reads, subscriptions: () => subscriptions,
    warm: url => listener?.({ url }),
    async initial(url) { resolveInitial(url); await initial; await Promise.resolve(); },
    async reject() { rejectInitial(new Error('native unavailable')); await initial.catch(() => {}); await Promise.resolve(); },
    unmount() { for (const effect of effects) effect.cleanup?.(); },
    strictReplay() { for (const effect of effects) effect.cleanup?.(); for (const effect of effects) effect.cleanup = effect.callback(); },
  };
}

test('actual native News effects consume the launch URL once across auth revalidation', async () => {
  const f = fixture({ ready: true }); await f.initial('https://www.mshpit.com/news');
  assert.deepEqual(f.calls, [{ news: true }]);
  f.render(false); f.render(true); f.render(false); f.render(true);
  assert.equal(f.reads(), 1); assert.equal(f.subscriptions(), 1); assert.equal(f.calls.length, 1);
});
test('launch and warm News wait for readiness, delivering only the latest pending intent', async () => {
  const f = fixture(); await f.initial('mshpit://news');
  f.warm('mshpit://news/live/latest-story'); assert.equal(f.calls.length, 0);
  f.render(true); assert.deepEqual(f.calls, [{ news: true, liveSlug: 'latest-story' }]);
  f.render(false); f.warm('mshpit://news/live/second-story'); f.render(true);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].liveSlug, 'second-story');
});
test('a late launch URL cannot override a newer ready warm News intent', async () => {
  const f = fixture({ ready: true }); f.warm('mshpit://news/live/newer');
  await f.initial('mshpit://news/live/older'); assert.deepEqual(f.calls, [{ news: true, liveSlug: 'newer' }]);
});
test('a newer account or unrelated native intent supersedes pending launch News', async () => {
  for (const url of ['mshpit://reset-password?token=fixture', 'https://example.com/news']) {
    const f = fixture(); await f.initial('mshpit://news'); f.warm(url); f.render(true);
    assert.equal(f.calls.length, 0);
    const late = fixture({ ready: true }); late.warm(url); await late.initial('mshpit://news');
    assert.equal(late.calls.length, 0);
  }
});
test('effect replay retains one initial read and delivers after readiness', async () => {
  const f = fixture(); f.strictReplay(); await f.initial('mshpit://news'); f.render(true);
  assert.equal(f.reads(), 1); assert.deepEqual(f.calls, [{ news: true }]);
});
test('late native initial completion cannot navigate after unmount', async () => {
  const f = fixture({ ready: true }); f.unmount(); await f.initial('mshpit://news');
  f.warm('mshpit://news'); assert.equal(f.calls.length, 0);
});
test('web never subscribes or reads the native launch URL', async () => {
  const f = fixture({ web: true, ready: true }); await f.initial('mshpit://news');
  assert.equal(f.reads(), 0); assert.equal(f.subscriptions(), 0); assert.equal(f.calls.length, 0);
});
test('initial URL rejection leaves warm ingress usable', async () => {
  const f = fixture({ ready: true }); await f.reject(); f.warm('mshpit://news');
  assert.deepEqual(f.calls, [{ news: true }]);
});
