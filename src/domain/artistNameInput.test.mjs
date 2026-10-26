import assert from "node:assert/strict";
import test from "node:test";
import { artistNameInput } from "./artistNameInput.mjs";

test("complete names count Unicode code points and never return a truncated prefix", () => {
  for (const name of ["a".repeat(120), "🎵".repeat(61), "🎵".repeat(120), "a" + "🎵".repeat(119)]) {
    assert.equal(artistNameInput(name), name);
  }
  for (const value of [null, {}, [], 123, "", "  ", "a".repeat(121), "🎵".repeat(121), "a".repeat(120) + "suffix",
    "a\ud800", "\udfff", "\ud800a", "\udfff\ud800"]) assert.equal(artistNameInput(value), "");
});

test("complete name validation retains the established whitespace and control policy", () => {
  assert.equal(artistNameInput("  Earth,   Wind & Fire  "), "Earth, Wind & Fire");
  assert.equal(artistNameInput("Björk"), "Björk");
  assert.equal(artistNameInput("宇多田ヒカル"), "宇多田ヒカル");
  assert.equal(artistNameInput("A\u202eB\u0000"), "AB");
  assert.equal(artistNameInput("\u0000\u200b"), "");
});
