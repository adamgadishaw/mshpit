import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { publicArtistPhoto } from "./artistPhotoCatalog.js";

const MBID = "d8fd8d9b-473b-4f06-83c8-869b1bb9de89";

function verifiedPhoto(overrides = {}) {
  return {
    title: "BrysonTiller.png",
    uri: "https://media.example/artists/bryson-tiller.webp",
    sourcePage: "https://commons.wikimedia.org/wiki/File:BrysonTiller.png",
    creator: "BrysonTiller Faan",
    license: "CC-BY-3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    source: "commons",
    modificationNotice: "Cropped, resized and converted to WebP.",
    mirror: {
      objectKey: `artists/licensed/bryson-tiller-${"a".repeat(12)}/${"b".repeat(48)}.webp`,
    },
    ...overrides,
  };
}

function catalog(overrides = {}) {
  return {
    "bryson tiller": {
      artistKey: "bryson tiller",
      mbid: MBID,
      photo: verifiedPhoto(),
      ...overrides,
    },
  };
}

test("artist photo lookup returns a validator-approved exact-key photo", () => {
  assert.deepEqual(publicArtistPhoto("  BRYSON   TILLER ", {
    artistMbid: MBID.toUpperCase(),
    catalog: catalog(),
    mediaPublicBaseUrl: "",
  }), {
    uri: "https://media.example/artists/bryson-tiller.webp",
    by: "BrysonTiller Faan · CC BY 3.0",
    source: "licensed",
    provenanceSource: "commons",
    title: "BrysonTiller.png",
    creator: "BrysonTiller Faan",
    license: "CC-BY-3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:BrysonTiller.png",
    modificationNotice: "Cropped, resized and converted to WebP.",
  });
});

test("artist photo lookup rebases a validated mirror key onto the current public media base", () => {
  const photo = publicArtistPhoto("bryson tiller", {
    artistMbid: MBID,
    catalog: catalog(),
    mediaPublicBaseUrl: "https://new-media.example/cdn",
  });
  assert.equal(photo.uri,
    `https://new-media.example/cdn/artists/licensed/bryson-tiller-${"a".repeat(12)}/${"b".repeat(48)}.webp`);
  assert.equal(photo.title, "BrysonTiller.png", "rebasing preserves attribution title metadata");
});

test("artist photo lookup rejects unsafe public bases and malformed or malicious mirror keys", () => {
  for (const objectKey of [
    `artists/licensed/bryson/../${"b".repeat(48)}.webp`,
    `venues/licensed/bryson/${"b".repeat(48)}.webp`,
    `artists/licensed/bryson/${"b".repeat(47)}.webp`,
    `artists/licensed/bryson/${"b".repeat(48)}.jpg`,
  ]) {
    assert.equal(publicArtistPhoto("bryson tiller", {
      catalog: catalog({ photo: verifiedPhoto({ mirror: { objectKey } }) }),
      mediaPublicBaseUrl: "https://media.example",
    }), null);
  }
  for (const mediaPublicBaseUrl of [
    "http://media.example",
    "https://user:pass@media.example",
    "https://media.example:8443",
    "https://media.example/cdn?token=secret",
    "https://media.example/cdn#fragment",
  ]) {
    assert.equal(publicArtistPhoto("bryson tiller", {
      catalog: catalog(), mediaPublicBaseUrl,
    }), null);
  }
});

test("artist photo lookup never falls back across artist keys or MusicBrainz identities", () => {
  const inventory = catalog();
  assert.equal(publicArtistPhoto("bryson tiller tribute", { catalog: inventory }), null);
  assert.equal(publicArtistPhoto("bryson tiller", {
    artistMbid: "11111111-1111-4111-8111-111111111111",
    catalog: inventory,
  }), null);
  assert.equal(publicArtistPhoto("bryson tiller", {
    artistMbid: "not-an-mbid",
    catalog: inventory,
  }), null);
  assert.equal(publicArtistPhoto("bryson tiller", {
    catalog: catalog({ artistKey: "another artist" }),
  }), null);
});

test("artist photo lookup fails closed on incomplete rights metadata", () => {
  assert.equal(publicArtistPhoto("bryson tiller", {
    catalog: catalog({ photo: verifiedPhoto({ licenseUrl: null }) }),
  }), null);
  assert.equal(publicArtistPhoto("bryson tiller", {
    catalog: catalog({ photo: verifiedPhoto({ title: null }) }),
  }), null);
});

test("source seed carries the reviewed Bryson Tiller identity and license", () => {
  const source = JSON.parse(readFileSync(
    new URL("../src/seed/catalog.artist-photos.source.json", import.meta.url),
    "utf8",
  ));
  assert.deepEqual(source["bryson tiller"], {
    artistKey: "bryson tiller",
    mbid: MBID,
    photo: {
      title: "BrysonTiller.png",
      uri: "https://upload.wikimedia.org/wikipedia/commons/9/96/BrysonTiller.png",
      sourcePage: "https://commons.wikimedia.org/wiki/File:BrysonTiller.png",
      creator: "BrysonTiller Faan",
      license: "CC-BY-3.0",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
      source: "commons",
      modificationNotice: "Cropped, resized and converted to WebP.",
    },
  });
});
