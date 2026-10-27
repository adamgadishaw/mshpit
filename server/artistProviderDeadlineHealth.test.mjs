import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-artist-deadline-health-"));
process.env.PIT_DATA_DIR = directory;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => assert.fail("unexpected provider request");
const { db } = await import("./db.js");
const { routes } = await import("./api.js");
const { runMusicBrainzRequest } = await import("./musicBrainzRequestThrottle.js");
after(() => { globalThis.fetch = originalFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });
const turn = () => new Promise(resolve => setImmediate(resolve));
const lookup = (name, signal) => routes["GET /api/artists/resolve"]({ query: { name }, signal, ip: "deadline-health-fixture" });
const resultOf = promise => promise.then(value => ({ value }), error => ({ error }));
const stall = signal => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
const empty = () => new Response(JSON.stringify({ data: [] }));

test("caller cancellation and queue expiry cannot become MusicBrainz health failures", { timeout: 12000 }, async () => {
  let entered, mb = 0;
  const started = new Promise(resolve => { entered = resolve; });
  globalThis.fetch = async (url, options) => {
    if (new URL(url).hostname === "api.deezer.com") return empty();
    assert.equal(new URL(url).hostname, "musicbrainz.org"); mb++; entered(); return stall(options.signal);
  };
  const caller = new AbortController();
  const cancelled = resultOf(lookup("Cancelled Health Fixture", caller.signal));
  await started; caller.abort(); assert.equal((await cancelled).error.name, "AbortError");
  while (runMusicBrainzRequest.status().active) await turn();
  assert.equal(runMusicBrainzRequest.status().consecutiveFailures, 0);
  let release, active;
  const activeStarted = new Promise(resolve => { active = resolve; });
  const held = runMusicBrainzRequest(() => new Promise(resolve => { release = resolve; active(); }));
  await activeStarted;
  try {
    await assert.rejects(lookup("Queued Health Fixture"), error => error.code === "PROVIDER_UNAVAILABLE"
      && error.cause.name === "ArtistLookupTimeoutError");
    assert.equal(mb, 1, "the queued lookup never dispatched");
    assert.equal(runMusicBrainzRequest.status().consecutiveFailures, 0);
  } finally { release(); await held; }
});

test("two full transport/body deadlines count once each despite coalescing and one caller leaving", { timeout: 16000 }, async () => {
  let physical = 0, entered, bodyCancelled = false;
  const started = new Promise(resolve => { entered = resolve; });
  globalThis.fetch = async (url, options) => {
    if (new URL(url).hostname === "api.deezer.com") return empty();
    assert.equal(new URL(url).hostname, "musicbrainz.org"); physical++;
    if (physical === 1) { entered(); return stall(options.signal); }
    return new Response(new ReadableStream({ cancel() { bodyCancelled = true; } }));
  };
  const caller = new AbortController();
  const departing = resultOf(lookup("Shared Timeout Health Fixture", caller.signal));
  await started;
  const others = Array.from({ length: 8 }, () => resultOf(lookup("Shared Timeout Health Fixture")));
  await turn(); // The other route pipelines must subscribe before one caller leaves.
  caller.abort(); assert.equal((await departing).error.name, "AbortError");
  const results = await Promise.all(others);
  assert.ok(results.every(result => result.error.code === "PROVIDER_UNAVAILABLE"
    && result.error.cause.code === "provider_timeout" && result.error.cause.name === "ProviderError"));
  while (runMusicBrainzRequest.status().active) await turn();
  assert.equal(physical, 1); assert.equal(runMusicBrainzRequest.status().consecutiveFailures, 1);
  await assert.rejects(lookup("Body Timeout Health Fixture"), error => error.code === "PROVIDER_UNAVAILABLE"
    && error.cause.code === "provider_timeout" && error.cause.name === "ProviderError");
  while (runMusicBrainzRequest.status().active) await turn();
  assert.equal(bodyCancelled, true); assert.equal(physical, 2);
  assert.equal(runMusicBrainzRequest.status().consecutiveFailures, 2);
  assert.equal(runMusicBrainzRequest.status().circuitOpen, true);
  await assert.rejects(lookup("Circuit Health Fixture"), error => error.code === "PROVIDER_UNAVAILABLE"
    && error.cause.code === "circuit_open");
  assert.equal(physical, 2, "the circuit blocks a third physical MusicBrainz attempt");
});
