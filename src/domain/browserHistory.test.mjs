import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createBrowserHistory, publicPresentationHintFromHistory } from "./browserHistory.mjs";

function fixture({ limit = 80 } = {}) {
  const entries = [{ state: null, url: "/event/x" }];
  let cursor = 0;
  const location = { pathname: "/event/x", href: "https://fixture.test/event/x" };
  const history = {
    get state() { return entries[cursor].state; },
    replaceState(state, _title, url) { entries[cursor] = { state, url }; },
    pushState(state, _title, url) { entries.splice(cursor + 1); entries.push({ state, url }); cursor++; location.pathname = url; },
    go(delta) { cursor += delta; location.pathname = entries[cursor].url; },
  };
  const controller = createBrowserHistory({ history, location, limit });
  return { controller, entries, location, history };
}
test("initial direct entry is replaced once and never creates a duplicate deep link", () => {
  const { controller, entries } = fixture();
  controller.initialize({ stack: [{}, { event: "x" }] });
  assert.equal(entries.length, 1);
  assert.equal(controller.canGoBack(), false);
});
test("browser history persists only opaque positions, never content or account fields", () => {
  const { controller, entries } = fixture();
  controller.initialize({ accountId: "private-member", stack: [{ password: "private-draft", photos: ["private-url"] }] });
  controller.write({ accountId: "private-member", stack: [{ email: "private-email" }] }, "/login");
  assert.equal(JSON.stringify(entries).includes("private"), false);
  for (const entry of entries) assert.deepEqual(Object.keys(entry.state).sort(), ["index", "key", "pit"]);
});

test("only an exact public post view enum survives reload, never its content or account", () => {
  const { controller, entries, history, location } = fixture();
  controller.initialize({ stack: [{}] });
  controller.write({ accountId: "private-member", stack: [{}, { post: { id: "p_review", review: "private-draft", media: ["private-url"] } }] }, "/post/p_review");
  const stored = history.state;
  assert.deepEqual(Object.keys(stored).sort(), ["index", "key", "pit", "presentation"]);
  assert.equal(stored.presentation, "post");
  assert.equal(JSON.stringify(entries).includes("private"), false);
  const reloaded = createBrowserHistory({ history, location });
  reloaded.initialize({ stack: [{}] });
  assert.deepEqual(publicPresentationHintFromHistory(history.state, location.pathname), { postId: "p_review" });
  reloaded.capture({ stack: [{}, { routeLoading: "/post/p_review" }] });
  assert.equal(history.state.presentation, "post", "hydration must not erase its own safe presentation input");
  reloaded.capture({ stack: [{}, { openLog: { id: "p_review" } }] });
  assert.equal(history.state.presentation, undefined, "returning to the summary removes the discussion preference");
});

test("post presentation hints cannot select arbitrary data, paths, or content", () => {
  const position = { pit: "mshpit-navigation-v1", key: "opaque", index: 1, presentation: "post", postId: "wrong", password: "private-password" };
  assert.deepEqual(publicPresentationHintFromHistory(position, "/post/p_review"), { postId: "p_review" });
  for (const path of ["/event/p_review", "/login", "/post/p_review?private=value", "/post/p_review/extra", `/post/${"p".repeat(201)}`]) {
    assert.equal(publicPresentationHintFromHistory(position, path), null);
  }
  for (const state of [null, { ...position, presentation: "admin" }, { ...position, index: -1 }, { ...position, pit: "unknown" }]) {
    assert.equal(publicPresentationHintFromHistory(state, "/post/p_review"), null);
  }
  const { history, location } = fixture();
  history.replaceState(position, "", "/post/p_review"); location.pathname = "/post/p_review";
  const clean = createBrowserHistory({ history, location }); clean.initialize({ stack: [{}] });
  assert.equal(JSON.stringify(history.state).includes("private"), false, "foreign persisted fields must be discarded");
  assert.equal(history.state.postId, undefined);
});

test("uncached account-boundary Back keeps only the public view hint", () => {
  const { controller, history, location } = fixture();
  controller.initialize({ stack: [{}] });
  controller.write({ accountId: "old-member", stack: [{}, { post: { id: "p_review", review: "private old data" } }] }, "/post/p_review");
  const postEntry = history.state;
  controller.write({ stack: [{}, { auth: true }] }, "/login");
  controller.clear();
  location.pathname = "/post/p_review";
  const back = controller.preparePop(postEntry);
  assert.equal(back.snapshot, null);
  assert.deepEqual(back.publicFrameHint, { postId: "p_review" });
  assert.equal(JSON.stringify(back).includes("private"), false);
});
test("snapshots are bounded and cleared at account boundaries", () => {
  const { controller, entries, location } = fixture({ limit: 3 });
  controller.initialize({ accountId: "a" });
  const old = entries[0].state;
  for (let i = 0; i < 8; i++) controller.write({ accountId: "a", post: i }, `/post/${i}`);
  assert.equal(controller.size, 3);
  controller.clear();
  assert.equal(controller.size, 0);
  location.pathname = "/event/x";
  assert.equal(controller.preparePop(old).snapshot, null);
});
test("a superseded pending Back decision cannot override a newer page click", () => {
  const { controller, entries, location } = fixture();
  controller.initialize({ landing: true });
  const first = entries[0].state;
  controller.write({ page: "a" }, "/artist/a");
  location.pathname = "/event/x";
  const previous = controller.preparePop(first);
  controller.write({ page: "b" }, "/artist/b");
  assert.equal(previous.accept(), false);
});
test("account reset does not recapture old frame data labeled as the next account", () => {
  const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const boundary = source.slice(source.indexOf("const confirmedNavigationAccountRef"), source.indexOf("// Persist tab + nav stack"));
  assert.match(boundary, /browserHistoryRef\.current\?\.clear\(\)/);
  assert.match(boundary, /browserHistoryRef\.current\?\.write\(next,/);
  assert.doesNotMatch(boundary, /writeNavigation\(next,/);
});
