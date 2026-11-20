import test from "node:test";
import assert from "node:assert/strict";
import { reviewedFestivalEventRow } from "./reviewedFestivalEventCorrections.js";

const event = {
  id: "tm_G5vIZ_G2gu-Q7", provider_event_id: "G5vIZ_G2gu-Q7", source: "ticketmaster",
  event_name: "Corona Capital", date: "2026-11-20", artist: "Daniel Caesar", artist_key: "daniel caesar",
  provider_artist_id: "test-caesar", canonical_artist_key: "daniel caesar", venue: "Autódromo Hermanos Rodríguez - Redirect",
  place: "Temple City, California, United States Of America", venue_provider_id: "wrong-id",
  lat: 34, lng: -118, start_local_time: "12:00:00", ticket_url: "https://tickets.example/admission",
  billed_artists: JSON.stringify(["Gorillaz", "Daniel Caesar", "Chvrches"]), event_status: "onsale",
};
test("exact Friday correction preserves provider and admission identity, fixes city and stale artist", () => {
  const result = reviewedFestivalEventRow(event);
  for (const key of ["id", "provider_event_id", "ticket_url", "date", "event_name", "event_status"]) {
    assert.equal(result[key], event[key], key);
  }
  assert.equal(result.artist, "Corona Capital");
  assert.equal(result.artist_key, null);
  assert.equal(result.provider_artist_id, null);
  assert.equal(result.canonical_artist_key, null);
  assert.equal(result.venue, "Autódromo Hermanos Rodríguez");
  assert.equal(result.venue_country_code, "MX");
  assert.equal(result.event_timezone, "America/Mexico_City");
  assert.equal(result.venue_provider_id, null);
  assert.equal(result.lat, null);
  assert.equal(result.start_local_time, null);
  assert.deepEqual(JSON.parse(result.billed_artists), ["Jamie xx", "Gorillaz", "Chvrches"]);
  assert.deepEqual(reviewedFestivalEventRow(result), result);
});
test("a valid Mexico City Friday ticket keeps its original location, time, and route", () => {
  const row = { ...event, id: "tm_1AfZk3_Gkdw1XuQ", provider_event_id: "1AfZk3_Gkdw1XuQ",
    event_name: "Individual Banamex Plus Corona Capital 2026", venue: "Autodromo Hnos. Rodriguez",
    place: "México, Ciudad de México, Mexico", venue_provider_id: "correct-id", start_local_time: "14:00:00",
    artist: "Gorillaz", artist_key: "gorillaz", canonical_artist_key: "gorillaz",
    billed_artists: ["Jamie xx", "Daniel Caesar", "Gorillaz"] };
  assert.deepEqual(reviewedFestivalEventRow(row), { ...row, billed_artists: ["Jamie xx", "Gorillaz"] });
});
test("both Flow Fest dates and Corona Sunday fix venue without changing lineup", () => {
  for (const [event_name,date] of [["Coca-Cola Flow Fest","2026-11-28"],["Coca-Cola Flow Fest","2026-11-29"],
    ["Corona Capital","2026-11-22"]]) {
    const row = { ...event, event_name, date, artist: "The xx", artist_key: "the xx", billed_artists: ["The xx"] };
    const result = reviewedFestivalEventRow(row);
    assert.equal(result.venue_country_code, "MX");
    assert.deepEqual(result.billed_artists, ["The xx"]);
    assert.equal(result.artist_key, "the xx");
  }
});
test("does not modify member, EDC, other-city lookalike, wrong provider, or next year", () => {
  for (const patch of [{owner_id:"member"},{ownerId:"member"},{event_name:"EDC Mexico"},{source:"bandsintown"},
    {provider_event_id:"different"},{date:"2027-11-20"},
    {id:"tm_other",provider_event_id:"other",venue:"Other venue",place:"Toronto, Canada"}]) {
    const row = { ...event, ...patch };
    assert.equal(reviewedFestivalEventRow(row), row);
  }
});
