import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VIDEO_POSTER_ERROR_CODES, VideoPosterError } from "../domain/videoPoster.mjs";
import { createVideoPosterRetryPolicy, videoPosterFailureDisposition } from "./videoPosterRetryPolicy.mjs";

test("transient poster failures get one delayed retry and then a stable fallback", () => {
  let clock = 10_000;
  const policy = createVideoPosterRetryPolicy({ now: () => clock, retryDelaysMs: [900] });
  const uri = "https://media.test/transient.mp4";
  const timeout = new VideoPosterError(VIDEO_POSTER_ERROR_CODES.timeout);

  const first = policy.claim(uri);
  assert.equal(first.action, "attempt");
  assert.deepEqual(policy.fail(uri, first.lease, timeout), { action: "retry", retryAfterMs: 900 });
  assert.deepEqual(policy.decision(uri), { action: "wait", retryAfterMs: 900 });
  clock += 900;

  const second = policy.claim(uri);
  assert.equal(second.action, "attempt");
  assert.equal(policy.fail(uri, second.lease, timeout).action, "fallback");
  assert.equal(policy.claim(uri).action, "fallback");
  assert.equal(policy.snapshot(uri).attempts, 2);
});

test("cross-origin canvas denial is permanent for the session after one attempt", () => {
  const policy = createVideoPosterRetryPolicy();
  const uri = "https://legacy-no-acao.test/clip.mp4";
  const blocked = new VideoPosterError(VIDEO_POSTER_ERROR_CODES.crossOriginBlocked);
  const first = policy.claim(uri);

  assert.equal(videoPosterFailureDisposition(blocked), "permanent");
  assert.equal(policy.fail(uri, first.lease, blocked).action, "fallback");
  assert.equal(policy.claim(uri).action, "fallback", "remounts must not start another canvas attempt");
  assert.equal(policy.snapshot(uri).attempts, 1);
});

test("viewability cancellation releases a lease without consuming the retry budget", () => {
  const policy = createVideoPosterRetryPolicy({ retryDelaysMs: [10] });
  const uri = "https://media.test/scroll-away.mp4";
  const first = policy.claim(uri);
  assert.equal(policy.cancel(uri, first.lease), true);
  assert.equal(policy.snapshot(uri), null);
  assert.equal(policy.claim(uri).action, "attempt");
});

test("web probes CORS before mounting or decoding a remote legacy video", () => {
  const source = readFileSync(new URL("./videoPoster.web.js", import.meta.url), "utf8");
  const probe = source.indexOf("await assertRemotePosterCors(source, guard, normalized.signal)");
  const decoder = source.indexOf('document.createElement("video")');
  assert.ok(probe >= 0 && decoder > probe);
  assert.match(source, /method: "HEAD"/);
  assert.match(source, /response\.type === "opaque"/);
  assert.match(source, /VIDEO_POSTER_ERROR_CODES\.crossOriginBlocked/);
});
