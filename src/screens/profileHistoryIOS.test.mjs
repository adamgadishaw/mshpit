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
const storeSource = readFileSync(new URL('../store.js', import.meta.url), 'utf8');
const storeDeclarations = require('@babel/parser').parse(storeSource, { sourceType: 'module', plugins: ['jsx'] }).program.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : []);
const empty = [];
const post = { id: 'review', userId: 'self', artist: 'Saved artist', venue: 'Room', date: '2025-01-01', overall: 4, createdAt: 1 };
const offline = () => Object.assign(new Error('Synthetic offline'), { name: 'AppError', code: 'PIT-NET-001', retryable: true });
function fixture({ copies = 1, platform = 'ios', self = true, guest = false, cached = empty, going = empty, attendance = empty, access = 'ready', favoriteShows = empty, colors = {}, accent = 'amber', userOverride = {}, badgeEligibility = () => empty } = {}) {
  const renderer = createRenderer(), reads = [];
  const user = { id: self ? 'self' : 'target', name: 'Synthetic member', handle: 'fixture', favoriteArtists: [], favoriteGenres: [], accent, ...userOverride };
  const session = guest ? null : self ? user : { id: 'viewer', favoriteArtists: [], favoriteGenres: [] };
  const createStore = platform === "ios" ? require("../features/profileHistory/profileHistoryState.ios.mjs").createProfileHistoryStore : createProfileHistoryStore;
  let store = createStore({ fetchPage: () => { const r = deferred(); reads.push(r); return r.promise; } });
  const params = { accountId: session?.id, targetId: user.id };
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: platform, select: x => x[platform] || x.default }, StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1 }) };
  const context = React.createContext(null);
  let hook;
  // Mount the real title/provider tree; native animation execution is covered
  // by NativeSwipeRail.ios.test.mjs. Keep these profile resource/lifetime tests
  // independent of Reanimated's native runtime without stubbing away children.
  let largeTitle;
  const titleAnimation = { __esModule: true, default: { View: 'AnimatedView' },
    useSharedValue(initial) {
      const ref = React.useRef(null);
      if (!ref.current) { let value = initial; ref.current = { get: () => value, set: next => { value = next; } }; }
      return ref.current;
    },
    useDerivedValue(callback) {
      const ref = React.useRef(callback); ref.current = callback;
      return React.useMemo(() => ({ get: () => ref.current() }), []);
    },
    useAnimatedStyle: callback => callback(),
  };
  const imports = (name, local) => {
    if (name.endsWith("/PageReturnContext")) return { PageTitle: p => p.children, usePageReturn: () => null };
    if (name.endsWith('/NativeLargeTitle.ios')) return largeTitle ||= execute('../components/NativeLargeTitle.ios.jsx', imports);
    if (name === 'react-native-reanimated') return titleAnimation;
    if (name.endsWith('/useReducedMotion') || name.endsWith('/useScreenReaderEnabled')) return { __esModule: true, default: () => false };
    if (name.endsWith("/useIOSDetailPresentation")) return local(name + ".js");
    if (name.endsWith('/NativeTabScroll')) return native;
    if (name.endsWith('/NativeTabSwipeExclusion')) return { __esModule: true, default: p => p.children };
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return native;
    if (name.endsWith('/useNativeTabPreview')) return { __esModule: true, default: () => false };
    if (name === '../hooks/useNativeTabContentReady') return { __esModule: true, default: () => {} };
    if (name === '../features/profilePresentation/ProfileHierarchy') return execute(`../features/profilePresentation/ProfileHierarchy${platform === 'ios' ? '.ios' : ''}.jsx`, imports);
    if (name.endsWith('/ProfileMediaPresentation')) return { useProfileMediaPresentation: () => ({ retryImages: noop }), ProfileMediaRetryBoundary: ({ children }) => children, ProfileBannerCover: 'ProfileBannerCover', ProfileGallery: 'ProfileGallery' };
    if (name === './services/profileHistoryApi.mjs') return { profileHistoryPageRequest: () => { const r = deferred(); reads.push(r); return r.promise; } };
    if (name === './services/profileHistoryPrivacyService.ios.js') return { captureApiIdentityCheck: () => () => true, invalidateIOSDetailPrivacy: noop };
    if (name === './profileHistoryClient.mjs' || name === './profileHistoryClient.ios.mjs') return { profileHistoryStore: store };
    if (name === '../features/profileHistory/useProfileHistory') return hook;
    if (name === '../lib/useAppActive') return { __esModule: true, default: () => true };
    if (name === '../hooks/useScopedRefresh') return { __esModule: true, default: () => ({ refreshing: false, refresh: noop }) };
    if (name === '../features/concertHistory/useConcertHistory') return { useConcertHistory: () => ({ concerts: empty, status: 'ready', complete: true, mapVisible: true }) };
    if (name === '../features/concertHistory/ConcertHistory') return 'ConcertHistory';
    if (name === '../components/PostNavigationContext') return { PostNavigationContext: context };
    if (name === '../components/Badge') return { BadgeRow: 'BadgeRow' };
    if (name.endsWith('/theme')) return { colors, roleColor: () => '#ffffff', radius: {}, space: x => x * 4, mono: 'mono' };
    if (name === '../store') return { useStore: () => ({ session, authReady: true, chatAuthEpoch: 1,
      userById: () => user, logsByUser: () => cached, goingFor: () => going, myAttendance: attendance,
      isFollowing: () => false, isBlocked: () => false, isMuted: () => false, followerCount: () => 0, followingCount: () => 0,
      userBadges: badgeEligibility, userPoints: () => 0, userAchievements: () => empty, sharedShows: () => ({ shows: empty, artists: empty }),
      loadUser: async () => ({ status: access, user: access === 'missing' ? null : user, favoriteShows }), loadRewards: async () => ({}),
    }) };
    if (name.includes('/components/')) return name.split('/').at(-1);
    if (name === '../lib/confirmOwnPostDelete') return { confirmOwnPostDelete: noop };
    return local(name);
  };
  let storeActions;
  if (platform === 'ios') {
    const client = execute('../features/profileHistory/profileHistoryClient.ios.mjs', imports);
    store = client.profileHistoryStore;
    const source = storeSource, declarations = storeDeclarations;
    const names = ['adoptProfileHistoryAccount', 'removeProfileHistoryPost', 'resetProfileHistoryAccount', 'scrubBlockedProfileHistoryPerson', 'upsertProfileHistoryPost'];
    const selections = names.map(name => {
      const node = declarations.find(node => node.id.name === name);
      assert.ok(node, `actual Store binding ${name}`);
      return `${name}: ${source.slice(node.init.start, node.init.end)}`;
    });
    storeActions = new Function('Platform', 'require', `return {${selections.join(',')}}`)({ OS: 'ios' }, path => {
      assert.equal(path, './features/profileHistory/profileHistoryClient.ios.mjs'); return client;
    });
    storeActions.adoptProfileHistoryAccount(session?.id);
  }
  hook = execute(`../features/profileHistory/useProfileHistory${platform === 'ios' ? '.ios' : ''}.js`, imports);
  const Screen = execute(`./ProfileScreen${platform === 'ios' ? '.ios' : ''}.jsx`, imports).default;
  const render = () => renderer.render(React.createElement(React.Fragment, null, Array.from({ length: copies }, (_, index) => React.createElement(Screen, { key: index, userId: user.id, asTab: self, onManageProfile: noop }, React.createElement('PrivateMemories', null, 'Private memory')))));
  const all = () => nodes(renderer.container);
  const text = () => all().map(n => n.text || '').join(' ');
  const flush = async () => { for (let i=0; i<6; i++) { await new Promise(r => setImmediate(r)); renderer.act(noop); } };
  return { render, all, text, reads, flush, store, params, storeActions,
    resolve: async (i, posts = [], nextCursor = null) => { reads[i].resolve({ posts, nextCursor }); await flush(); },
    reject: async (i, error = offline()) => { reads[i].reject(error); await flush(); },
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

for (const status of [403, 404, 410]) test(`actual duplicate Profiles remove denied ${status} history without cached fallback or auto-read`, async () => {
  const f = fixture({ copies: 2, self: false, cached: [{ ...post, userId: 'target' }] });
  f.render(); await f.flush(); await f.resolve(0, [{ ...post, userId: 'target' }]);
  assert.equal(f.all().filter(n => n.type === 'TicketStub').length, 2);
  void f.store.refresh(f.params); await f.flush();
  await f.reject(1, Object.assign(offline(), { status }));
  assert.equal(f.all().filter(n => n.type === 'TicketStub').length, 0);
  assert.match(f.text(), /Synthetic member/, 'public profile metadata remains accessible');
  f.render(); await f.flush(); assert.equal(f.reads.length, 2);
  f.storeActions.upsertProfileHistoryPost('viewer', 'target', { ...post, id: 'late-receipt', userId: 'target' });
  await f.flush(); assert.equal(f.all().filter(n => n.type === 'TicketStub').length, 0);
  f.retry(); await f.flush(); assert.equal(f.reads.length, 3);
  await f.resolve(2, [{ ...post, id: 'fresh', userId: 'target' }]);
  assert.deepEqual(f.all().filter(n => n.type === 'TicketStub').map(n => n.props.log.id), ['fresh', 'fresh']);
  f.unmount();
});
test('actual selected Store history bindings share mutation, block scrub and account reset with the iOS hook', async () => {
  const f = fixture({ self: false }); f.render(); await f.flush(); await f.resolve(0, []);
  const rows = () => f.all().filter(n => n.type === 'TicketStub').map(n => n.props.log.id);
  f.storeActions.upsertProfileHistoryPost('viewer', 'target', { ...post, userId: 'target' }); await f.flush();
  assert.deepEqual(rows(), ['review']);
  f.storeActions.removeProfileHistoryPost('viewer', 'target', 'review'); await f.flush(); assert.deepEqual(rows(), []);
  f.storeActions.upsertProfileHistoryPost('viewer', 'target', { ...post, id: 'blocked', userId: 'target' }); await f.flush();
  f.storeActions.scrubBlockedProfileHistoryPerson('viewer', 'target'); await f.flush(); assert.deepEqual(rows(), []);
  f.storeActions.upsertProfileHistoryPost('viewer', 'target', { ...post, id: 'reset', userId: 'target' }); await f.flush();
  f.storeActions.resetProfileHistoryAccount('viewer'); await f.flush(); assert.deepEqual(rows(), []);
  f.unmount();
});

// End-to-end contract seam: a temporary real SQLite account, actual PATCH and
// self/public reads, actual Store eligibility, and each real profile component.
test('saved badge preferences survive fresh reads and render on self/public profiles without awarding status', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dataDir = mkdtempSync(join(tmpdir(), 'pit-profile-badge-view-'));
  process.env.PIT_DATA_DIR = dataDir;
  process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = 'true';
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
  const { db, q } = await import('../../server/db.js');
  const { routes } = await import('../../server/api.js');
  const { memberBadgeTypes } = await import('../domain/memberBadges.mjs');
  // roleBadge is exported, so its declaration lives under ExportNamedDeclaration.
  const ast = require('@babel/parser').parse(storeSource, { sourceType: 'module', plugins: ['jsx'] });
  const exportedRole = ast.program.body.flatMap(n => n.declaration?.declarations || []).find(n => n.id.name === 'roleBadge');
  const roleBadge = new Function('return (' + storeSource.slice(exportedRole.init.start, exportedRole.init.end) + ')')();
  const eligibilitySource = storeSource.slice(storeSource.indexOf('  const userBadges ='), storeSource.indexOf('  // --- Gamification'));
  const badgeEligibility = new Function('roleBadge', 'memberBadgeTypes', 'isTop100', eligibilitySource + '\nreturn userBadges;')(roleBadge, memberBadgeTypes, () => false);
  const id = 'badge_view_owner';
  try {
    q.insertUser.run(id, 'badge-view@example.test', 'Badge viewer fixture', id, 'test-hash', 'fan', null, null, null, 'BV', '#123456', Date.now());
    db.prepare("UPDATE users SET age_band='18_plus', email_verified_at=?, verified=1, sponsor=1 WHERE id=?").run(Date.now(), id);
    for (const selection of [null, [], ['verified'], ['staff', 'verified']]) {
      routes['PATCH /api/me']({ user: q.userById.get(id), ip: 'badge-view-fixture', body: { extras: { profileBadges: selection } } });
      for (const self of [true, false]) {
        const user = self ? routes['GET /api/me']({ user: q.userById.get(id) }).user
          : routes['GET /api/users/:id']({ params: { id }, user: null }).user;
        assert.equal(user.role, 'fan');
        assert.equal(user.verified, true);
        assert.equal(user.sponsor, true);
        assert.equal(Object.hasOwn(user, 'profileBadgeSelectionSupported'), self);
        const expected = selection === null ? badgeEligibility(user) : selection.length ? ['verified'] : [];
        for (const platform of ['ios', 'web', 'android']) {
          const f = fixture({ self, platform, userOverride: user, badgeEligibility });
          try {
            f.render(); await f.flush();
            const rows = f.all().filter(n => n.type === 'BadgeRow');
            assert.equal(rows.length, 1, platform + ': exact profile name badge row');
            assert.deepEqual(rows[0].props.badges, expected, platform + ': fresh preference rendered');
          } finally { f.unmount(); }
        }
      }
    }
    db.prepare('UPDATE users SET verified=0 WHERE id=?').run(id);
    const revoked = routes['GET /api/users/:id']({ params: { id }, user: null }).user;
    const f = fixture({ self: false, userOverride: revoked, badgeEligibility });
    try { f.render(); await f.flush(); assert.deepEqual(f.all().find(n => n.type === 'BadgeRow').props.badges, []); } finally { f.unmount(); }
  } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
});
