import assert from "node:assert/strict";
import test from "node:test";

import { readPublicPost, resolveNavigationArtist, resolvePublicEntity } from "./publicNavigationApi.mjs";

test("artist navigation forwards cancellation and retains provider eligibility", async () => {
  const controller = new AbortController();
  const calls = [];
  const result = await resolveNavigationArtist(" A$AP Rocky ", { signal: controller.signal }, {
    apiCall: async (path, options) => {
      calls.push({ path, options });
      return { artist: { id: "rocky", name: "A$AP Rocky" }, transient: true };
    },
  });
  assert.equal(calls[0].path, "/api/artists/resolve?name=A%24AP%20Rocky");
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[0].options.silent, true);
  assert.equal(result.transient, true);
  controller.abort();
  assert.equal(calls[0].options.signal.aborted, true);
});

test("artist navigation refuses missing and oversized names without requests", async () => {
  const apiCall = () => assert.fail("invalid navigation must not request a provider");
  for (const name of ["", " ", "x".repeat(201)]) {
    assert.equal(await resolveNavigationArtist(name, {}, { apiCall }), null);
  }
  assert.equal(await resolveNavigationArtist("Unknown", {}, { apiCall: async () => ({ artist: null }) }), null);
});

test("public entity resolution encodes the complete canonical pathname", async () => {
  const calls = [];
  const entity = await resolvePublicEntity("/artist/earl-sweatshirt", {}, {
    apiCall: async (path, options) => {
      calls.push({ path, options });
      return { entity: { kind: "artist", name: "Earl Sweatshirt" } };
    },
  });
  assert.equal(calls[0].path, "/api/resolve?path=%2Fartist%2Fearl-sweatshirt");
  assert.equal(calls[0].options.silent, true);
  assert.deepEqual(entity, { kind: "artist", name: "Earl Sweatshirt" });
});

test("shared post hydration encodes opaque post ids and rejects empty input", async () => {
  const calls = [];
  const post = await readPublicPost("post/42", {}, {
    apiCall: async (path) => {
      calls.push(path);
      return { post: { id: "post/42" } };
    },
  });
  assert.equal(calls[0], "/api/posts/post%2F42");
  assert.deepEqual(post, { id: "post/42" });
  assert.equal(await readPublicPost("", {}, { apiCall: async () => ({}) }), null);
});
