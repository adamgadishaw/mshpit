import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

test("identical live searches share provider work while each caller can cancel independently", async () => {
  const firstController = new AbortController();
  const secondController = new AbortController();
  const pendingResponses = [];
  const providerSignals = [];
  let fetches = 0;
  const fetchImpl = async (_url, request = {}) => {
    fetches += 1;
    providerSignals.push(request.signal);
    return new Promise((resolve) => {
      pendingResponses.push(() => resolve({
        ok: true,
        json: async () => ({
          data: [{
            id: 42,
            title_short: "Shared Search Result",
            artist: { name: "Shared Search Artist" },
            album: { title: "One Provider Pass" },
            rank: 100,
          }],
        }),
      }));
    });
  };

  const query = `shared-search-coalescing-proof-${randomUUID()}`;
  const first = searchDeezerTracks(query, { fetchImpl, signal: firstController.signal });
  const second = searchDeezerTracks(query, { fetchImpl, signal: secondController.signal });
  while (pendingResponses.length < 2) await new Promise((resolve) => setImmediate(resolve));

  firstController.abort(new DOMException("first surface moved on", "AbortError"));
  await assert.rejects(first, (error) => error?.name === "AbortError");
  assert.equal(fetches, 2, "the second waiter reuses the qualified and plain searches already in flight");
  assert.ok(providerSignals.every((signal) => !signal.aborted),
    "one cancelled surface does not throw away provider work still needed elsewhere");

  for (const resolve of pendingResponses) resolve();
  const results = await second;
  assert.equal(results[0]?.title, "Shared Search Result");
  assert.equal(fetches, 2);
});
