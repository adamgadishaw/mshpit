import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { publicArtistPhoto } from "./artistPhotoCatalog.js";

const MBID = "d8fd8d9b-473b-4f06-83c8-869b1bb9de89";

function verifiedPhoto(overrides = {}) {
  return {
    title: "Bryson Tiller August 2018 (cropped).jpg",
    uri: "https://media.example/artists/bryson-tiller.webp",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Bryson_Tiller_August_2018_(cropped).jpg",
    creator: "AtlantaFX",
    license: "CC-BY-3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    source: "commons",
    modificationNotice: "Source file was cropped on Wikimedia Commons from the original YouTube frame. Resized and converted to WebP by MSHpit.",
    focalPoint: { x: 0.43, y: 0.2 },
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
    by: "AtlantaFX · CC BY 3.0",
    source: "licensed",
    provenanceSource: "commons",
    title: "Bryson Tiller August 2018 (cropped).jpg",
    creator: "AtlantaFX",
    license: "CC-BY-3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Bryson_Tiller_August_2018_(cropped).jpg",
    modificationNotice: "Source file was cropped on Wikimedia Commons from the original YouTube frame. Resized and converted to WebP by MSHpit.",
    focalPoint: { x: 0.43, y: 0.2 },
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
  assert.equal(photo.title, "Bryson Tiller August 2018 (cropped).jpg",
    "rebasing preserves attribution title metadata");
  assert.deepEqual(photo.focalPoint, { x: 0.43, y: 0.2 }, "rebasing preserves the reviewed focal point");
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

test("artist photo lookup omits malformed optional focal metadata", () => {
  const photo = publicArtistPhoto("bryson tiller", {
    catalog: catalog({ photo: verifiedPhoto({ focalPoint: { x: 2, y: "top" } }) }),
    mediaPublicBaseUrl: "",
  });
  assert.ok(photo);
  assert.equal(Object.hasOwn(photo, "focalPoint"), false);
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
      title: "Bryson Tiller August 2018 (cropped).jpg",
      uri: "https://upload.wikimedia.org/wikipedia/commons/b/b4/Bryson_Tiller_August_2018_%28cropped%29.jpg",
      sourcePage: "https://commons.wikimedia.org/wiki/File:Bryson_Tiller_August_2018_(cropped).jpg",
      creator: "AtlantaFX",
      license: "CC-BY-3.0",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
      source: "commons",
      modificationNotice: "Source file was cropped on Wikimedia Commons from the original YouTube frame.",
      focalPoint: { x: 0.43, y: 0.2 },
    },
  });
});
