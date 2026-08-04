import assert from "node:assert/strict";
import test from "node:test";

import { writeThemePair, themeBelongsTo } from "./themeStorage.mjs";

const KEYS = { themeKey: "pit_theme", ownerKey: "pit_theme_owner" };

// A Storage stand-in that can fail on the Nth write, the way Safari private
// mode does (the object exists; setItem throws).
function fakeStorage({ failOnWrite = 0 } = {}) {
  const data = new Map();
  let writes = 0;
  return {
    data,
    setItem(k, v) {
      writes += 1;
      if (failOnWrite && writes === failOnWrite) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem(k) { data.delete(k); },
  };
}

test("a normal write stores the theme and its owner together", () => {
  const s = fakeStorage();
  assert.equal(writeThemePair(s, KEYS, "neon", "u_1"), true);
  assert.equal(s.data.get(KEYS.themeKey), "neon");
  assert.equal(s.data.get(KEYS.ownerKey), "u_1");
});

test("a signed-out write is scoped to guest, not left blank", () => {
  const s = fakeStorage();
  writeThemePair(s, KEYS, "forest", null);
  assert.equal(s.data.get(KEYS.ownerKey), "guest");
});

test("a theme is NEVER stored without its owner key", () => {
  // The exact Safari private-mode shape: the first write lands, the second
  // throws. Storing the theme alone would leave it unscoped, and the next
  // account on this browser would inherit it.
  const s = fakeStorage({ failOnWrite: 2 });
  assert.equal(writeThemePair(s, KEYS, "neon", "u_1"), false);
  assert.equal(s.data.has(KEYS.themeKey), false, "the orphaned theme must be rolled back");
  assert.equal(s.data.has(KEYS.ownerKey), false);
});

test("a first-write failure leaves nothing behind either", () => {
  const s = fakeStorage({ failOnWrite: 1 });
  assert.equal(writeThemePair(s, KEYS, "neon", "u_1"), false);
  assert.equal(s.data.size, 0);
});

test("a failed write cannot resurrect a previous account's theme", () => {
  // Someone else's theme is already stored; our write fails halfway.
  const s = fakeStorage();
  writeThemePair(s, KEYS, "ember", "u_previous");
  const failing = {
    data: s.data,
    setItem(k, v) { if (k === KEYS.ownerKey) throw new Error("QuotaExceededError"); s.data.set(k, v); },
    removeItem(k) { s.data.delete(k); },
  };
  assert.equal(writeThemePair(failing, KEYS, "neon", "u_new"), false);
  // Critically: NOT left as theme=neon owned by u_previous.
  assert.equal(s.data.has(KEYS.themeKey), false);
  assert.equal(s.data.has(KEYS.ownerKey), false);
});

test("missing or unusable storage is refused, not thrown", () => {
  for (const bad of [null, undefined, {}, { setItem: "nope" }]) {
    assert.equal(writeThemePair(bad, KEYS, "neon", "u_1"), false);
  }
});

test("storage that also fails to roll back still reports failure", () => {
  const hostile = { setItem() { throw new Error("nope"); }, removeItem() { throw new Error("nope"); } };
  assert.equal(writeThemePair(hostile, KEYS, "neon", "u_1"), false);
});

test("a stored theme only applies to the account that saved it", () => {
  assert.equal(themeBelongsTo("u_1", "u_1"), true);
  assert.equal(themeBelongsTo("u_1", "u_2"), false, "another account must not inherit it");
  assert.equal(themeBelongsTo(null, null), true, "guest keeps a guest theme");
  assert.equal(themeBelongsTo("guest", null), true);
  assert.equal(themeBelongsTo("u_1", null), false, "signing out drops the account theme");
});
