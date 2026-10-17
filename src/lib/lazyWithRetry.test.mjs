import assert from 'node:assert/strict';
import test from 'node:test';
import { lazyWithRetry, loadChunk, isChunkLoadError, confirmMissingDynamicChunk, dynamicChunkUrl } from './lazyWithRetry.js';
import WebChunkRecovery from './webChunkRecovery.js';
function harness() { let reloads = 0; const store = new Map(); return { reload: () => reloads++, reloadCount: () => reloads, delay: async () => {}, store, storage: { getItem: key => store.get(key), setItem: (key,value) => store.set(key,value), removeItem: key => store.delete(key) } }; }
test('successful imports and one transient retry return the module without navigation', async () => {
  for (const failures of [0, 1]) { const h = harness(); let attempts = 0;
    const result = await loadChunk(async () => { if (attempts++ < failures) throw Error('network'); return { default: 'Screen' }; }, h);
    assert.equal(result.default, 'Screen'); assert.equal(attempts, failures + 1); assert.equal(h.reloadCount(), 0);
  }
});
test('all recognized web chunk failures retain an in-place recovery view, with no automatic reload or storage access', async () => {
  const errors = [Object.assign(Error('missing'), { name: 'ChunkLoadError' }), Error('Loading chunk failed: 404'), Error('Requiring unknown module "624".'), Object.assign(Error('Loading module https://fixture.invalid/Old.js failed.'), { name: 'AsyncRequireError' }), Error('Failed to fetch dynamically imported module')];
  for (const error of errors) {
    const h = harness(); let attempts = 0;
    const options = { ...h, get storage() { assert.fail('no storage required to preserve the mounted tree'); }, probe: () => assert.fail('no network probe needed') };
    for (let repeat = 0; repeat < 2; repeat++) {
      const mod = await loadChunk(async () => { attempts++; throw error; }, options);
      assert.equal(mod.default().type, WebChunkRecovery); assert.equal(h.reloadCount(), 0);
    }
    assert.equal(attempts, 4);
  }
});
test('native/preload paths and ordinary generic network errors keep their rejection behavior', async () => {
  for (const error of [Error('render failed'), TypeError('Failed to fetch'), Error('Requiring unknown module "624" while saving.')]) {
    const h = harness(); await assert.rejects(loadChunk(async () => { throw error; }, h), value => value === error); assert.equal(h.reloadCount(), 0); assert.equal(isChunkLoadError(error), false);
  }
  await assert.rejects(loadChunk(async () => { throw Object.assign(Error('missing'), { name: 'AsyncRequireError' }); }, { reload: null, delay: async () => {} }), /missing/);
});
test('retained chunk URL diagnostic verification stays same-origin and recognizes HTML fallback', async () => {
 const error = Object.assign(Error('Loading module /_expo/static/js/web/Old.js failed. (error: /_expo/static/js/web/Old.js)'), { name: 'AsyncRequireError' });
 assert.equal(dynamicChunkUrl(error, 'https://fixture.invalid/feed'), 'https://fixture.invalid/_expo/static/js/web/Old.js');
 assert.equal(await confirmMissingDynamicChunk(error, { baseUrl: 'https://fixture.invalid/feed', probe: async () => ({ status: 200, contentType: 'text/html' }) }), true);
});
test("preloading a lazy screen shares one import with React's later render", async () => {
  let imports = 0;
  const Screen = lazyWithRetry(async () => {
    imports += 1;
    return { default: () => null };
  }, "Preloaded");

  const [first, second] = await Promise.all([Screen.preload(), Screen.preload()]);
  assert.equal(first, second);
  assert.equal(await resolveLazyScreen(Screen), first.default);
  assert.equal(imports, 1, "concurrent warmups must not request the chunk twice");
});

async function resolveLazyScreen(Screen) {
  try { return Screen._init(Screen._payload); }
  catch (suspended) {
    if (!suspended || typeof suspended.then !== "function") throw suspended;
    await suspended;
    return Screen._init(Screen._payload);
  }
}

test("optional warmup rejects; foreground navigation preserves the working page", async () => {
  const h = harness();
  const previousWindow = globalThis.window;
  globalThis.window = { sessionStorage: h.storage, location: { reload: h.reload } };
  try {
    const Screen = lazyWithRetry(async () => { throw new Error('Requiring unknown module "624".'); }, "WarmFailure");
    await assert.rejects(() => Screen.preload(), /unknown module/);
    assert.equal(h.reloadCount(), 0, "background work must never navigate away from the composer");
    assert.equal(h.store.size, 0, "warmup must not spend the later navigation recovery guard");

    const fallback = await resolveLazyScreen(Screen);
    assert.equal(h.reloadCount(), 0, "opening the failed screen preserves the working tree");
    assert.equal(fallback().type, WebChunkRecovery);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("navigation during a failed warmup retries as a foreground load", async () => {
  let rejectWarmup;
  let attempts = 0;
  const actual = () => null;
  const Screen = lazyWithRetry(() => {
    attempts += 1;
    if (attempts === 1) return new Promise((_resolve, reject) => { rejectWarmup = reject; });
    if (attempts === 2) return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve({ default: actual });
  }, "NavigateDuringWarmup");
  const warmup = Screen.preload();
  const rejected = assert.rejects(warmup, /Failed to fetch/);
  const navigation = resolveLazyScreen(Screen);
  rejectWarmup(new TypeError("Failed to fetch"));
  await rejected;
  assert.equal(await navigation, actual);
  assert.equal(attempts, 3, "render shares the warmup, then owns a fresh attempt after it fails");
});
