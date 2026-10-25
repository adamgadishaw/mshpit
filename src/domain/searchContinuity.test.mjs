import assert from "node:assert/strict";
import test from "node:test";
import { searchContinuity } from "./searchContinuity.mjs";
import { createBrowserHistory } from "./browserHistory.mjs";

test("search continuity expires, is bounded, and rejects a different account or logout", () => {
  const value = { accountId: "a", at: 1000, query: "private-query", category: "shows", scrollY: 325, people: ["private-result"] };
  assert.deepEqual(searchContinuity(value, "a", 2000), { accountId: "a", at: 1000, query: "private-query", category: "shows", scrollY: 325 });
  for (const account of ["b", null, undefined]) assert.equal(searchContinuity(value, account, 2000), null);
  assert.equal(searchContinuity(value, "a", 1000 + 15 * 60 * 1000 + 1), null);
  assert.equal(searchContinuity(value, "a", 999), null);
  const bounded = searchContinuity({ ...value, query: "x".repeat(10000), category: "unknown", scrollY: Infinity }, "a", 2000);
  assert.equal(bounded.query.length, 512);
  assert.equal(bounded.category, "all");
  assert.equal(bounded.scrollY, 0);
});

test("route entries retain independent search context in bounded memory without exposing it in browser history", () => {
  const entries = [];
  const location = { pathname: "/search", href: "https://fixture.test/search" };
  let index = 0;
  const history = {
    get state() { return entries[index]?.state; },
    replaceState(state, _title, url) { entries[index] = { state, url }; },
    pushState(state, _title, url) { entries.splice(++index); entries.push({ state, url }); location.pathname = url; },
  };
  const controller = createBrowserHistory({ history, location, limit: 2 });
  const snapshot = query => ({ accountId: "a", stack: [{}], tab: "search", searchContinuity: { accountId: "a", at: 1000, query, category: "artists", scrollY: 325 } });
  controller.initialize(snapshot("first-private"));
  const first = history.state;
  controller.capture(snapshot("edited-private"));
  assert.equal(entries.length, 1);
  controller.write(snapshot("second-private"), "/artist/x");
  const second = history.state;
  location.pathname = "/search";
  const back = controller.preparePop(first);
  assert.equal(back.snapshot.searchContinuity.query, "edited-private");
  assert.equal(back.accept(), true);
  location.pathname = "/artist/x";
  const forward = controller.preparePop(second);
  assert.equal(forward.snapshot.searchContinuity.query, "second-private");
  assert.equal(forward.accept(), true);
  assert.equal(JSON.stringify(entries).includes("private"), false);
  controller.write(snapshot("third-private"), "/search");
  assert.equal(controller.size, 2);
  location.pathname = "/search";
  assert.equal(controller.preparePop(first).snapshot, null);
  controller.clear();
  assert.equal(controller.size, 0);
  assert.equal(controller.preparePop(second).snapshot, null);
});
