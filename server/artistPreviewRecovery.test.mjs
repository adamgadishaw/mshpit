import assert from "node:assert/strict";
import test from "node:test";
import { resolveArtistPreviewWithFallback as resolve } from "./artistPreviewRecovery.js";

const unavailable = () => Object.assign(new Error("Artist provider is temporarily unavailable."), { code: "PROVIDER_UNAVAILABLE" });

test("fast primary does not double provider volume", async () => {
  assert.deepEqual(await resolve({ primary: async () => ({ mbid: "exact" }), fallback: () => assert.fail("no fallback required") }),
    { artist: { mbid: "exact" }, provider: "musicbrainz" });
});

test("slow primary yields to one independently verified fallback and cancels only its subscription", async () => {
  let signal, fallbacks = 0, rejectPrimary;
  const result = await resolve({ hedgeAfterMs: 10,
    primary: (requestSignal) => { signal = requestSignal; return new Promise((_resolve, reject) => { rejectPrimary = reject; }); },
    fallback: async () => { fallbacks++; return { deezerId: "123" }; },
  });
  assert.deepEqual(result, { artist: { deezerId: "123" }, provider: "deezer" });
  assert.equal(fallbacks, 1);
  assert.equal(signal.aborted, true);
  rejectPrimary(signal.reason);
  await new Promise((done) => setImmediate(done));
});

test("empty fallback cannot hide an outage as an artist-not-found result", async () => {
  const error = unavailable();
  await assert.rejects(resolve({ primary: async () => { throw error; }, fallback: async () => null }), (value) => value === error);
});

test("a genuine primary miss plus empty fallback remains a genuine miss", async () => {
  assert.deepEqual(await resolve({ primary: async () => null, fallback: async () => null }), { artist: null, provider: null });
});

test("failed early fallback keeps waiting for a valid primary result", async () => {
  let release;
  const result = resolve({ hedgeAfterMs: 10,
    primary: () => new Promise((done) => { release = done; }),
    fallback: async () => { release({ mbid: "exact" }); throw unavailable(); },
  });
  assert.deepEqual(await result, { artist: { mbid: "exact" }, provider: "musicbrainz" });
});

test("validation errors never launch an availability fallback", async () => {
  const error = Object.assign(new Error("bad identity"), { code: "VALIDATION_FAILED" });
  await assert.rejects(resolve({ primary: async () => { throw error; }, fallback: () => assert.fail("no fallback") }), (value) => value === error);
});

test("caller cancellation stops both subscriptions without leaking a later rejection", async () => {
  const controller = new AbortController();
  let primarySignal, fallbackSignal;
  const result = resolve({ signal: controller.signal, hedgeAfterMs: 10,
    primary: (signal) => { primarySignal = signal; return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); },
    fallback: (signal) => { fallbackSignal = signal; controller.abort(); throw signal.reason; },
  });
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(primarySignal.aborted, true);
  assert.equal(fallbackSignal.aborted, true);
});

test("same-turn cancellation starts neither provider and leaves no hedge timer", async () => {
  const controller = new AbortController();
  const result = resolve({ signal: controller.signal, hedgeAfterMs: 1,
    primary: () => assert.fail("cancelled primary must not start"),
    fallback: () => assert.fail("cancelled fallback must not start"),
  });
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  await new Promise((done) => setTimeout(done, 10));
});
