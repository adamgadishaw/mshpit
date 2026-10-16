import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import { navigationFrameForAccount } from './memberAccess.mjs';
import { nativeNewsLinkFrame } from './nativeNewsLink.mjs';

const source = readFileSync(new URL('../../App.js', import.meta.url), 'utf8');
const functions = {};
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && ['commitGo', 'finishAuthentication'].includes(node.id?.name)) {
    functions[node.id.name] = source.slice(node.init.start, node.init.end);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(parse(source, { sourceType: 'module', plugins: ['jsx'] }));
function fixture(initial = [{}, { auth: true }], web = false) {
  const stackRef = { current: initial }, writes = [];
  const navigationRef = { current: { stack: initial, tab: 'discover', landing: false, accountId: null } };
  const context = {
    web, session: null, Platform: { OS: web ? 'web' : 'android' },
    navigationFrameForAccount, prepareAvailableNavigationFrame: frame => frame,
    stackRef, navigationRef, pathForFrame: () => null, MAIN_TAB_PATHS: { feed: '/feed' },
    writeNavigation(next, path, mode) { writes.push({ path, mode }); navigationRef.current = next; stackRef.current = next.stack; },
    back() { stackRef.current = stackRef.current.slice(0, -1); navigationRef.current.stack = stackRef.current; },
  };
  return {
    open: runInNewContext('(' + functions.commitGo + ')', context),
    finish: runInNewContext('(' + functions.finishAuthentication + ')', context),
    stack: () => JSON.parse(JSON.stringify(stackRef.current)), writes,
  };
}
test('a native News link updates an already open sign-in and resumes after confirmed login', () => {
  const f = fixture([{}, { auth: true, authMode: 'login', authFromLanding: true }]);
  f.open(nativeNewsLinkFrame('mshpit://news/live/current'));
  assert.deepEqual(f.stack(), [{}, { auth: true, authMode: 'login', authFromLanding: true, authReturn: { news: true, liveSlug: 'current' } }]);
  assert.equal(f.writes[0].mode, 'replace');
  f.finish('login', { accountId: 'synthetic-member' });
  assert.deepEqual(f.stack(), [{}, { news: true, liveSlug: 'current' }]);
});
test('successive native News links retain one sign-in screen and the newest bounded destination', () => {
  const f = fixture([{}]);
  for (const slug of ['first', 'second', 'latest']) f.open(nativeNewsLinkFrame('mshpit://news/live/' + slug));
  assert.equal(f.stack().length, 2);
  f.finish('login', { accountId: 'synthetic-member' });
  assert.deepEqual(f.stack(), [{}, { news: true, liveSlug: 'latest' }]);
});
test('a generic News link replaces an older story while ordinary auth requests preserve it', () => {
  const f = fixture();
  f.open({ news: true, liveSlug: 'old' }); f.open({ news: true }); f.open({ auth: true });
  assert.deepEqual(f.stack().at(-1).authReturn, { news: true });
  f.finish('login', { accountId: 'synthetic-member' });
  assert.deepEqual(f.stack().at(-1), { news: true });
});
test('mutation payloads and invalid News slugs are not replayed after sign-in', () => {
  const f = fixture();
  f.open({ news: true, liveSlug: '../settings', logging: true });
  f.finish('login', { accountId: 'synthetic-member' });
  assert.deepEqual(f.stack(), [{}, { news: true }]);
});
test('web duplicate sign-in retains its existing behavior', () => {
  const f = fixture([{}, { auth: true }], true);
  f.open({ auth: true, authReturn: { news: true } });
  assert.deepEqual(f.stack(), [{}, { auth: true }]); assert.equal(f.writes.length, 0);
});
