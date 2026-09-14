import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createBrowserHistory } from "./browserHistory.mjs";

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
