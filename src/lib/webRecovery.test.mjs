import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { captureWebAuthCheck, registerWebRecoveryDraft, requestWebRecovery, verifyDurableJson, freshAppUrl } from './webRecovery.mjs';
import { composerDraftFingerprint, normalizeComposerDraft } from '../domain/composerDraft.mjs';
import { upsertAccountDraft } from '../domain/draftPolicy.mjs';
import { emptyNewsroomForm, newsroomDraftEnvelope, newsroomDraftStorageKey, restoreNewsroomDraft } from '../domain/newsroomComposition.mjs';

function browserFixture({ storageMode = 'working', confirm = () => true } = {}) {
  const entries = new Map([['pit.session.synthetic', 'unchanged']]);
  let reloads = 0, dialogs = 0;
  const browser = { location: { href: 'https://fixture.invalid/discover?token=synthetic#secret', reload: () => reloads++ },
    confirm: message => { dialogs++; return confirm(message); },
    localStorage: {
      getItem: key => { if (storageMode === 'denied') throw Error('denied'); return entries.get(key) ?? null; },
      setItem: (key, value) => { if (storageMode === 'denied') throw Error('denied'); if (storageMode !== 'noop') entries.set(key, String(value)); },
      removeItem: key => entries.delete(key),
    } };
  return { browser, entries, reloads: () => reloads, dialogs: () => dialogs };
}
function withBrowser(f, run) {
  const previous = globalThis.window;
  globalThis.window = f.browser;
  try { return run(); } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
}
function register(flush, current = () => true, run) {
  const remove = registerWebRecoveryDraft(flush, current);
  try { return run(); } finally { remove(); }
}

test('no live source requires honest persisted-only confirmation; cancellation preserves the tab and all stored bytes', () => {
  const f = browserFixture({ confirm: warning => { assert.match(warning, /Only drafts already saved/); assert.match(warning, /selected files may be lost/); return false; } });
  const before = [...f.entries];
  assert.equal(requestWebRecovery({ browser: f.browser }).status, 'staying');
  assert.equal(f.reloads(), 0); assert.equal(f.dialogs(), 1); assert.deepEqual([...f.entries], before);
  assert.equal(freshAppUrl(f.browser), 'https://fixture.invalid/');
});
test('unmounted fatal boundary does not claim to flush former forms', () => {
  const f = browserFixture();
  register(() => assert.fail('an unmounted form must not be used'), () => true, () => {
    assert.equal(requestWebRecovery({ browser: f.browser, unmounted: true }).status, 'reloading');
    assert.equal(f.reloads(), 1);
  });
});
for (const storageMode of ['denied', 'noop']) test(storageMode + ' storage blocks even an explicitly requested recovery', () => {
  const f = browserFixture({ storageMode });
  assert.equal(requestWebRecovery({ browser: f.browser }).status, 'blocked');
  assert.equal(f.reloads(), 0); assert.equal(f.dialogs(), 0);
});
test('a known unsupported or throwing/async save never reaches confirmation or reload', () => {
  for (const flush of [() => ({ status: 'blocked' }), () => { throw Error('write'); }, () => Promise.resolve({ status: 'saved', verify: () => true })]) {
    const f = browserFixture();
    register(flush, () => true, () => {
      assert.equal(requestWebRecovery({ browser: f.browser }).status, 'blocked');
      assert.equal(f.reloads(), 0); assert.equal(f.dialogs(), 0);
    });
  }
});
test('durable receipt, source registration and identity are rechecked after confirmation', () => {
  for (const invalidate of ['storage', 'owner', 'unmount']) {
    let current = true, remove;
    const f = browserFixture({ confirm: () => { if (invalidate === 'storage') f.entries.delete('draft'); if (invalidate === 'owner') current = false; if (invalidate === 'unmount') remove(); return true; } });
    f.entries.set('draft', JSON.stringify({ ownerId: 'a', text: 'synthetic' }));
    remove = registerWebRecoveryDraft(() => ({ status: 'saved', verify: () => verifyDurableJson('draft', value => value?.ownerId === 'a' && value.text === 'synthetic', f.browser) }), () => current);
    try { assert.equal(requestWebRecovery({ browser: f.browser }).status, 'blocked'); assert.equal(f.reloads(), 0); }
    finally { remove(); }
  }
});

// Execute the real API epoch capture without its transport or any network call.
function identityFixture() {
  const source = readFileSync(new URL('./api.js', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module' });
  const declarations = ast.program.body.flatMap(node => {
    const d = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    return d && (['configureApiIdentity', 'captureApiIdentityCheck'].includes(d.id?.name)
      || d.type === 'VariableDeclaration' && d.declarations.some(item => item.id.name === 'apiIdentity')) ? source.slice(d.start, d.end) : [];
  }).join('\n');
  return new Function('identityWaiters', declarations + ';return {configureApiIdentity,captureApiIdentityCheck}')(new Set());
}
test('captured recovery ownership rejects A→B, A→guest→A and validation restarts before saving', () => {
  for (const transition of ['b', 'roundtrip', 'revalidate']) {
    const api = identityFixture(), f = browserFixture();
    api.configureApiIdentity('a');
    const check = api.captureApiIdentityCheck('a');
    register(() => assert.fail('stale callback cannot write'), check, () => {
      if (transition === 'b') api.configureApiIdentity('b');
      if (transition === 'roundtrip') { api.configureApiIdentity(null); api.configureApiIdentity('a'); }
      if (transition === 'revalidate') { api.configureApiIdentity('a', { ready: false }); api.configureApiIdentity('a'); }
      assert.equal(requestWebRecovery({ browser: f.browser }).status, 'blocked');
      assert.equal(f.reloads(), 0);
    });
  }
});

// Extract and execute the registered callback from the actual component AST.
// This checks its real dirty/busy/media and durable owner/fingerprint conditions.
function componentCallback(path, bindings) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let callback;
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee?.name === 'useWebRecoveryDraft') callback = node.arguments[1];
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
  };
  walk(ast); assert.ok(callback, 'actual component registers its draft');
  return new Function(...Object.keys(bindings), 'return (' + source.slice(callback.start, callback.end) + ')')(...Object.values(bindings));
}
function composer(f, overrides = {}) {
  const currentDraft = normalizeComposerDraft({ postType: 'status', review: 'Synthetic unsaved post' });
  const bindings = { session: { id: 'a' }, submitBusy: false, editing: false, effectiveComposerDirty: true,
    pendingMediaAssets: [], isDurableMediaUrl: value => /^https:\/\//.test(value || ''), effectiveHasContent: true,
    draftFingerprint: composerDraftFingerprint(currentDraft), currentDraft, composerDraftFingerprint, verifyDurableJson,
    persistDraftSnapshot: draft => { f.browser.localStorage.setItem('pit.drafts', JSON.stringify(upsertAccountDraft([], { ...draft, id: 'draft-a' }, 'a'))); return 'draft-a'; }, ...overrides };
  return componentCallback('../screens/LogScreen.jsx', bindings);
}
test('actual post callback flushes the latest supported draft and confirms durable owner/content before reload', () => {
  const f = browserFixture({ confirm: warning => { assert.match(warning, /Supported drafts were saved and checked/); return true; } });
  withBrowser(f, () => register(composer(f), () => true, () => {
    assert.equal(requestWebRecovery().status, 'reloading'); assert.equal(f.reloads(), 1);
    const saved = JSON.parse(f.entries.get('pit.drafts'))[0];
    assert.equal(saved.ownerId, 'a'); assert.equal(saved.review, 'Synthetic unsaved post');
  }));
});
test('actual post callback refuses in-memory fallback, wrong owner, truncated data, edit-only work and raw picker media', () => {
  const cases = [
    { persistDraftSnapshot: () => 'draft-a' },
    { editing: true }, { submitBusy: true },
    { pendingMediaAssets: [{ runtimeFile: {}, sourceUrl: 'blob:synthetic' }] },
    { pendingMediaAssets: [{ durableLocalUri: 'file:///temporary.jpg' }] },
  ];
  for (const overrides of cases) {
    const f = browserFixture();
    withBrowser(f, () => register(composer(f, overrides), () => true, () => {
      assert.equal(requestWebRecovery().status, 'blocked'); assert.equal(f.reloads(), 0);
    }));
  }
  for (const bad of [{ ownerId: 'b', review: 'Synthetic unsaved post' }, { ownerId: 'a', review: 'truncated' }]) {
    const f = browserFixture();
    withBrowser(f, () => register(composer(f, { persistDraftSnapshot: () => { f.entries.set('pit.drafts', JSON.stringify([{ ...bad, id: 'draft-a' }])); return 'draft-a'; } }), () => true,
      () => { assert.equal(requestWebRecovery().status, 'blocked'); assert.equal(f.reloads(), 0); }));
  }
});
test('actual newsroom callback preserves account envelope, blocks active operations and rejects lossy serialization', () => {
  for (const mode of ['saved', 'busy', 'fallback', 'oversize']) {
    const f = browserFixture();
    const form = { ...emptyNewsroomForm(), headline: mode === 'oversize' ? 'x'.repeat(301) : 'Synthetic draft', body: 'Recover this article' };
    const callback = componentCallback('../features/newsroom/SelfWrittenNewsComposer.jsx', { accountId: 'a', form, uploading: mode === 'busy', saving: false, busy: false, submission: { current: false }, hasContent: true, attempt: { current: null }, savedPayload: null,
      newsroomDraftStorageKey, newsroomDraftEnvelope, restoreNewsroomDraft, verifyDurableJson,
      saveLocal: (key, value) => { if (mode !== 'fallback') f.browser.localStorage.setItem(key, JSON.stringify(value)); } });
    withBrowser(f, () => register(callback, () => true, () => {
      assert.equal(requestWebRecovery().status, mode === 'saved' ? 'reloading' : 'blocked');
      assert.equal(f.reloads(), mode === 'saved' ? 1 : 0);
      if (mode === 'saved') assert.equal(restoreNewsroomDraft('a', JSON.parse(f.entries.get(newsroomDraftStorageKey('a')))).form.body, form.body);
    }));
  }
});
test('actual signup callback blocks unsaved profile changes without persisting credentials or form contents', () => {
  for (const state of [{ dirty: true, busy: false, active: { current: null } }, { dirty: false, busy: true, active: { current: null } }]) {
    const f = browserFixture();
    register(componentCallback('../screens/SignupOnboardingScreen.jsx', state), () => true, () => {
      assert.equal(requestWebRecovery({ browser: f.browser }).status, 'blocked'); assert.equal(f.reloads(), 0);
      assert.deepEqual([...f.entries], [['pit.session.synthetic', 'unchanged']]);
    });
  }
});


test('durable auth intent/epoch/cookie changes during confirmation block reload before storage events run', () => {
  for (const channel of ['intent', 'epoch', 'cookie']) {
    const f = browserFixture({ confirm: () => {
      if (channel === 'intent') f.entries.set('pit.auth.intent.v1', JSON.stringify({ revision: 'b', phase: 'signed-in' }));
      if (channel === 'epoch') f.entries.set('pit.auth.epoch.v1', JSON.stringify({ nonce: 'b' }));
      if (channel === 'cookie') f.browser.document.cookie = 'pit_auth_intent_v1=' + encodeURIComponent(JSON.stringify({ revision: 'b', phase: 'signed-in' }));
      return true;
    } });
    f.entries.set('pit.auth.intent.v1', JSON.stringify({ revision: 'a', phase: 'signed-in' }));
    f.entries.set('pit.auth.epoch.v1', JSON.stringify({ nonce: 'a' }));
    f.browser.document = { cookie: 'pit_auth_intent_v1=' + encodeURIComponent(JSON.stringify({ revision: 'a', phase: 'signed-in' })) };
    register(() => ({ status: 'saved', verify: () => true }), () => true, () => {
      assert.equal(requestWebRecovery({ browser: f.browser }).status, 'blocked');
      assert.equal(f.reloads(), 0); assert.equal(f.dialogs(), 1);
    });
  }
});
test('durable pending/sign-out intent blocks a still-mounted old account before its callback can write', () => {
  for (const phase of ['pending', 'signed-out']) {
    const f = browserFixture();
    f.entries.set('pit.auth.intent.v1', JSON.stringify({ revision: 'new', phase }));
    register(() => assert.fail('old form must not save'), () => true, () => {
      assert.equal(requestWebRecovery({ browser: f.browser }).status, 'blocked');
      assert.equal(f.reloads(), 0); assert.equal(f.dialogs(), 0);
    });
  }
});

function ownershipFixture(api) {
  const source = readFileSync(new URL('./webRecoveryOwnership.js', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module' });
  const body = ast.program.body.flatMap(node => {
    if (node.type === 'ImportDeclaration') return [];
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    return source.slice(declaration.start, declaration.end);
  }).join('\n');
  return new Function('captureApiIdentityCheck', 'captureWebAuthCheck', body + ';return captureWebRecoveryOwnership')(api.captureApiIdentityCheck, captureWebAuthCheck);
}

function hookFixture(api, platform = 'web') {
  const source = readFileSync(new URL('../hooks/useWebRecoveryDraft.js', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module' });
  const body = ast.program.body.flatMap(node => {
    if (node.type === 'ImportDeclaration') return [];
    const d = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    return source.slice(d.start, d.end);
  }).join('\n');
  let ref, previousDeps, pending, cleanup, registrations = 0, removals = 0;
  const bindings = {
    Platform: { OS: platform },
    useRef: value => ref || (ref = { current: value }),
    useLayoutEffect: (callback, deps) => { if (!previousDeps || previousDeps.some((value, index) => value !== deps[index])) { pending = callback; previousDeps = deps; } },
    captureWebRecoveryOwnership: ownershipFixture(api),
    registerWebRecoveryDraft: (...args) => { registrations++; const remove = registerWebRecoveryDraft(...args); return () => { removals++; remove(); }; },
  };
  const hook = new Function(...Object.keys(bindings), body + ';return useWebRecoveryDraft')(...Object.values(bindings));
  return {
    render(accountId, flush) { hook(accountId, flush); if (pending) { cleanup?.(); cleanup = pending(); pending = null; } },
    unmount() { cleanup?.(); cleanup = null; },
    counts: () => [registrations, removals],
  };
}
test('actual hook keeps the latest callback, cleans registration on account render/unmount, and stays inactive on native', () => {
  const f = browserFixture(), api = identityFixture(); api.configureApiIdentity('a');
  withBrowser(f, () => {
    const h = hookFixture(api); let saves = 0;
    h.render('a', () => assert.fail('superseded render callback'));
    h.render('a', () => { saves++; return { status: 'clean', verify: () => true }; });
    assert.deepEqual(h.counts(), [1, 0]);
    assert.equal(requestWebRecovery().status, 'reloading'); assert.equal(saves, 1);
    api.configureApiIdentity('b');
    assert.equal(requestWebRecovery().status, 'blocked'); assert.equal(saves, 1);
    h.render('b', () => { saves++; return { status: 'clean', verify: () => true }; });
    assert.deepEqual(h.counts(), [2, 1]);
    assert.equal(requestWebRecovery().status, 'reloading'); assert.equal(saves, 2);
    h.unmount(); assert.deepEqual(h.counts(), [2, 2]);
    requestWebRecovery(); assert.equal(saves, 2, 'removed callback cannot be reused');
    const native = hookFixture(api, 'android'); native.render('b', () => assert.fail('native recovery registry'));
    assert.deepEqual(native.counts(), [0, 0]); native.unmount();
  });
});
test('actual hook rejects account round trips, same-account revalidation and undelivered cross-tab auth changes', () => {
  for (const transition of ['roundtrip', 'revalidate', 'other-tab']) {
    const f = browserFixture(), api = identityFixture(); api.configureApiIdentity('a');
    withBrowser(f, () => {
      const h = hookFixture(api);
      try {
        h.render('a', () => assert.fail('obsolete draft callback'));
        if (transition === 'roundtrip') { api.configureApiIdentity(null); api.configureApiIdentity('a'); }
        if (transition === 'revalidate') { api.configureApiIdentity('a', { ready: false }); api.configureApiIdentity('a'); }
        if (transition === 'other-tab') f.entries.set('pit.auth.intent.v1', JSON.stringify({ revision: 'new-account', phase: 'signed-in' }));
        assert.equal(requestWebRecovery().status, 'blocked'); assert.equal(f.reloads(), 0);
      } finally { h.unmount(); }
    });
  }
});
