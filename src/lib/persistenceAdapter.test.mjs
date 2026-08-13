import test from "node:test";
import assert from "node:assert/strict";

import { createJsonPersistence } from "./persistenceAdapter.mjs";

test("JSON persistence reads and writes through a synchronous storage adapter", () => {
  const values = new Map();
  const persistence = createJsonPersistence({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  persistence.save("drafts", [{ id: "draft_1" }]);
  assert.equal(values.get("drafts"), '[{"id":"draft_1"}]');
  assert.deepEqual(persistence.load("drafts", []), [{ id: "draft_1" }]);
});

test("storage failures report diagnostics and fall back to process memory", () => {
  const events = [];
  let stored = '[{"id":"stale"}]';
  const persistence = createJsonPersistence({
    getItem: () => stored,
    setItem: () => { throw new Error("write failed"); },
  });
  persistence.setErrorHandler((error, details) => events.push([error.message, details]));
  persistence.save("drafts", [{ id: "draft_2" }]);
  assert.deepEqual(persistence.load("drafts", []), [{ id: "draft_2" }]);
  assert.deepEqual(events.map((event) => event[1].operation), ["write"]);
  stored = null;
});
