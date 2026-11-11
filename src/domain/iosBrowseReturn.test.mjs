import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { browseSnapshot, createBrowseReturnStore, createBrowseScrollReturn } from "./iosBrowseReturn.mjs";
const fixture = () => { const store = createBrowseReturnStore(); store.account("A"); return store; };
test("detail return keeps Search query/category/scroll without results", () => {
  const store = fixture(), before = store.lease("search");
  before.save({ query: "Björk", category: "artists", scrollY: 940, rows: [{ private: true }] });
  const after = store.lease("search");
  assert.equal(after, before);
  assert.deepEqual(after.read(), { query: "Björk", category: "artists", scrollY: 940 });
});
test("Discover keeps only bounded filters and offset, not fetched payloads", () => {
  const store = fixture(), lease = store.lease("discover");
  lease.save({ query: "rock", programme: "shows", region: "Canada", scope: "local", touched: true,
    days: 90, eventView: "list", eventWeek: "2026-11-09", scrollY: 850, genre: "rock", genreFocused: true, events: [1, 2] });
  assert.equal(lease.read().days, 90); assert.equal(lease.read().region, "Canada");
  assert.equal(lease.read().eventWeek, "2026-11-09"); assert.equal(lease.read().genreFocused, true);
  assert.equal("events" in lease.read(), false);
  assert.equal(browseSnapshot("search", { query: "x".repeat(1000), scrollY: Infinity }).query.length, 240);
  assert.equal(browseSnapshot("search", { scrollY: Infinity }).scrollY, 0);
});
test("A to B and logout clear snapshots; stale callbacks cannot write for B or new A", () => {
  const store = fixture(), a = store.lease("search"); a.save({ query: "private A" });
  store.account("B"); const b = store.lease("search"); a.save({ query: "late A" });
  assert.equal(b.read(), undefined); b.save({ query: "B" });
  store.account(null); assert.equal(store.lease("search").read(), undefined);
  store.account("A"); a.save({ query: "late A again" }); assert.equal(store.lease("search").read(), undefined);
});
test("explicit new navigation invalidates old callbacks even for same account", () => {
  const store = fixture(), old = store.lease("search"); old.save({ query: "old" });
  store.reset("search"); const fresh = store.lease("search"); old.save({ query: "late" });
  assert.notEqual(fresh.key, old.key); assert.equal(fresh.read(), undefined);
  assert.equal(store.lease("other"), null);
});
test("routine same-account render does not clear state", () => {
  const store = fixture(), lease = store.lease("search"); lease.save({ query: "still here" });
  store.account("A"); assert.equal(store.lease("search").read().query, "still here");
});
const layout = (height) => ({ nativeEvent: { layout: { height } } });
const scroll = (y) => ({ nativeEvent: { contentOffset: { y } } });
test("return waits for ready results and layout, then restores just once", () => {
  const calls = [], saved = [], ref = { scrollTo: (value) => calls.push(value) };
  const state = createBrowseScrollReturn(940, (value) => saved.push(value));
  state.onScroll(scroll(0)); state.onContentSizeChange(390, 2000); state.update(ref, false);
  state.onLayout(layout(700)); assert.equal(calls.length, 0); state.update(ref, true);
  assert.deepEqual(calls, [{ y: 940, animated: false }]);
  state.onContentSizeChange(390, 2200); state.update(ref, true); assert.equal(calls.length, 1);
  state.onScroll(scroll(1020)); assert.deepEqual(saved.at(-1), { scrollY: 1020 });
});
test("loading placeholder does not consume offset before native content measures", () => {
  const calls = [], state = createBrowseScrollReturn(800);
  state.onLayout(layout(600)); state.onContentSizeChange(390, 100); state.update({ scrollTo: (v) => calls.push(v) }, true);
  assert.equal(calls.length, 0); state.onContentSizeChange(390, 1600); assert.equal(calls[0].y, 800);
});
test("new gestures and filter selection cancel an outstanding restoration", () => {
  for (const action of ["onScrollBeginDrag", "cancel"]) {
    const calls = [], state = createBrowseScrollReturn(400); state[action]();
    state.onLayout(layout(600)); state.onContentSizeChange(390, 1600); state.update({ scrollTo: (v) => calls.push(v) }, true);
    assert.equal(calls.length, 0);
  }
});
test("App gates snapshots to iOS, retains no hidden browse screen, and resets explicit navigation", () => {
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(app, /Platform.OS === "ios" \? browseReturnRef.current.lease\("search"\) : null/);
  assert.match(app, /browseReturnRef.current.account\(session\?\.id \|\| null\)/);
  assert.match(app, /if \(Platform.OS === "ios" && frame.directory\) browseReturnRef.current.reset\("discover"\)/);
  assert.match(app, /browseReturn=\{searchReturn\}/);
  const helper = readFileSync(new URL("./iosBrowseReturn.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(helper, /localStorage|AsyncStorage|fetch\(|console\.|writeFile/);
});
