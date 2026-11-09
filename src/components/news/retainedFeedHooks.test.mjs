import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "@babel/core";
import * as newsState from "../../domain/newsReaderState.mjs";
import * as loadState from "../../domain/loadState.mjs";
import * as errorCatalog from "../../lib/errorCatalog.mjs";
import { isAppErrorLike } from "../../domain/commandResult.mjs";
import { createNewsIntroductionSession } from "../../domain/newsIntroductionSession.mjs";

const require = createRequire(import.meta.url);
const settle = () => new Promise(resolve => setImmediate(resolve));
const socialApiCode = transformSync(readFileSync(new URL("../../features/socialReactions/socialReactionsApi.js", import.meta.url), "utf8"), {
  filename: "socialReactionsApi.js", babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")],
}).code;
const paths = { news: "./useNewsDeskStories.ios.js", intro: "./useNewsIntroduction.ios.js", following: "../../features/socialReactions/useFollowingFeed.ios.js" };
const compiled = Object.fromEntries(Object.entries(paths).flatMap(([name, iosPath]) => ["ios", "shared"].map(platform => {
  const path = platform === "ios" ? iosPath : iosPath.replace(".ios.js", ".js");
  return [`${name}:${platform}`, transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
    filename: path, babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")],
  }).code];
})));

// Use the real diagnostic error adapter with only its storage boundary stubbed.
const diagnostics = { exports: {} };
const diagnosticModules = {
  "./persist": { load: (_, fallback) => fallback, remove() {}, save() {}, setPersistErrorHandler() {} },
  "./errorCatalog.mjs": errorCatalog,
  "../domain/accountLocalPrivacy.mjs": { diagnosticsStorageKey: () => "fixture-diagnostics", LEGACY_DIAGNOSTICS_STORAGE_KEY: "fixture-legacy" },
  "../domain/deviceStoragePolicy.mjs": { shouldToastDeviceStorageFailure: () => false },
};
new Function("require", "module", "exports", transformSync(readFileSync(new URL("../../lib/diagnostics.js", import.meta.url), "utf8"), {
  filename: "diagnostics.js", babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")],
}).code)(name => { assert.ok(name in diagnosticModules, `Unexpected diagnostic import ${name}`); return diagnosticModules[name]; }, diagnostics, diagnostics.exports);

// Execute the production modules. Effects may be held after render to exercise
// the interval before cleanup, and even cancelled transports can resolve late.
function fixture(kind, platform = "ios") {
  const slots = [], snapshots = [], effects = new Map(), calls = [], timers = new Set(), timerHistory = [], listeners = new Set(), listenerHistory = [];
  let cursor = 0, sequence = 0, args = [], writes = 0;
  let context = { session: { id: "a" }, authReady: true, blockedIds: [], removedIds: [], mutedIds: [], followedArtists: ["Moon Walker"] };
  const same = (a, b) => a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, update => { writes++; slots[i].value = typeof update === "function" ? update(slots[i].value) : update; snapshots.push(slots[i].value); }];
    },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (same(slots[i]?.deps, deps)) { effects.delete(i); return; }
      effects.set(i, () => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    },
  };
  const read = options => new Promise((resolve, reject) => calls.push({ ...options, resolve, reject }));
  const socialApi = { exports: {} };
  new Function("require", "module", "exports", socialApiCode)(name => {
    assert.equal(name, "../../lib/api");
    return { api(path, settings) {
      const url = new URL(path, "https://fixture.invalid");
      return read({ accountId: settings.expectedAccountId, cursor: url.searchParams.get("before"), signal: settings.signal });
    } };
  }, socialApi, socialApi.exports);
  const modules = {
    "../../hooks/useIOSDetailPresentation": { __esModule: true, default: () => ({ active: true, current: () => true, guard: value => value, token: null }) },
    react,
    "../../lib/newsDeskApi": { fetchNewsDeskStories: read, requestNewsIntroduction: read },
    "./NewsInteractionContext": { useNewsInteractions: () => context },
    "../../domain/newsReaderState.mjs": newsState,
    "../../domain/loadState.mjs": loadState,
    "../../lib/diagnostics": diagnostics.exports,
    "../../domain/newsIntroductionSession.mjs": { newsIntroductionSession: createNewsIntroductionSession() },
    "../../domain/chatDelivery.mjs": { createChatClientMutationId: () => `request-${++sequence}` },
    "./socialReactionsApi": {
      readFollowingFeed: socialApi.exports.readFollowingFeed,
      subscribeSocialReactionChanges(listener) {
        listeners.add(listener); listenerHistory.push(listener);
        const unsubscribe = socialApi.exports.subscribeSocialReactionChanges(listener);
        return () => { listeners.delete(listener); unsubscribe(); };
      },
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "setInterval", "clearInterval", compiled[`${kind}:${platform}`])(
    name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, module, module.exports,
    fn => { timers.add(fn); timerHistory.push(fn); return fn; }, fn => timers.delete(fn),
  );
  return {
    calls, snapshots, timers, timerHistory, listeners, listenerHistory,
    get writes() { return writes; },
    context(update) { context = { ...context, ...update }; },
    render(...nextArgs) { if (nextArgs.length) args = nextArgs; cursor = 0; return module.exports.default(...args); },
    commit() { const pending = [...effects.values()]; effects.clear(); for (const effect of pending) effect(); },
    unmount() { effects.clear(); for (const slot of slots) slot?.cleanup?.(); },
    tick() { for (const timer of timers) timer(); },
    changed(accountId = "a") { socialApi.exports.notifySocialReactionChange(accountId); },
  };
}
const options = (kind, enabled = true, retainOnInactive = true) => kind === "news"
  ? { enabled, retainOnInactive }
  : { accountId: "a", privacyScope: "clear", enabled, retainOnInactive };
const rows = (kind, view) => kind === "news" ? view.stories : view.posts;
const result = (kind, ids, nextCursor = null) => ({ [kind === "news" ? "stories" : "posts"]: ids.map(id => ({ id })), nextCursor });
const ids = (kind, view) => rows(kind, view).map(row => row.id);

for (const kind of ["news", "following"]) {
  test(`${kind}: retained multi-page rows and cursor survive inactivity without a re-entry read`, async () => {
    const f = fixture(kind);
    f.render(options(kind)); f.commit();
    f.calls[0].resolve(result(kind, ["one"], "page-two")); await settle();
    const page = f.render().loadMore();
    f.calls[1].resolve(result(kind, ["two"], "page-three")); await page;
    const active = f.render();
    const hidden = f.render(options(kind, false));
    assert.equal(rows(kind, hidden), rows(kind, active));
    assert.equal(hidden.nextCursor, "page-three");
    assert.equal(hidden.status, "ready");
    await Promise.all([active.reload(), active.loadMore(), hidden.reload(), hidden.loadMore()]);
    f.tick(); f.changed("unrelated-account");
    assert.equal(f.calls.length, 2, "no callback, timer or mutation starts hidden work before effect cleanup");
    f.commit();
    assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, kind === "following" ? 1 : 0);
    const resumed = f.render(options(kind)); f.commit();
    assert.deepEqual(ids(kind, resumed), ["one", "two"]);
    assert.equal(f.calls.length, 2);
    await active.reload();
    assert.equal(f.calls.length, 2, "an earlier visible callback remains stale after re-entry");
    const append = f.render().loadMore();
    assert.equal(f.calls[2].cursor, "page-three");
    f.calls[2].resolve(result(kind, ["three"])); await append;
    assert.deepEqual(ids(kind, f.render()), ["one", "two", "three"]);
    f.unmount();
  });

  test(`${kind}: hiding during pagination restores settled state and fences both late outcomes`, async () => {
    for (const late of ["resolve", "reject"]) {
      const f = fixture(kind);
      f.render(options(kind)); f.commit(); f.calls[0].resolve(result(kind, ["one"], "next")); await settle();
      const append = f.render().loadMore(), pending = f.calls[1];
      assert.equal(f.render().status, "loading");
      const hidden = f.render(options(kind, false));
      assert.equal(pending.signal.aborted, true);
      assert.equal(hidden.status, "ready"); assert.deepEqual(ids(kind, hidden), ["one"]); assert.equal(hidden.nextCursor, "next");
      const writes = f.writes;
      pending[late](late === "resolve" ? result(kind, ["stale"], "bad") : Error("late failure")); await append;
      assert.equal(f.writes, writes, "no hidden state writes from cancelled page");
      f.commit(); f.render(options(kind)); f.commit();
      assert.equal(f.calls.length, 2); assert.equal(f.render().status, "ready");
      const retry = f.render().loadMore(); assert.equal(f.calls[2].cursor, "next");
      f.calls[2].resolve(result(kind, ["two"])); await retry;
      assert.deepEqual(ids(kind, f.render()), ["one", "two"]); f.unmount();
    }
  });

  test(`${kind}: initial inactive mounts do no work; cancelled initial reads retry only on resume`, async () => {
    const f = fixture(kind);
    f.render(options(kind, false)); f.commit(); f.tick(); f.changed();
    assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, kind === "following" ? 1 : 0);
    const active = f.render(options(kind)); f.commit(); const first = f.calls[0];
    f.render(options(kind, false)); assert.equal(first.signal.aborted, true); f.commit();
    first.resolve(result(kind, ["hidden"])); await settle(); assert.deepEqual(ids(kind, f.render()), []);
    f.render(options(kind)); f.commit(); assert.equal(f.calls.length, 2);
    await active.reload(); assert.equal(f.calls.length, 2);
    f.calls[1].resolve(result(kind, [])); await settle();
    f.render(options(kind, false)); f.commit(); f.render(options(kind)); f.commit();
    assert.equal(f.calls.length, 2, "completed empty reads are retained too"); f.unmount();
  });

  test(`${kind}: completed errors retain retry state, while cancelled reloads cannot leave a spinner`, async () => {
    const f = fixture(kind);
    f.render(options(kind)); f.commit(); f.calls[0].resolve(result(kind, ["one"], "next")); await settle();
    const page = f.render().loadMore(); f.calls[1].reject({ status: 500 }); await page;
    assert.equal(f.render().status, "error");
    f.render(options(kind, false)); f.commit(); f.render(options(kind)); f.commit();
    assert.equal(f.calls.length, 2); assert.equal(f.render().status, "error");
    if (kind === "news") {
      assert.equal(f.render().failedMore, true);
      const retry = f.render().retry(); assert.equal(f.calls[2].cursor, "next");
      f.calls[2].resolve(result(kind, ["two"], "third")); await retry;
    }
    const refresh = f.render().reload(); const pending = f.calls.at(-1);
    const hidden = f.render(options(kind, false)); assert.notEqual(hidden.status, "loading");
    pending.resolve(result(kind, ["stale"])); await refresh; f.commit();
    f.render(options(kind)); f.commit(); assert.notEqual(f.render().status, "loading"); f.unmount();
  });

  test(`${kind}: privacy/account round trips discard admitted data, cursors and stale callbacks`, async () => {
    for (const change of ["account", "privacy"]) {
      const f = fixture(kind);
      const original = options(kind);
      f.render(original); f.commit(); f.calls[0].resolve(result(kind, ["private"], "private-cursor")); await settle();
      const old = f.render(); const pending = old.loadMore();
      if (kind === "news") f.context(change === "account" ? { session: { id: "b" } } : { blockedIds: ["blocked"] });
      const other = kind === "following" ? { ...original, [change === "account" ? "accountId" : "privacyScope"]: "b", enabled: false } : { ...original, enabled: false };
      assert.deepEqual(ids(kind, f.render(other)), []);
      assert.equal(f.calls[1].signal.aborted, true);
      await old.reload(); assert.equal(f.calls.length, 2);
      f.commit();
      if (kind === "news") f.context({ session: { id: "a" }, blockedIds: [] });
      assert.deepEqual(ids(kind, f.render({ ...original, enabled: false })), [], "returning to an earlier scope never resurrects its rows");
      assert.equal(f.render().nextCursor, null); f.commit();
      f.calls[1].resolve(result(kind, ["late-private"])); await pending;
      f.render(original); f.commit(); assert.equal(f.calls.length, 3); assert.equal(f.calls[2].cursor, null);
      f.calls[2].resolve(result(kind, ["fresh"])); await settle(); assert.deepEqual(ids(kind, f.render()), ["fresh"]);
      await old.loadMore(); assert.equal(f.calls.length, 3); f.unmount();
    }
  });

  test(`${kind}: unmount cancels requests and invalidates retained callbacks`, async () => {
    const f = fixture(kind);
    f.render(options(kind)); f.commit(); f.calls[0].resolve(result(kind, ["one"], "next")); await settle();
    const active = f.render(), page = active.loadMore(), pending = f.calls[1];
    f.unmount(); assert.equal(pending.signal.aborted, true);
    const writes = f.writes;
    await active.reload(); await active.loadMore();
    for (const timer of f.timerHistory) timer(); for (const listener of f.listenerHistory) listener("a");
    pending.resolve(result(kind, ["late"])); await page;
    assert.equal(f.calls.length, 2); assert.equal(f.writes, writes);
  });

  test(`${kind}: explicit retention opt-out preserves ordinary re-entry refresh`, async () => {
    const f = fixture(kind), enabled = options(kind, true, false);
    f.render(enabled); f.commit(); f.calls[0].resolve(result(kind, ["one"], "next")); await settle(); f.render();
    f.render({ ...enabled, enabled: false }); f.commit(); f.render(enabled); f.commit();
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].cursor, null); f.unmount();
  });
}

test("News auth readiness loss clears retained data even when the account/privacy key is unchanged", async () => {
  const f = fixture("news"); f.render(options("news")); f.commit(); f.calls[0].resolve(result("news", ["private"], "next")); await settle();
  const old = f.render(); f.context({ authReady: false });
  assert.deepEqual(f.render(options("news", false)).stories, []); f.commit();
  f.context({ authReady: true }); assert.deepEqual(f.render().stories, []); f.commit();
  await old.reload(); assert.equal(f.calls.length, 1);
  f.render(options("news")); f.commit(); assert.equal(f.calls.length, 2); f.unmount();
});

test("Following old polling callbacks stay inert after retained re-entry", async () => {
  const f = fixture("following"); f.render(options("following")); f.commit(); f.calls[0].resolve(result("following", ["one"])); await settle();
  f.render(); const timer = f.timerHistory[0];
  f.render(options("following", false)); timer(); f.commit();
  f.render(options("following")); f.commit(); timer();
  assert.equal(f.calls.length, 1);
  f.tick(); assert.equal(f.calls.length, 2, "current visible polling still works"); f.unmount();
});

test("Following queued invalidation survives interrupted pagination but waits for visible re-entry", async () => {
  const f = fixture("following"); f.render(options("following")); f.commit(); f.calls[0].resolve(result("following", ["one"], "next")); await settle();
  const page = f.render().loadMore(); f.changed(); f.changed();
  f.render(options("following", false)); f.commit();
  f.calls[1].resolve(result("following", ["late"])); await page;
  assert.equal(f.calls.length, 2); assert.deepEqual(ids("following", f.render()), ["one"]);
  f.render(options("following")); f.commit(); assert.equal(f.calls.length, 3); assert.equal(f.calls[2].cursor, null);
  f.calls[2].resolve(result("following", ["fresh"])); await settle(); assert.deepEqual(ids("following", f.render()), ["fresh"]); f.unmount();
});

test("Following authority failures cannot restore previously admitted data on retained re-entry", async () => {
  for (const status of [401, 403, 404, 410]) {
    const f = fixture("following"); f.render(options("following")); f.commit(); f.calls[0].resolve(result("following", ["private"], "next")); await settle();
    const refresh = f.render().reload(); f.calls[1].reject({ status }); await refresh;
    f.render(options("following", false)); f.commit(); f.render(options("following")); f.commit();
    assert.deepEqual(f.render().posts, []); assert.equal(f.render().nextCursor, null); assert.equal(f.render().status, "error"); assert.equal(f.calls.length, 2); f.unmount();
  }
});

const retained = { retainOnInactive: true };
test("introduction: an admitted pin survives hide/re-entry without a second command or stale dismissal", async () => {
  const f = fixture("intro"); f.render(true, retained); f.commit(); f.calls[0].resolve({ post: { id: "news_one" } }); await settle();
  const active = f.render(), hidden = f.render(false, retained);
  assert.equal(hidden.post, active.post); active.dismiss(); hidden.dismiss(); await active.retry(); await hidden.retry();
  assert.equal(f.render().post.id, "news_one"); f.commit();
  f.render(true, retained); f.commit(); active.dismiss(); hidden.dismiss();
  assert.equal(f.render().post.id, "news_one"); assert.equal(f.calls.length, 1);
  f.render().dismiss(); assert.equal(f.render().post, null);
  f.render(false, retained); f.commit(); f.render(true, retained); f.commit(); assert.equal(f.calls.length, 1); f.unmount();
});

test("introduction: incomplete command aborts before effects and stale callbacks cannot consume its receipt", async () => {
  const f = fixture("intro"); f.render(false, retained); f.commit(); assert.equal(f.calls.length, 0);
  const active = f.render(true, retained); f.commit(); const first = f.calls[0];
  const hidden = f.render(false, retained); assert.equal(first.signal.aborted, true);
  active.dismiss(); hidden.dismiss(); await active.retry(); await hidden.retry(); assert.equal(f.calls.length, 1);
  first.resolve({ post: { id: "hidden" } }); await settle(); assert.equal(f.render().post, null); f.commit();
  f.render(true, retained); f.commit(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].requestId, first.requestId);
  active.dismiss(); hidden.dismiss(); f.calls[1].resolve({ post: { id: "accepted" } }); await settle();
  assert.equal(f.render().post.id, "accepted"); f.unmount();
});

test("introduction: account, block, removal, mute, follows and auth boundaries never resurrect an admitted pin", async () => {
  for (const change of [{ session: { id: "b" } }, { blockedIds: ["blocked"] }, { removedIds: ["news_one"] }, { mutedIds: ["muted"] }, { followedArtists: ["Other artist"] }, { authReady: false }]) {
    const f = fixture("intro"); f.render(true, retained); f.commit(); f.calls[0].resolve({ post: { id: "news_one" } }); await settle();
    const old = f.render(); f.context(change); assert.equal(f.render(false, retained).post, null); f.commit();
    f.context({ session: { id: "a" }, blockedIds: [], removedIds: [], mutedIds: [], followedArtists: ["Moon Walker"], authReady: true });
    assert.equal(f.render().post, null); f.commit(); f.render(true, retained); f.commit();
    old.dismiss(); await old.retry(); assert.equal(f.render().post, null); assert.equal(f.calls.length, 1); f.unmount();
  }
});

test("introduction: unmount fences command completions and all old controls", async () => {
  const f = fixture("intro"), active = f.render(true, retained); f.commit();
  f.unmount(); assert.equal(f.calls[0].signal.aborted, true); const writes = f.writes;
  active.dismiss(); await active.retry(); f.calls[0].resolve({ post: { id: "late" } }); await settle();
  assert.equal(f.writes, writes); assert.equal(f.calls.length, 1);
});

for (const kind of ["news", "following"]) {
  test(`${kind}: native defaults retain data while shared web/Android defaults still refresh`, async () => {
    for (const platform of ["ios", "shared"]) {
      const f = fixture(kind, platform), enabled = options(kind); delete enabled.retainOnInactive;
      f.render(enabled); f.commit(); f.calls[0].resolve(result(kind, ["one"], "next")); await settle();
      const active = f.render(), hidden = f.render({ ...enabled, enabled: false }); f.commit();
      if (platform === "ios") assert.equal(rows(kind, hidden), rows(kind, active));
      if (platform === "shared" && kind === "news") assert.deepEqual(hidden.stories, []);
      f.render(enabled); f.commit();
      assert.equal(f.calls.length, platform === "ios" ? 1 : 2);
      f.unmount();
    }
  });
}

test("introduction: iOS defaults preserve the pin; shared defaults and native opt-out retain prior behavior", async () => {
  for (const [platform, config, keep] of [["ios", undefined, true], ["shared", undefined, false], ["ios", { retainOnInactive: false }, false]]) {
    const f = fixture("intro", platform); f.render(true, config); f.commit(); f.calls[0].resolve({ post: { id: "news_one" } }); await settle();
    f.render(); const hidden = f.render(false, config); assert.equal(hidden.post?.id || null, keep ? "news_one" : null); f.commit();
    const resumed = f.render(true, config); f.commit(); assert.equal(resumed.post?.id || null, keep ? "news_one" : null);
    assert.equal(f.calls.length, 1); f.unmount();
  }
});


test("News cancelling a page retry retains the error and exact retry cursor", async () => {
  const f = fixture("news"); f.render(options("news")); f.commit(); f.calls[0].resolve(result("news", ["one"], "page-two")); await settle();
  const append = f.render().loadMore(); f.calls[1].reject(Error("offline")); await append;
  const retry = f.render().retry(); assert.equal(f.calls[2].cursor, "page-two");
  const hidden = f.render(options("news", false)); assert.equal(hidden.status, "error"); assert.equal(hidden.failedMore, true); f.commit();
  f.calls[2].reject(Error("cancelled")); await retry;
  f.render(options("news")); f.commit(); assert.equal(f.calls.length, 3);
  const again = f.render().retry(); assert.equal(f.calls[3].cursor, "page-two");
  f.calls[3].resolve(result("news", ["two"])); await again;
  assert.deepEqual(f.render().stories.map(story => story.id), ["one", "two"]); f.unmount();
});


test("Following resources use canonical LoadState data, timestamps and AppError failures", async () => {
  const f = fixture("following"); f.render(options("following")); f.commit();
  const initial = f.snapshots.at(-1); assert.equal(initial.status, "loading"); assert.equal(initial.updatedAt, null);
  f.calls[0].resolve(result("following", ["one"], "next")); await settle();
  const settled = f.snapshots.at(-1); assert.equal(settled.status, "ready"); assert.equal(typeof settled.updatedAt, "number");
  const refresh = f.render().reload(); assert.equal(f.snapshots.at(-1).status, "refreshing"); assert.equal(f.render().status, "loading");
  f.calls[1].reject({ status: 500 }); await refresh;
  const failed = f.snapshots.at(-1); assert.equal(failed.status, "error"); assert.equal(isAppErrorLike(failed.error), true);
  assert.equal(failed.updatedAt, settled.updatedAt); assert.deepEqual(failed.data.posts, [{ id: "one" }]);
  for (const resource of f.snapshots) assert.deepEqual(Object.keys(resource).sort(), ["data", "error", "scope", "status", "updatedAt"]);
  const retry = f.render().reload(); f.calls[2].reject({ status: 403 }); await retry;
  const denied = f.snapshots.at(-1); assert.equal(denied.updatedAt, null); assert.deepEqual(denied.data, { posts: [], nextCursor: null });
  assert.equal(denied.error.code, "PIT-AUTH-002"); assert.equal(f.render().loaded, false); f.unmount();
});

test("Following transport cancellation restores its canonical settled resource without an error", async () => {
  const f = fixture("following"); f.render(options("following")); f.commit();
  f.calls[0].resolve(result("following", ["one"], "next")); await settle(); const settled = f.snapshots.at(-1);
  const append = f.render().loadMore(); f.calls[1].reject(Object.assign(Error("aborted"), { name: "AbortError" })); await append;
  assert.equal(f.snapshots.at(-1), settled); assert.equal(f.render().status, "ready"); assert.equal(f.render().nextCursor, "next"); f.unmount();
});


test("Following navigation precommit fences reads but remembers relevant mutation invalidations", async () => {
  let current = true;
  const presentation = { current: () => current }, props = { ...options("following"), presentation };
  const f = fixture("following"); f.render(props); f.commit(); f.calls[0].resolve(result("following", ["one"], "next")); await settle();
  const active = f.render(); current = false;
  await active.reload(); await active.loadMore(); f.tick(); f.changed();
  assert.equal(f.calls.length, 1, "a navigation decision closes the gap before the next render");
  const resumed = f.render({ ...props, presentation: { current: () => true } }); f.commit();
  assert.deepEqual(resumed.posts, [{ id: "one" }]); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].cursor, null);
  f.calls[1].resolve(result("following", ["fresh"], "fresh-next")); await settle();
  current = true; await active.reload(); for (const timer of f.timerHistory.slice(0, -1)) timer();
  assert.equal(f.calls.length, 2, "retired presentation controls never target the new owner");
  const append = f.render().loadMore(); assert.equal(f.calls[2].cursor, "fresh-next");
  f.calls[2].resolve(result("following", ["two"])); await append; assert.deepEqual(f.render().posts, [{ id: "fresh" }, { id: "two" }]); f.unmount();
});

test("Following precommit rejects an in-flight response and postpones reconciliation until Back", async () => {
  let current = true;
  const props = { ...options("following"), presentation: { current: () => current } };
  const f = fixture("following"); f.render(props); f.commit(); f.calls[0].resolve(result("following", ["one"], "next")); await settle();
  const append = f.render().loadMore(); f.changed(); const writes = f.writes;
  current = false; f.calls[1].resolve(result("following", ["late"])); await append;
  assert.equal(f.writes, writes); assert.equal(f.calls.length, 2);
  const resumed = f.render({ ...props, presentation: { current: () => true } }); f.commit();
  assert.equal(resumed.status, "ready"); assert.deepEqual(resumed.posts, [{ id: "one" }]); assert.equal(resumed.nextCursor, "next");
  assert.equal(f.calls.length, 3); assert.equal(f.calls[2].cursor, null);
  f.calls[2].resolve(result("following", ["confirmed"])); await settle(); assert.deepEqual(f.render().posts, [{ id: "confirmed" }]); f.unmount();
});

test("Following hidden unfollow/repost invalidations reconcile expanded history once on Back", async () => {
  const f = fixture("following"), props = options("following");
  f.render(props); f.commit(); f.calls[0].resolve(result("following", Array.from({ length: 30 }, (_, i) => `unfollowed-${i}`), "page-two")); await settle();
  const page = f.render().loadMore(); f.calls[1].resolve(result("following", ["unfollowed-30", "still-followed"], "page-three")); await page;
  const active = f.render(); f.tick(); assert.equal(f.calls.length, 2, "expanded history does not poll page one");
  f.render({ ...props, enabled: false }); f.commit(); const writes = f.writes;
  f.changed("another-account"); f.tick(); assert.equal(f.calls.length, 2); assert.equal(f.writes, writes);
  const unchanged = f.render(props); f.commit(); assert.equal(unchanged.posts, active.posts); assert.equal(unchanged.nextCursor, "page-three"); assert.equal(f.calls.length, 2);
  f.render({ ...props, enabled: false }); f.commit();
  f.changed(); f.changed(); f.changed(); f.tick();
  assert.equal(f.calls.length, 2, "the production mutation emitter performs no hidden read"); assert.equal(f.writes, writes);
  f.render(props); f.commit(); assert.equal(f.calls.length, 3); assert.equal(f.calls[2].cursor, null);
  assert.equal(f.render().posts.length, 32, "keep readable history until its authoritative replacement arrives");
  f.calls[2].resolve(result("following", ["still-followed", "new-repost"], "fresh-page-two")); await settle();
  assert.deepEqual(f.render().posts, [{ id: "still-followed" }, { id: "new-repost" }]); assert.equal(f.render().nextCursor, "fresh-page-two");
  f.render({ ...props, enabled: false }); f.commit(); f.render(props); f.commit(); assert.equal(f.calls.length, 3, "a reconciled version does not refresh again on unchanged Back"); f.unmount();
});

test("Following revoked account/privacy listeners cannot dirty a new retained scope", async () => {
  for (const change of [{ accountId: "b" }, { privacyScope: "blocked" }]) {
    const f = fixture("following"), props = options("following");
    f.render(props); f.commit(); f.calls[0].resolve(result("following", ["old"], "old-next")); await settle();
    f.render({ ...props, enabled: false }); f.commit(); const revoked = f.listenerHistory[0]; f.changed();
    const next = { ...props, ...change }; f.render(next); revoked("a"); f.commit(); assert.equal(f.calls.length, 2);
    f.calls[1].resolve(result("following", ["new"], "new-next")); await settle();
    f.render({ ...next, enabled: false }); f.commit(); revoked("a");
    f.render(next); f.commit(); assert.equal(f.calls.length, 2); assert.deepEqual(f.render().posts, [{ id: "new" }]);
    f.unmount(); const writes = f.writes; for (const listener of f.listenerHistory) listener(next.accountId); assert.equal(f.calls.length, 2); assert.equal(f.writes, writes);
  }
});

test("Following mutation during Back reconciliation remains dirty until a newer fresh response", async () => {
  const f = fixture("following"), props = options("following");
  f.render(props); f.commit(); f.calls[0].resolve(result("following", ["old"])); await settle();
  f.render({ ...props, enabled: false }); f.commit(); f.changed(); f.render(props); f.commit();
  assert.equal(f.calls.length, 2); f.changed();
  f.calls[1].resolve(result("following", ["before-second-change"])); await settle();
  assert.equal(f.calls.length, 3, "a later mutation cannot be acknowledged by an earlier request");
  f.calls[2].resolve(result("following", ["after-second-change"])); await settle();
  f.render({ ...props, enabled: false }); f.commit(); f.render(props); f.commit();
  assert.equal(f.calls.length, 3); assert.deepEqual(f.render().posts, [{ id: "after-second-change" }]); f.unmount();
});

test("Following failed or interrupted reconciliation keeps hidden invalidations pending for the next entry", async () => {
  for (const outcome of ["failure", "interruption"]) {
    const f = fixture("following"), props = options("following");
    f.render(props); f.commit(); f.calls[0].resolve(result("following", ["old"], "old-next")); await settle();
    f.render({ ...props, enabled: false }); f.commit(); f.changed();
    f.render(props); f.commit(); assert.equal(f.calls.length, 2);
    if (outcome === "failure") { f.calls[1].reject({ status: 500 }); await settle(); }
    f.render({ ...props, enabled: false }); f.commit();
    if (outcome === "interruption") { assert.equal(f.calls[1].signal.aborted, true); f.calls[1].resolve(result("following", ["obsolete"])); await settle(); }
    assert.equal(f.calls.length, 2);
    f.render(props); f.commit(); assert.equal(f.calls.length, 3); assert.equal(f.calls[2].cursor, null);
    f.calls[2].resolve(result("following", ["fresh"])); await settle(); assert.deepEqual(f.render().posts, [{ id: "fresh" }]);
    f.render({ ...props, enabled: false }); f.commit(); f.render(props); f.commit(); assert.equal(f.calls.length, 3); f.unmount();
  }
});
