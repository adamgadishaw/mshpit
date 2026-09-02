import assert from "node:assert/strict";
import test from "node:test";

import { opaqueId } from "./ids.js";

test("opaque server ids retain the full 128 bits and stay URL and DM-key safe", () => {
  const id = opaqueId("post", { random: (size) => {
    assert.equal(size, 16);
    return Buffer.from(Array.from({ length: 16 }, (_, index) => index));
  } });
  assert.equal(id, "post_000102030405060708090a0b0c0d0e0f");
  assert.match(id, /^post_[a-f0-9]{32}$/);
  assert.equal(id.includes("__"), false);

  const highEntropy = opaqueId("u", { random: () => Buffer.alloc(16, 0xff) });
  assert.equal(highEntropy, "u_ffffffffffffffffffffffffffffffff");
  assert.equal(highEntropy.includes("__"), false);
});

test("opaque ids reject ambiguous prefixes and incomplete entropy", () => {
  assert.throws(() => opaqueId("../post"), /prefix/i);
  assert.throws(() => opaqueId("post", { random: () => Buffer.alloc(8) }), /16 bytes/i);
});
