import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { connectNativeAccountLinks } from './nativeAccountLink.mjs';
import { nativeNewsLinkFrame } from './nativeNewsLink.mjs';

const token = 'synthetic_launch_token_123456789012345';
const accountLink = kind => `https://www.mshpit.com/#${kind}=${token}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = readFileSync(new URL('../../App.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  const nativeNewsNavigateRef = useRef(null);');
const end = source.indexOf('\n  useEffect(() => {\n    if (!web)', start);
assert.ok(start >= 0 && end > start, 'actual native News ingress is available');

function fixture(ready = true) {
  const listeners = new Set(), intents = [], invalidations = [];
  let resolveInitial;
  const initial = new Promise(resolve => { resolveInitial = resolve; });
  const linking = {
    getInitialURL: () => initial,
    addEventListener(type, callback) {
      assert.equal(type, 'url');
      listeners.add(callback);
      return { remove() { listeners.delete(callback); } };
    },
  };
  const inbox = connectNativeAccountLinks({ linking,
    onIntent: intent => intents.push(intent), onInvalidate: event => invalidations.push(event),
  });
  inbox.setIdentity(ready, null);
  return { linking, inbox, intents, invalidations,
    warm(url) { for (const listener of listeners) listener({ url }); },
    async initial(url) { resolveInitial(url); await tick(); },
  };
}

for (const kind of ['verify', 'reset']) test(`newer warm News cannot be covered by delayed launch ${kind}`, async () => {
  const f = fixture(), navigation = [], effects = [];
  runInNewContext(`(function () { ${source.slice(start, end)} })()`, {
    web: false, authReady: true, Linking: f.linking, nativeNewsLinkFrame,
    go: frame => navigation.push(JSON.parse(JSON.stringify(frame))),
    useRef: current => ({ current }), useEffect: effect => effects.push(effect),
  });
  const cleanups = effects.map(effect => effect());
  try {
    f.warm('mshpit://news/live/newer');
    await f.initial(accountLink(kind));
    assert.deepEqual(navigation, [{ news: true, liveSlug: 'newer' }]);
    assert.deepEqual(f.intents, [], 'the old launch capability must not open an overlay above News');
    assert.deepEqual(f.invalidations, [], 'an ignored launch link must not disturb the current flow');
  } finally {
    for (const cleanup of cleanups) cleanup?.();
    f.inbox.dispose();
  }
});

test('non-account warm intents suppress delayed launch while auth settles without retiring future explicit links', async () => {
  for (const url of ['mshpit://news', 'https://example.com/unrelated']) {
    const f = fixture(false);
    try {
      f.warm(url);
      await f.initial(accountLink('reset'));
      f.inbox.setIdentity(true, null);
      assert.deepEqual(f.intents, [], 'auth readiness must not replay the superseded launch link');
      f.warm(accountLink('reset'));
      assert.equal(f.intents.length, 1, 'a new explicit account intent remains usable');
      const invalidations = f.invalidations.length;
      f.warm(accountLink('reset'));
      assert.equal(f.intents.length, 1);
      assert.equal(f.invalidations.length, invalidations, 'duplicate delivery must not replace the current form');
      f.inbox.close();
      f.warm(accountLink('reset'));
      assert.equal(f.intents.length, 1, 'closing still prevents duplicate delivery from reopening the form');
    } finally {
      f.inbox.dispose();
    }
  }
});

test('newer warm News discards an account launch already buffered for readiness', async () => {
  const f = fixture(false);
  try {
    await f.initial(accountLink('reset'));
    assert.deepEqual(f.intents, []);
    f.warm('mshpit://news/live/newer');
    f.inbox.setIdentity(true, null);
    assert.deepEqual(f.intents, [], 'the buffered launch capability must not open after the newer route');
    f.warm(accountLink('reset'));
    assert.equal(f.intents.length, 1, 'a superseded but undelivered token can be opened by a new explicit gesture');
    f.warm(accountLink('reset'));
    assert.equal(f.intents.length, 1, 'ordinary duplicate delivery is still ignored');
  } finally {
    f.inbox.dispose();
  }
});

test('an unrelated warm URL preserves an account form already delivered to the user', async () => {
  const f = fixture();
  try {
    await f.initial(accountLink('reset'));
    const invalidations = f.invalidations.length;
    f.warm('mshpit://news/live/newer');
    assert.equal(f.intents.length, 1);
    assert.equal(f.invalidations.length, invalidations, 'this ingress fix must not cancel an active sensitive form');
    f.inbox.setIdentity(false, null);
    f.inbox.setIdentity(true, null);
    assert.equal(f.intents.length, 1, 'the delivered form must not be republished on readiness');
  } finally {
    f.inbox.dispose();
  }
});
