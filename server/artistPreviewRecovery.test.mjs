import assert from "node:assert/strict";
import test from "node:test";
import { resolveArtistPreviewWithFallback as resolve } from "./artistPreviewRecovery.js";

const unavailable = () => Object.assign(new Error("Artist provider is temporarily unavailable."), { code: "PROVIDER_UNAVAILABLE" });

test("observation preserves both settled failures and the original primary error", async () => {
  const events = [], primaryError = unavailable(), fallbackError = unavailable();
  primaryError.cause = { code: "network", message: "private primary detail" };
  fallbackError.cause = { code: "provider_timeout", message: "private fallback detail" };
  await assert.rejects(resolve({ primary: async () => { throw primaryError; }, fallback: async () => { throw fallbackError; },
    observe: (event) => events.push(event) }), (error) => error === primaryError);
  assert.deepEqual(events.filter((event) => event.type === "settled"), [
    { type: "settled", provider: "musicbrainz", outcome: "unavailable", failure: "network" },
    { type: "settled", provider: "deezer", outcome: "unavailable", failure: "provider_timeout" },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /private/);
});

test("winning fallback records pending primary cancellation once and ignores late failure", async () => {
  const events = [];
  let rejectPrimary;
  const artist = { deezerId: "42" };
  const result = await resolve({ hedgeAfterMs: 1,
    primary: () => new Promise((_resolve, reject) => { rejectPrimary = reject; }),
    fallback: async () => artist, observe: (event) => events.push(event),
  });
  assert.equal(result.artist, artist);
  assert.deepEqual(events.filter((event) => event.type === "settled"), [
    { type: "settled", provider: "deezer", outcome: "matched", failure: "none" },
    { type: "settled", provider: "musicbrainz", outcome: "cancelled_after_winner", failure: "none" },
  ]);
  const count = events.length;
  rejectPrimary(unavailable());
  await new Promise((done) => setImmediate(done));
  assert.equal(events.length, count);
});

test("caller cancellation and observer exceptions preserve abort and stop both subscriptions", async () => {
  const controller = new AbortController(), events = [];
  const pending = (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  const result = resolve({ signal: controller.signal, hedgeAfterMs: 1, primary: pending,
    fallback: (signal) => { const promise = pending(signal); controller.abort(); return promise; },
    observe: (event) => { events.push(event); throw new Error("diagnostics only"); },
  });
  await assert.rejects(result, (error) => error === controller.signal.reason);
  assert.deepEqual(events.filter((event) => event.type === "settled").map((event) => event.outcome), ["caller_cancelled", "caller_cancelled"]);
});

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

test("an unavailable fallback cannot turn a genuine primary miss into a definitive no-match", async () => {
  const error = unavailable();
  await assert.rejects(resolve({ primary: async () => null, fallback: async () => { throw error; } }),
    (value) => value === error);
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
