import assert from "node:assert/strict";
import test from "node:test";

import { getDeezerDiscography } from "./musicProviders.js";

test("identical discography loads share one provider pipeline and keep a live caller's work", async () => {
  const firstController = new AbortController();
  const secondController = new AbortController();
  let releaseIdentity;
  let fetches = 0;
  let identitySignal = null;
  const artist = "Coalesced Discography Proof 2026";
  const fetchImpl = async (url, request = {}) => {
    fetches += 1;
    if (String(url).includes("/search/artist")) {
      identitySignal = request.signal;
      return new Promise((resolve) => {
        releaseIdentity = () => resolve({
          ok: true,
          json: async () => ({
            data: [{ id: 987654321, name: artist, nb_fan: 1000, nb_album: 0 }],
          }),
        });
      });
    }
    if (String(url).includes("/top?")) {
      return { ok: true, json: async () => ({ data: [] }) };
    }
    if (String(url).includes("/albums?")) {
      return { ok: true, json: async () => ({ data: [] }) };
    }
    throw new Error(`unexpected provider URL: ${url}`);
  };

  const first = getDeezerDiscography(artist, { fetchImpl, signal: firstController.signal });
  const second = getDeezerDiscography(artist, { fetchImpl, signal: secondController.signal });
  while (!releaseIdentity) await new Promise((resolve) => setImmediate(resolve));

  firstController.abort(new DOMException("first artist page closed", "AbortError"));
  await assert.rejects(first, (error) => error?.name === "AbortError");
  assert.equal(identitySignal?.aborted, false,
    "the shared provider pipeline stays alive for the remaining artist page");

  releaseIdentity();
  const result = await second;
  assert.equal(result.status, "fresh");
  assert.equal(fetches, 3,
    "one artist lookup, one top-track lookup, and one album lookup serve both callers");
});
