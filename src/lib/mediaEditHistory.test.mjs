import test from "node:test";
import assert from "node:assert/strict";
import {
  commitMediaEditHistory,
  createMediaEditHistory,
  mediaEditHistoryState,
  redoMediaEditHistory,
  resetMediaEditHistory,
  sealMediaEditHistory,
  undoMediaEditHistory,
} from "./mediaEditHistory.mjs";

test("media edit history supports undo, redo, reset, and divergent edits", () => {
  let history = createMediaEditHistory({ value: 0 });
  history = commitMediaEditHistory(history, { value: 1 });
  history = commitMediaEditHistory(history, { value: 2 });
  assert.equal(undoMediaEditHistory(history).present.value, 1);
  history = undoMediaEditHistory(history);
  assert.equal(redoMediaEditHistory(history).present.value, 2);

  history = commitMediaEditHistory(history, { value: 7 });
  assert.equal(history.future.length, 0);
  history = resetMediaEditHistory(history);
  assert.equal(history.present.value, 0);
  assert.deepEqual(mediaEditHistoryState(history), { canUndo: true, canRedo: false, isDirty: false });
});

test("a continuous slider gesture becomes one undo step", () => {
  let history = createMediaEditHistory(0);
  history = commitMediaEditHistory(history, 1, { groupKey: "brightness" });
  history = commitMediaEditHistory(history, 2, { groupKey: "brightness" });
  history = commitMediaEditHistory(history, 3, { groupKey: "brightness" });
  assert.deepEqual(history.past, [0]);
  history = sealMediaEditHistory(history);
  history = commitMediaEditHistory(history, 4, { groupKey: "brightness" });
  assert.deepEqual(history.past, [0, 3]);
});

test("history is bounded and can compare normalized values", () => {
  let history = createMediaEditHistory({ n: 0 }, { limit: 2 });
  const equals = (a, b) => a.n === b.n;
  history = commitMediaEditHistory(history, { n: 0 }, { equals });
  history = commitMediaEditHistory(history, { n: 1 }, { equals });
  history = commitMediaEditHistory(history, { n: 2 }, { equals });
  history = commitMediaEditHistory(history, { n: 3 }, { equals });
  assert.deepEqual(history.past.map((item) => item.n), [1, 2]);

  const visuallyReset = commitMediaEditHistory(createMediaEditHistory({ n: 0 }), { n: 0 });
  assert.equal(mediaEditHistoryState(visuallyReset, { equals }).isDirty, false);
});
