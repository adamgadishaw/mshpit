import assert from "node:assert/strict";
import test from "node:test";

import {
  deezerEnrichmentGenreFields, deezerReleaseGenreConsensus, normalizeDeezerGenre,
} from "./deezerGenre.js";

test("Deezer genre labels normalize onto the product vocabulary", () => {
  assert.equal(normalizeDeezerGenre("Rap/Hip Hop"), "Hip-Hop");
  assert.equal(normalizeDeezerGenre(" dance "), "Electronic");
  assert.equal(normalizeDeezerGenre("Films/Games"), null);
  assert.equal(normalizeDeezerGenre("Kids"), null);
});

test("one release can never classify an artist", () => {
  assert.equal(deezerReleaseGenreConsensus(["Alternative"]), null);
  assert.equal(deezerReleaseGenreConsensus(["Alternative", "Alternative"]), null);
});

test("several releases must agree by a clear majority", () => {
  assert.deepEqual(
    deezerReleaseGenreConsensus(["Pop", "Pop", "Rock"]),
    {
      genre: "Pop",
      provider: "deezer",
      basis: "release-consensus-v1",
      sampleCount: 3,
      supportingCount: 2,
      share: 0.6667,
      counts: [{ genre: "Pop", count: 2 }, { genre: "Rock", count: 1 }],
    },
  );
  assert.equal(
    deezerReleaseGenreConsensus(["Pop", "Pop", "Rock", "Rock"]),
    null,
    "a tie is not evidence even though its ordering is deterministic",
  );
});

test("aliases are counted together and noisy categories do not dilute evidence", () => {
  assert.deepEqual(
    deezerReleaseGenreConsensus([
      { genre: "Dance" },
      { genre: "Electronic" },
      { genre: "Electro" },
      { genre: "Kids" },
    ]),
    {
      genre: "Electronic",
      provider: "deezer",
      basis: "release-consensus-v1",
      sampleCount: 3,
      supportingCount: 3,
      share: 1,
      counts: [{ genre: "Electronic", count: 3 }],
    },
  );
});

test("the Deezer writer accepts only matching consensus evidence", () => {
  const evidence = deezerReleaseGenreConsensus(["Pop", "Pop", "Rock"]);
  const accepted = deezerEnrichmentGenreFields({}, null, { deezerId: 1, genreEvidence: evidence });
  assert.equal(accepted.genre, "Pop");
  assert.equal(accepted.genreClaims[0]?.source, "release_consensus");

  const forged = deezerEnrichmentGenreFields({}, null, {
    deezerId: 1,
    genreEvidence: { ...evidence, genre: "Rock" },
  });
  assert.deepEqual(forged, {});
});

test("changing Deezer identity clears evidence tied to the previous artist", () => {
  const evidence = deezerReleaseGenreConsensus(["Pop", "Pop", "Rock"]);
  const previous = {
    deezerId: 1,
    ...deezerEnrichmentGenreFields({}, null, { deezerId: 1, genreEvidence: evidence }),
  };
  const cleared = deezerEnrichmentGenreFields(previous, "Pop", { deezerId: 2 });
  assert.deepEqual(deezerEnrichmentGenreFields(previous, "Pop", {}), {}, "an outage is not an identity change");
  assert.equal(cleared.genre, null);
  assert.deepEqual(cleared.genreClaims, []);
  assert.equal(cleared.genreEvidence, undefined);
});
