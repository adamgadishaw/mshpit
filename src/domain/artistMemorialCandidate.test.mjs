import assert from "node:assert/strict";
import test from "node:test";

import {
  artistMemorialCandidates,
  artistMemorialPreparationName,
  isArtistMemorialCandidate,
  normalizeArtistMemorialCandidate,
  preparedMemorialArtistFromResponse,
} from "./artistMemorialCandidate.mjs";

const OLIVER = Object.freeze({
  key: "oliver tree",
  name: "Oliver Tree",
  mbid: "1FA3BDED-908F-47BE-9784-3C9EF850682B",
  country: "United States",
});

test("memorial preparation accepts a bounded full stage name", () => {
  assert.equal(artistMemorialPreparationName("  Oliver   Tree  "), "Oliver Tree");
  assert.throws(() => artistMemorialPreparationName("O"), /full stage name/i);
  assert.throws(() => artistMemorialPreparationName("x".repeat(121)), /full stage name/i);
});

test("memorial candidates require a canonical key, name, and MusicBrainz identity", () => {
  assert.equal(isArtistMemorialCandidate(OLIVER), true);
  assert.deepEqual(normalizeArtistMemorialCandidate(OLIVER), {
    ...OLIVER,
    mbid: "1fa3bded-908f-47be-9784-3c9ef850682b",
  });
  for (const invalid of [null, { ...OLIVER, key: "" }, { ...OLIVER, name: "" }, { ...OLIVER, mbid: null }, { ...OLIVER, mbid: "bad" }]) {
    assert.equal(isArtistMemorialCandidate(invalid), false);
  }
});

test("memorial candidate lists normalize and deduplicate exact identities", () => {
  const duplicate = { ...OLIVER, mbid: OLIVER.mbid.toLowerCase() };
  const second = { key: "another artist", name: "Another Artist", mbid: "22345678-1234-4234-8234-123456789abc" };
  assert.deepEqual(artistMemorialCandidates([OLIVER, duplicate, { ...OLIVER, mbid: "bad" }, second]), [
    { ...OLIVER, mbid: OLIVER.mbid.toLowerCase() },
    second,
  ]);
});

test("the exact-artist response must contain one valid canonical candidate", () => {
  assert.deepEqual(preparedMemorialArtistFromResponse({ artists: [OLIVER], enriched: 1, requested: 1 }), {
    ...OLIVER,
    mbid: OLIVER.mbid.toLowerCase(),
  });
  assert.throws(() => preparedMemorialArtistFromResponse(null), /invalid exact-artist response/i);
  assert.throws(() => preparedMemorialArtistFromResponse({ artists: [] }), /could not confirm/i);
  assert.throws(() => preparedMemorialArtistFromResponse({ artists: [OLIVER, OLIVER] }), /more than one/i);
  assert.throws(() => preparedMemorialArtistFromResponse({ artists: [{ ...OLIVER, mbid: "bad" }] }), /without a valid exact/i);
});
