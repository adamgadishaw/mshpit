import assert from "node:assert/strict";
import test from "node:test";
import { artistAccountRequest, runArtistAccountCommand } from "./artistAccountApi.mjs";
import { signupAccountError, signupFormPayload } from "../../domain/signupForm.mjs";
import { publicProfileCacheEntry } from "../../domain/dataPolicy.mjs";

const response = { ok: true, user: { id: "member", role: "artist", verified: false }, artist: { key: "new-band" }, profile: { ownerId: "member", verified: false } };
test("artist commands do not begin or adopt a response after an account switch", async () => {
  for (const changeDuringRequest of [false, true]) {
    let current = changeDuringRequest;
    const saved = [];
    const result = await runArtistAccountCommand({ accountId: "member", create: true }, {
      apiCall: async () => { current = false; return response; }, isCurrent: () => current,
      confirmUser: (user) => saved.push(user), cacheArtists: (artists) => saved.push(artists), fail: (error) => ({ ok: false, error }),
    });
    assert.equal(result.ok, false); assert.equal(result.stale, true); assert.deepEqual(saved, []);
  }
});
test("artist creation is a same-account mutation with no automatic verification", async () => {
  const calls = [];
  const controller = new AbortController();
  const result = await artistAccountRequest({ accountId: "member", create: true, artistName: "New Band", bio: "Live music", signal: controller.signal }, { apiCall: async (...args) => { calls.push(args); return response; } });
  assert.equal(result, response);
  assert.equal(calls[0][0], "/api/artist-pages");
  assert.equal(calls[0][1].expectedAccountId, "member");
  assert.equal(calls[0][1].signal, controller.signal);
  assert.deepEqual(calls[0][1].body, { artistName: "New Band", bio: "Live music" });
  assert.equal(result.user.verified, false);
});
test("artist creation rejects another account, missing ownership and canceled responses", async () => {
  for (const invalid of [{ ...response, user: { ...response.user, id: "other" } }, { ...response, profile: { ownerId: "other" } }, { ...response, user: { ...response.user, role: "fan" } }]) {
    await assert.rejects(artistAccountRequest({ accountId: "member", create: true }, { apiCall: async () => invalid }), /could not be confirmed/);
  }
  const controller = new AbortController();
  await assert.rejects(artistAccountRequest({ accountId: "member", signal: controller.signal }, { apiCall: async () => { controller.abort(); return response; } }), { name: "AbortError" });
});
test("artist account read is private, read-only and scoped even before page creation", async () => {
  const value = { ok: true, user: { id: "member", role: "fan" }, artist: null, profile: null };
  const result = await artistAccountRequest({ accountId: "member" }, { apiCall: async (path, options) => {
    assert.equal(path, "/api/artist-account"); assert.equal(options.method, "GET"); assert.equal(options.expectedAccountId, "member"); assert.equal(options.body, undefined); return value;
  } });
  assert.equal(result, value);
});
test("signup artist intent never supplies role, verification or ownership privileges", () => {
  const values = { name: "Member", handle: "newband", email: "member@example.test", password: "password123", genres: ["Rock"], ageBand: "18_plus", agreed: true,
    artistIntent: { artistName: "  New Band  ", verified: true, ownerId: "other" }, role: "artist", verified: true };
  const payload = signupFormPayload(values);
  assert.deepEqual(payload.artistIntent, { artistName: "New Band" });
  assert.equal(payload.role, undefined); assert.equal(payload.verified, undefined);
  assert.equal(signupAccountError({ ...values, artistIntent: { artistName: "X" } }).field, "artistName");
  assert.equal(signupFormPayload({ ...values, artistIntent: undefined }).artistIntent, undefined);
  assert.equal(publicProfileCacheEntry({ id: "member", pendingArtistIntent: payload.artistIntent }).pendingArtistIntent, undefined);
});
