import assert from "node:assert/strict";
import test from "node:test";
import { replaceNavigationFrame } from "./navigationStack.mjs";

const pop = (stack) => stack.length > 1 ? stack.slice(0, -1) : stack;

test("finishing signup into nearby shows retains a root that Back can reach", () => {
  const root = {};
  const nearby = { nearby: true, nearbyTab: "shows" };
  const next = replaceNavigationFrame([root], nearby);
  assert.deepEqual(next, [{}, nearby]);
  assert.equal(next[0], root);
  assert.equal(next[1], nearby);
  assert.deepEqual(pop(next), [root]);
  assert.deepEqual(pop(pop(next)), [root]);
});

test("the first artist-picker destination also returns to tabs on Back", () => {
  const picker = { pickArtists: true };
  const next = replaceNavigationFrame([{}], picker);
  assert.equal(next.length, 2);
  assert.equal(next[1], picker);
  assert.deepEqual(pop(next), [{}]);
});

test("ordinary replacements retain prior screens without preserving the replaced overlay", () => {
  const root = {}, artist = { artistName: "Fixture Band" }, menu = { menu: true };
  const settings = { settings: true };
  const next = replaceNavigationFrame([root, artist, menu], settings);
  assert.deepEqual(next, [root, artist, settings]);
  assert.equal(next.length, 3);
  assert.equal(next[1], artist);
  assert.deepEqual(pop(next), [root, artist]);
  assert.equal(next.includes(menu), false);
});

test("composer replacement keeps the root but never leaves the composer under its destination", () => {
  const composer = { logging: true, composerId: "composer_fixture" };
  const calendar = { calendar: true, calendarView: "month" };
  const next = replaceNavigationFrame([{}, composer], calendar);
  assert.deepEqual(next, [{}, calendar]);
  assert.deepEqual(pop(next), [{}]);
});

test("an explicit root destination collapses to a single tab frame", () => {
  const root = {};
  for (const stack of [[{}], [{}, { nearby: true }], [{}, { artistName: "Fixture Band" }, { menu: true }]]) {
    const next = replaceNavigationFrame(stack, root);
    assert.deepEqual(next, [root]);
    assert.equal(next[0], root);
    assert.equal(pop(next), next);
  }
});

test("missing history and a legacy single overlay gain a recoverable root", () => {
  const nextFrame = { nearby: true };
  for (const previous of [undefined, null, [], [{ pickArtists: true }]]) {
    const next = replaceNavigationFrame(previous, nextFrame);
    assert.deepEqual(next, [{}, nextFrame]);
    assert.deepEqual(pop(next), [{}]);
  }
});

test("replacement never mutates its input array, existing frames, or the new frame", () => {
  const root = Object.freeze({});
  const artist = Object.freeze({ artistName: "Fixture Band" });
  const menu = Object.freeze({ menu: true });
  const frame = Object.freeze({ cityGuide: Object.freeze({ citySlug: "fixture-city", countryCode: "CA" }) });
  const stack = Object.freeze([root, artist, menu]);
  const next = replaceNavigationFrame(stack, frame);
  assert.notEqual(next, stack);
  assert.deepEqual(stack, [root, artist, menu]);
  assert.deepEqual(next, [root, artist, frame]);
  assert.equal(next[0], root);
  assert.equal(next[1], artist);
  assert.equal(next[2], frame);
  assert.deepEqual(replaceNavigationFrame(Object.freeze([root]), frame), [root, frame]);
});

test("history needs one push only when root-safe replacement adds a frame", () => {
  const destination = { nearby: true, nearbyTab: "shows" };
  const initial = [{}];
  const first = replaceNavigationFrame(initial, destination);
  assert.equal(first.length - initial.length, 1, "web must pushState instead of replacing its root entry");
  const second = replaceNavigationFrame(first, { pickArtists: true });
  assert.equal(second.length - first.length, 0, "lateral changes retain replaceState semantics");
  assert.deepEqual(pop(second), [{}]);
});
