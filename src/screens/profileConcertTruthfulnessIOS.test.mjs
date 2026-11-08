import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const codes = new Map(), noop = () => {};
function execute(path, imports, timers = { setTimeout, clearTimeout }) {
  const file = new URL(path, import.meta.url);
  if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, "utf8"), {
    filename: file.pathname, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", codes.get(path))(
    name => imports(name, createRequire(file)), module, module.exports, timers.setTimeout, timers.clearTimeout);
  return module.exports;
}
function createRenderer() {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [], focus() {}, scrollToEnd() {} }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
    hideInstance: noop, unhideInstance: noop, hideTextInstance: noop, unhideTextInstance: noop,
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; }, resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false, detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null, NotPendingTransition: null,
    HostTransitionContext: React.createContext(null), resetFormInstance: noop, bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 5; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return { container, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// Real screen, React, history hook and store. Only transport/native hosts and
// unrelated resources are mocked; these tests do not claim native layout QA.
const { createProfileHistoryStore } = require('../features/profileHistory/profileHistoryState.mjs');
const empty = [];
const post = { id: 'review', userId: 'self', artist: 'Saved artist', venue: 'Room', date: '2025-01-01', overall: 4, createdAt: 1 };
const offline = () => Object.assign(new Error('Synthetic offline'), { name: 'AppError', code: 'PIT-NET-001', retryable: true });
function fixture({ platform = 'ios', self = true, guest = false, cached = empty, going = empty, attendance = empty, access = 'ready', favoriteShows = empty, colors = {}, accent = 'amber', mapVisible = false } = {}) {
  const renderer = createRenderer(), reads = [], concertReads = [], opened = []; let concertState;
  const user = { id: self ? 'self' : 'target', name: 'Synthetic member', handle: 'fixture', favoriteArtists: [], favoriteGenres: [], accent, concertMapVisible: mapVisible };
  const session = guest ? null : self ? user : { id: 'viewer', favoriteArtists: [], favoriteGenres: [] };
  const store = createProfileHistoryStore({ fetchPage: () => { const r = deferred(); reads.push(r); return r.promise; } });
  const params = { accountId: session?.id, targetId: user.id };
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: platform, select: x => x[platform] || x.default }, StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1 }) };
  const context = React.createContext(null);
  let hook, concertHook, ConcertHistory, ConcertMap;
  const imports = (name, local) => {
    // Resolve the actual map module without chunk/Suspense timing; its JSX and hooks remain real.
    if (name === 'react') return { ...React, lazy: () => React.lazy(() => ({ then: resolve => resolve(ConcertMap) })) };
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native-svg') return { __esModule: true, default: 'Svg', G: 'G', Line: 'Line', Path: 'Path' };
    if (name === 'react-native') return native;
    if (name === './profileHistoryClient.mjs') return { profileHistoryStore: store };
    if (name === '../features/profileHistory/useProfileHistory') return hook;
    if (name === '../lib/useAppActive') return { __esModule: true, default: () => true };
    if (name === '../hooks/useScopedRefresh') return { __esModule: true, default: () => ({ refreshing: false, refresh: noop }) };
    if (name === '../features/concertHistory/useConcertHistory') return { useConcertHistory: props => { concertState = concertHook.useConcertHistory(props); return concertState; } };
    if (name === './services/concertHistoryApi.mjs') return { requestConcertHistoryPage: options => { const r = { ...deferred(), options }; concertReads.push(r); return r.promise; }, readConcertHistoryPost: async id => ({ id }) };
    if (name === '../features/concertHistory/ConcertHistory') return ConcertHistory;
    if (name === '../components/PostNavigationContext') return { PostNavigationContext: context };
    if (name === '../components/Badge') return { BadgeRow: 'BadgeRow' };
    if (name === '../theme' || name === '../../theme') return { shadow: {}, colors, roleColor: () => '#ffffff', radius: {}, space: x => x * 4, mono: 'mono' };
    if (name === '../store') return { useStore: () => ({ session, authReady: true, chatAuthEpoch: 1,
      userById: () => user, logsByUser: () => cached, goingFor: () => going, myAttendance: attendance,
      isFollowing: () => false, isBlocked: () => false, isMuted: () => false, followerCount: () => 0, followingCount: () => 0,
      userBadges: () => empty, userPoints: () => 0, userAchievements: () => empty, sharedShows: () => ({ shows: empty, artists: empty }),
      loadUser: async () => ({ status: access, user: access === 'missing' ? null : user, favoriteShows }), loadRewards: async () => ({}),
    }) };
    if (name.startsWith('../components/') || name.startsWith('../../components/')) return name.split('/').at(-1);
    if (name === '../lib/confirmOwnPostDelete') return { confirmOwnPostDelete: noop };
    return local(name);
  };
  hook = execute('../features/profileHistory/useProfileHistory.js', imports);
  concertHook = execute('../features/concertHistory/useConcertHistory.js', imports);
  ConcertMap = execute('../features/concertHistory/ProfileConcertMap.jsx', imports);
  ConcertHistory = execute('../features/concertHistory/ConcertHistory.jsx', imports);
  const Screen = execute('./ProfileScreen.jsx', imports).default;
  const render = () => renderer.render(React.createElement(Screen, { userId: user.id, asTab: self, onManageProfile: noop, onOpenPost: row => opened.push(row), onOpenShow: row => opened.push(row) }, React.createElement('PrivateMemories', null, 'Private memory')));
  const all = () => nodes(renderer.container);
  const text = () => all().map(n => n.text || '').join(' ');
  const flush = async () => { for (let i=0; i<6; i++) { await new Promise(r => setImmediate(r)); renderer.act(noop); } };
  return { render, all, text, reads, concertReads, opened, flush, store, params,
    concertRefresh: () => { void concertState.refresh(); },
    concertResolve: async (i, concerts = [], nextCursor = null) => { concertReads[i].resolve({ concerts, nextCursor, complete: !nextCursor, hasMore: !!nextCursor, mapVisible }); await flush(); },
    concertReject: async (i, error = offline()) => { concertReads[i].reject(error); await flush(); },
    press: label => renderer.act(() => all().find(n => n.props?.accessibilityLabel === label).props.onPress()),
    resolve: async (i, posts = [], nextCursor = null) => { reads[i].resolve({ posts, nextCursor }); await flush(); },
    reject: async i => { reads[i].reject(offline()); await flush(); },
    retry: () => renderer.act(() => all().find(n => n.props?.accessibilityLabel === 'Retry loading profile posts').props.onPress()),
    unmount: () => renderer.render(null),
  };
}
// Exercise the actual nested ConcertHistory, hook, resource, and calendar
// projection. Only network/native hosts are substituted. No native UI claims.
const concert = { id: 'concert', postId: 'review', artist: 'Known artist', venue: 'Known room', date: '2025-01-01', rating: 4 };
const child = f => f.all().find(n => n.props?.testID === 'profile-concert-history');
const childText = f => nodes(child(f)).map(n => n.text || '').join(' ');
const assertUnknown = f => {
  assert.doesNotMatch(childText(f), /LOGGED|0 concerts|No concerts logged yet/);
};
for (const self of [true, false]) test(`${self ? 'You' : 'public Profile'} actual concert child: cold/loading/failure/retry/complete empty`, async () => {
  const f = fixture({ self }); f.render(); await f.flush();
  assert.match(childText(f), /Loading concert history/); assertUnknown(f);
  await f.concertReject(0); assertUnknown(f); assert.match(childText(f), /could not be loaded/);
  f.press('Retry concert history'); await f.flush(); assert.equal(f.concertReads.length, 2); assertUnknown(f);
  await f.concertResolve(1); assert.match(childText(f), /0 concerts/); assert.match(childText(f), /No concerts logged yet/); assert.match(childText(f), /LOGGED/);
  f.concertRefresh(); await f.flush(); assertUnknown(f); await f.concertReject(2); assertUnknown(f); f.unmount();
});
test('actual child retains real partial and cached concerts, retry and review navigation', async () => {
  const f = fixture({ self: false }); f.render(); await f.flush();
  await f.concertResolve(0, [concert], 'page2');
  assert.match(childText(f), /Known artist/); assert.match(childText(f), /1 concert/);
  await f.concertReject(1); assert.match(childText(f), /Known artist/); assert.match(childText(f), /could not be loaded/);
  f.press('Retry concert history'); await f.flush(); assert.equal(f.concertReads[2].options.before, 'page2');
  await f.concertResolve(2); assert.match(childText(f), /Known artist/);
  f.press('Open review for Known artist at Known room'); await f.flush(); assert.deepEqual(f.opened, [{ id: 'review' }]);
  f.concertRefresh(); await f.flush(); await f.concertReject(3); assert.match(childText(f), /Known artist/); f.unmount();
});
test('ready partial empty child never stamps zero total but retains original pagination', async () => {
  const f = fixture(); f.render(); await f.flush();
  for (let i=0; i<5; i++) await f.concertResolve(i, [], `page${i+1}`);
  assertUnknown(f); assert.match(childText(f), /Concert count not confirmed/); assert.match(childText(f), /No concerts in this part/);
  f.press('See all concerts'); await f.flush(); assert.equal(f.concertReads.length, 6);
  await f.concertResolve(5); assert.match(childText(f), /No concerts logged yet/); f.unmount();
});
test('real private attendance appears only in owner concert child; access denial clears public rows', async () => {
  const attendance = [{ artist: 'Private night', venue: 'Private room', date: '2025-01-01', state: 'went' }];
  for (const self of [true, false]) {
    const f = fixture({ self, attendance }); f.render(); await f.flush(); await f.concertReject(0);
    assert.equal(childText(f).includes('Private night'), self);
    if (self) { f.press('Open show for Private night at Private room'); assert.equal(f.opened[0].artist, 'Private night'); }
    f.unmount();
  }
  const f = fixture({ self: false }); f.render(); await f.flush(); await f.concertResolve(0, [concert]);
  f.concertRefresh(); await f.flush(); await f.concertReject(1, { status: 403 });
  assert.doesNotMatch(childText(f), /Known artist|LOGGED/); assert.match(childText(f), /no longer available/); f.unmount();
});
for (const platform of ['ios', 'android', 'web']) test(`${platform}: actual normalized calendar rows never invent an iOS doors time`, async () => {
  const date = `${new Date().getFullYear() + 1}-01-01`;
  for (const self of [true, false]) {
    const f = fixture({ platform, self, going: [{ artist: 'Own plan', venue: 'Own room', date }] }); f.render(); await f.flush();
    await f.resolve(0, [{ ...post, artist: 'Public plan', date: date.replaceAll('-', ' · '), userId: self ? 'self' : 'target' }]);
    await f.concertResolve(0, [concert]);
    assert.match(f.text(), /Public plan/); assert.equal(f.text().includes('Own plan'), self);
    assert.match(childText(f), /Known artist/); // Child is real, not a host stub.
    const countdowns = f.all().filter(n => n.type === 'Countdown');
    assert.equal(countdowns.length, platform === 'ios' ? 0 : self ? 2 : 1);
    assert.equal(f.text().includes('until doors'), platform !== 'ios');
    const row = f.all().find(n => n.props?.accessibilityLabel?.startsWith('Public plan,'));
    assert.ok(row); row.props.onPress(); assert.equal(f.opened.at(-1).date, date);
    f.unmount();
  }
});
for (const platform of ['android', 'web']) test(`${platform} retains original concert zero-stamp presentation`, async () => {
  const f = fixture({ platform }); f.render(); await f.flush(); assert.match(childText(f), /LOGGED/);
  await f.concertReject(0); assert.match(childText(f), /0 concerts/); f.unmount();
});
for (const self of [true, false]) test(`${self ? 'You' : 'public'} actual map never invites logging on an unconfirmed empty read`, async () => {
  const f = fixture({ self, mapVisible: true }); f.render(); await f.flush();
  assert.doesNotMatch(childText(f), /Log a show to put it on the map/);
  await f.concertReject(0); assert.doesNotMatch(childText(f), /Log a show to put it on the map/);
  f.press('Retry concert history'); await f.flush(); await f.concertResolve(1);
  assert.ok(f.all().some(n => n.props?.testID === 'profile-concert-map'));
  assert.match(childText(f), /Log a show to put it on the map/); f.unmount();
});
test('real nonempty map remains during recovery, partial-empty map does not claim absence', async () => {
  const f = fixture({ mapVisible: true }); f.render(); await f.flush();
  for (let i=0; i<5; i++) await f.concertResolve(i, [], `page${i+1}`);
  assert.doesNotMatch(childText(f), /Log a show to put it on the map/);
  f.press('See all concerts'); await f.flush(); await f.concertResolve(5, [concert]);
  assert.ok(f.all().some(n => n.props?.testID === 'profile-concert-map'));
  assert.match(childText(f), /No mapped locations in this view/);
  f.concertRefresh(); await f.flush(); await f.concertReject(6);
  assert.ok(f.all().some(n => n.props?.testID === 'profile-concert-map')); assert.match(childText(f), /Known artist/); f.unmount();
});
for (const platform of ['android', 'web']) test(`${platform} keeps original empty-map prompt on unavailable history`, async () => {
  const f = fixture({ platform, mapVisible: true }); f.render(); await f.flush(); await f.concertReject(0);
  assert.match(childText(f), /Log a show to put it on the map/); f.unmount();
});
