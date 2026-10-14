import test from "node:test";
import assert from "node:assert/strict";
import { venueIdentityLowerCase, normalizeVenueKey } from "./venueIdentity.mjs";
test("native English venue casing matches the existing Unicode semantics", () => {
  const contexts = ["I \u0130 I\u0307 J\u0301", "\u039f\u03a3 \u039f\u03a3\u0391 \u0391\u03a3 \u03a3\u039f\u03a3", "STRA\u1e9eE Stra\u00dfe", "\u0141\u00d3D\u0179 \u00c6R\u00d8SK\u00d8BING", "PAVILH\u00c3O ATL\u00c2NTICO", "\uff2d\uff21\uff33\uff33\uff25\uff39 \uff28\uff21\uff2c\uff2c", "\u{10400}\u{10428}", "A\u2019B\u2014C & D", "", "Toronto \u6771\u4eac"];
  for (const value of contexts) assert.equal(venueIdentityLowerCase(value, true), venueIdentityLowerCase(value, false));
  // Check every Unicode code point that changes under default casing, including supplementary planes.
  for (let code = 0; code <= 0x10ffff; code++) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    const value = String.fromCodePoint(code);
    if (value.toLowerCase() !== value) assert.equal(venueIdentityLowerCase(value, true), venueIdentityLowerCase(value, false), "U+"+code.toString(16));
  }
});
test("native casing retains normalization, typography and canonical key inputs", () => {
  const saved = globalThis.HermesInternal;
  const values = ["  RBC AMPHITHEATRE  ", "L\u2019OLYMPIA", "PAVILH\u00c3O ATL\u00c2NTICO", "The O\u2082", "\u0130STANBUL", "\u039f\u03a3", null];
  const reference = values.map(normalizeVenueKey);
  try { globalThis.HermesInternal = {}; assert.deepEqual(values.map(normalizeVenueKey), reference); }
  finally { if (saved === undefined) delete globalThis.HermesInternal; else globalThis.HermesInternal = saved; }
});
