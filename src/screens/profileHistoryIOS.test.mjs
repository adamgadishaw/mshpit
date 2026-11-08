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
function fixture({ platform = 'ios', self = true, guest = false, cached = empty, going = empty, attendance = empty, access = 'ready', favoriteShows = empty, colors = {}, accent = 'amber' } = {}) {
  const renderer = createRenderer(), reads = [];
  const user = { id: self ? 'self' : 'target', name: 'Synthetic member', handle: 'fixture', favoriteArtists: [], favoriteGenres: [], accent };
  const session = guest ? null : self ? user : { id: 'viewer', favoriteArtists: [], favoriteGenres: [] };
  const store = createProfileHistoryStore({ fetchPage: () => { const r = deferred(); reads.push(r); return r.promise; } });
  const params = { accountId: session?.id, targetId: user.id };
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: platform, select: x => x[platform] || x.default }, StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1 }) };
  const context = React.createContext(null);
  let hook;
  const imports = (name, local) => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return native;
    if (name === './profileHistoryClient.mjs') return { profileHistoryStore: store };
    if (name === '../features/profileHistory/useProfileHistory') return hook;
    if (name === '../lib/useAppActive') return { __esModule: true, default: () => true };
    if (name === '../hooks/useScopedRefresh') return { __esModule: true, default: () => ({ refreshing: false, refresh: noop }) };
    if (name === '../features/concertHistory/useConcertHistory') return { useConcertHistory: () => ({ concerts: empty, status: 'ready', complete: true, mapVisible: true }) };
    if (name === '../features/concertHistory/ConcertHistory') return 'ConcertHistory';
    if (name === '../components/PostNavigationContext') return { PostNavigationContext: context };
    if (name === '../components/Badge') return { BadgeRow: 'BadgeRow' };
    if (name === '../theme') return { colors, roleColor: () => '#ffffff', radius: {}, space: x => x * 4, mono: 'mono' };
    if (name === '../store') return { useStore: () => ({ session, authReady: true, chatAuthEpoch: 1,
      userById: () => user, logsByUser: () => cached, goingFor: () => going, myAttendance: attendance,
      isFollowing: () => false, isBlocked: () => false, isMuted: () => false, followerCount: () => 0, followingCount: () => 0,
      userBadges: () => empty, userPoints: () => 0, userAchievements: () => empty, sharedShows: () => ({ shows: empty, artists: empty }),
      loadUser: async () => ({ status: access, user: access === 'missing' ? null : user, favoriteShows }), loadRewards: async () => ({}),
    }) };
    if (name.startsWith('../components/')) return name.split('/').at(-1);
    if (name === '../lib/confirmOwnPostDelete') return { confirmOwnPostDelete: noop };
    return local(name);
  };
  hook = execute('../features/profileHistory/useProfileHistory.js', imports);
  const Screen = execute('./ProfileScreen.jsx', imports).default;
  const render = () => renderer.render(React.createElement(Screen, { userId: user.id, asTab: self, onManageProfile: noop }, React.createElement('PrivateMemories', null, 'Private memory')));
  const all = () => nodes(renderer.container);
  const text = () => all().map(n => n.text || '').join(' ');
  const flush = async () => { for (let i=0; i<6; i++) { await new Promise(r => setImmediate(r)); renderer.act(noop); } };
  return { render, all, text, reads, flush, store, params,
    resolve: async (i, posts = [], nextCursor = null) => { reads[i].resolve({ posts, nextCursor }); await flush(); },
    reject: async i => { reads[i].reject(offline()); await flush(); },
    retry: () => renderer.act(() => all().find(n => n.props?.accessibilityLabel === 'Retry loading profile posts').props.onPress()),
    unmount: () => renderer.render(null),
  };
}
for (const self of [true, false]) test(`${self ? 'You' : 'public Profile'} distinguishes loading/failure/retry from confirmed empty`, async () => {
  const f = fixture({ self }); f.render(); await f.flush();
  const noFalseEmpty = () => { assert.doesNotMatch(f.text(), /haven't posted yet|No posts yet|No upcoming shows yet/); assert.ok(!f.all().some(n => /^0\+? (Reviews|Upcoming)$/.test(n.props?.accessibilityLabel || ''))); };
  assert.match(f.text(), /Loading posts/); noFalseEmpty();
  await f.reject(0); assert.match(f.text(), /Posts could not be loaded/); noFalseEmpty();
  f.retry(); await f.flush(); assert.equal(f.reads.length, 2); noFalseEmpty();
  await f.resolve(1); assert.match(f.text(), self ? /haven't posted yet/ : /No posts yet/); assert.match(f.text(), /No upcoming shows yet/); assert.doesNotMatch(f.text(), /could not be loaded/);
  // A failed refresh must not reassert an earlier empty receipt as current.
  void f.store.refresh(f.params); await f.flush(); await f.reject(2); noFalseEmpty(); f.unmount();
});
test('cached real posts remain visible through failure, then fresh receipt replaces them', async () => {
  const f = fixture({ cached: [post] }); f.render(); await f.flush(); await f.reject(0);
  assert.ok(f.all().some(n => n.type === 'TicketStub' && n.props.log.id === 'review'));
  assert.ok(f.all().some(n => n.props?.accessibilityLabel === '1+ Reviews'));
  f.retry(); await f.flush(); await f.resolve(1, [post]);
  void f.store.refresh(f.params); await f.flush(); await f.reject(2);
  assert.ok(f.all().some(n => n.type === 'TicketStub' && n.props.log.id === 'review'));
  assert.match(f.text(), /Earlier posts could not be loaded/); f.unmount();
});
test('partial successful receipt cannot establish absence', async () => {
  const f = fixture(); f.render(); await f.flush(); await f.resolve(0, [], 'next');
  assert.ok(f.all().some(n => n.props?.accessibilityLabel === 'Not confirmed Reviews'));
  assert.doesNotMatch(f.text(), /Not loaded/);
  assert.doesNotMatch(f.text(), /haven't posted yet|No upcoming shows yet/); assert.match(f.text(), /Load earlier posts/); f.unmount();
});
test('independent Going rows survive unavailable history without leaking owner memories publicly', async () => {
  const going = [{ artist: 'Future artist', venue: 'Future room', date: `${new Date().getFullYear() + 1}-01-01` }];
  for (const self of [true, false]) {
    const f = fixture({ self, going }); f.render(); await f.flush(); await f.reject(0);
    if (self) { assert.match(f.text(), /Future artist/); assert.match(f.text(), /Private memory/); }
    else { assert.doesNotMatch(f.text(), /Future artist|Private memory/); }
    f.unmount();
  }
});
test('missing public profile and guest gate remain authoritative', async () => {
  const denied = fixture({ self: false, access: 'missing', cached: [post] }); denied.render(); await denied.flush();
  assert.match(denied.text(), /account isn't available/); assert.ok(!denied.all().some(n => n.type === 'TicketStub')); denied.unmount();
  const guest = fixture({ self: false, guest: true }); guest.render(); await guest.flush();
  assert.equal(guest.reads.length, 0); assert.ok(guest.all().some(n => n.type === 'AccountSnapshotPrompt')); assert.doesNotMatch(guest.text(), /Private memory|No posts yet/); guest.unmount();
});
for (const platform of ['android', 'web']) test(`${platform} retains prior presentation`, async () => {
  const f = fixture({ platform }); f.render(); await f.flush(); await f.reject(0);
  assert.match(f.text(), /haven't posted yet/); assert.match(f.text(), /No upcoming shows yet/); f.unmount();
});
const themeSource = readFileSync(new URL('../theme.js', import.meta.url), 'utf8');
const palettes = ['STAGE', 'DAYLIGHT', 'NEON', 'FOREST', 'EMBER', 'ICE', 'ROSE', 'MINT', 'BACKSTAGE', 'VINYL', 'SUNSET', 'LAVENDER'];
const { PROFILE_ACCENT_OPTIONS } = require('../domain/profileAccents.mjs');
const flatten = style => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]));
const luminance = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(c => c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4).reduce((s,c,i) => s+c*[.2126,.7152,.0722][i],0);
test('actual favorite score text retains AA contrast across all palettes and accents; decorative identity remains', async () => {
  for (const name of palettes) {
    const body = themeSource.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`))[1];
    const colors = Object.fromEntries([...body.matchAll(/(\w+):\s*"(#[0-9A-Fa-f]{6})"/g)].map(m => [m[1],m[2]]));
    for (const accent of PROFILE_ACCENT_OPTIONS) {
      const f = fixture({ colors, accent: accent.id, favoriteShows: [{ ...post, overall: 8.5 }] }); f.render(); await f.flush();
      const score = f.all().find(n => n.type === 'Text' && n.children.some(c => c.text === '8.5'));
      assert.ok(score, 'meaningful rating text is rendered');
      const card = f.all().find(n => n.props?.accessibilityLabel?.includes('Open the review.'));
      const style = flatten(score.props.style), background = flatten(card.props.style).backgroundColor || colors.bg;
      const a = luminance(style.color), b = luminance(background);
      assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05) >= 4.5, `${name}/${accent.id}`);
      assert.equal(style.fontSize, 14); assert.equal(flatten(card.props.style).borderColor, accent.color);
      f.unmount();
    }
  }
});
for (const platform of ['android', 'web']) test(`${platform} retains favorite rating accent`, async () => {
  const f = fixture({ platform, colors: { amber: '#9C4708' }, accent: 'rose', favoriteShows: [{ ...post, overall: 8.5 }] }); f.render(); await f.flush();
  const score = f.all().find(n => n.type === 'Text' && n.children.some(c => c.text === '8.5'));
  assert.equal(flatten(score.props.style).color, '#ED5B8D'); f.unmount();
});
test('independent private attendance stays owner-only during history failure', async () => {
  const attendance = [{ artist: 'Private attended artist', venue: 'Room', date: '2025-01-01', state: 'went' },
    { artist: 'Private planned artist', venue: 'Room', date: `${new Date().getFullYear() + 1}-01-01`, state: 'going' }];
  for (const self of [true, false]) {
    const f = fixture({ self, attendance }); f.render(); await f.flush(); await f.reject(0);
    const history = f.all().find(n => n.type === 'ConcertHistory');
    assert.equal(history.props.concerts.some(c => c.artist === 'Private attended artist'), self);
    assert.equal(f.text().includes('Private planned artist'), self); f.unmount();
  }
});
test('public nonempty receipt and retained cache remain usable with a failed refresh', async () => {
  const f = fixture({ self: false }); f.render(); await f.flush(); await f.resolve(0, [{ ...post, userId: 'target' }]);
  assert.ok(f.all().some(n => n.props?.accessibilityLabel === '1 Reviews'));
  void f.store.refresh(f.params); await f.flush(); await f.reject(1);
  assert.ok(f.all().some(n => n.type === 'TicketStub' && n.props.log.id === post.id));
  assert.ok(f.all().some(n => n.props?.accessibilityLabel === '1+ Reviews'));
  assert.doesNotMatch(f.text(), /No posts yet|Private memory/); f.unmount();
});
