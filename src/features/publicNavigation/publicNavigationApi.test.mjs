import assert from "node:assert/strict";
import test from "node:test";

import { readPublicPost, resolvePublicEntity } from "./publicNavigationApi.mjs";

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
