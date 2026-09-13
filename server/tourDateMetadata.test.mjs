import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveTourNameFromEventTitle,
  publicTourDateArtistProjection,
  publicTourDateProviderFields,
} from "./tourDateMetadata.js";

test("tour-name derivation accepts one explicit concert tour segment", () => {
  assert.equal(deriveTourNameFromEventTitle({
    eventName: "Tiffany Day - HALO TOUR",
    artist: "Tiffany Day",
    eventKind: "concert",
  }), "HALO TOUR");
  assert.equal(deriveTourNameFromEventTitle({
    eventName: "Foundation World Tour",
    artist: "Foundation Artist",
    eventKind: "concert",
  }), "Foundation World Tour");
  assert.equal(deriveTourNameFromEventTitle({
    eventName: "Tiffany Day - HALO TOUR - MOVED TO OPERA HOUSE",
    artist: "Tiffany Day",
    eventKind: "concert",
  }), "HALO TOUR");
});

test("tour-name derivation fails closed for ambiguous and special-event titles", () => {
  for (const eventName of [
    "Foundation Artist Live",
    "Tour",
    "Artist Tour - Encore Tour",
    "Reading Festival World Tour",
    "County Fair Tour Stage",
    "Summer Fest - North American Tour",
  ]) {
    assert.equal(deriveTourNameFromEventTitle({
      eventName,
      artist: "Foundation Artist",
      eventKind: "concert",
    }), null, eventName);
  }
  assert.equal(deriveTourNameFromEventTitle({
    eventName: "CNE World Tour",
    artist: "Foundation Artist",
    eventKind: "festival",
  }), null);
  assert.equal(deriveTourNameFromEventTitle({
    eventName: "Foundation World Tour",
    artist: "Foundation Artist",
    eventKind: null,
  }), null);
});

test("provider projection preserves official title and distinguishes absent access confidence", () => {
  assert.deepEqual(publicTourDateProviderFields({
    provider_event_id: "tm-42",
    event_name: "Foundation Artist - HALO TOUR",
    tour_name: "HALO TOUR",
    start_date_time: "2032-05-10T23:30:00.000Z",
    start_local_time: "2032-05-10T19:30:00",
    access_start_date_time: "2032-05-10T22:30:00.000Z",
    access_start_approximate: 0,
    event_status: "onsale",
  }), {
    providerEventId: "tm-42",
    eventName: "Foundation Artist - HALO TOUR",
    tourName: "HALO TOUR",
    startDateTime: "2032-05-10T23:30:00.000Z",
    startLocalTime: "2032-05-10T19:30:00",
    accessStartDateTime: "2032-05-10T22:30:00.000Z",
    accessStartApproximate: false,
    eventStatus: "onsale",
  });
  assert.equal(publicTourDateProviderFields({}).accessStartApproximate, null);
});

test("public artist projection repairs contradicted provider bindings without changing legacy or member rows", () => {
  const collision = {
    artist: "sports.",
    artist_key: "sports-dot",
    source: "ticketmaster",
    music_evidence: "ticketmaster:classification:music",
    billed_artists: '["Jungle","Sports"]',
  };
  assert.deepEqual(publicTourDateArtistProjection(collision), {
    artist: "Jungle",
    bindingAllowed: false,
  });
  assert.deepEqual(publicTourDateArtistProjection({
    ...collision,
    billed_artists: '["Jungle","sports."]',
  }), {
    artist: "sports.",
    bindingAllowed: true,
  });
  assert.deepEqual(publicTourDateArtistProjection({
    ...collision,
    billed_artists: "[]",
  }), {
    artist: "sports.",
    bindingAllowed: true,
  });
  assert.deepEqual(publicTourDateArtistProjection({
    ...collision,
    owner_id: "member",
  }), {
    artist: "sports.",
    bindingAllowed: true,
  });
  assert.deepEqual(publicTourDateArtistProjection({
    ...collision,
    music_evidence: null,
  }), {
    artist: "sports.",
    bindingAllowed: false,
  });
});
