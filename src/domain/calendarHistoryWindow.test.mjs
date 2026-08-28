import assert from "node:assert/strict";
import test from "node:test";
import {
  CALENDAR_HISTORY_PAGE_SIZE,
  calendarHistoryWindow,
  nextCalendarHistoryLimit,
} from "./calendarHistoryWindow.mjs";

const posts = Array.from({ length: 75 }, (_, index) => ({ id: `post-${index}` }));

test("calendar history starts with one bounded page and reveals cached pages progressively", () => {
  const first = calendarHistoryWindow(posts, CALENDAR_HISTORY_PAGE_SIZE, null);
  assert.equal(first.posts.length, 30);
  assert.equal(first.hasBufferedPage, true);
  assert.equal(first.hasMore, true);

  const second = calendarHistoryWindow(posts, nextCalendarHistoryLimit(first.visibleLimit), null);
  assert.equal(second.posts.length, 60);
  assert.equal(second.posts.at(-1).id, "post-59");
  assert.equal(second.hasBufferedPage, true);
});

test("calendar history keeps the server cursor visible after the local cache boundary", () => {
  const window = calendarHistoryWindow(posts.slice(0, 30), 30, "older-page");
  assert.equal(window.hasBufferedPage, false);
  assert.equal(window.hasServerPage, true);
  assert.equal(window.hasMore, true);
  assert.equal(window.complete, false);
});

test("calendar history is complete only when buffered rows and the server cursor are exhausted", () => {
  const complete = calendarHistoryWindow(posts.slice(0, 12), Number.NaN, null);
  assert.equal(complete.visibleLimit, CALENDAR_HISTORY_PAGE_SIZE);
  assert.equal(complete.posts.length, 12);
  assert.equal(complete.complete, true);
  assert.equal(nextCalendarHistoryLimit(-5), CALENDAR_HISTORY_PAGE_SIZE * 2);
});
