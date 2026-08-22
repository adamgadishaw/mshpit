import assert from "node:assert/strict";
import test from "node:test";

import { reconcileConfirmedArtistPostRemoval } from "./artistPostMutation.mjs";

test("artist updates remain visible until a confirmed removal is reconciled", () => {
  const current = {
    "model/actriz": [{ id: "ap-1", text: "Tonight" }, { id: "ap-2", text: "Tomorrow" }],
    turnstile: [{ id: "ap-3", text: "Elsewhere" }],
  };
  assert.equal(reconcileConfirmedArtistPostRemoval(current, { artistKey: "model/actriz", postId: "missing" }), current);
  const next = reconcileConfirmedArtistPostRemoval(current, { artistKey: "model/actriz", postId: "ap-1" });
  assert.deepEqual(next["model/actriz"].map((post) => post.id), ["ap-2"]);
  assert.equal(next.turnstile, current.turnstile);
  assert.equal(current["model/actriz"].length, 2, "the pre-confirmation snapshot is not mutated");
});
