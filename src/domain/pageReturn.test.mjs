import assert from "node:assert/strict";
import test from "node:test";
import { assignScrollRef, createPageReturnController, scrollPageToTop } from "./pageReturn.mjs";

test("only the committed visible route handles repeated page-return gestures", () => {
  const controller = createPageReturnController();
  const calls = [];
  controller.register("a|tab:feed", () => calls.push("feed"));
  const leaveCity = controller.register("a|city:Paris", () => calls.push("city"));
  controller.activate("a|tab:feed");
  assert.equal(controller.request("a|city:Paris"), false);
  controller.request("a|tab:feed"); controller.request("a|tab:feed");
  controller.activate("a|city:Paris");
  assert.equal(controller.request("a|tab:feed"), false, "retained native feed cannot steal an overlay gesture");
  controller.request("a|city:Paris");
  leaveCity();
  assert.equal(controller.request("a|city:Paris"), false);
  controller.activate("b|tab:feed");
  assert.equal(controller.request("a|tab:feed"), false, "old-account registrations cannot handle the new account");
  assert.deepEqual(calls, ["feed", "feed", "city"]);
});

test("late cleanup cannot remove a newer registration and real refresh wins over static scroll", () => {
  const controller = createPageReturnController();
  const calls = [];
  const old = controller.register("feed", () => calls.push("old"));
  controller.register("feed", () => calls.push("static"), false);
  controller.register("feed", () => calls.push("new"));
  old(); controller.activate("feed"); controller.request("feed");
  assert.deepEqual(calls, ["new"]);
});

test("title capabilities accurately distinguish draft-safe scrolling from refresh", () => {
  const controller = createPageReturnController();
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => notifications++);
  assert.equal(controller.capability("draft"), 0);
  const removeStatic = controller.register("draft", () => {}, false);
  assert.equal(controller.capability("draft"), 1);
  const removeRemote = controller.register("draft", () => {});
  assert.equal(controller.capability("draft"), 2);
  removeRemote(); assert.equal(controller.capability("draft"), 1);
  removeStatic(); assert.equal(controller.capability("draft"), 0);
  assert.equal(notifications, 4);
  unsubscribe();
});

test("a page-return gesture cancels pending navigation before refreshing its route", () => {
  const controller = createPageReturnController(), actions = [];
  controller.setBeforeRequest(() => actions.push("cancel pending navigation"));
  controller.register("feed", () => actions.push("refresh"));
  controller.activate("feed"); controller.request("feed");
  assert.deepEqual(actions, ["cancel pending navigation", "refresh"]);
});

test("list and scroll view returns stop momentum and preserve both supported ref shapes", () => {
  const calls = [];
  scrollPageToTop({ scrollToOffset: (options) => calls.push(options) });
  scrollPageToTop({ scrollTo: (options) => calls.push(options) });
  assert.deepEqual(calls, [{ offset: 0, animated: false }, { x: 0, y: 0, animated: false }]);
  const objectRef = { current: null }; let functionValue;
  const target = {};
  assignScrollRef(objectRef, target); assignScrollRef((value) => functionValue = value, target);
  assert.equal(objectRef.current, target); assert.equal(functionValue, target);
  assignScrollRef(objectRef, null); assert.equal(objectRef.current, null);
});
