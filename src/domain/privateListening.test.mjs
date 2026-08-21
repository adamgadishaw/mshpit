import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIVATE_LISTENING_DURATION_MS,
  normalizePrivateListeningUntil,
  privateListeningActive,
  privateListeningRemainingLabel,
  privateListeningStorageKey,
  startPrivateListening,
} from "./privateListening.mjs";

test("private listening is account scoped and expires after six hours", () => {
  const at = 1_800_000_000_000;
  const until = startPrivateListening(at);
  assert.equal(until, at + PRIVATE_LISTENING_DURATION_MS);
  assert.equal(privateListeningStorageKey("u 1"), "pit.private-listening.v1.u%201");
  assert.equal(privateListeningActive(until, at + 1), true);
  assert.equal(privateListeningActive(until, until), false);
});

test("invalid, expired, and overlong device values fail closed", () => {
  const at = 1_800_000_000_000;
  assert.equal(normalizePrivateListeningUntil("bad", at), 0);
  assert.equal(normalizePrivateListeningUntil(at - 1, at), 0);
  assert.equal(normalizePrivateListeningUntil(at + PRIVATE_LISTENING_DURATION_MS * 5, at), at + PRIVATE_LISTENING_DURATION_MS);
  assert.equal(privateListeningRemainingLabel(at + 65 * 60_000, at), "1h 5m remaining");
  assert.equal(privateListeningRemainingLabel(at + PRIVATE_LISTENING_DURATION_MS - 1, at), "6h 0m remaining");
});
