import assert from "node:assert/strict";
import test from "node:test";

import {
  publicCollectionHydration,
  publicFramePath,
  resolvedPublicCollectionFrame,
} from "./publicFrameNavigation.mjs";

test("artist archive frames serialize only with an authoritative public slug", () => {
  assert.equal(
    publicFramePath({ artistArchive: { name: "Earl Sweatshirt", publicSlug: "earl-sweatshirt" } }),
    "/artist/earl-sweatshirt/concerts",
  );
  assert.equal(publicFramePath({ artistArchive: { name: "Earl Sweatshirt" } }), null);
  assert.equal(
    publicFramePath(
      { artistArchive: { name: "Earl Sweatshirt" } },
      { resolveArtistMeta: () => ({ publicSlug: "earl-sweatshirt" }) },
    ),
    "/artist/earl-sweatshirt/concerts",
  );
});

test("direct artist-concert archive URLs resolve the base artist then rebuild the archive frame", () => {
  const hydration = publicCollectionHydration("/artist/earl-sweatshirt/concerts");
  assert.deepEqual(hydration, {
    type: "artist-concerts",
    publicSlug: "earl-sweatshirt",
    resolvePath: "/artist/earl-sweatshirt",
  });
  assert.deepEqual(
    resolvedPublicCollectionFrame(hydration, {
      kind: "artist",
      name: "Earl Sweatshirt",
      artistKey: "earl sweatshirt",
    }),
    {
      artistArchive: {
        name: "Earl Sweatshirt",
        artistKey: "earl sweatshirt",
        publicSlug: "earl-sweatshirt",
      },
    },
  );
});

test("unrelated and unresolved collection routes do not manufacture frames", () => {
  assert.equal(publicCollectionHydration("/concerts/ca/toronto"), null);
  assert.equal(
    resolvedPublicCollectionFrame(
      publicCollectionHydration("/artist/earl-sweatshirt/concerts"),
      { kind: "venue", name: "History" },
    ),
    null,
  );
});
