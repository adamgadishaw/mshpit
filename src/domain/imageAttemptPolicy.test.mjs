import assert from "node:assert/strict";
import test from "node:test";
import { advanceImageAttempt, displayImageAttempt, imageAttemptSources, initialImageAttempt } from "./imageAttemptPolicy.mjs";

test("identical preferred and fallback URLs are attempted only once", () => {
  const sources = imageAttemptSources([null, "", "https://wsrv.nl/?url=public-photo", "https://wsrv.nl/?url=public-photo"]);
  assert.equal(sources.length, 1);
  const state = initialImageAttempt("photo", sources);
  const failed = advanceImageAttempt(state, { scope: "photo", index: 0 }, sources.length);
  assert.equal(failed.exhausted, true, "one failed rendition reaches the explicit unavailable state, not a blank same-URL retry");
});

test("duplicate preferred-source failures cannot skip the working fallback", () => {
  const sources = imageAttemptSources(["https://wsrv.nl/?url=photo", "https://media.example/photo"]);
  const firstEvent = { scope: "photo", index: 0 };
  const initial = initialImageAttempt("photo", sources);
  const fallback = advanceImageAttempt(initial, firstEvent, sources.length);
  assert.equal(fallback.index, 1);
  assert.equal(advanceImageAttempt(fallback, firstEvent, sources.length), fallback);
  assert.equal(fallback.exhausted, false);
});

test("errors cannot erase a photo after its active source was displayed", () => {
  const event = { scope: "photo", index: 0 };
  const shown = displayImageAttempt(initialImageAttempt("photo", ["photo"]), event);
  assert.equal(shown.ready, true);
  assert.equal(advanceImageAttempt(shown, event, 1), shown);
});

test("recycled cells ignore both old-source failures and old display callbacks", () => {
  const current = initialImageAttempt("new-photo", ["new-photo"]);
  const old = { scope: "old-photo", index: 0 };
  assert.equal(advanceImageAttempt(current, old, 1), current);
  assert.equal(displayImageAttempt(current, old), current);
});

test("all distinct failures terminate with no retry loop", () => {
  const sources = ["preview", "original"];
  let state = initialImageAttempt("photo", sources);
  state = advanceImageAttempt(state, { scope: "photo", index: 0 }, sources.length);
  state = advanceImageAttempt(state, { scope: "photo", index: 1 }, sources.length);
  assert.equal(state.exhausted, true);
  assert.equal(advanceImageAttempt(state, { scope: "photo", index: 2 }, sources.length), state);
});

test("private signed URLs retain their full identity and no state is shared", () => {
  const a = "https://media.example/photo?signature=one";
  const b = "https://media.example/photo?signature=two";
  assert.deepEqual(imageAttemptSources([a, b, a]), [a, b]);
  const accountOne = initialImageAttempt(a, [a]);
  const accountTwo = initialImageAttempt(b, [b]);
  const failed = advanceImageAttempt(accountOne, { scope: a, index: 0 }, 1);
  assert.equal(failed.exhausted, true);
  assert.equal(accountTwo.exhausted, false);
  assert.equal(accountTwo.ready, false);
});

test("baseline duplicate-event sequence loses its fallback; the new policy retains it", () => {
  // This reproduces the old components' unconditional stage += 1 callbacks.
  let oldStage = 0;
  const oldOnError = () => { oldStage = Math.min(2, oldStage + 1); };
  oldOnError(); oldOnError();
  assert.equal(oldStage, 2, "baseline drops the image before its fallback can finish");
  let next = initialImageAttempt("photo", ["preview", "original"]);
  for (let i = 0; i < 2; i += 1) next = advanceImageAttempt(next, { scope: "photo", index: 0 }, 2);
  assert.equal(next.index, 1);
  assert.equal(next.exhausted, false);
});
