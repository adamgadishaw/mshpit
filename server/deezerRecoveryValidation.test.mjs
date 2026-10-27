import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-deezer-recovery-validation-"));
process.env.PIT_DATA_DIR = directory;
const { db } = await import("./db.js");
const { providerJson, findDeezerArtistCandidates, getDeezerDiscography } = await import("./musicProviders.js");
const realNow = Date.now;
let now = realNow();
Date.now = () => now;
after(() => { Date.now = realNow; db.close(); rmSync(directory, { recursive: true, force: true }); });
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const turn = () => new Promise(resolve => setImmediate(resolve));
async function refusal() {
  await assert.rejects(providerJson("Deezer", "https://api.deezer.com/search/artist?q=refusal", {
    fetchImpl: async () => json({}, 429, { "Retry-After": "1" }),
  }), { status: 429 });
  now += 1001;
}

test("a rejected discography artist directory cannot release the shared recovery probe", async () => {
  await refusal();
  await assert.rejects(getDeezerDiscography("Discography Recovery Fixture", {
    fetchImpl: async () => json({ data: {} }),
  }));
  let dispatches = 0;
  const releases = [];
  const pending = Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
    findDeezerArtistCandidates(`After discography failure ${i}`, {
      fetchImpl: () => { dispatches++; return new Promise(resolve => releases.push(resolve)); },
    })));
  await turn();
  const admitted = dispatches;
  releases.forEach(resolve => resolve(json({ data: [] })));
  const results = await pending;
  assert.equal(admitted, 1);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason.code === "circuit_open").length, 7);
});

for (const [label, data] of [
  ["missing directory", { unexpected: "schema" }],
  ["non-array directory", { data: {} }],
  ["invalid IDs", { data: [{ id: "wrong", name: "Invalid Fixture" }] }],
  ["invalid names", { data: [{ id: 1, name: " " }] }],
]) test(`a ${label} cannot mark the Deezer recovery probe healthy`, async () => {
  await refusal();
  await assert.rejects(findDeezerArtistCandidates(`Invalid ${label}`, {
    fetchImpl: async () => json(data),
  }), { code: "invalid_payload" });

  let dispatches = 0;
  const releases = [];
  const fetchImpl = () => { dispatches++; return new Promise(resolve => releases.push(resolve)); };
  const pending = Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
    findDeezerArtistCandidates(`${label} recovery competitor ${i}`, { fetchImpl })));
  await turn();
  const admitted = dispatches;
  releases.forEach(resolve => resolve(json({ data: [] })));
  const results = await pending;
  assert.equal(admitted, 1, "a rejected payload leaves only one recovery probe admissible");
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason.code === "circuit_open").length, 7);
  assert.deepEqual(results.find(result => result.status === "fulfilled").value, [], "valid empty results recover");

  let recoveredDispatches = 0;
  const recovered = await Promise.all([0, 1].map(i => findDeezerArtistCandidates(`${label} healthy ${i}`, {
    fetchImpl: async () => { recoveredDispatches++; return json({ data: [{ id: 123, name: "Valid Fixture" }] }); },
  })));
  assert.equal(recoveredDispatches, 2, "a validated empty probe restores ordinary admission");
  assert.ok(recovered.every(candidates => candidates[0]?.name === "Valid Fixture"));
});

test("projection stays inside the exclusive probe and cancellation cannot announce recovery", async () => {
  await refusal();
  const controller = new AbortController();
  let releaseProjection, projectionStarted;
  const started = new Promise(resolve => { projectionStarted = resolve; });
  const probe = providerJson("Deezer", "https://api.deezer.com/search/artist?q=held-projection", {
    fetchImpl: async () => json({ data: [] }),
    signal: controller.signal,
    project: async () => { projectionStarted(); return new Promise(resolve => { releaseProjection = resolve; }); },
  });
  const probeResult = probe.then(value => ({ value }), error => ({ error }));
  await started;
  await assert.rejects(providerJson("Deezer", "https://api.deezer.com/search/artist?q=projection-rival", {
    fetchImpl: () => assert.fail("projection has not yet established recovery"),
  }), { code: "circuit_open" });
  controller.abort();
  releaseProjection([]);
  assert.equal((await probeResult).error.name, "AbortError");

  let release, dispatches = 0;
  const next = providerJson("Deezer", "https://api.deezer.com/search/artist?q=next-probe", {
    fetchImpl: () => { dispatches++; return new Promise(resolve => { release = resolve; }); },
  });
  const rivals = await Promise.allSettled(Array.from({ length: 8 }, () =>
    findDeezerArtistCandidates("Cancelled projection rival", {
      fetchImpl: () => assert.fail("a cancelled projection leaves recovery pending"),
    })));
  assert.equal(dispatches, 1);
  assert.ok(rivals.every(result => result.status === "rejected" && result.reason.code === "circuit_open"));
  release(json({ data: [] }));
  await next;
});
