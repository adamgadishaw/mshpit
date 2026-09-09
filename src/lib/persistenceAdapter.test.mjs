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

function recoveringStorage() {
  const values = new Map();
  const failures = { read: false, write: false, remove: false };
  const persistence = createJsonPersistence({
    getItem(key) { if (failures.read) throw new Error("read failed"); return values.get(key) ?? null; },
    setItem(key, value) { if (failures.write) throw new Error("write failed"); values.set(key, value); },
    removeItem(key) { if (failures.remove) throw new Error("remove failed"); values.delete(key); },
  });
  return { ...persistence, values, failures };
}

for (const externalChange of ["none", "replacement", "removal"]) {
  test(`successful write recovery retires old memory before later read failure (${externalChange})`, () => {
    const f = recoveringStorage();
    f.failures.write = true;
    f.save("private-state", { revision: 1, privateDraft: "old" });
    assert.equal(f.load("private-state", null).revision, 1);
    f.failures.write = false;
    f.save("private-state", { revision: 2 });
    assert.deepEqual(JSON.parse(f.values.get("private-state")), { revision: 2 });
    if (externalChange === "replacement") f.values.set("private-state", JSON.stringify({ revision: 3 }));
    if (externalChange === "removal") f.values.delete("private-state");
    assert.deepEqual(f.load("private-state", null), externalChange === "removal" ? null
      : { revision: externalChange === "replacement" ? 3 : 2 });
    f.failures.read = true;
    assert.equal(f.load("private-state", null), null, "unavailable durable data must not resurrect an obsolete private fallback");
    f.failures.read = false;
    assert.deepEqual(f.load("private-state", null), externalChange === "removal" ? null
      : { revision: externalChange === "replacement" ? 3 : 2 }, "the latest durable value was not overwritten");
  });
}

test("healthy reads and writes do not create a second retained cache", () => {
  const f = recoveringStorage();
  for (let index = 0; index < 20; index++) {
    f.save(`private-${index}`, { index });
    assert.deepEqual(f.load(`private-${index}`, null), { index });
  }
  f.failures.read = true;
  for (let index = 0; index < 20; index++) assert.equal(f.load(`private-${index}`, null), null);
});

for (const adapter of ["missing", "failing"]) {
  test(`memory fallback keeps JSON snapshots independent of caller mutation (${adapter})`, () => {
    const f = adapter === "missing" ? createJsonPersistence() : recoveringStorage();
    if (f.failures) f.failures.write = true;
    const value = { account: "a", draft: { text: "saved" }, at: new Date("2026-09-09T00:00:00.000Z") };
    f.save("draft", value);
    value.account = "b";
    value.draft.text = "unsaved";
    const firstRead = f.load("draft", null);
    assert.deepEqual(firstRead, { account: "a", draft: { text: "saved" }, at: "2026-09-09T00:00:00.000Z" });
    firstRead.account = "c";
    firstRead.draft.text = "mutated read";
    assert.deepEqual(f.load("draft", null), { account: "a", draft: { text: "saved" }, at: "2026-09-09T00:00:00.000Z" });
  });
}

for (const mode of ["durable", "memory", "removed"]) {
  test(`unserializable writes preserve the last usable state (${mode})`, () => {
    const f = recoveringStorage();
    const events = [];
    f.setErrorHandler((error, details) => events.push(details));
    if (mode === "memory") f.failures.write = true;
    f.save("private-state", { revision: 1 });
    if (mode === "removed") {
      f.failures.remove = true;
      f.remove("private-state");
    }
    events.length = 0;
    const circular = {};
    circular.self = circular;
    for (const value of [circular, 1n, undefined, () => {}, Symbol("invalid")]) {
      f.save("private-state", value);
      assert.deepEqual(f.load("private-state", null), mode === "removed" ? null : { revision: 1 });
    }
    assert.deepEqual(events, Array.from({ length: 5 }, () => ({ operation: "write", key: "private-state" })));
  });
}

test("failed removal masks both durable data and fallback until an explicit valid save", () => {
  const f = recoveringStorage();
  f.save("private-state", { account: "a" });
  f.failures.write = true;
  f.save("private-state", { account: "b" });
  f.failures.remove = true;
  f.remove("private-state");
  assert.equal(f.load("private-state", null), null);
  f.failures.read = true;
  assert.equal(f.load("private-state", null), null);
  f.failures.write = false;
  f.save("private-state", { account: "c" });
  assert.equal(f.load("private-state", null), null, "no retired fallback should survive a durable save");
  f.failures.read = false;
  assert.deepEqual(f.load("private-state", null), { account: "c" });
  f.failures.remove = false;
  f.remove("private-state");
  f.failures.read = true;
  assert.equal(f.load("private-state", null), null);
});
