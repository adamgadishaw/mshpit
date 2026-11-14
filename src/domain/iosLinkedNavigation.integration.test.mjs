import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "@babel/parser";
import { createIOSLinkedNavigation } from "./iosLinkedNavigation.mjs";
import { navigationFrameForAccount, memberTabRequiresAccount } from "./memberAccess.mjs";
import { publicIdentityTarget } from "./artistAccountIdentity.mjs";
import { composerNavigationTransition, isComposerFrame } from "./composerNavigation.mjs";
import { replaceNavigationFrame } from "./navigationStack.mjs";

const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const root = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body.find(node => node.type === "FunctionDeclaration" && node.id?.name === "Root");
const names = ["newsStoryNotice", "cancelNewsStory", "newsStoryNoticeCurrent", "cancelNewsStoryNotice", "retryNewsStoryNotice", "cancelPublicRoute", "applyNavigation", "writeNavigation", "runAfterComposerClose", "commitGo", "commitReplace", "navigateCandidate", "go", "replace", "openSignIn", "publicIdentityFrame", "popStack", "requestComposerPop", "back", "switchTab", "openIOSLinkedDestination", "openProfile", "openProfileByHandle", "openPost", "openPostById", "openNewsStory"];
const declarations = new Map();
for (const statement of root.body.body) {
  if (statement.type !== "VariableDeclaration") continue;
  for (const node of statement.declarations) if (names.includes(node.id?.name)) {
    declarations.set(node.id.name, `const ${node.id.name} = ${source.slice(node.init.start, node.init.end)};`);
  }
}
for (const name of names) assert.ok(declarations.has(name), `missing Root handler ${name}`);
const setup = source.slice(source.indexOf("  const linkedNavigationRef = useRef(null);"), source.indexOf("  const browseReturnRef = useRef(null);"));
assert.match(setup, /account\(session\?\.id \|\| null, chatAuthEpoch\)/);
const actualRoot = `(() => { ${setup}\n${names.map(name => declarations.get(name)).join("\n")} return { ${names.join(", ")} }; })()`;
const snapshot = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Execute the real Root initialization, lifecycle and handlers. The Store
// boundary is deferred, never replaced with a second navigation implementation.
function fixture({ platform = "ios", session = { id: "A" }, epoch = 1, initialStack = [{}, { artistName: "Origin" }], cached = {}, cancelPushNavigation = () => {} } = {}) {
  const ownerRef = { current: null }, guardRef = { current: null };
  const stackRef = { current: initialStack };
  const navigationRef = { current: { stack: initialStack, tab: "feed", landing: false } };
  const reads = [], navigations = [], analytics = [], layouts = [], notices = [];
  let aborts = 0;
  const request = (kind, id, options) => {
    const job = deferred();
    reads.push({ kind, id, options, ...job });
    return job.promise;
  };
  const shared = {
    cancelPushNavigation,
    Platform: { OS: platform }, web: false, createLinkedNavigationOwner: createIOSLinkedNavigation,
    useRef: () => ownerRef, useLayoutEffect: fn => layouts.push(fn),
    stackRef, navigationRef, composerCloseGuardRef: guardRef,
    postOpenSequence: { current: 0 }, sessionRef: { get current() { return session; } },
    authNavigationAbortRef: { current: () => { aborts += 1; } },
    publicLookup: { lookup: null }, publicRouteRequestRef: { current: null }, publicNavigationPendingRef: { current: null },
    setPublicNavigationNotice() {}, newsOpenRef: { current: 0 }, newsLinkedClaimRef: { current: null }, setNewsStoryNotice(value) { notices.push(value); },
    setStack(stack) { navigations.push(snapshot(stack)); }, setTab() {}, setLanding() {},
    navigationFrameForAccount, memberTabRequiresAccount, publicIdentityTarget,
    composerNavigationTransition, isComposerFrame, replaceNavigationFrame,
    prepareAvailableNavigationFrame: frame => frame, pathForFrame: () => null,
    browseReturnRef: { current: { reset() {} } },
    SearchScreen: {}, DiscoverScreen: {}, YouScreen: {},
    MAIN_TAB_PATHS: { feed: "/feed", search: "/search", discover: "/discover", you: "/you" },
    userByHandle: handle => cached[handle], userById: () => null,
    loadPostForView: (id, options) => request("post", id, options),
    searchPeople: (id, options) => request("profile", id, options),
    track: (...args) => analytics.push(args), remoteArtistMeta: () => null,
  };
  let funcs, cleanup;
  const render = (nextSession = session, nextEpoch = epoch) => {
    session = nextSession; epoch = nextEpoch;
    funcs = runInNewContext(actualRoot, { ...shared, session, chatAuthEpoch: epoch, newsStoryNoticeState: notices.at(-1) || null });
    return funcs;
  };
  render(); cleanup = layouts[0]();
  return {
    get app() { return funcs; }, render, reads, navigations, analytics, guardRef,
    get stack() { return snapshot(stackRef.current); },
    get tab() { return navigationRef.current.tab; },
    ownerRef, notices, get aborts() { return aborts; },
    unmount() { cleanup(); },
    strictRemount() { cleanup(); cleanup = layouts[0](); },
  };
}

test("actual Root cancels pending push navigation and fences a deferred composer confirmation", () => {
  let valid = true, cancelled = 0;
  const f = fixture({ cancelPushNavigation: () => { valid = false; cancelled++; } }), prompts = [];
  f.guardRef.current = prompt => prompts.push(prompt);
  f.app.go({ openLog: { id: "old-push" } }, null, () => valid);
  assert.equal(prompts.length, 1); assert.equal(f.navigations.length, 0);
  f.guardRef.current = null; f.app.go({ settings: true });
  assert.equal(cancelled, 1); prompts[0].proceed();
  assert.equal(f.navigations.length, 1); assert.equal(f.stack.at(-1).settings, true);
  valid = true; f.app.back(); assert.equal(valid, false); assert.equal(cancelled, 2);
});

for (const pair of [["post", "post"], ["profile", "profile"], ["post", "profile"], ["profile", "post"]]) {
  test(`Root latest linked intent wins inverted ${pair.join(" -> ")} completions`, async () => {
    const f = fixture();
    const open = (kind, id) => kind === "post" ? f.app.openPostById(id) : f.app.openProfileByHandle(id);
    const first = open(pair[0], "older"), second = open(pair[1], "newer");
    assert.equal(f.reads.length, 2);
    assert.equal(f.reads[0].options.signal.aborted, true);
    const resolve = (read, id) => read.resolve(read.kind === "post" ? { id } : [{ id, handle: id }]);
    resolve(f.reads[1], "newer"); await second;
    resolve(f.reads[0], "older"); await first;
    assert.equal(f.navigations.length, 1);
    assert.deepEqual(f.stack.at(-1), pair[1] === "post" ? { post: { id: "newer" } } : { profileId: "newer", profileHandle: "newer" });
  });
}

for (const destination of ["go", "replace", "back", "tab"]) {
  test(`Root committed ${destination} cancels an older lookup and its captured callbacks`, async () => {
    const f = fixture(), captured = f.app;
    const pending = captured.openPostById("older");
    if (destination === "go") f.app.go({ venueName: "New venue" });
    if (destination === "replace") f.app.replace({ venueName: "New venue" });
    if (destination === "back") f.app.back();
    if (destination === "tab") f.app.switchTab("search");
    const current = f.stack, count = f.navigations.length;
    assert.equal(f.reads[0].options.signal.aborted, true);
    f.reads[0].resolve({ id: "older" }); await pending;
    await captured.openProfileByHandle("stale");
    assert.equal(f.reads.length, 1, "departed callback must not fetch");
    assert.deepEqual(f.stack, current);
    assert.equal(f.navigations.length, count);
    const fresh = f.render().openPostById("fresh");
    assert.equal(f.reads.length, 2);
    f.reads[1].resolve({ id: "fresh" }); await fresh;
    assert.equal(f.stack.at(-1).post.id, "fresh");
  });
}

test("Root account changes invalidate synchronously, before layout effects, including A -> B -> A", async () => {
  const f = fixture(), old = f.app;
  const pending = old.openProfileByHandle("old");
  f.render({ id: "B" }, 2); f.render({ id: "A" }, 3);
  assert.equal(f.reads[0].options.signal.aborted, true);
  f.reads[0].resolve([{ id: "old", handle: "old" }]); await pending;
  await old.openPostById("stale");
  assert.equal(f.reads.length, 1); assert.equal(f.navigations.length, 0);
  const beforeReset = f.app;
  const second = beforeReset.openPostById("same-account");
  f.render({ id: "A" }, 4);
  f.reads[1].resolve({ id: "same-account" }); await second;
  await beforeReset.openProfileByHandle("stale-again");
  assert.equal(f.reads.length, 2); assert.equal(f.navigations.length, 0);
});

test("routine Root rerender preserves the active claim", async () => {
  const f = fixture(), pending = f.app.openPostById("valid");
  f.render({ id: "A" }, 1);
  f.reads[0].resolve({ id: "valid" }); await pending;
  assert.equal(f.stack.at(-1).post.id, "valid");
});

for (const kind of ["post", "profile"]) {
  for (const result of ["missing", "rejected"]) {
    test(`Root ${kind} ${result} keeps its route and supports a deliberate retry`, async () => {
      const f = fixture(), original = f.stack;
      const open = () => kind === "post" ? f.app.openPostById("retry") : f.app.openProfileByHandle("retry");
      const first = open();
      if (result === "rejected") f.reads[0].reject(new Error("offline"));
      else f.reads[0].resolve(kind === "post" ? null : []);
      await first;
      assert.deepEqual(f.stack, original); assert.equal(f.navigations.length, 0); assert.equal(f.reads.length, 1);
      const second = open();
      f.reads[1].resolve(kind === "post" ? { id: "retry" } : [{ id: "retry", handle: "retry" }]);
      await second;
      assert.equal(f.navigations.length, 1); assert.equal(f.reads.length, 2);
    });
  }
}

test("Root cache hits keep authoritative artist identity and never search", async () => {
  const artist = { id: "artist", handle: "artist-handle", role: "artist", artistName: "Canonical Artist" };
  const f = fixture({ cached: { "artist-handle": artist } });
  await f.app.openProfileByHandle("artist-handle");
  assert.equal(f.reads.length, 0);
  assert.deepEqual(f.stack.at(-1), { artistName: "Canonical Artist" });
});

test("Root a cached newer profile supersedes a pending post", async () => {
  const f = fixture({ cached: { cached: { id: "cached", handle: "cached" } } });
  const pending = f.app.openPostById("old");
  await f.app.openProfileByHandle("cached");
  f.reads[0].resolve({ id: "old" }); await pending;
  assert.equal(f.reads.length, 1);
  assert.deepEqual(f.stack.at(-1), { profileId: "cached", profileHandle: "cached" });
});

test("Root editor guard still controls lookup completion, and cancel lets a deliberate retry proceed", async () => {
  const f = fixture({ initialStack: [{}, { logging: true, composerId: "draft" }] }), prompts = [];
  f.guardRef.current = prompt => prompts.push(prompt);
  const first = f.app.openPostById("linked");
  f.reads[0].resolve({ id: "linked" }); await first;
  assert.equal(prompts.length, 1); assert.equal(f.navigations.length, 0);
  prompts[0].cancel(); prompts[0].proceed();
  assert.equal(f.navigations.length, 0);
  const retry = f.app.openPostById("linked");
  f.reads[1].resolve({ id: "linked" }); await retry;
  assert.equal(prompts.length, 2);
  prompts[1].proceed();
  assert.equal(f.navigations.length, 1);
  assert.deepEqual(f.stack, [{}, { post: { id: "linked" } }]);
  prompts[1].proceed();
  assert.equal(f.navigations.length, 1, "claim is consumed before committing");
});

test("Root cancelling a direct dirty-editor leave preserves the still-relevant lookup", async () => {
  const f = fixture(), prompts = [];
  f.guardRef.current = prompt => prompts.push(prompt);
  const pending = f.app.openProfileByHandle("valid");
  f.app.go({ settings: true }); prompts[0].cancel();
  assert.equal(f.reads[0].options.signal.aborted, false);
  f.reads[0].resolve([{ id: "valid", handle: "valid" }]); await pending;
  prompts[1].proceed();
  assert.equal(f.stack.at(-1).profileId, "valid");
});

test("Root a stale discard approval cannot override a newer linked intent or account", async () => {
  const f = fixture(), prompts = [];
  f.guardRef.current = prompt => prompts.push(prompt);
  const older = f.app.openPostById("older");
  f.reads[0].resolve({ id: "older" }); await older;
  const newer = f.app.openPostById("newer");
  prompts[0].proceed(); assert.equal(f.navigations.length, 0);
  assert.equal(f.aborts, 0, "stale proceed cannot abort a current auth request");
  f.reads[1].resolve({ id: "newer" }); await newer;
  f.render({ id: "A" }, 2);
  prompts[1].proceed(); assert.equal(f.navigations.length, 0);
  assert.equal(f.aborts, 0, "old-account proceed must have no auth side effect");
});

test("Root busy editor cannot be escaped by lookup completion", async () => {
  const f = fixture({ initialStack: [{}, { logging: true }] });
  f.guardRef.current = ({ cancel }) => cancel();
  const pending = f.app.openPostById("linked");
  f.reads[0].resolve({ id: "linked" }); await pending;
  assert.equal(f.navigations.length, 0);
});

test("Root unmount and StrictMode cleanup never revive pending reads", async () => {
  const f = fixture(), old = f.app;
  const first = old.openPostById("old"); f.strictRemount();
  f.reads[0].resolve({ id: "old" }); await first;
  assert.equal(f.navigations.length, 0);
  const second = f.app.openPostById("fresh");
  f.reads[1].resolve({ id: "fresh" }); await second;
  assert.equal(f.stack.at(-1).post.id, "fresh");
  f.render();
  const third = f.app.openProfileByHandle("unmounted"); f.unmount();
  f.reads[2].resolve([{ id: "unmounted", handle: "unmounted" }]); await third;
  await old.openPostById("not-mounted");
  assert.equal(f.reads.length, 3); assert.equal(f.navigations.length, 1);
});

test("Root guest news links authenticate without fetching or replaying a post", async () => {
  const f = fixture({ session: null });
  await f.app.openPostById("news_private");
  assert.equal(f.reads.length, 0); assert.deepEqual(f.stack.at(-1), { auth: true });
  f.render({ id: "member" }, 2);
  assert.equal(f.reads.length, 0);
});

test("Root a resolved guest news post keeps its auth destination claim through the close guard", async () => {
  const f = fixture({ session: null }), prompts = [];
  f.guardRef.current = prompt => prompts.push(prompt);
  const pending = f.app.openPostById("opaque-id");
  f.reads[0].resolve({ id: "opaque-id", news: true }); await pending;
  const newer = f.app.openProfileByHandle("newer");
  prompts[0].proceed(); assert.equal(f.navigations.length, 0);
  f.reads[1].resolve([]); await newer;
});

for (const platform of ["android", "web"]) {
  test(`Root ${platform} keeps unowned Store calls while the newest review-open intent wins`, async () => {
    const f = fixture({ platform });
    const first = f.app.openPostById("first"), second = f.app.openPostById("second");
    assert.equal(f.ownerRef.current, null);
    assert.equal(f.reads[0].options, undefined); assert.equal(f.reads[1].options, undefined);
    f.reads[1].resolve({ id: "second" }); await second;
    f.reads[0].resolve({ id: "first" }); await first;
    assert.equal(f.stack.at(-1).post.id, "second", "a delayed older review must not replace the newer selected review");
    assert.equal(f.navigations.length, 1);
    const profile = f.app.openProfileByHandle("handle");
    assert.equal(f.reads[2].options, undefined);
    f.reads[2].resolve([{ id: "user", handle: "handle" }]); await profile;
    assert.equal(f.stack.at(-1).profileId, "user");
    const news = f.app.openNewsStory({ postId: "news-one" });
    assert.equal(f.reads[3].options, undefined);
    assert.deepEqual(snapshot(f.notices.at(-1)), { loading: true, story: { postId: "news-one" } });
    f.reads[3].resolve(null); await news;
    assert.deepEqual(snapshot(f.notices.at(-1)), { loading: false, story: { postId: "news-one" } });
  });
}

for (const firstKind of ["news", "post", "profile"]) {
  const secondKind = firstKind === "news" ? "profile" : "news";
  test(`Root newest ${firstKind} -> ${secondKind} intent also fences pending News`, async () => {
    const f = fixture();
    const open = (kind, id) => kind === "news" ? f.app.openNewsStory({ postId: id })
      : kind === "post" ? f.app.openPostById(id) : f.app.openProfileByHandle(id);
    const first = open(firstKind, "older"), second = open(secondKind, "newer");
    assert.equal(f.reads[0].options.signal.aborted, true);
    // The older result arrives before the newer lookup, not after its commit.
    f.reads[0].resolve(firstKind === "profile" ? [{ id: "older", handle: "older" }] : { id: "older" });
    await first; assert.equal(f.navigations.length, 0);
    f.reads[1].resolve(secondKind === "profile" ? [{ id: "newer", handle: "newer" }] : { id: "newer" });
    await second; assert.equal(f.navigations.length, 1);
  });
}

test("Root cancelling News aborts its lookup and keeps retry notice behavior", async () => {
  const f = fixture(), first = f.app.openNewsStory({ postId: "news-one" });
  f.app.cancelNewsStory();
  assert.equal(f.reads[0].options.signal.aborted, true);
  f.reads[0].resolve({ id: "news-one" }); await first;
  assert.equal(f.navigations.length, 0); assert.equal(f.notices.at(-1), null);
  const retry = f.app.openNewsStory({ postId: "news-one" });
  f.reads[1].resolve(null); await retry;
  assert.equal(f.notices.at(-1).loading, false);
  assert.deepEqual(snapshot(f.notices.at(-1).story), { postId: "news-one" });
});

test("Root an older News discard approval cannot override a newer linked read", async () => {
  const f = fixture(), prompts = [];
  f.guardRef.current = prompt => prompts.push(prompt);
  const news = f.app.openNewsStory({ postId: "old-news" });
  f.reads[0].resolve({ id: "old-news" }); await news;
  const post = f.app.openPostById("new-post");
  prompts[0].proceed();
  assert.equal(f.navigations.length, 0); assert.equal(f.aborts, 0);
  f.reads[1].resolve({ id: "new-post" }); await post;
  prompts[1].proceed(); assert.equal(f.stack.at(-1).post.id, "new-post");
});

test("Metro platform owner has an inert web/Android fallback", async () => {
  const fallback = await import("./linkedNavigationOwner.js");
  assert.equal(fallback.createLinkedNavigationOwner(), null);
  const ios = await import("./linkedNavigationOwner.ios.js");
  assert.equal(ios.createLinkedNavigationOwner, createIOSLinkedNavigation);
  assert.match(source, /import \{ createLinkedNavigationOwner \} from "\.\/src\/domain\/linkedNavigationOwner"/);
  assert.doesNotMatch(source, /import[^\n]+from "\.\/src\/domain\/iosLinkedNavigation\.mjs"/);
});

for (const change of ["route", "account", "epoch"]) {
  test(`Root a captured guest News callback is inert after ${change} changes`, async () => {
    const f = fixture({ session: null }), old = f.app;
    if (change === "route") f.app.go({ venueName: "Current venue" });
    if (change === "account") f.render({ id: "A" }, 2);
    if (change === "epoch") f.render(null, 2);
    const before = f.navigations.length;
    await old.openNewsStory({ postId: "news-old" });
    await old.openPostById("news-old");
    assert.equal(f.navigations.length, before);
    assert.equal(f.reads.length, 0);
  });
}

test("Root cancelling an old News notice cannot revoke the newer linked claim", async () => {
  const f = fixture(), news = f.app.openNewsStory({ postId: "old-news" });
  const post = f.app.openPostById("new-post");
  f.app.cancelNewsStory();
  assert.equal(f.reads[1].options.signal.aborted, false);
  f.reads[0].resolve(null); await news;
  assert.equal(f.notices.at(-1), null, "old failure cannot resurrect the cancelled notice");
  f.reads[1].resolve({ id: "new-post" }); await post;
  assert.equal(f.stack.at(-1).post.id, "new-post");
});

test("Root stale or invalid handles never fall back to an unrelated search result", async () => {
  const f = fixture(), original = f.stack;
  const pending = f.app.openProfileByHandle("exact-handle");
  f.reads[0].resolve([{ id: "other", handle: "similar-handle" }]); await pending;
  assert.deepEqual(f.stack, original);
  const retry = f.app.openProfileByHandle("exact-handle");
  f.reads[1].resolve([{ id: "artist", role: "artist", artistName: "Server Canonical", handle: "exact-handle" }]);
  await retry;
  assert.deepEqual(f.stack.at(-1), { artistName: "Server Canonical" });
});

test("Root an old resolved discard approval cannot act after a newer direct route", async () => {
  const f = fixture(), prompts = [];
  f.guardRef.current = prompt => prompts.push(prompt);
  const first = f.app.openPostById("older");
  f.reads[0].resolve({ id: "older" }); await first;
  f.guardRef.current = null;
  f.app.go({ venueName: "Current venue" });
  const aborts = f.aborts;
  prompts[0].proceed();
  assert.equal(f.aborts, aborts);
  assert.equal(f.navigations.length, 1);
  assert.deepEqual(f.stack.at(-1), { venueName: "Current venue" });
});

for (const change of ["account", "epoch"]) {
  test(`Root iOS News loading/retry notice is hidden synchronously after ${change} changes`, async () => {
    const f = fixture(), first = f.app.openNewsStory({ postId: "old-news" });
    assert.equal(f.render().newsStoryNotice.loading, true);
    f.render({ id: change === "account" ? "B" : "A" }, 2);
    assert.equal(f.app.newsStoryNotice, null, "do not wait for an effect or promise settlement");
    f.reads[0].resolve(null); await first;
    assert.equal(f.render().newsStoryNotice, null, "stale completion cannot restore notice");
    const next = f.app.openNewsStory({ postId: "new-news" });
    f.reads[1].resolve(null); await next;
    assert.equal(f.render().newsStoryNotice.loading, false);
    f.render({ id: change === "account" ? "C" : "A" }, 3);
    assert.equal(f.app.newsStoryNotice, null);
  });
}

for (const opener of ["post", "news", "resolved-news"]) {
  test(`Root guest ${opener} keeps an already-open auth screen without re-aborting authentication`, async () => {
    const f = fixture({ session: null, initialStack: [{}, { auth: true }] });
    if (opener === "post") await f.app.openPostById("news_one");
    if (opener === "news") await f.app.openNewsStory({ postId: "news-one" });
    if (opener === "resolved-news") {
      const pending = f.app.openPostById("opaque-id");
      f.reads[0].resolve({ id: "opaque-id", news: true }); await pending;
    }
    assert.equal(f.navigations.length, 0);
    assert.equal(f.aborts, 0);
    assert.equal(f.stack.length, 2);
  });
}

test("Root direct sign-in callbacks still accept normal press event arguments", () => {
  const f = fixture({ session: null });
  f.app.openSignIn({ nativeEvent: { target: 1 } });
  assert.deepEqual(f.stack.at(-1), { auth: true });
});

for (const action of ["cancel", "retry"]) {
  test(`Root a captured old News ${action} cannot supersede a newer News intent`, async () => {
    const f = fixture(), first = f.app.openNewsStory({ postId: "old-news" });
    let captured;
    if (action === "retry") {
      f.reads[0].resolve(null); await first;
      captured = f.render().retryNewsStoryNotice;
    } else captured = f.render().cancelNewsStoryNotice;
    const second = f.app.openNewsStory({ postId: "new-news" });
    captured();
    assert.equal(f.reads.length, 2, "stale retry must not fetch");
    assert.equal(f.reads[1].options.signal.aborted, false, "stale cancel must not abort the new story");
    assert.equal(f.notices.at(-1).story.postId, "new-news");
    if (action === "cancel") { f.reads[0].resolve(null); await first; }
    f.reads[1].resolve({ id: "new-news" }); await second;
    assert.equal(f.stack.at(-1).post.id, "new-news");
  });
}

test("Root current News notice can cancel or deliberately retry without a stale callback", async () => {
  const f = fixture(), first = f.app.openNewsStory({ postId: "news-one" });
  f.render().cancelNewsStoryNotice();
  assert.equal(f.reads[0].options.signal.aborted, true);
  f.reads[0].resolve(null); await first;
  const next = f.app.openNewsStory({ postId: "news-one" });
  f.reads[1].resolve(null); await next;
  f.render().retryNewsStoryNotice();
  assert.equal(f.reads.length, 3);
  f.reads[2].resolve({ id: "news-one" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.stack.at(-1).post.id, "news-one");
});
