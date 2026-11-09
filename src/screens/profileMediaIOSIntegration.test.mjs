import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
const tabContext = require('../components/nativeTabPreviewContext.mjs');
const { transformSync } = require("@babel/core");
const codes = new Map(), noop = () => {};
function execute(path, imports, timers = { setTimeout, clearTimeout }) {
  const file = new URL(path, import.meta.url);
  if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, "utf8"), {
    filename: file.pathname, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", codes.get(path))(
    name => imports(name, createRequire(file)), module, module.exports, timers.setTimeout, timers.clearTimeout, callback => setTimeout(callback, 0), clearTimeout);
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
    createInstance: (type, props) => ({ type, props, children: [], scrolls: [], focus() {}, scrollToEnd() {}, scrollTo(options) { this.scrolls.push(options); } }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: node => { node.hidden = true; }, unhideTextInstance: node => { node.hidden = false; },
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
function fixture({ managed = false, strict = false, platform = 'ios', self = true, guest = false, cached = [], banner = 'https://media.test/banner-original.jpg', withViewer = true, now = () => 0 } = {}) {
  const renderer = createRenderer(), reads = [], opened = [], rewards = [], readiness = [], profileReads = [], mutations = [], sheets = [];
  const detailContext = require('../components/iosDetailPresentationContext.mjs');
  const privacy = require('../domain/iosDetailPrivacyEpoch.mjs').createIOSDetailPrivacyEpoch();
  let admission = null, life = null;
  const publishCommands = () => {
    const revision = privacy.getSnapshot(), current = admission.current;
    const canAct = () => current() && privacy.getSnapshot() === revision;
    admission = { ...admission, canAct, commandToken: Object.freeze({}),
      guard: callback => typeof callback === 'function' ? (...args) => canAct() ? callback(...args) : undefined : callback };
  };
  const admit = active => {
    if (life) life.live = false;
    const state = { live: active }; life = state;
    admission = { managed: true, active, current: () => state.live, token: Object.freeze({}), scope: 'profile-occurrence', preview: !active };
    publishCommands();
  };
  if (managed) admit(true);
  const user = { id: self ? 'self' : 'target', name: 'Synthetic member', handle: 'fixture', favoriteArtists: [], favoriteGenres: [], banner };
  const state = { user, session: guest ? null : self ? user : { id: 'viewer', favoriteArtists: [], favoriteGenres: [] }, cached, access: 'ready', epoch: 1, fontScale: 1, withViewer, preview: false, initialSection: null, ownerTools: [], removedIds: [], blockedIds: [], removedPhotos: new Set(), directoryMissing: false, favoriteShows: empty, concerts: empty };
  const isPhotoRemoved = uri => state.removedPhotos.has(uri);
  const store = createProfileHistoryStore({ now, fetchPage: params => { const r = deferred(); reads.push({ ...r, params }); return r.promise; } });
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl',
    ActionSheetIOS: { showActionSheetWithOptions: (options, choose) => sheets.push({ options, choose }) },
    Platform: { OS: platform, select: x => x[platform] || x.default },
    StyleSheet: { create: x => x, absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }, hairlineWidth: .5 },
    useWindowDimensions: () => ({ width: 320, height: 852, fontScale: state.fontScale }) };
  const context = React.createContext(null);
  let historyHook, baseHistoryHook, retryHooks, attemptHook, refreshHook, smartImage, presentation, refreshBoundary;
  const imports = (name, local) => {
    if (name.endsWith("/useIOSDetailPresentation")) return execute('../hooks/useIOSDetailPresentation.ios.js', imports);
    if (name === '../components/iosDetailPresentationContext.mjs') return detailContext;
    if (name === './useProfileHistory.js') return baseHistoryHook;
    if (name.endsWith('/NativeTabScroll')) return native;
    if (name.endsWith('/NativeTabSwipeExclusion')) return { __esModule: true, default: p => p.children };
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return native;
    if (name.endsWith('/useNativeTabPreview')) return execute(`../hooks/useNativeTabPreview${platform === 'ios' ? '.ios' : ''}.js`, imports);
    if (name === '../hooks/useNativeTabContentReady') return execute(`../hooks/useNativeTabContentReady${platform === 'ios' ? '.ios' : ''}.js`, imports);
    if (name === '../components/nativeTabPreviewContext.mjs') return tabContext;
    if (name === '../features/profilePresentation/ProfileHierarchy') return execute(`../features/profilePresentation/ProfileHierarchy${platform === 'ios' ? '.ios' : ''}.jsx`, imports);
    if (name === 'expo-image') return { Image: 'ExpoImage' };
    if (name === './profileHistoryClient.mjs' || name === './profileHistoryClient.ios.mjs') return { profileHistoryStore: store };
    if (name.endsWith('/useProfileHistory')) return historyHook;
    if (name.endsWith('/feedImageRetry')) return retryHooks;
    if (name.endsWith('/useImageAttempt')) return attemptHook;
    if (name.endsWith('/ProfileMediaPresentation')) return presentation;
    if (name.endsWith('/SmartImage')) return smartImage;
    if (name.endsWith('/VinylRefreshBoundary')) return platform === 'web' ? 'VinylRefreshBoundary' : refreshBoundary;
    if (name.endsWith('/useAppActive')) return { __esModule: true, default: () => true };
    if (name.endsWith('/useScopedRefresh')) return refreshHook;
    if (name.endsWith('/img')) return local(name + '.js');
    if (name.endsWith('/useConcertHistory')) return { useConcertHistory: () => ({ concerts: state.concerts, status: 'ready', complete: true, mapVisible: true, refresh: async () => ({}) }) };
    if (name.endsWith('/ConcertHistory')) return 'ConcertHistory';
    if (name.endsWith('/PostNavigationContext')) return { PostNavigationContext: context };
    if (name.endsWith('/Badge')) return { BadgeRow: 'BadgeRow' };
    if (name.endsWith('/theme')) return { colors: {}, roleColor: () => '#ffffff', radius: {}, space: x => x * 4, mono: 'mono' };
    if (name === '../store') return { useStore: () => ({ session: state.session, authReady: true, chatAuthEpoch: state.epoch,
      removedIds: state.removedIds, blockedIds: state.blockedIds, isPhotoRemoved,
      userById: () => state.directoryMissing ? null : state.user, logsByUser: () => state.cached, goingFor: () => empty, myAttendance: empty,
      isFollowing: () => false, isBlocked: id => state.blockedIds.includes(id), isMuted: () => false, followerCount: () => 0, followingCount: () => 0,
      userBadges: () => empty, userPoints: () => 0, userAchievements: () => empty, sharedShows: () => ({ shows: empty, artists: empty }),
      loadUser: async (...args) => {
        const request = { args, ...deferred() }; profileReads.push(request);
        return state.deferProfile ? request.promise : { status: state.access, user: state.access === 'missing' ? null : state.user, favoriteShows: state.favoriteShows };
      },
      follow: id => mutations.push(['follow', id]), unfollow: id => mutations.push(['unfollow', id]),
      blockUser: id => mutations.push(['block', id]), unblockUser: id => mutations.push(['unblock', id]),
      muteUser: id => mutations.push(['mute', id]), unmuteUser: id => mutations.push(['unmute', id]),
      deleteOwnPost: async id => { mutations.push(['delete', id]); return { ok: true }; }, loadRewards: async (id, options) => { rewards.push({ id, options }); return {}; },
    }) };
    if (name.includes('/components/') || name === './Icon' || name === './ClipPoster') return name.split('/').at(-1);
    if (name.endsWith('/confirmOwnPostDelete')) return { confirmOwnPostDelete: noop };
    return local(name);
  };
  baseHistoryHook = execute('../features/profileHistory/useProfileHistory.js', imports);
  historyHook = platform === 'ios' ? execute('../features/profileHistory/useProfileHistory.ios.js', imports) : baseHistoryHook;
  retryHooks = execute(`../hooks/feedImageRetry${platform === 'ios' ? '.ios' : ''}.js`, imports);
  attemptHook = execute(`../hooks/useImageAttempt${platform === 'ios' ? '.ios' : ''}.js`, imports);
  refreshHook = execute('../hooks/useScopedRefresh.js', imports);
  smartImage = execute('../components/SmartImage.jsx', imports);
  refreshBoundary = execute('../components/VinylRefreshBoundary.jsx', imports);
  presentation = execute(`../features/profileMedia/ProfileMediaPresentation${platform === 'ios' ? '.ios' : ''}.jsx`, imports);
  const Screen = execute(`./ProfileScreen${platform === 'ios' ? '.ios' : ''}.jsx`, imports).default;
  const reportReady = ready => readiness.push(ready);
  const render = () => renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
    React.createElement(detailContext.IOSDetailPresentationContext.Provider, { value: admission },
      React.createElement(tabContext.NativeTabPreviewContext.Provider, { value: state.preview },
        React.createElement(tabContext.NativeTabReadinessContext.Provider, { value: reportReady },
          React.createElement(Screen, { userId: state.user.id, asTab: state.session?.id === state.user.id, initialSection: state.initialSection, ownerTools: state.ownerTools, onManageProfile: noop,
            onOpenPost: (...args) => opened.push(args), onOpenShow: (...args) => opened.push(args), onOpenPhotos: state.withViewer ? (...args) => opened.push(args) : undefined }, React.createElement('PrivateMemories', null, 'Private memories')))))));
  const all = () => nodes(renderer.container);
  const byId = id => all().find(n => n.props?.testID === id);
  const text = () => all().map(n => n.text || '').join(' ');
  const image = fragment => all().find(n => n.type === 'ExpoImage' && decodeURIComponent(n.props.source.uri).includes(fragment));
  const flush = async () => { for (let i=0; i<6; i++) { await new Promise(r => setImmediate(r)); renderer.act(noop); } };
  return { state, render, all, byId, text, image, reads, opened, rewards, readiness, flush, store, act: renderer.act, profileReads, mutations, sheets,
    invalidatePrivacy() { privacy.invalidate(); },
    commitPrivacy() { publishCommands(); render(); },
    get presentation() { return admission; },
    cover() { admit(false); state.preview = true; render(); },
    reveal() { admit(true); state.preview = false; render(); },
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


test('native profile starts with posts and keeps gallery/history mounted but inaccessible until selected', async () => {
  const f = fixture(); f.render(); await f.flush(); await f.resolve(0, [photo]);
  const gallery = f.byId('profile-section-gallery'), shows = f.byId('profile-section-shows'), posts = f.byId('profile-section-posts');
  const tile = f.byId('profile-gallery-item-0');
  const hidden = (section, value) => {
    assert.equal(flatten(section.props.style).display === 'none', value);
    assert.equal(section.props.accessibilityElementsHidden, value);
    assert.equal(section.props.importantForAccessibility, value ? 'no-hide-descendants' : 'auto');
  };
  hidden(posts, false); hidden(gallery, true); hidden(shows, true);
  assert.ok(nodes(shows).some(n => n.type === 'PrivateMemories'));
  assert.ok(!nodes(posts).some(n => n.type === 'PrivateMemories'));
  for (const key of ['gallery', 'shows', 'posts', 'gallery']) {
    f.press(`profile-tab-${key}`);
    for (const name of ['posts', 'shows', 'gallery']) {
      hidden(f.byId(`profile-section-${name}`), name !== key);
      assert.equal(f.byId(`profile-tab-${name}`).props.accessibilityState.selected, name === key);
      assert.ok(flatten(f.byId(`profile-tab-${name}`).props.style).minHeight >= 44);
    }
    assert.equal(f.byId('profile-gallery-item-0'), tile, 'section switch retains loaded native image host');
  }
  assert.equal(f.reads.length, 1, 'section switching must not load additional history');
  f.press('profile-gallery-item-0'); assert.equal(f.opened[0][2], photo.id);
  f.unmount();
});

test('profile section selection resets across target and auth lifetime, and stale tab callbacks are fenced', async () => {
  const f = fixture(); f.render(); await f.flush();
  f.press('profile-tab-gallery');
  const old = f.byId('profile-tab-shows').props.onPress;
  f.state.epoch++; f.render();
  assert.equal(f.byId('profile-tab-posts').props.accessibilityState.selected, true);
  f.act(old); assert.equal(f.byId('profile-tab-posts').props.accessibilityState.selected, true);
  f.press('profile-tab-shows');
  f.state.user = { ...f.state.user, id: 'second' }; f.state.session = f.state.user; f.render(); await f.flush();
  assert.equal(f.byId('profile-tab-posts').props.accessibilityState.selected, true);
  f.unmount();
});

test('native primary readiness excludes rewards and preview cannot award achievements or refresh', async () => {
  const f = fixture(); f.state.preview = true; f.render(); await f.flush();
  assert.equal(f.rewards.length, 0); assert.equal(f.readiness.at(-1), false);
  f.press('profile-gallery-refresh'); await f.flush(); assert.equal(f.rewards.length, 0); assert.equal(f.reads.length, 1);
  await f.resolve(0, [photo]); assert.equal(f.readiness.at(-1), true);
  f.state.preview = false; f.render(); await f.flush(); assert.equal(f.rewards.length, 1);
  f.render(); await f.flush(); assert.equal(f.rewards.length, 1, 'rerender is not another reward award');
  f.unmount();
  const failed = fixture(); failed.state.preview = true; failed.render(); await failed.flush(); await failed.reject(0);
  assert.equal(failed.readiness.at(-1), true, 'honest terminal post error can finish the transition');
  failed.unmount();
});

test('explicit owner actions preserve badges/current callbacks and refuse obsolete scopes', async () => {
  const f = fixture(), actions = [];
  const tools = callback => [
    { key: 'inbox', label: 'Inbox', icon: 'mail', badge: 4, onPress: callback },
    { key: 'activity', label: 'Activity', icon: 'bell', badge: 120, onPress: () => actions.push('activity') },
    { key: 'settings', label: 'Settings', icon: 'menu', onPress: noop },
  ];
  f.state.ownerTools = tools(() => actions.push('old')); f.render(); await f.flush();
  const old = f.byId('profile-owner-inbox').props.onPress;
  assert.match(f.byId('profile-owner-inbox').props.accessibilityLabel, /4 unread/);
  assert.match(f.byId('profile-owner-activity').props.accessibilityLabel, /120 unread/);
  assert.equal(f.byId('profile-owner-settings'), undefined);
  assert.deepEqual(actions, [], 'rendering shortcuts never opens Inbox or Activity');
  f.state.ownerTools = tools(() => actions.push('current')); f.render(); f.act(old);
  assert.deepEqual(actions, ['current']);
  f.state.fontScale = 3; f.render();
  assert.ok(flatten(f.byId('profile-owner-inbox').props.style).minHeight >= 44);
  assert.ok(f.all().filter(n => n.type === 'Text').every(n => n.props.allowFontScaling !== false));
  const beforeEpoch = f.byId('profile-owner-inbox').props.onPress;
  f.state.epoch++; f.render(); f.act(beforeEpoch); assert.deepEqual(actions, ['current']);
  const beforeUnmount = f.byId('profile-owner-inbox').props.onPress;
  f.unmount(); f.act(beforeUnmount); assert.deepEqual(actions, ['current']);
});

for (const platform of ['android', 'web']) test(`${platform} has no native section wrappers, tab controls or owner shortcut additions`, async () => {
  const f = fixture({ platform }); f.render(); await f.flush(); await f.resolve(0, [photo]);
  assert.equal(f.byId('profile-section-posts'), undefined);
  assert.equal(f.byId('profile-tab-posts'), undefined);
  assert.equal(f.byId('profile-owner-inbox'), undefined);
  assert.ok(f.all().some(n => n.type === 'PrivateMemories'));
  f.unmount();
});


for (const parentFirst of [true, false]) test(`concert-history entry uses nested content coordinates (${parentFirst ? 'section first' : 'concert first'})`, async () => {
  const f = fixture(); f.state.initialSection = 'concert-history'; f.render(); await f.flush(); await f.resolve(0, [photo]);
  assert.equal(f.byId('profile-tab-shows').props.accessibilityState.selected, true);
  const sectionLayout = () => f.byId('profile-section-shows').props.onLayout({ nativeEvent: { layout: { y: 600 } } });
  const concertLayout = () => f.byId('profile-concert-anchor').props.onLayout({ nativeEvent: { layout: { y: 120 } } });
  f.act(parentFirst ? sectionLayout : concertLayout);
  f.act(parentFirst ? concertLayout : sectionLayout);
  await new Promise(resolve => setTimeout(resolve, 15)); await f.flush();
  const scroll = f.all().find(n => n.type === 'ScrollView');
  assert.equal(scroll.scrolls.at(-1).y, 708);
  assert.equal(scroll.scrolls.at(-1).animated, false);
  const completed = scroll.scrolls.length;
  f.press('profile-tab-posts'); f.press('profile-tab-shows');
  f.act(sectionLayout); f.act(concertLayout);
  await new Promise(resolve => setTimeout(resolve, 15)); await f.flush();
  assert.equal(scroll.scrolls.length, completed, 'returning to Shows does not force a second deep-link scroll');
  f.unmount();
});

test('choosing Posts cancels a pending concert-history focus and late hidden layout cannot revive it', async () => {
  const f = fixture(); f.state.initialSection = 'concert-history'; f.render(); await f.flush(); await f.resolve(0, [photo]);
  const sectionLayout = f.byId('profile-section-shows').props.onLayout;
  const concertLayout = f.byId('profile-concert-anchor').props.onLayout;
  f.act(() => { sectionLayout({ nativeEvent: { layout: { y: 600 } } }); concertLayout({ nativeEvent: { layout: { y: 120 } } }); });
  f.press('profile-tab-posts');
  f.act(() => { sectionLayout({ nativeEvent: { layout: { y: 0 } } }); concertLayout({ nativeEvent: { layout: { y: 0 } } }); });
  await new Promise(resolve => setTimeout(resolve, 15)); await f.flush();
  assert.equal(f.all().find(n => n.type === 'ScrollView').scrolls.length, 0);
  f.unmount();
});


test('a later explicit concert-history entry on the same profile can focus again', async () => {
  const f = fixture(); f.state.initialSection = 'concert-history'; f.render(); await f.flush(); await f.resolve(0, [photo]);
  const measure = () => f.act(() => {
    f.byId('profile-section-shows').props.onLayout({ nativeEvent: { layout: { y: 600 } } });
    f.byId('profile-concert-anchor').props.onLayout({ nativeEvent: { layout: { y: 120 } } });
  });
  measure(); await new Promise(resolve => setTimeout(resolve, 15)); await f.flush();
  const scroll = f.all().find(n => n.type === 'ScrollView'); assert.equal(scroll.scrolls.length, 1);
  f.state.initialSection = null; f.render();
  f.state.initialSection = 'concert-history'; f.render(); measure();
  await new Promise(resolve => setTimeout(resolve, 15)); await f.flush();
  assert.equal(scroll.scrolls.length, 2); f.unmount();
});


test('owner shortcut handlers belong to one layout presentation across Suspense and account roundtrips', () => {
  const renderer = createRenderer(), called = [];
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: x => x } };
  const { ProfileOwnerActions } = execute('../features/profilePresentation/ProfileHierarchy.ios.jsx', name => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return native;
    if (name.endsWith('/useIOSDetailPresentation')) return require('../hooks/useIOSDetailPresentation.js');
    if (name.endsWith('/useNativeTabPreview')) return { __esModule: true, default: () => false };
    if (name.endsWith('/theme')) return { colors: {} };
    if (name.endsWith('/Icon')) return 'Icon';
    throw new Error(name);
  });
  let suspend = false, scope = 'account-a:1';
  const pending = new Promise(() => {});
  function Owner() {
    if (suspend) throw pending;
    return React.createElement(ProfileOwnerActions, { scope, actions: [{ key: 'inbox', icon: 'mail', label: 'Inbox', onPress: () => called.push(scope) }] });
  }
  const render = () => renderer.render(React.createElement(React.Suspense, { fallback: React.createElement('Loading') }, React.createElement(Owner)));
  const action = () => nodes(renderer.container).find(n => n.props?.testID === 'profile-owner-inbox').props.onPress;
  render(); const first = action(); first(); assert.equal(called.length, 1);
  suspend = true; render(); first(); assert.equal(called.length, 1, 'layout-hidden owner immediately retires its handler');
  suspend = false; render(); first(); assert.equal(called.length, 1, 'same-scope reconnect does not revive a captured handler');
  const reconnected = action(); reconnected(); assert.equal(called.length, 2);
  scope = 'account-b:1'; render(); scope = 'account-a:1'; render();
  reconnected(); assert.equal(called.length, 2, 'same scope after an account roundtrip is a fresh presentation');
  const final = action(); renderer.render(null); final(); assert.equal(called.length, 2);
});


test('captured owner shortcuts stay inert during preview and never borrow a later promotion', async () => {
  const f = fixture(), actions = [];
  f.state.preview = true;
  f.state.ownerTools = [{ key: 'inbox', label: 'Inbox', icon: 'mail', onPress: () => actions.push('inbox') }];
  f.render(); await f.flush(); const previewHandler = f.byId('profile-owner-inbox').props.onPress;
  f.act(previewHandler); assert.deepEqual(actions, []);
  f.state.preview = false; f.render(); await f.flush();
  f.act(previewHandler); assert.deepEqual(actions, [], 'preview callback never gains committed ownership');
  const committed = f.byId('profile-owner-inbox').props.onPress;
  f.act(committed); assert.deepEqual(actions, ['inbox']);
  f.state.preview = true; f.render(); f.act(committed); assert.deepEqual(actions, ['inbox']);
  f.state.preview = false; f.render(); f.act(committed); assert.deepEqual(actions, ['inbox'], 'old foreground handler cannot borrow the fresh promotion');
  f.press('profile-owner-inbox'); assert.deepEqual(actions, ['inbox', 'inbox']);
  f.unmount();
});


test('integrated native identity leaves the transparent banner overlap tappable', async () => {
  const f = fixture(); f.render(); await f.flush();
  const identity = f.byId('profile-identity-tile');
  assert.equal(identity.props.pointerEvents, 'box-none');
  const row = identity.children.find(n => n.type === 'View' && flatten(n.props.style).justifyContent === 'space-between');
  assert.equal(row.props.pointerEvents, 'box-none');
  const outer = f.all().find(n => n.children?.includes(identity));
  assert.equal(outer.props.pointerEvents, 'box-none');
  assert.equal(flatten(outer.props.style).marginTop, -32);
  f.press('profile-banner-open'); assert.equal(f.opened[0][0][0].uri, f.state.user.banner);
  f.unmount();
});


for (const strict of [false, true]) test(`retained Profile (${strict ? "StrictMode" : "normal"}) preserves section/scroll/media and permanently fences captured menu/gallery/card actions`, async () => {
  const f = fixture({ managed: true, strict, self: false }); f.render(); await f.flush();
  await f.resolve(f.reads.length - 1, [photo], 'earlier');
  const scroll = f.all().find(n => n.type === 'ScrollView'); scroll.offset = 884;
  const banner = f.image('/banner-original.jpg'), gallery = f.image('/original.jpg');
  const oldBanner = f.byId('profile-banner-open').props.onPress;
  const oldGallery = f.byId('profile-gallery-item-0').props.onPress;
  const oldEarlier = f.byId('profile-gallery-load-earlier').props.onPress;
  const oldRefresh = scroll.props.refreshControl.props.onRefresh;
  const oldTab = f.byId('profile-tab-posts').props.onPress;
  const follow = f.all().find(n => n.props?.accessibilityLabel === 'Follow Synthetic member').props.onPress;
  const card = f.all().find(n => n.type === 'TicketStub');
  const oldPost = card.props.onOpenPost, oldDelete = card.props.onDelete;
  f.press('profile-action-menu'); const sheet = f.sheets.at(-1);
  f.press('profile-tab-gallery');
  const reads = f.reads.length, profileReads = f.profileReads.length, rewards = f.rewards.length;
  f.cover(); await f.flush();
  assert.equal(f.reads.length, reads); assert.equal(f.profileReads.length, profileReads); assert.equal(f.rewards.length, rewards);
  for (const back of [false, true]) {
    if (back) { f.reveal(); await f.flush(); }
    f.act(() => { oldBanner(); oldGallery(); oldEarlier(); oldRefresh(); oldTab(); follow(); oldPost(photo); void oldDelete(photo.id); sheet.choose(0); });
    await f.flush();
    assert.equal(f.all().find(n => n.type === 'ScrollView'), scroll); assert.equal(scroll.offset, 884);
    assert.equal(f.image('/banner-original.jpg'), banner); assert.equal(f.image('/original.jpg'), gallery);
    assert.equal(f.byId('profile-tab-gallery').props.accessibilityState.selected, true);
    assert.deepEqual(f.mutations, []); assert.deepEqual(f.opened, []); assert.equal(f.reads.length, reads);
  }
  assert.equal(f.profileReads.length, profileReads, 'Back keeps the confirmed profile receipt');
  f.press('profile-gallery-item-0'); assert.equal(f.opened.length, 1);
  f.pressLabel('Follow Synthetic member'); assert.deepEqual(f.mutations, [['follow', 'target']]);
  f.press('profile-gallery-load-earlier'); await f.flush(); assert.equal(f.reads.length, reads + 1);
  f.unmount();
});


test('real privacy epoch revokes captured Profile media/menu/commands before render and fresh commands recover', async () => {
  const f = fixture({ managed: true, self: false }); f.render(); await f.flush(); await f.resolve(0, [photo], 'earlier');
  const admission = f.presentation, token = admission.token, commandToken = admission.commandToken;
  assert.equal(Object.isFrozen(token), true); assert.equal(Object.isFrozen(commandToken), true);
  const banner = f.byId('profile-banner-open').props.onPress, gallery = f.byId('profile-gallery-item-0').props.onPress;
  const earlier = f.byId('profile-gallery-load-earlier').props.onPress;
  const follow = f.all().find(n => n.props?.accessibilityLabel === 'Follow Synthetic member').props.onPress;
  const card = f.all().find(n => n.type === 'TicketStub'); const openPost = card.props.onOpenPost, remove = card.props.onDelete;
  f.press('profile-action-menu'); const choose = f.sheets.at(-1).choose;
  const count = f.reads.length;
  f.invalidatePrivacy();
  assert.equal(admission.current(), true, 'read settlement still owns the top occurrence');
  assert.equal(admission.canAct(), false, 'commands retire synchronously before React');
  for (const committed of [false, true]) {
    if (committed) f.commitPrivacy();
    f.act(() => { banner(); gallery(); earlier(); follow(); openPost(photo); void remove(photo.id); choose(0); });
    await f.flush(); assert.deepEqual(f.opened, []); assert.deepEqual(f.mutations, []); assert.equal(f.reads.length, count);
  }
  assert.equal(f.presentation.token, token); assert.notEqual(f.presentation.commandToken, commandToken);
  f.press('profile-banner-open'); f.press('profile-gallery-item-0'); f.pressLabel('Follow Synthetic member');
  assert.equal(f.opened.length, 2); assert.deepEqual(f.mutations, [['follow', 'target']]);
  f.unmount();
});

test('Profile adopts an in-flight authoritative denial across privacy rotation without abort/reload loops', async () => {
  const f = fixture({ managed: true, self: false }); f.state.deferProfile = true; f.render(); await f.flush();
  assert.equal(f.profileReads.length, 1);
  const read = f.profileReads[0], token = f.presentation.token, current = f.presentation.current;
  f.invalidatePrivacy(); f.commitPrivacy(); await f.flush();
  assert.equal(f.presentation.token, token); assert.equal(f.presentation.current, current);
  assert.equal(read.args[1].signal.aborted, false, 'privacy command rotation must not cancel the admitted read');
  read.resolve({ status: 'missing', user: null, favoriteShows: [] }); await f.flush();
  assert.match(f.text(), /This account isn't available/); assert.equal(f.byId('profile-banner-open'), undefined);
  f.invalidatePrivacy(); f.commitPrivacy(); await f.flush();
  assert.equal(f.profileReads.length, 1); assert.match(f.text(), /This account isn't available/);
  f.unmount();
});


for (const reason of ['blocked author', 'directory quarantine']) test(`active Profile hides retained identity/media/history after ${reason}`, async () => {
  const f = fixture({ managed: true, self: false }); f.render(); await f.flush(); await f.resolve(0, [photo]);
  const oldBanner = f.byId('profile-banner-open').props.onPress;
  const oldGallery = f.byId('profile-gallery-item-0').props.onPress;
  const follow = f.all().find(n => n.props?.accessibilityLabel === 'Follow Synthetic member').props.onPress;
  const reads = f.profileReads.length;
  f.invalidatePrivacy();
  if (reason === 'blocked author') f.state.blockedIds = ['target']; else f.state.directoryMissing = true;
  f.act(() => { oldBanner(); oldGallery(); follow(); }); assert.deepEqual(f.opened, []); assert.deepEqual(f.mutations, []);
  f.commitPrivacy(); await f.flush();
  assert.match(f.text(), /This account isn't available/); assert.doesNotMatch(f.text(), /Synthetic member|Saved artist/);
  assert.equal(f.byId('profile-gallery'), undefined); assert.equal(f.byId('profile-banner-open'), undefined);
  assert.equal(f.all().some(n => n.type === 'TicketStub' || n.type === 'ConcertHistory'), false);
  f.act(() => { oldBanner(); oldGallery(); follow(); }); assert.deepEqual(f.opened, []); assert.deepEqual(f.mutations, []);
  assert.equal(f.profileReads.length, reads, 'quarantine does not create a read loop'); f.unmount();
});

test('active Profile projects removed posts and photos out of history, pins, map and banner without resurrection', async () => {
  const withdrawn = 'https://media.test/original.jpg', banner = 'https://media.test/banner-original.jpg';
  const f = fixture({ managed: true, self: false });
  f.state.favoriteShows = [{ ...photo, photo: withdrawn }];
  f.state.concerts = [{ id: 'concert', postId: photo.id, artist: 'Saved artist', photo: withdrawn }];
  f.render(); await f.flush(); await f.resolve(0, [photo]);
  const oldGallery = f.byId('profile-gallery-item-0').props.onPress;
  f.invalidatePrivacy(); f.state.removedPhotos.add(withdrawn); f.state.removedPhotos.add(banner);
  f.act(oldGallery); assert.deepEqual(f.opened, []);
  f.commitPrivacy(); await f.flush();
  assert.equal(f.byId('profile-gallery-item-0'), undefined); assert.equal(f.byId('profile-banner-open'), undefined);
  const card = f.all().find(n => n.type === 'TicketStub'); assert.deepEqual(card.props.log.photos, []); assert.deepEqual(card.props.log.media, []);
  assert.equal(f.all().find(n => n.type === 'ConcertHistory').props.concerts[0].photo, null);
  assert.equal(f.all().some(n => n.type === 'SmartImage' && n.props.uri === withdrawn), false);
  f.state.removedIds = [photo.id]; f.invalidatePrivacy(); f.commitPrivacy(); await f.flush();
  assert.equal(f.all().some(n => n.type === 'TicketStub'), false);
  assert.deepEqual(f.all().find(n => n.type === 'ConcertHistory').props.concerts, []);
  assert.equal(f.all().some(n => n.props?.accessibilityLabel?.startsWith('Saved artist')), false);
  f.act(oldGallery); assert.deepEqual(f.opened, []); f.unmount();
});
