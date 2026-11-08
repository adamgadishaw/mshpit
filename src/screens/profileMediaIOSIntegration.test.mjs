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

// Actual screen, platform-resolved media components, history resource, image
// retry owner and SmartImage. Only native hosts/transport/unrelated UI are fake.
const { createProfileHistoryStore } = require('../features/profileHistory/profileHistoryState.mjs');
const empty = [];
const basic = { id: 'review', userId: 'self', artist: 'Saved artist', venue: 'Room', date: '2025-01-01', overall: 4, createdAt: 10 };
const photo = { ...basic, id: 'photo-post', createdAt: 5, photosPublic: true,
  photos: ['https://media.test/original.jpg'], media: [{ id: 'asset-a', uri: 'https://media.test/original.jpg', kind: 'image', width: 2000, height: 1500, altText: 'A real fixture photo' }] };
const offline = () => Object.assign(new Error('Synthetic offline'), { name: 'AppError', code: 'PIT-NET-001', retryable: true });
const flatten = style => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]));
function fixture({ platform = 'ios', self = true, guest = false, cached = [], banner = 'https://media.test/banner-original.jpg', withViewer = true, now = () => 0 } = {}) {
  const renderer = createRenderer(), reads = [], opened = [];
  const user = { id: self ? 'self' : 'target', name: 'Synthetic member', handle: 'fixture', favoriteArtists: [], favoriteGenres: [], banner };
  const state = { user, session: guest ? null : self ? user : { id: 'viewer', favoriteArtists: [], favoriteGenres: [] }, cached, access: 'ready', epoch: 1, fontScale: 1, withViewer };
  const store = createProfileHistoryStore({ now, fetchPage: params => { const r = deferred(); reads.push({ ...r, params }); return r.promise; } });
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl',
    Platform: { OS: platform, select: x => x[platform] || x.default },
    StyleSheet: { create: x => x, absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }, hairlineWidth: .5 },
    useWindowDimensions: () => ({ width: 320, height: 852, fontScale: state.fontScale }) };
  const context = React.createContext(null);
  let historyHook, retryHooks, attemptHook, refreshHook, smartImage, presentation, refreshBoundary;
  const imports = (name, local) => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return native;
    if (name === 'expo-image') return { Image: 'ExpoImage' };
    if (name === './profileHistoryClient.mjs') return { profileHistoryStore: store };
    if (name.endsWith('/useProfileHistory')) return historyHook;
    if (name.endsWith('/feedImageRetry')) return retryHooks;
    if (name.endsWith('/useImageAttempt')) return attemptHook;
    if (name.endsWith('/ProfileMediaPresentation')) return presentation;
    if (name.endsWith('/SmartImage')) return smartImage;
    if (name.endsWith('/VinylRefreshBoundary')) return platform === 'web' ? 'VinylRefreshBoundary' : refreshBoundary;
    if (name.endsWith('/useAppActive')) return { __esModule: true, default: () => true };
    if (name.endsWith('/useScopedRefresh')) return refreshHook;
    if (name.endsWith('/img')) return local(name + '.js');
    if (name.endsWith('/useConcertHistory')) return { useConcertHistory: () => ({ concerts: empty, status: 'ready', complete: true, mapVisible: true, refresh: async () => ({}) }) };
    if (name.endsWith('/ConcertHistory')) return 'ConcertHistory';
    if (name.endsWith('/PostNavigationContext')) return { PostNavigationContext: context };
    if (name.endsWith('/Badge')) return { BadgeRow: 'BadgeRow' };
    if (name.endsWith('/theme')) return { colors: {}, roleColor: () => '#ffffff', radius: {}, space: x => x * 4, mono: 'mono' };
    if (name === '../store') return { useStore: () => ({ session: state.session, authReady: true, chatAuthEpoch: state.epoch,
      userById: () => state.user, logsByUser: () => state.cached, goingFor: () => empty, myAttendance: empty,
      isFollowing: () => false, isBlocked: () => false, isMuted: () => false, followerCount: () => 0, followingCount: () => 0,
      userBadges: () => empty, userPoints: () => 0, userAchievements: () => empty, sharedShows: () => ({ shows: empty, artists: empty }),
      loadUser: async () => ({ status: state.access, user: state.access === 'missing' ? null : state.user, favoriteShows: empty }), loadRewards: async () => ({}),
    }) };
    if (name.includes('/components/') || name === './Icon' || name === './ClipPoster') return name.split('/').at(-1);
    if (name.endsWith('/confirmOwnPostDelete')) return { confirmOwnPostDelete: noop };
    return local(name);
  };
  historyHook = execute('../features/profileHistory/useProfileHistory.js', imports);
  retryHooks = execute(`../hooks/feedImageRetry${platform === 'ios' ? '.ios' : ''}.js`, imports);
  attemptHook = execute(`../hooks/useImageAttempt${platform === 'ios' ? '.ios' : ''}.js`, imports);
  refreshHook = execute('../hooks/useScopedRefresh.js', imports);
  smartImage = execute('../components/SmartImage.jsx', imports);
  refreshBoundary = execute('../components/VinylRefreshBoundary.jsx', imports);
  presentation = execute(`../features/profileMedia/ProfileMediaPresentation${platform === 'ios' ? '.ios' : ''}.jsx`, imports);
  const Screen = execute('./ProfileScreen.jsx', imports).default;
  const render = () => renderer.render(React.createElement(Screen, { userId: state.user.id, asTab: state.session?.id === state.user.id, onManageProfile: noop, onOpenPhotos: state.withViewer ? (...args) => opened.push(args) : undefined }));
  const all = () => nodes(renderer.container);
  const byId = id => all().find(n => n.props?.testID === id);
  const text = () => all().map(n => n.text || '').join(' ');
  const image = fragment => all().find(n => n.type === 'ExpoImage' && decodeURIComponent(n.props.source.uri).includes(fragment));
  const flush = async () => { for (let i=0; i<6; i++) { await new Promise(r => setImmediate(r)); renderer.act(noop); } };
  return { state, render, all, byId, text, image, reads, opened, flush, store, act: renderer.act,
    get params() { return { accountId: state.session?.id, targetId: state.user.id }; },
    press: id => renderer.act(() => byId(id).props.onPress()),
    pressLabel: label => renderer.act(() => all().find(n => n.props?.accessibilityLabel === label).props.onPress()),
    resolve: async (i, posts = [], nextCursor = null) => { reads[i].resolve({ posts, nextCursor }); await flush(); },
    reject: async i => { reads[i].reject(offline()); await flush(); },
    unmount: () => renderer.render(null),
  };
}

test('actual paginated history reproduces missing previews, then one explicit page recovers canonical media', async () => {
  const f = fixture(); f.render(); await f.flush();
  assert.match(f.text(), /Loading gallery/);
  await f.resolve(0, [basic], 'older');
  assert.ok(f.byId('profile-gallery')); assert.match(f.text(), /No media in the posts loaded so far/);
  assert.equal(f.byId('profile-gallery-item-0'), undefined); assert.equal(f.reads.length, 1, 'no automatic full-history scan');
  const load = f.byId('profile-gallery-load-earlier').props.onPress;
  f.act(() => { load(); load(); }); await f.flush();
  assert.equal(f.reads.length, 2); assert.equal(f.reads[1].params.before, 'older');
  await f.resolve(1, [photo], 'even-older');
  assert.match(f.text(), /Earlier posts may have more/);
  assert.match(f.image('/original.jpg').props.source.uri, /wsrv.nl.*w=720/);
  f.press('profile-gallery-item-0');
  assert.equal(f.opened[0][1], 0); assert.equal(f.opened[0][2], 'photo-post');
  assert.deepEqual(f.opened[0][0][0], { ...photo.media[0], postId: 'photo-post', ownerId: 'self', by: 'Synthetic member' });
  assert.equal(f.reads.length, 2); f.unmount();
});

test('cold failure, retry and complete empty have distinct gallery states', async () => {
  for (const self of [true, false]) {
    const f = fixture({ self }); f.render(); await f.flush();
    assert.doesNotMatch(f.text(), /No shared photos|attach to posts appear/);
    await f.reject(0); assert.match(f.text(), /Gallery could not be loaded/);
    f.pressLabel('Refresh gallery after loading error'); await f.flush();
    await f.resolve(1); assert.match(f.text(), self ? /attach to posts appear here/ : /No shared photos or videos yet/);
    assert.equal(f.reads.length, 2); f.unmount();
  }
});

test('earlier-page failure retries that cursor and keeps the loaded media', async () => {
  const f = fixture(); f.render(); await f.flush(); await f.resolve(0, [photo], 'older');
  f.press('profile-gallery-load-earlier'); await f.flush(); await f.reject(1);
  assert.match(f.text(), /Some photos and videos are shown/); assert.ok(f.byId('profile-gallery-item-0'));
  f.press('profile-gallery-load-earlier'); await f.flush(); assert.equal(f.reads[2].params.before, 'older');
  await f.resolve(2); assert.ok(f.byId('profile-gallery-item-0')); f.unmount();
});

test('failed head refresh with a retained older cursor recovers the head, not an unrelated older page', async () => {
  const f = fixture(); f.render(); await f.flush(); await f.resolve(0, [photo], 'older');
  f.press('profile-gallery-refresh'); await f.flush();
  assert.equal(f.reads[1].params.before, null); await f.reject(1);
  assert.ok(f.byId('profile-gallery-load-earlier'), 'older paging remains a separate explicit option');
  f.pressLabel('Refresh gallery after loading error'); await f.flush();
  assert.equal(f.reads[2].params.before, null, 'error refresh checks current head and media permissions');
  await f.resolve(2); assert.equal(f.byId('profile-gallery-item-0'), undefined); f.unmount();
});

test('guest profiles retain the existing sign-in gate and no-gallery data access', async () => {
  const f = fixture({ guest: true, self: false }); f.render(); await f.flush();
  assert.equal(f.reads.length, 0); assert.equal(f.byId('profile-gallery'), undefined);
  assert.ok(f.all().some(n => n.type === 'AccountSnapshotPrompt')); f.unmount();
});

test('the real native refresh boundary still injects RefreshControl into ScrollView beneath the retry provider', async () => {
  for (const platform of ['ios', 'android']) {
    const f = fixture({ platform }); f.render(); await f.flush(); await f.resolve(0, [photo]);
    const scroll = f.all().find(n => n.type === 'ScrollView');
    assert.equal(scroll.props.refreshControl.type, 'RefreshControl');
    f.act(() => { scroll.props.refreshControl.props.onRefresh(); scroll.props.refreshControl.props.onRefresh(); });
    await f.flush(); assert.equal(f.reads.length, 2);
    assert.equal(f.reads[1].params.before, null);
    await f.resolve(1, [photo]); f.unmount();
  }
});

test('real image ladder shows proxy then original, ignores late errors and retries exhausted previews only on explicit refresh', async () => {
  const f = fixture(); f.render(); await f.flush(); await f.resolve(0, [photo]);
  const proxy = f.image('/original.jpg'), proxyError = proxy.props.onError;
  f.act(() => proxyError({ error: 'Synthetic proxy failure' }));
  const original = f.image('/original.jpg'), originalError = original.props.onError;
  assert.equal(original.props.source.uri, photo.photos[0]);
  f.act(() => proxyError({ error: 'Late proxy failure' })); assert.equal(f.image('/original.jpg'), original);
  f.act(() => originalError({ error: 'Synthetic original failure' }));
  assert.equal(f.image('/original.jpg'), undefined); assert.match(f.text(), /PHOTO UNAVAILABLE/);
  f.render(); assert.equal(f.image('/original.jpg'), undefined, 'ordinary rerender does not retry');
  const refresh = f.byId('profile-gallery-refresh').props.onPress;
  f.act(() => { refresh(); refresh(); }); await f.flush();
  assert.equal(f.reads.length, 2, 'repeat refresh is single-flight');
  const retried = f.image('/original.jpg'); assert.ok(retried); assert.notEqual(retried, proxy);
  assert.equal(retried.props.source.uri, proxy.props.source.uri, 'no cache-busting URL');
  f.act(() => { proxyError({ error: 'Stale primary' }); originalError({ error: 'Stale fallback' }); });
  assert.equal(f.image('/original.jpg'), retried);
  f.act(() => retried.props.onDisplay()); await f.resolve(1, [photo]); f.unmount();
});

test('timestamp-zero empty receipt stays authoritative during refresh/error instead of resurrecting stale feed photos', async () => {
  const f = fixture({ cached: [photo], now: () => 0 }); f.render(); await f.flush();
  assert.ok(f.byId('profile-gallery-item-0')); await f.resolve(0);
  assert.equal(f.store.getSnapshot(JSON.stringify(['self', 'self'])).updatedAt, 0);
  assert.equal(f.byId('profile-gallery-item-0'), undefined);
  f.press('profile-gallery-refresh'); await f.flush(); assert.equal(f.byId('profile-gallery-item-0'), undefined);
  await f.reject(1); assert.equal(f.byId('profile-gallery-item-0'), undefined); assert.match(f.text(), /Gallery could not be loaded/);
  f.state.cached = []; f.store.resetAccount('self'); await f.flush();
  assert.equal(f.store.getSnapshot(JSON.stringify(['self', 'self'])).updatedAt, null);
  assert.equal(f.byId('profile-gallery-item-0'), undefined); f.unmount();
});

test('private guards, permission revocation, authoritative empty and unavailable profile fence obsolete viewer actions', async () => {
  const privatePost = { ...photo, photosPublic: false };
  for (const self of [true, false]) {
    const f = fixture({ self }); f.render(); await f.flush(); await f.resolve(0, [privatePost]);
    assert.equal(!!f.byId('profile-gallery-item-0'), self); f.unmount();
  }
  const f = fixture({ self: false, cached: [photo] }); f.render(); await f.flush(); await f.resolve(0, [photo]);
  const oldTile = f.byId('profile-gallery-item-0').props.onPress;
  f.store.scrubAccount('viewer', post => ({ ...post, photosPublic: false })); await f.flush();
  assert.equal(f.byId('profile-gallery-item-0'), undefined); f.act(oldTile); assert.equal(f.opened.length, 0);
  f.state.access = 'missing'; f.press('profile-gallery-refresh'); await f.flush(); await f.resolve(1);
  assert.match(f.text(), /account isn't available/); assert.equal(f.byId('profile-gallery'), undefined); f.act(oldTile); assert.equal(f.opened.length, 0);
  f.unmount();
});

test('banner opens original image without post/report identity and retires replaced URI, target, auth and unmounted callbacks', async () => {
  const f = fixture(); f.render(); await f.flush();
  const original = f.state.user.banner, first = f.byId('profile-banner-open').props.onPress;
  f.act(first); assert.deepEqual(f.opened[0], [[{ uri: original, kind: 'image', altText: "Synthetic member's profile banner" }], 0, null]);
  assert.equal(f.image('banner-original').props.source.uri, original);
  f.state.user = { ...f.state.user, banner: 'https://media.test/second.jpg' }; f.state.session = f.state.user; f.render();
  f.act(first); assert.equal(f.opened.length, 1);
  f.state.user = { ...f.state.user, banner: original }; f.state.session = f.state.user; f.render();
  f.act(first); assert.equal(f.opened.length, 1, 'A→B→A cannot revive first callback');
  let retired = f.byId('profile-banner-open').props.onPress;
  f.state.epoch++; f.render(); f.act(retired); assert.equal(f.opened.length, 1);
  retired = f.byId('profile-banner-open').props.onPress;
  f.state.user = { ...f.state.user, id: 'second' }; f.state.session = f.state.user; f.render(); await f.flush();
  f.act(retired); assert.equal(f.opened.length, 1);
  retired = f.byId('profile-banner-open').props.onPress; f.unmount(); f.act(retired); assert.equal(f.opened.length, 1);
});

test('gallery callback retires on account/auth changes and absent callbacks are disabled', async () => {
  const f = fixture(); f.render(); await f.flush(); await f.resolve(0, [photo]);
  const old = f.byId('profile-gallery-item-0').props.onPress;
  f.state.epoch++; f.render(); f.act(old); assert.equal(f.opened.length, 0);
  f.state.session = { id: 'viewer' }; f.render(); await f.flush(); f.act(old); assert.equal(f.opened.length, 0);
  f.unmount();
  const inert = fixture({ withViewer: false }); inert.render(); await inert.flush(); await inert.resolve(0, [photo]);
  for (const id of ['profile-banner-open', 'profile-gallery-item-0']) { assert.equal(inert.byId(id).props.disabled, true); inert.byId(id).props.onPress?.(); }
  assert.equal(inert.opened.length, 0); inert.unmount();
});

test('three preview tiles retain the complete canonical mixed-media payload; large text controls stay accessible', async () => {
  const clip = { id: 'clip', kind: 'video', uri: 'https://media.test/extensionless', posterUrl: 'https://media.test/poster.jpg', altText: 'Crowd singing' };
  const extra = { ...photo, photos: [], media: [photo.media[0], clip, { ...photo.media[0], id: 'third', uri: 'https://media.test/third.jpg' }, { ...photo.media[0], id: 'fourth', uri: 'https://media.test/fourth.jpg' }] };
  const f = fixture(); f.render(); await f.flush(); await f.resolve(0, [extra]);
  assert.equal(f.all().filter(n => /^profile-gallery-item-/.test(n.props?.testID || '')).length, 3);
  const poster = f.all().find(n => n.type === 'ClipPoster'); assert.equal(poster.props.posterUri, clip.posterUrl);
  assert.deepEqual(flatten(poster.props.style), { width: '100%', aspectRatio: 1 }, 'video wrapper participates in square cell layout');
  const photoWrapper = f.byId('profile-gallery-item-0').children.find(n => n.type === 'View');
  assert.equal(flatten(photoWrapper.props.style).width, '100%');
  assert.equal(flatten(photoWrapper.props.style).aspectRatio, 1);
  assert.equal(flatten(photoWrapper.props.style).position, undefined, 'photo wrapper must not collapse as absolute-only content');
  f.press('profile-gallery-item-1'); assert.equal(f.opened[0][0].length, 4); assert.equal(f.opened[0][0][1].id, 'clip'); assert.equal(f.opened[0][1], 1); assert.equal(f.opened[0][2], photo.id);
  for (const fontScale of [1, 1.6, 3, 1]) {
    f.state.fontScale = fontScale; f.render();
    assert.deepEqual(flatten(f.all().find(n => n.type === 'ClipPoster').props.style), { width: '100%', aspectRatio: 1 });
    assert.equal(flatten(f.byId('profile-gallery-item-0').children.find(n => n.type === 'View').props.style).aspectRatio, 1);
    for (const id of ['profile-banner-open', 'profile-gallery-refresh', 'profile-gallery-item-0']) assert.ok(flatten(f.byId(id).props.style).minHeight >= 44);
    assert.ok(f.all().filter(n => n.type === 'Text').every(n => n.props.allowFontScaling !== false));
    assert.equal(flatten(f.byId('profile-banner-open').props.style).aspectRatio, 3);
  }
  f.unmount();
});

for (const platform of ['android', 'web']) test(`${platform} retains the previous media presentation, callback payload and no image retry provider`, async () => {
  const f = fixture({ platform }); f.render(); await f.flush(); await f.resolve(0, [photo]);
  assert.equal(f.byId('profile-banner-open'), undefined); assert.equal(f.byId('profile-gallery'), undefined);
  assert.doesNotMatch(f.text(), /Loading gallery|Earlier posts may have/);
  assert.match(f.text(), /Media/);
  f.pressLabel('A real fixture photo'); assert.equal(f.opened[0][0][0].postId, photo.id);
  assert.equal(f.opened[0][2], photo.id); f.unmount();
});
