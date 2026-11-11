import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import { createNativeStartupLinks } from './nativeStartupLinks.mjs';
import { connectNativeAccountLinks } from '../domain/nativeAccountLink.mjs';
import { nativeNewsLinkFrame } from '../domain/nativeNewsLink.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const accountURL = kind => `https://www.mshpit.com/#${kind}=synthetic_startup_token_123456789012345`;
const newsURL = 'mshpit://news/live/newer-story';
const app = readFileSync(new URL('../../App.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const newsStart = app.indexOf('  const nativeNewsNavigateRef = useRef(null);');
const newsEnd = app.indexOf('\n  useEffect(() => {\n    if (!web)', newsStart);
assert.ok(newsStart >= 0 && newsEnd > newsStart);
const appearance = readFileSync(new URL('../AppearanceApp.jsx', import.meta.url), 'utf8');
const bootStatements = parse(appearance, { sourceType: 'module', plugins: ['jsx'] }).program.body.filter(node =>
  (node.type === 'ExpressionStatement' && node.expression.callee?.name === 'startNativeStartupLinkCapture')
  || (node.type === 'VariableDeclaration' && node.declarations.some(item => item.id.name === 'application'))
  || (node.type === 'FunctionDeclaration' && node.id.name === 'loadApplication'));
assert.equal(bootStatements.length, 3, 'actual boot starts capture before deferred App evaluation');
const bootSource = bootStatements.map(node => appearance.slice(node.start, node.end)).join('\n');

function fixture() {
  const initial = deferred(), authority = deferred();
  const listeners = new Set(), calls = { initial: 0, removed: 0, app: 0 };
  const linking = {
    getInitialURL() { calls.initial++; return initial.promise; },
    addEventListener(type, listener) {
      assert.equal(type, 'url'); listeners.add(listener);
      return { remove() { if (listeners.delete(listener)) calls.removed++; } };
    },
  };
  const methods = { ...linking };
  let startup;
  const load = runInNewContext(`(function () { ${bootSource}; return loadApplication; })()`, {
    startNativeStartupLinkCapture: () => { startup ||= createNativeStartupLinks(linking); },
    prepareSavedTheme: () => authority.promise,
    require: path => { assert.equal(path, '../App'); calls.app++; return { default: 'Application' }; },
  });
  const startupLinkingFor = (name, owner) => startup.forConsumer(name, owner);
  const navigation = [], intents = [], invalidations = [], cleanups = [];
  const mountNews = () => {
    const effects = [];
    runInNewContext(`(function () { ${app.slice(newsStart, newsEnd)} })()`, {
      web: false, authReady: true, startupLinkingFor, nativeNewsLinkFrame,
      go: frame => navigation.push(JSON.parse(JSON.stringify(frame))),
      useRef: current => ({ current }), useEffect: effect => effects.push(effect),
    });
    let releases = effects.map(effect => effect()).filter(Boolean);
    cleanups.push(() => releases.forEach(release => release()));
    return { replay() {
      releases.forEach(release => release());
      releases = effects.map(effect => effect()).filter(Boolean);
    } };
  };
  const mountAccount = () => {
    const inbox = connectNativeAccountLinks({ linking: startupLinkingFor('account'),
      onIntent: intent => intents.push(intent), onInvalidate: event => invalidations.push(event),
    });
    inbox.setIdentity(true, null);
    cleanups.push(() => inbox.dispose());
    return inbox;
  };
  return { load, authority, initial, calls, listeners, linking, methods, startupLinkingFor,
    navigation, intents, invalidations, mountNews, mountAccount,
    warm: url => { for (const listener of [...listeners]) listener({ url }); },
    unmount: () => { for (const cleanup of cleanups.splice(0)) cleanup(); },
  };
}

for (const warm of [accountURL('reset'), newsURL, 'https://example.com/unrelated', 'x'.repeat(4097), null]) {
  test(`delayed actual AppearanceApp keeps newest ${warm === newsURL ? 'News' : warm === null ? 'malformed' : warm.length > 4096 ? 'oversized' : warm.includes('#reset') ? 'account' : 'unrelated'} URL above launch`, async () => {
    const f = fixture(), loading = f.load();
    assert.equal(f.listeners.size, 1);
    assert.equal(f.calls.app, 0);
    f.warm(accountURL('verify'));
    f.warm(warm);
    f.initial.resolve(accountURL('verify'));
    f.authority.resolve(); await loading;
    assert.equal(f.calls.app, 1);
    f.mountNews(); f.mountAccount(); await tick();
    assert.deepEqual(f.navigation, warm === newsURL ? [{ news: true, liveSlug: 'newer-story' }] : []);
    assert.equal(f.intents.length, warm === accountURL('reset') ? 1 : 0);
    if (f.intents.length) assert.equal(f.intents[0].kind, 'reset');
    assert.equal(f.calls.initial, 0, 'a warm startup event suppresses the original platform launch read');
    assert.equal(f.calls.removed, 1, 'startup capture ends after both ingress consumers take the handoff');
    assert.equal(f.listeners.size, 2, 'only existing live ingress listeners remain');
    assert.equal(f.linking.getInitialURL, f.methods.getInitialURL);
    assert.equal(f.linking.addEventListener, f.methods.addEventListener);
    f.unmount(); assert.equal(f.listeners.size, 0);
  });
}

test('late original platform result cannot overwrite a warm URL between consumer mounts', async () => {
  const f = fixture(); f.authority.resolve(); await f.load();
  f.mountNews();
  assert.equal(f.calls.initial, 1);
  f.warm(accountURL('reset'));
  f.mountAccount(); await tick();
  f.initial.resolve(newsURL); await tick();
  assert.equal(f.intents.length, 1); assert.equal(f.intents[0].kind, 'reset');
  assert.deepEqual(f.navigation, []);
  assert.equal(f.calls.removed, 1); f.unmount();
});

test('unchanged cold launch reaches both existing parsers, and remount never replays its capability', async () => {
  const f = fixture(); f.authority.resolve(); await f.load();
  f.mountNews(); f.mountAccount();
  f.initial.resolve(accountURL('verify')); await tick();
  assert.equal(f.intents.length, 1); assert.equal(f.intents[0].kind, 'verify');
  assert.deepEqual(f.navigation, []); assert.equal(f.calls.initial, 2);
  f.unmount(); f.mountNews(); f.mountAccount(); await tick();
  assert.equal(f.intents.length, 1); assert.equal(f.calls.initial, 2);
  f.warm(accountURL('reset')); await tick();
  assert.equal(f.intents.length, 2, 'a later explicit warm intent still works');
  f.unmount();
});

for (const readStarted of [false, true]) test(`account effect replay ${readStarted ? 'during platform read' : 'before queued read'} retains one cold capability`, async () => {
  const f = fixture(); f.authority.resolve(); await f.load();
  f.mountNews();
  const discarded = f.mountAccount();
  if (readStarted) await tick();
  discarded.dispose(); f.mountAccount(); await tick();
  assert.equal(f.calls.removed, 1, 'only the discarded account listener is removed before handoff settles');
  f.initial.resolve(accountURL('reset')); await tick();
  assert.equal(f.intents.length, 1); assert.equal(f.intents[0].kind, 'reset');
  assert.equal(f.listeners.size, 2, 'capture ends only after the live replacement claims its handoff');
  f.unmount(); assert.equal(f.listeners.size, 0);
});

test('News effect replay retains its existing pending initial read and latest startup URL', async () => {
  const f = fixture(); f.authority.resolve(); await f.load();
  const news = f.mountNews(); f.mountAccount(); await tick();
  const reads = f.calls.initial;
  news.replay();
  f.warm(newsURL);
  f.initial.resolve(accountURL('verify')); await tick();
  assert.equal(f.calls.initial, reads, 'News does not duplicate the initial read on effect replay');
  assert.deepEqual(f.navigation, [{ news: true, liveSlug: 'newer-story' }]);
  assert.deepEqual(f.intents, []);
  f.unmount();
});

test('a replacement Root receives pending launch News before the old root can consume its handoff', async () => {
  const f = fixture(); f.authority.resolve(); await f.load();
  f.mountNews(); f.mountAccount(); await tick();
  f.unmount();
  f.mountNews(); f.mountAccount(); await tick();
  f.initial.resolve(newsURL); await tick();
  assert.deepEqual(f.navigation, [{ news: true, liveSlug: 'newer-story' }]);
  assert.deepEqual(f.intents, []);
  assert.equal(f.listeners.size, 2, 'only the replacement live handlers remain');
  f.unmount(); assert.equal(f.listeners.size, 0);
});

test('web startup adapter adds no native subscription or initial read', async () => {
  const web = await import('./nativeStartupLinks.js');
  assert.equal(web.startNativeStartupLinkCapture(), undefined);
  assert.equal(web.startupLinkingFor('news'), null);
});
