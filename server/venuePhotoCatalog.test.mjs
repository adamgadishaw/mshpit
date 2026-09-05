import assert from "node:assert/strict";
import test from "node:test";
import {
  publicVenuePhotoCatalogSize,
  publicVenuePhotoPool,
} from "./venuePhotoCatalog.js";

const photo = (name, overrides = {}) => ({
  uri: `https://images.example/${name}.webp`,
  sourcePage: `https://commons.wikimedia.org/wiki/File:${name}.jpg`,
  creator: "Venue Photographer",
  license: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  source: "commons",
  ...overrides,
});

test("public venue photo lookup follows explicit venue rename aliases", () => {
  const preferred = photo("preferred");
  const other = photo("other");
  const catalog = {
    "budweiser stage": {
      galleryPool: [other, preferred],
      photos: [preferred.uri],
    },
  };
  const result = publicVenuePhotoPool("RBC Amphitheatre", { catalog, limit: 1 });
  assert.equal(result.length, 1);
  assert.equal(result[0].uri, preferred.uri);
});

test("only RBC's verified provider crosswalk can reuse its renamed venue pool", () => {
  const rbc = photo("rbc-amphitheatre");
  const providerBindings = {
    "provider:ticketmaster:kovzpzaekkia": "budweiser stage",
  };
  const catalog = {
    "budweiser stage": { galleryPool: [rbc], photos: [rbc.uri] },
  };
  assert.deepEqual(publicVenuePhotoPool("RBC Amphitheatre", {
    catalog,
    providerBindings,
    source: "Ticketmaster",
    providerVenueId: "KovZpZAEkkIA",
  }).map((entry) => entry.uri), [rbc.uri]);
  assert.deepEqual(publicVenuePhotoPool("Some Other Venue", {
    catalog,
    providerBindings,
    source: "ticketmaster",
    providerVenueId: "KovZpZAEkkIA",
  }), [], "the verified provider id cannot attach its photo to a different venue");
  assert.deepEqual(publicVenuePhotoPool("RBC Amphitheatre", {
    catalog,
    providerBindings,
    source: "ticketmaster",
    providerVenueId: "unmapped-same-name-venue",
  }), [], "a same-name request without an explicit crosswalk remains empty");

  const rightsRemoved = {
    ...catalog,
    "provider:ticketmaster:kovzpzaekkia": { galleryPool: [], photos: [] },
  };
  assert.deepEqual(publicVenuePhotoPool("RBC Amphitheatre", {
    catalog: rightsRemoved,
    providerBindings,
    source: "ticketmaster",
    providerVenueId: "KovZpZAEkkIA",
  }), [], "an explicit empty provider row overrides the crosswalk after a rights removal");
});

test("provider-scoped venue photos require an exact provider catalog key", () => {
  const fallback = photo("fallback");
  const provider = photo("provider");
  const otherProvider = photo("other-provider");
  const catalog = {
    "sample hall": { galleryPool: [fallback], photos: [fallback.uri] },
    "provider:ticketmaster:za98xzqpzkk": {
      galleryPool: [provider],
      photos: [provider.uri],
    },
    "provider:ticketmaster:other-city-hall": {
      galleryPool: [otherProvider],
      photos: [otherProvider.uri],
    },
  };
  const result = publicVenuePhotoPool("Sample Hall", {
    catalog,
    source: "Ticketmaster",
    providerVenueId: "ZA98xZqPZkk",
    limit: 2,
  });
  assert.deepEqual(result.map((entry) => entry.uri), [provider.uri]);
  assert.deepEqual(publicVenuePhotoPool("Sample Hall", {
    catalog,
    source: "ticketmaster",
    providerVenueId: "other-city-hall",
  }).map((entry) => entry.uri), [otherProvider.uri]);
  assert.deepEqual(publicVenuePhotoPool("Sample Hall", {
    catalog,
    source: "ticketmaster",
    providerVenueId: "unmapped-same-name-hall",
  }), []);
  assert.deepEqual(
    publicVenuePhotoPool("Sample Hall", { catalog }).map((entry) => entry.uri),
    [fallback.uri],
    "a legacy name-only request keeps the explicit exact-name catalog behavior",
  );
});

test("public venue photo lookup fails closed on incomplete rights metadata", () => {
  const catalog = {
    "sample hall": {
      galleryPool: [
        photo("missing-source", { sourcePage: null }),
        photo("wrong-license", { licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" }),
        photo("valid"),
      ],
    },
  };
  assert.deepEqual(
    publicVenuePhotoPool("Sample Hall", { catalog }).map((entry) => entry.uri),
    ["https://images.example/valid.webp"],
  );
});

test("the shipped venue photo catalog exposes mirrored licensed inventory", () => {
  assert.ok(publicVenuePhotoCatalogSize() >= 300);
  const result = publicVenuePhotoPool("Rogers Centre", { limit: 1 });
  assert.equal(result.length, 1);
  assert.match(result[0].uri, /^https:\/\/pub-[a-z0-9]+\.r2\.dev\/venues\/licensed\//u);
  assert.match(result[0].sourcePage, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/u);
});
