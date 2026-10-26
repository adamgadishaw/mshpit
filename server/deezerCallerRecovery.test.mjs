import assert from "node:assert/strict";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-deezer-caller-recovery-"));
process.env.PIT_DATA_DIR = directory;
const { db } = await import("./db.js");
const { providerJson, findDeezerArtistCandidates, getDeezerDiscography, getFreshDeezerPreview,
  searchDeezerTracks, resolveYouTubeTrack } = await import("./musicProviders.js");
const { deezerEnrich } = await import("./catalogSeed.js");
const { runDeezerPhotoPass } = await import("./features/artistPhotos/deezerArtistPhotoFill.js");
const { checkArtistReleases, ensureArtistUpdatesSchema } = await import("./features/artistUpdates/artistUpdatesService.js");
const realNow = Date.now, realFetch = globalThis.fetch;
let now = realNow(), sequence = 0;
Date.now = () => now;
globalThis.fetch = () => assert.fail("no live provider access");
after(() => { Date.now = realNow; globalThis.fetch = realFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const turn = () => new Promise(resolve => setImmediate(resolve));
const poison = { toString: 1, valueOf: 1 }; // JSON-compatible value whose scalar coercion fails.
async function waitForRecovery() {
  await assert.rejects(providerJson("Deezer", "https://api.deezer.com/search/artist?q=refusal", {
    fetchImpl: async () => json({}, 429, { "Retry-After": "1" }),
  }), { status: 429 });
  now += 1001;
}
async function assertAdmission(expected) {
  let calls = 0;
  const releases = [];
  const requests = Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
    findDeezerArtistCandidates(`Caller recovery ${sequence++}-${i}`, {
      fetchImpl: () => { calls++; return new Promise(resolve => releases.push(resolve)); },
    })));
  await turn();
  const admitted = calls;
  releases.forEach(resolve => resolve(json({ data: [] })));
  const results = await requests;
  assert.equal(admitted, expected, "only a healthy endpoint projection may restore unrestricted admission");
  assert.equal(results.filter(result => result.status === "fulfilled").length, expected);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason.code === "circuit_open").length, 8 - expected);
}

for (const empty of [false, true]) {
  const kind = empty ? "normal empty" : "malformed";
  for (const stage of ["artist", "top", "albums", "detail"]) test(`discography ${stage}: ${kind} projection controls recovery`, async () => {
    const name = `Discography ${stage} ${kind}`;
    if (stage === "artist") await waitForRecovery();
    let probes = 0;
    const outcome = await getDeezerDiscography(name, { fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === "/search/artist") {
        if (stage === "artist") { probes++; return json(empty ? { data: [] } : { data: {} }); }
        if (stage === "top") await waitForRecovery();
        return json({ data: [{ id: 321, name, nb_fan: 5000 }] });
      }
      if (path.endsWith("/top")) {
        if (stage === "top") { probes++; return json(empty ? { data: [] } : { data: {} }); }
        if (stage === "albums") await waitForRecovery();
        return json({ data: [] });
      }
      if (path.endsWith("/albums")) {
        if (stage === "albums") { probes++; return json(empty ? { data: [] } : { data: {} }); }
        if (stage === "detail") {
          await waitForRecovery();
          return json({ data: [{ id: 654, title: "Fixture Release", record_type: "album" }] });
        }
        return json({ data: [] });
      }
      assert.equal(path, "/album/654"); probes++;
      return json(empty ? {} : { tracks: { data: {} } });
    } }).catch(error => error);
    assert.equal(probes, 1);
    if (!empty && stage !== "detail") assert.ok(outcome instanceof Error);
    if (empty) assert.equal(outcome instanceof Error, false);
    await assertAdmission(empty ? 8 : 1);
  });

  for (const fallback of [false, true]) test(`preview ${fallback ? "fallback" : "qualified"}: ${kind} projection controls recovery`, async () => {
    if (!fallback) await waitForRecovery();
    let calls = 0;
    const pending = getFreshDeezerPreview(`Preview ${kind} ${fallback}`, "Recovery Fixture", { fetchImpl: async () => {
      calls++;
      if (fallback && calls === 1) { await waitForRecovery(); return json({ data: [] }); }
      return json(empty ? { data: [] } : { data: {} });
    } });
    if (empty) assert.equal((await pending).status, "not_found");
    else await assert.rejects(pending);
    await assertAdmission(empty ? 8 : 1);
  });

  test(`song search: ${kind} projection controls recovery despite optional failures`, async () => {
    await waitForRecovery();
    assert.deepEqual(await searchDeezerTracks(`Song search ${kind}`, {
      fetchImpl: async () => json(empty ? { data: [] } : { data: [{ title: poison, artist: { name: "Fixture" } }] }),
    }), []);
    await assertAdmission(empty ? 8 : 1);
  });

  test(`recording credit proof: ${kind} projection controls recovery`, async () => {
    await waitForRecovery();
    const title = `Proof ${kind}`, artist = "Proof Fixture";
    let proofs = 0;
    const result = await resolveYouTubeTrack(title, artist, {
      apiKey: "offline-fixture", sourceProvider: "deezer", sourceId: empty ? "919192" : "919191", allowSearch: true,
      fetchImpl: async url => {
        const parsed = new URL(url);
        if (parsed.hostname === "api.deezer.com") {
          proofs++;
          return json(empty ? {} : { title, artist: { name: artist }, duration: poison });
        }
        assert.equal(parsed.hostname, "www.googleapis.com");
        if (parsed.pathname.endsWith("/search")) return json({ items: [{ id: { videoId: "proof123456" } }] });
        assert.ok(parsed.pathname.endsWith("/videos"));
        return json({ items: [{ id: "proof123456", snippet: { title, channelTitle: `${artist} - Topic` },
          contentDetails: { duration: "PT3M" }, status: { embeddable: true, privacyStatus: "public" }, statistics: { viewCount: "1000000" } }] });
      },
    });
    assert.equal(result.status, "recording_proof_unavailable");
    assert.equal(proofs, 1);
    await assertAdmission(empty ? 8 : 1);
  });

  test(`catalog enrichment top tracks: ${kind} projection controls recovery`, async () => {
    const name = `Enrichment ${kind}`;
    const previous = globalThis.fetch;
    globalThis.fetch = async url => {
      assert.match(new URL(url).pathname, /\/top$/u);
      return json(empty ? { data: [] } : { data: {} });
    };
    try {
      const pending = deezerEnrich(name, { findArtist: async () => {
        await waitForRecovery(); return { artist: { id: 555, name, nb_fan: 5000 }, confidence: 1 };
      } });
      if (empty) assert.deepEqual((await pending).topTracks, []);
      else await assert.rejects(pending);
    } finally { globalThis.fetch = previous; }
    await assertAdmission(empty ? 8 : 1);
  });

  for (const known of [false, true]) test(`photo ${known ? "ID" : "search"}: ${kind} projection controls recovery`, async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,photo TEXT,source TEXT,popularity INTEGER,data TEXT,updated_at INTEGER);
      CREATE TABLE artist_profiles(artist_key TEXT,removed INTEGER DEFAULT 0,avatar_uri TEXT);
      CREATE TABLE tour_dates(id TEXT,artist_key TEXT,date TEXT);`);
    database.prepare("INSERT INTO artists VALUES ('fixture','Fixture',NULL,'musicbrainz',80,?,1)").run(JSON.stringify(known ? { deezerId: 1 } : {}));
    await waitForRecovery();
    const invalid = { id: 1, name: poison, nb_fan: 5000 };
    try {
      const pending = runDeezerPhotoPass(database, { at: now, fetchJson: (url, options) => providerJson("Deezer", url, {
        ...options, fetchImpl: async () => json(empty ? (known ? {} : { data: [] }) : (known ? invalid : { data: [invalid] })),
      }) });
      if (empty) assert.equal((await pending).noMatch, 1);
      else await assert.rejects(pending);
    } finally { database.close(); }
    await assertAdmission(empty ? 8 : 1);
  });

  for (const list of [false, true]) test(`release news ${list ? "directory" : "profile"}: ${kind} projection controls recovery`, async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,favorite_artists TEXT);
      CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,public_slug TEXT,photo TEXT,popularity INTEGER,data TEXT);
      CREATE TABLE fan_club_members(artist TEXT,user_id TEXT);
      CREATE TABLE tour_dates(id TEXT,artist_key TEXT,date TEXT);
      INSERT INTO users VALUES ('member','["Fixture"]');
      INSERT INTO fan_club_members VALUES ('fixture','member');
      INSERT INTO artists VALUES ('fixture','Fixture','fixture',NULL,90,'{"deezerId":123}');`);
    ensureArtistUpdatesSchema(database);
    if (!list) await waitForRecovery();
    let dispatches = 0;
    try {
      const result = await checkArtistReleases(database, { now, newId: () => "fixture-update", fetchJson: (url, options) => providerJson("Deezer", url, {
        ...options, fetchImpl: async () => {
          dispatches++;
          if (!new URL(url).pathname.endsWith("/albums")) {
            if (list) { await waitForRecovery(); return json({ name: "Fixture", nb_fan: 5000 }); }
            return json(empty ? {} : { name: poison });
          }
          return json(empty ? { data: [] } : { data: [{ id: poison, record_type: "album", title: "Fixture Release", release_date: "2026-10-26" }] });
        },
      }) });
      assert.equal(result.created.length, 0);
      assert.equal(dispatches, list ? 2 : 1);
    } finally { database.close(); }
    await assertAdmission(empty ? 8 : 1);
  });
}
