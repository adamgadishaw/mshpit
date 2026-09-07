import test from "node:test";
import assert from "node:assert/strict";
import { fetchArtistBiography, saveArtistBiography } from "./artistBiographyApi.mjs";
import { validateStaffArtistBiography } from "../../domain/artistBiography.mjs";

test("staff biography reads and writes preserve account, cancellation, revision, and canonical path", async () => {
  const calls = [], signal = new AbortController().signal;
  const facts = validateStaffArtistBiography({ artistType: "person", birthDate: "1985", sourceUrl: "https://artist.example.org/about" });
  const services = { apiCall: async (path, options) => { calls.push({ path, options }); return { artistKey: "a & b", artistMbid: null, facts, revision: options.method ? 2 : 1 }; } };
  assert.equal((await fetchArtistBiography({ accountId: "staff-a", artistKey: "A & B", signal }, services)).revision, 1);
  assert.equal((await saveArtistBiography({ accountId: "staff-a", artistKey: "A & B", artistMbid: null, signal, revision: 1, facts }, services)).revision, 2);
  for (const call of calls) {
    assert.equal(call.path, "/api/admin/artists/a%20%26%20b/biography");
    assert.equal(call.options.expectedAccountId, "staff-a"); assert.equal(call.options.signal, signal);
  }
  assert.equal(calls[1].options.method, "PUT"); assert.equal(calls[1].options.body.revision, 1);
  assert.equal(calls[1].options.body.facts.birthDate, "1985");
  assert.equal(calls[1].options.body.artistMbid, null);
});

test("biography transport rejects missing identity, invalid facts, and malformed snapshots", async () => {
  let count = 0;
  const services = { apiCall: async () => { count += 1; return {}; } };
  await assert.rejects(() => fetchArtistBiography({ artistKey: "a" }, services), /authenticated/);
  await assert.rejects(() => saveArtistBiography({ accountId: "staff", artistKey: "a", facts: { artistType: "person" } }, services), /Reload/);
  await assert.rejects(() => saveArtistBiography({ accountId: "staff", artistKey: "a", revision: 0, facts: { artistType: "person" } }, services), /source/);
  assert.equal(count, 0);
  await assert.rejects(() => fetchArtistBiography({ accountId: "staff", artistKey: "a" }, services), /invalid/);
  await assert.rejects(() => fetchArtistBiography({ accountId: "staff", artistKey: "a" }, { apiCall: async () => ({ artistKey: "a", artistMbid: null, revision: 0, facts: { birthDate: "1985" } }) }), /invalid/);
});

test("artist biography editor receives retained pending facts separately from public verified facts", async () => {
  const artistMbid = "875203e1-8e58-4b86-8dcb-7190faf411c5";
  const pendingFacts = validateStaffArtistBiography({ artistType: "person", birthDate: "1985", sourceUrl: "https://artist.example.org/about" });
  const snapshot = await fetchArtistBiography({ accountId: "staff", artistKey: "a" }, { apiCall: async () => ({
    artistKey: "a", artistMbid, revision: 2, facts: null, pendingFacts, requiresReview: true,
  }) });
  assert.equal(snapshot.facts, null); assert.equal(snapshot.pendingFacts.birthDate, "1985");
  assert.equal(snapshot.artistMbid, artistMbid); assert.equal(snapshot.requiresReview, true);
  let sent;
  await saveArtistBiography({ accountId: "staff", artistKey: "a", artistMbid: snapshot.artistMbid, revision: 2, facts: pendingFacts }, {
    apiCall: async (path, options) => { sent = options.body; return { ...snapshot, revision: 3, facts: pendingFacts, pendingFacts: null, requiresReview: false }; },
  });
  assert.equal(sent.artistMbid, artistMbid);
});
