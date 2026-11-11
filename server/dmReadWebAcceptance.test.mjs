// Website companion acceptance against the actual b535ba4 backend.
// Actual Store callbacks, server routes, ThreadScreen and visibility/scroll hooks.
// No network, production data, native builds, or release-worktree mutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';
import { parse } from '@babel/parser';
import { createAccountReadCoordinator } from '../src/domain/accountReadCoordinator.mjs';
import { accountMutationIsCurrent, captureAccountMutation } from '../src/domain/accountMutation.mjs';
import { chatOutboxFor } from '../src/domain/chatDelivery.mjs';
import { mergeChatMessages, reconcileRemovedDirectMessages } from '../src/domain/chatMessages.mjs';
import { directMessageUnreadCount, mergeDirectMessageReadSummary, normalizeDirectMessageReadCursor } from '../src/domain/directMessageRead.mjs';
import { normalizeMessageRelationshipContext } from '../src/domain/messageRelationshipContext.mjs';


assert.equal(process.env.NODE_ENV, 'test');
assert.match(process.env.PIT_DATA_DIR || '', /pit-tests-/);
const { db, q } = await import('./db.js');
const { routes } = await import('./api.js');
after(() => { db.close(); });

const source = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const provider = ast.program.body.find(n => n.declaration?.id?.name === 'StoreProvider').declaration;
const declarations = provider.body.body.flatMap(n => n.type === 'VariableDeclaration' ? n.declarations : []);
const names = ['dmKey', 'loadInboxThreads', 'loadThread', 'threadMessages', 'markThreadRead', 'inboxThreads', 'mainThreads', 'requestThreads', 'inboxUnread'];
const callbacks = names.map(name => {
  const node = declarations.find(n => n.id?.name === name); assert.ok(node, name);
  return `const ${source.slice(node.start, node.end)};`;
}).join('\n');
let hydrationNode;
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'CallExpression' && node.callee?.property?.name === 'then'
    && node.callee.object?.callee?.name === 'fetchDirectMessageSummaries') hydrationNode = node.arguments[0];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(ast); assert.ok(hydrationNode);
const hydrationCallback = source.slice(hydrationNode.start, hydrationNode.end);
const insertDm = db.prepare('INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)');
const insertNotif = db.prepare('INSERT INTO notifications (id,user_id,actor_id,type,post_id,text,created_at) VALUES (?,?,?,?,?,?,?)');
function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, 'test-hash', 'fan', 'Toronto', 43.65, -79.38, id.slice(0, 2), '#123456', Date.now());
  return q.userById.get(id);
}
function pair(prefix) {
  const viewer = addUser(`${prefix}v`), peer = addUser(`${prefix}p`);
  db.prepare("INSERT INTO dm_acceptances VALUES(?,?,?,'explicit')").run(viewer.id, peer.id, 1);
  let serial = 0;
  function incoming(n = 1) {
    const rows = [];
    db.exec("BEGIN");
    try {
      for (let i = 0; i < n; i++) {
        const index = ++serial, id = `${prefix}-${String(index).padStart(5, '0')}`, at = 100000 + index;
        insertDm.run(id, peer.id, viewer.id, `Synthetic incoming ${index}`, at);
        insertNotif.run(`n-${id}`, viewer.id, peer.id, 'dm', id, 'Synthetic notification', at);
        rows.push({ id, at });
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return rows;
  }
  function outgoing() {
    const id = `${prefix}-out-${++serial}`;
    insertDm.run(id, viewer.id, peer.id, 'Synthetic outgoing preview', 100000 + serial);
    return id;
  }
  return { viewer, peer, incoming, outgoing };
}
function client(p) {
  const { viewer, peer } = p;
  const state = { dms: {}, dmRead: {}, users: [], outbox: [], blocked: [] };
  const sessionRef = { current: viewer }, chatReadsRef = { current: createAccountReadCoordinator() };
  const chatOutboxRef = { current: state.outbox }, chatAuthEpochRef = { current: 1 }, accountMutationEpochRef = { current: 1 };
  const notificationActivity = { data: { inboxUnread: 0 } }, writes = [];
  let beforeWrite = null, rejectWrite = false;
  const summary = () => routes['GET /api/me/threads']({ user: viewer, query: { summary: '1' } });
  const refreshCounts = () => { notificationActivity.data = routes['GET /api/me/notifications']({ user: viewer }); };
  const setter = key => update => { state[key] = typeof update === 'function' ? update(state[key]) : update; };
  const api = async path => {
    const url = new URL(path, 'http://fixture.invalid');
    const query = Object.fromEntries(url.searchParams);
    if (url.pathname === '/api/me/threads') return routes['GET /api/me/threads']({ user: viewer, query });
    const match = url.pathname.match(/^\/api\/dms\/([^/]+)$/);
    assert.ok(match, `unexpected fixture route ${path}`);
    return routes['GET /api/dms/:otherId']({ user: viewer, params: { otherId: decodeURIComponent(match[1]) }, query });
  };
  function dependencies() {
    return {
      session: viewer, sessionRef, chatReadsRef, chatOutboxRef, chatAuthEpochRef, accountMutationEpochRef,
      blockedIdsRef: { get current() { return state.blocked; } },
      dms: state.dms, dmRead: state.dmRead, chatOutbox: state.outbox, blockedIds: state.blocked,
      ENABLE_DEMO_DATA: false, mergeChatMessages, reconcileRemovedDirectMessages, chatOutboxFor,
      normalizeMessageRelationshipContext,
      directMessageUnreadCount, mergeDirectMessageReadSummary, normalizeDirectMessageReadCursor,
      captureAccountMutation, accountMutationIsCurrent, notificationActivity,
      setDms: setter('dms'), setDmRead: setter('dmRead'), setUsers: setter('users'),
      absorbUsers() {}, publicProfileCacheEntry: user => user, ago: String,
      api, currentMutationActor: () => viewer, isFollowing: () => false, userById: id => q.userById.get(id),
      async writeDirectMessageRead(...args) {
        writes.push({ args, cachedLatest: actions().threadMessages(peer.id).at(-1)?.id });
        if (rejectWrite) throw new Error('Synthetic offline write');
        if (beforeWrite) { const callback = beforeWrite; beforeWrite = null; callback(); }
        const response = routes['POST /api/dms/:otherId/read-through']({ user: viewer, params: { otherId: args[0] }, body: { messageId: args[1].messageId } });
        writes.at(-1).response = response;
        return response;
      },
      setNotifications(rows, options) { if (options?.refreshSummary) refreshCounts(); },
      reconcileConfirmedNotificationReads: rows => rows,
      commandSuccess: result => ({ ok: true, ...result }), commandError: error => ({ ok: false, error: error.message }),
      localCommandError: code => ({ ok: false, code }),
    };
  }
  function actions() {
    const deps = dependencies();
    return new Function(...Object.keys(deps), `${callbacks}\nreturn {${names.join(',')}};`)(...Object.values(deps));
  }
  function hydrate() {
    const deps = { ...dependencies(), su: viewer, dmKey: (a, b) => [a, b].sort().join('__'), dmHydrationRead: chatReadsRef.current.claim('dm-inbox', viewer) };
    new Function(...Object.keys(deps), `return (${hydrationCallback});`)(...Object.values(deps))(summary());
    refreshCounts();
  }
  function snapshot(label) {
    refreshCounts();
    const row = actions().inboxThreads().find(t => t.otherId === peer.id);
    const server = summary().threads.find(t => t.otherId === peer.id);
    return { label, serverUnread: server?.unread, rowUnread: row?.unread, globalUnread: actions().inboxUnread(), cached: row?.count, cursor: server?.readCursor };
  }
  return { p, state, writes, actions, hydrate, snapshot, summary, refreshCounts,
    beforeWrite: callback => { beforeWrite = callback; }, failWrites: value => { rejectWrite = value; } };
}

// Reuse the repository's tested React host harness; native layout is represented
// by explicit geometry. Execute the actual ThreadScreen and actual website scroll hook.
const require = createRequire(import.meta.url), React = require('react'), reconciler = require('react-reconciler');
const { transformSync } = require('@babel/core');
const noop = () => {}, codes = new Map();
const rendererSource = readFileSync(new URL('../src/screens/threadWebVisibleRead.test.mjs', import.meta.url), 'utf8');
const rendererAst = parse(rendererSource, { sourceType: 'module' });
const rendererNode = rendererAst.program.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'createRenderer');
const rendererFactory = rendererSource.slice(rendererNode.start, rendererNode.end).replace('scrollToEnd() {},', 'scrollToEnd(options) { scrolls.push(options); },').replace('measureInWindow(callback) { measurements.push({ node: this, callback }); }', 'measureInWindow(callback) { if (this.bounds) callback(...this.bounds); }');
assert.ok(rendererFactory.includes('scrolls.push(options)'));
function execute(path, imports) {
  const file = new URL(path, import.meta.url);
  if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, 'utf8'), {
    filename: file.pathname, babelrc: false, configFile: false,
    plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')],
  }).code);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'document', 'window', codes.get(path))(name => imports(name, createRequire(file)), module, module.exports, { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }, { addEventListener() {}, removeEventListener() {} });
  return module.exports.default;
}
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
function screen(c) {
  const pending = [], scrolls = [], listeners = new Set();
  const AppState = { currentState: "active", addEventListener: (_, callback) => { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } };
  const renderer = new Function('React', 'reconciler', 'noop', 'scrolls', `${rendererFactory}; return createRenderer([]);`)(React, reconciler, noop, scrolls);
  const native = {
    ...Object.fromEntries(['View', 'Text', 'TextInput', 'Pressable', 'ScrollView', 'ActivityIndicator', 'KeyboardAvoidingView'].map(name => [name, name])),
    Platform: { OS: 'web' }, AppState, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
  };
  let refreshTask;
  const imports = (name, local) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return native;
    if (name === '../theme') return { colors: {}, radius: {}, mono: 'mono' };
    if (name === '../store') return { useStore: () => ({
      session: c.p.viewer, chatAuthEpoch: 1, userById: id => q.userById.get(id),
      ...c.actions(), markThreadRead: (...args) => { const promise = c.actions().markThreadRead(...args); pending.push(promise); return promise; },
      loadUser: async () => ({}), getDMRequestState: () => 'accepted', sendDM: noop, retryChatMessage: noop, cancelChatMessage: noop,
    }) };
    if (name === '../hooks/useScopedRefresh') return ({ task }) => { refreshTask = task; return { refreshing: false, refresh: () => task({}) }; };
    if (name === '../hooks/useVisibleDirectMessageRead') return visibleHook;
    if (name === '../hooks/useIOSThreadRefreshAnnouncement') return () => ({ begin: noop, finish: noop });
    if (name === '../hooks/useIOSThreadControls') return () => () => true;
    if (name === '../lib/useLiveChat') return noop;
    if (name === '../lib/useChatScroll') return scrollHook;
    if (name === '../hooks/useReducedMotion') return () => true;
    if (name.startsWith('../components/')) return name.split('/').at(-1);
    return local(name);
  };
  const scrollHook = execute('../src/lib/useChatScroll.js', imports);
  const visibleHook = execute('../src/hooks/useVisibleDirectMessageRead.js', imports);
  const Thread = execute('../src/screens/ThreadScreen.jsx', imports);
  const f = {
    scrolls,
    render: () => renderer.render(React.createElement(Thread, { otherId: c.p.peer.id, onClose: noop })),
    close: () => renderer.render(null),
    scroll: () => { const node = nodes(renderer.container).find(n => n.type === 'ScrollView'); assert.ok(node); return node; },
    act: callback => renderer.act(callback),
    async settle() { for (let i = 0; i < 6; i++) { await new Promise(resolve => setTimeout(resolve, 0)); await Promise.all(pending); renderer.act(noop); } },
    async refresh() { await refreshTask({}); f.render(); await f.settle(); },
    layout(offset, { drag = false, emitScroll = true } = {}) {
      const scroll = f.scroll(); scroll.bounds = [0, 100, 390, 400];
      const rows = nodes(renderer.container).filter(n => n.type === 'View' && n.props.collapsable === false && typeof n.props.onLayout === 'function');
      assert.equal(rows.length, c.actions().threadMessages(c.p.peer.id).length);
      f.act(() => {
        scroll.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 400 } } });
        rows.forEach((row, i) => {
          const y = 100 + i * 60; row.bounds = [0, 100 + y - offset, 390, 60];
          row.props.onLayout({ nativeEvent: { layout: { x: 0, y, width: 390, height: 60 } } });
        });
        scroll.props.onContentSizeChange(390, 100 + rows.length * 60);
        const event = { nativeEvent: { contentOffset: { x: 0, y: offset }, contentSize: { width: 390, height: 100 + rows.length * 60 }, layoutMeasurement: { width: 390, height: 400 } } };
        if (drag) scroll.props.onScrollBeginDrag?.(event);
        if (emitScroll) scroll.props.onScroll(event);
      });
    },
    background() { AppState.currentState = 'background'; f.act(() => { for (const cb of listeners) cb('background'); }); },
    foreground() { AppState.currentState = 'active'; f.act(() => { for (const cb of listeners) cb('active'); }); },
  };
  f.render(); return f;
}


test('1,200 unread remains exact through cold startup, partial head load, another cold start and outgoing preview', async () => {
  const p = pair('count'); p.incoming(1200);
  const c = client(p); c.hydrate();
  const cold = c.snapshot('cold startup');
  assert.deepEqual([cold.serverUnread, cold.rowUnread, cold.globalUnread, cold.cached], [1200, 1200, 1200, 1]);
  const page = await c.actions().loadThread(p.peer.id, { includeContext: false, strict: true });
  assert.equal(c.actions().threadMessages(p.peer.id).length, 500);
  const head = c.snapshot('partial head');
  assert.deepEqual([head.serverUnread, head.rowUnread, head.globalUnread, head.cached], [1200, 1200, 1200, 500]);
  p.outgoing(); const fresh = client(p); fresh.hydrate();
  const restarted = fresh.snapshot('cold with outgoing latest');
  assert.deepEqual([restarted.serverUnread, restarted.rowUnread, restarted.globalUnread, restarted.cached], [1200, 1200, 1200, 1]);
});

test('opening does not write before measured visibility; confirmed read survives cold start', async t => {
  const p = pair('open'); const all = p.incoming(1200);
  const c = client(p); c.hydrate();
  const f = screen(c); t.after(f.close); await f.settle();
  assert.equal(c.writes.length, 0);
  assert.equal(c.snapshot('before viewport evidence').rowUnread, 1200);
  // A short preview-only thread can be proven visible without a scroll event.
  f.layout(0, { emitScroll: false }); await f.settle();
  assert.equal(c.writes.length, 1);
  assert.equal(c.writes[0].args[1].messageId, all.at(-1).id);
  assert.equal(c.snapshot('visible preview confirmed').serverUnread, 0);
  f.close(); const fresh = client(p); fresh.hydrate();
  const restarted = fresh.snapshot('fresh client');
  assert.deepEqual([restarted.serverUnread, restarted.rowUnread, restarted.globalUnread], [0, 0, 0]);
  p.incoming(); const later = client(p); later.hydrate();
  assert.equal(later.snapshot('later arrival').rowUnread, 1);
});

test('new offscreen arrivals stay unread through render, older-history scrolling and a cold client', async t => {
  const p = pair('offscreen'); p.incoming(1200);
  const c = client(p); c.hydrate();
  const first = await c.actions().loadThread(p.peer.id, { includeContext: false, strict: true });
  const f = screen(c); t.after(f.close); await f.settle();
  assert.equal(c.writes.length, 0);
  f.layout(29700); await f.settle();
  assert.equal(c.writes.length, 1); assert.equal(c.snapshot('initial bottom').serverUnread, 0);
  f.layout(400, { drag: true }); await f.settle(); f.scrolls.length = 0;
  p.incoming(3);
  await c.actions().loadThread(p.peer.id, { after: first.syncCursor, includeContext: false, strict: true });
  f.render(); f.layout(400); await f.settle();
  assert.equal(f.scrolls.length, 0, 'Actual website scroll hook does not auto-scroll reader in older history');
  assert.equal(c.writes.length, 1, 'New rows below the viewport earn no receipt');
  const stayed = c.snapshot('still reading older history');
  assert.deepEqual([stayed.serverUnread, stayed.rowUnread, stayed.globalUnread], [3, 3, 3]);
  const fresh = client(p); fresh.hydrate();
  const restarted = fresh.snapshot('fresh client before opening');
  assert.deepEqual([restarted.serverUnread, restarted.rowUnread, restarted.globalUnread], [3, 3, 3]);
  f.layout(29880); await f.settle();
  assert.equal(c.writes.length, 2);
  assert.equal(c.snapshot('newest now actually visible').serverUnread, 0);
});

test('server-only arrival between measured target and POST remains unread and notified after restart', async t => {
  const p = pair('race'); const all = p.incoming(1200);
  const c = client(p); c.hydrate(); await c.actions().loadThread(p.peer.id, { includeContext: false, strict: true });
  let serverOnly; c.beforeWrite(() => { serverOnly = p.incoming()[0]; });
  const f = screen(c); t.after(f.close); await f.settle();
  f.layout(29700); await f.settle();
  const write = c.writes[0];
  assert.equal(write.args[1].messageId, all.at(-1).id);
  assert.equal(write.response.readCursor.id, all.at(-1).id);
  assert.equal(c.actions().threadMessages(p.peer.id).some(m => m.id === serverOnly.id), false);
  assert.equal(db.prepare('SELECT read FROM notifications WHERE id=?').get(`n-${serverOnly.id}`).read, 0);
  const unread = c.snapshot('after receipt');
  assert.deepEqual([unread.serverUnread, unread.rowUnread, unread.globalUnread], [1, 1, 1]);
  f.close(); const fresh = client(p); fresh.hydrate();
  assert.equal(fresh.snapshot('fresh client').rowUnread, 1);
});

test('successful refresh retries the unchanged observed target after failure without reopening', async t => {
  const p = pair('retry'); p.incoming(40);
  const c = client(p); c.hydrate(); await c.actions().loadThread(p.peer.id, { includeContext: false, strict: true });
  c.failWrites(true); const f = screen(c); t.after(f.close); await f.settle();
  f.layout(2100); await f.settle();
  assert.equal(c.writes.length, 1);
  const failed = c.snapshot('read failed');
  assert.deepEqual([failed.serverUnread, failed.rowUnread, failed.globalUnread], [40, 40, 40]);
  c.failWrites(false); await f.refresh();
  assert.equal(c.writes.length, 2);
  assert.equal(c.writes[1].args[1].messageId, c.writes[0].args[1].messageId);
  const recovered = c.snapshot('recovery on same mounted screen');
  assert.deepEqual([recovered.serverUnread, recovered.rowUnread, recovered.globalUnread], [0, 0, 0]);
});

test('authoritative counts survive a deleted latest message omitted by 750 newer inbox tombstones', async () => {
  const p = pair('delete'); const all = p.incoming(3), c = client(p); c.hydrate();
  assert.equal(c.snapshot('before removal').rowUnread, 3);
  const outsider = addUser('deleteother');
  db.exec('BEGIN');
  for (let index = 0; index < 800; index++) {
    const id = `other-removed-${index}`;
    insertDm.run(id, outsider.id, p.viewer.id, 'Synthetic removed elsewhere', 200000 + index);
    db.prepare('UPDATE dms SET removed=1 WHERE id=?').run(id);
  }
  db.prepare('UPDATE dms SET removed=1 WHERE id=?').run(all.at(-1).id);
  db.exec('COMMIT');
  const raw = c.summary();
  assert.equal(raw.removedIds.length, 750);
  assert.equal(raw.removedIds.includes(all.at(-1).id), false);
  await c.actions().loadInboxThreads();
  const after = c.snapshot('after capped removal response');
  assert.deepEqual([after.serverUnread, after.rowUnread, after.globalUnread], [2, 2, 2]);
  const fresh = client(p); fresh.hydrate();
  assert.equal(fresh.snapshot('cold after removal').rowUnread, 2);
});
