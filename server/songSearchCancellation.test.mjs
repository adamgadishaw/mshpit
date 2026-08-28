import assert from "node:assert/strict";
import test from "node:test";

import { searchDeezerTracks } from "./musicProviders.js";

test("cancelled song type-ahead stops both outbound Deezer searches", async () => {
  const controller = new AbortController();
  const signals = [];
  const fetchImpl = async (_url, request = {}) => {
    signals.push(request.signal);
    return new Promise((_resolve, reject) => {
      const rejectAbort = () => reject(request.signal?.reason || new DOMException("cancelled", "AbortError"));
      if (request.signal?.aborted) rejectAbort();
      else request.signal?.addEventListener("abort", rejectAbort, { once: true });
    });
  };

  const pending = searchDeezerTracks("cancel-probe-artist-2026", {
    fetchImpl,
    signal: controller.signal,
  });
  controller.abort(new DOMException("new query replaced this one", "AbortError"));

  await assert.rejects(pending, (error) => error?.name === "AbortError");
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal?.aborted));
});
