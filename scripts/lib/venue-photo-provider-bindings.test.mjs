import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVenuePhotoProviderBindings,
  MAX_PROVIDER_VENUE_BINDING_DISTANCE_METERS,
  serializeVenuePhotoProviderBindings,
  venuePhotoBindingDistanceMeters,
} from "./venue-photo-provider-bindings.mjs";
import { providerVenuePhotoCatalogKey } from "../../server/venuePhotoCatalogIdentity.js";

const licensed = (name) => ({
  galleryPool: [{
    uri: `https://media.example/${name}.webp`,
    sourcePage: `https://commons.wikimedia.org/wiki/File:${name}.jpg`,
    creator: "Venue Photographer",
    license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    source: "commons",
  }],
});

test("provider bindings require an explicit canonical name and tight physical match", () => {
  const result = buildVenuePhotoProviderBindings({
    "budweiser stage": {
      name: "Budweiser Stage",
      lat: 43.6289,
      lng: -79.4158,
    },
    "known hall": {
      name: "Known Hall",
      lat: 43.65,
      lng: -79.38,
    },
  }, [
    {
      venue: "RBC Amphitheatre",
      source: "Ticketmaster",
      venue_provider_id: "RBC",
      lat: 43.62945,
      lng: -79.41492,
    },
    {
      venue: "Known Hall",
      source: "Ticketmaster",
      venue_provider_id: "FAR",
      lat: 43.66,
      lng: -79.38,
    },
    {
      venue: "Known Hall",
      source: "Ticketmaster",
      venue_provider_id: "MISSING",
      lat: null,
      lng: null,
    },
    {
      venue: "Known Hall",
      source: "Ticketmaster",
      venue_provider_id: "MOVED",
      lat: 43.65,
      lng: -79.38,
    },
    {
      venue: "Known Hall",
      source: "Ticketmaster",
      venue_provider_id: "MOVED",
      lat: 43.66,
      lng: -79.38,
    },
  ], {
    "budweiser stage": licensed("rbc"),
    "known hall": licensed("known"),
  });

  assert.deepEqual(result.bindings, {
    "provider:ticketmaster:rbc": "budweiser stage",
  });
  assert.equal(MAX_PROVIDER_VENUE_BINDING_DISTANCE_METERS, 500);
  assert.equal(result.stats.rejected.missingLocation, 1);
  assert.equal(result.stats.rejected.ambiguousProviderIdentity, 1);
  assert.equal(result.stats.rejected.noCatalogMatch, 1);
});

test("provider bindings fail closed on conflicting identities and ambiguous catalogue matches", () => {
  const photos = {
    "hall one": licensed("one"),
    "hall two": licensed("two"),
  };
  const result = buildVenuePhotoProviderBindings({
    "hall one": { name: "Shared Hall", lat: 40, lng: -73 },
    "hall two": { name: "Shared Hall", lat: 40.001, lng: -73 },
  }, [
    {
      venue: "Shared Hall", source: "ticketmaster", venue_provider_id: "AMBIGUOUS",
      lat: 40.0005, lng: -73,
    },
    {
      venue: "Shared Hall", source: "ticketmaster", venue_provider_id: "CONFLICTING",
      lat: 40, lng: -73,
    },
    {
      venue: "Different Hall", source: "ticketmaster", venue_provider_id: "CONFLICTING",
      lat: 40, lng: -73,
    },
  ], photos);

  assert.deepEqual(result.bindings, {});
  assert.equal(result.stats.rejected.ambiguousCatalogMatch, 1);
  assert.equal(result.stats.rejected.ambiguousProviderIdentity, 1);
});

test("an exact provider photo row stays authoritative even when its pool is empty", () => {
  const providerKey = "provider:ticketmaster:authoritative";
  const result = buildVenuePhotoProviderBindings({
    "known hall": { name: "Known Hall", lat: 43.65, lng: -79.38 },
  }, [{
    venue: "Known Hall", source: "ticketmaster", venue_provider_id: "AUTHORITATIVE",
    lat: 43.65, lng: -79.38,
  }], {
    "known hall": licensed("known"),
    [providerKey]: { galleryPool: [], photos: [] },
  });

  assert.deepEqual(result.bindings, {});
  assert.equal(result.stats.rejected.exactProviderRow, 1);
});

test("binding distance and serialization are deterministic", () => {
  assert.equal(Math.round(venuePhotoBindingDistanceMeters(
    { lat: 43.6289, lng: -79.4158 },
    { lat: 43.62945, lng: -79.41492 },
  )), 94);
  assert.equal(venuePhotoBindingDistanceMeters({ lat: null, lng: 0 }, { lat: 0, lng: 0 }), null);
  assert.equal(serializeVenuePhotoProviderBindings({
    "provider:z:last": "z hall",
    "provider:a:first": "a hall",
  }), "{\n  \"provider:a:first\": \"a hall\",\n  \"provider:z:last\": \"z hall\"\n}\n");
});

test("provider catalogue keys reject delimiters and control characters", () => {
  assert.equal(providerVenuePhotoCatalogKey("ticketmaster", "safe-ID_7~x"),
    "provider:ticketmaster:safe-id_7~x");
  assert.equal(providerVenuePhotoCatalogKey("ticket:master", "venue"), null);
  assert.equal(providerVenuePhotoCatalogKey("ticketmaster", "venue:other"), null);
  assert.equal(providerVenuePhotoCatalogKey("ticketmaster", "venue\nother"), null);
});
