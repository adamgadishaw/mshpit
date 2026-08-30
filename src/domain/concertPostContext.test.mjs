import test from "node:test";
import assert from "node:assert/strict";
import { concertPostContext } from "./concertPostContext.mjs";

test("concert post context preserves the canonical public post URL", () => {
  const context = concertPostContext({ id: "post/42", artist: "Earl Sweatshirt" });
  assert.equal(context.showHref, "/post/post%2F42");
});

test("artist comparison URLs require an authoritative public slug", () => {
  const unresolved = concertPostContext({ id: "1", artist: "Earl Sweatshirt" });
  assert.equal(unresolved.artistPublicSlug, null);
  assert.equal(unresolved.artistConcertsHref, null);
  const resolved = concertPostContext({ id: "1", artist: "Earl Sweatshirt", artistPublicSlug: "earl-sweatshirt" });
  assert.equal(resolved.artistPublicSlug, "earl-sweatshirt");
  assert.equal(
    resolved.artistConcertsHref,
    "/artist/earl-sweatshirt/concerts",
  );
});

test("tour labels never manufacture tour or artist archive URLs", () => {
  const context = concertPostContext({ id: "1", artist: "Artist", tour: "A Tour That Does Not Exist" });
  assert.equal(context.artistConcertsHref, null);
  assert.equal(context.showHref, "/post/1");
});
