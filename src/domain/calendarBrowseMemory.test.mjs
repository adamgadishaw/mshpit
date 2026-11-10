import assert from "node:assert/strict";
import test from "node:test";
import { calendarBrowseSnapshot, createCalendarBrowseMemory, createCalendarScrollReturn } from "./calendarBrowseMemory.mjs";

const initial = { cursor: { y: 2026, m: 10 }, selected: "2026-11-10", view: "upcoming",
  scope: "all", presentation: "month", historyVisibleLimit: 30, agendaLimit: 40, scrollY: 0 };
const identity = { accountId: "a", authEpoch: 1 };
const layout = height => ({ nativeEvent: { layout: { height } } });
const scroll = y => ({ nativeEvent: { contentOffset: { y } } });

test("Show and Back restores the same calendar occurrence, not a newly opened calendar", () => {
  const memory = createCalendarBrowseMemory(); memory.account("a", 1);
  const occurrence = {};
  const before = memory.claim(occurrence, identity, initial);
  const browsed = { cursor: { y: 2027, m: 2 }, selected: "2027-03-22", view: "past",
    scope: "plans", presentation: "agenda", historyVisibleLimit: 90, agendaLimit: 120, scrollY: 641 };
  before.save(browsed);
  const returned = memory.claim(occurrence, identity, initial);
  assert.equal(returned.restored, true);
  assert.deepEqual(returned.read(), browsed);
  assert.deepEqual(memory.claim({}, identity, initial).read(), initial);
});

test("a fresh presentation revokes an older instance's same-occurrence callbacks", () => {
  const memory = createCalendarBrowseMemory(); memory.account("a", 1);
  const occurrence = {}, old = memory.claim(occurrence, identity, initial);
  const latest = memory.claim(occurrence, identity, initial);
  assert.equal(old.current(), false);
  assert.equal(old.save({ selected: "2020-01-01" }), null);
  assert.equal(old.read(), null);
  assert.equal(latest.read().selected, initial.selected);
});

test("A to B to A clears even the original navigation frame and fences late work", () => {
  const memory = createCalendarBrowseMemory(); memory.account("a", 1);
  const occurrence = {}, old = memory.claim(occurrence, identity, initial);
  old.save({ scope: "plans", selected: "2026-12-31", scrollY: 500 });
  memory.account("b", 2);
  assert.equal(memory.claim(occurrence, identity, initial), null);
  assert.equal(old.read(), null);
  memory.account("a", 1);
  assert.deepEqual(memory.claim(occurrence, identity, initial).read(), initial);
  assert.equal(old.save({ scrollY: 800 }), null);
});

test("same-account reauthentication resets browsing; unchanged identity preserves it", () => {
  const memory = createCalendarBrowseMemory(); memory.account("a", 1);
  const occurrence = {}, old = memory.claim(occurrence, identity, initial);
  old.save({ view: "past" }); memory.account("a", 1);
  assert.equal(old.read().view, "past");
  memory.account("a", 2);
  assert.equal(old.current(), false);
  assert.equal(memory.claim(occurrence, { accountId: "a", authEpoch: 2 }, initial).read().view, "upcoming");
});

test("only bounded browsing fields survive, never private content or mutable input objects", () => {
  const value = { ...initial, cursor: { ...initial.cursor, events: [{ artist: "private" }] },
    selected: "2026-02-31", scrollY: Infinity, historyVisibleLimit: -1, agendaLimit: 41,
    events: [{ ticketUrl: "https://private.example" }], attendance: ["secret"], account: { name: "private" } };
  const result = calendarBrowseSnapshot(value, initial);
  assert.deepEqual(result, initial);
  value.cursor.y = 2020;
  assert.equal(result.cursor.y, 2026);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.cursor), true);
  assert.equal(calendarBrowseSnapshot({ selected: "2028-02-29" }).selected, "2028-02-29");
});

test("scroll restore waits for ready plus both measurements and clamps once without animation", () => {
  const calls = [], saved = [];
  const controller = createCalendarScrollReturn(900, patch => saved.push(patch));
  controller.update({ scrollTo: args => calls.push(args) }, false);
  controller.onScroll(scroll(0));
  controller.onContentSizeChange(320, 1000); controller.onLayout(layout(500));
  assert.deepEqual(calls, []); assert.deepEqual(saved, []);
  controller.update({ scrollTo: args => calls.push(args) }, true);
  assert.deepEqual(calls, [{ y: 500, animated: false }]);
  assert.deepEqual(saved, [{ scrollY: 500 }]);
  controller.onContentSizeChange(320, 1800); controller.onLayout(layout(400));
  assert.equal(calls.length, 1);
});

test("layout-first restore and short-content clamp work without accepting bounce offsets", () => {
  const calls = [], saved = [];
  const controller = createCalendarScrollReturn(50, patch => saved.push(patch));
  controller.update({ scrollTo: args => calls.push(args) }, true);
  controller.onLayout(layout(500)); controller.onContentSizeChange(320, 200);
  assert.deepEqual(calls, [{ y: 0, animated: false }]);
  controller.onScroll(scroll(-80)); controller.onScroll(scroll(200));
  assert.deepEqual(saved, [{ scrollY: 0 }, { scrollY: 0 }, { scrollY: 0 }]);
});

test("a deliberate drag before readiness wins over deferred restore", () => {
  const calls = [], saved = [];
  const controller = createCalendarScrollReturn(900, patch => saved.push(patch));
  controller.onLayout(layout(500)); controller.onContentSizeChange(320, 2000);
  controller.onScrollBeginDrag(scroll(140));
  controller.onScroll(scroll(210));
  controller.update({ scrollTo: args => calls.push(args) }, true);
  assert.deepEqual(calls, []);
  assert.deepEqual(saved, [{ scrollY: 140 }, { scrollY: 210 }]);
});

test("a retired route cannot restore, overwrite scroll, or cancel the new route's position", () => {
  let current = true;
  const calls = [], saved = [];
  const controller = createCalendarScrollReturn(100, patch => saved.push(patch), () => current);
  controller.onLayout(layout(500)); controller.onContentSizeChange(320, 2000);
  current = false;
  controller.update({ scrollTo: args => calls.push(args) }, true);
  controller.onScrollBeginDrag(scroll(200)); controller.onScroll(scroll(300));
  assert.deepEqual(calls, []); assert.deepEqual(saved, []);
});
