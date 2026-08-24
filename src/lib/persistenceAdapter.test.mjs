import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createJsonPersistence } from "./persistenceAdapter.mjs";

test("JSON persistence reads and writes through a synchronous storage adapter", () => {
  const values = new Map();
  const persistence = createJsonPersistence({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  });
  persistence.save("drafts", [{ id: "draft_1" }]);
  assert.equal(values.get("drafts"), '[{"id":"draft_1"}]');
  assert.deepEqual(persistence.load("drafts", []), [{ id: "draft_1" }]);
  persistence.remove("drafts");
  assert.equal(values.has("drafts"), false);
  assert.deepEqual(persistence.load("drafts", []), []);
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

test("failed removals are reported and cannot reveal the stale adapter value", () => {
  const events = [];
  const persistence = createJsonPersistence({
    getItem: () => JSON.stringify({ private: true }),
    removeItem: () => { throw new Error("remove failed"); },
  });
  persistence.setErrorHandler((error, details) => events.push([error.message, details]));
  persistence.remove("private-cache");
  assert.equal(persistence.load("private-cache", null), null);
  assert.deepEqual(events, [["remove failed", { operation: "remove", key: "private-cache" }]]);
});

test("web and native persistence adapters physically remove private keys", () => {
  const web = readFileSync(new URL("./persist.web.js", import.meta.url), "utf8");
  const native = readFileSync(new URL("./persist.native.js", import.meta.url), "utf8");
  assert.match(web, /removeItem:\s*\(key\)\s*=>\s*storage\.removeItem\(key\)/);
  assert.match(native, /Storage\.removeItemSync\(key\)/);
  assert.match(web, /export const remove = persistence\.remove/);
  assert.match(native, /export const remove = persistence\.remove/);
});
