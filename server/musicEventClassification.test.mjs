import assert from "node:assert/strict";
import test from "node:test";

import { bandsintownMusicEvent, ticketmasterMusicEvent } from "./musicEventClassification.js";
import { ticketmasterRows } from "./tourdates.js";

const venue = {
  id: "venue-1", name: "Exhibition Grounds", city: { name: "Toronto" },
  country: { name: "Canada", countryCode: "CA" },
};

function ticketmasterEvent(overrides = {}) {
  return {
    id: "event-1",
    name: "Canadian National Exhibition",
    dates: { start: { localDate: "2030-08-16" }, end: { localDate: "2030-09-02" } },
    classifications: [{ segment: { name: "Music" }, genre: { name: "Rock" } }],
    _embedded: {
      attractions: [{ name: "The Beaches" }, { name: "Metric" }],
      venues: [venue],
    },
    ...overrides,
  };
}

test("music-classified fairs, rodeos, festivals, and multi-day programming retain real evidence", () => {
  const fair = ticketmasterMusicEvent(ticketmasterEvent());
  assert.equal(fair.kind, "fair");
  assert.equal(fair.evidence, "ticketmaster:classification:music");
  assert.deepEqual(fair.billedArtists, ["The Beaches", "Metric"]);
  assert.equal(fair.endDate, "2030-09-02");

  assert.equal(ticketmasterMusicEvent(ticketmasterEvent({
    name: "Calgary Stampede Rodeo Concert Series",
  })).kind, "rodeo");
  assert.equal(ticketmasterMusicEvent(ticketmasterEvent({
    name: "Lollapalooza",
  })).kind, "multi_day");
  assert.equal(ticketmasterMusicEvent(ticketmasterEvent({
    name: "OVO Fest",
    dates: { start: { localDate: "2030-08-01" } },
  })).kind, "festival");
});

test("event-name keywords never admit an arbitrary non-music fair or rodeo", () => {
  assert.equal(ticketmasterMusicEvent(ticketmasterEvent({
    name: "State Fair",
    classifications: [{ segment: { name: "Sports" } }],
    _embedded: { attractions: [], venues: [venue] },
  })), null);
  assert.equal(ticketmasterMusicEvent(ticketmasterEvent({
    name: "Championship Rodeo",
    classifications: [{ segment: { name: "Sports" } }],
    _embedded: { attractions: [], venues: [venue] },
  })), null);
  assert.equal(bandsintownMusicEvent({ title: "County Fair", lineup: [] }), null);
});

test("Ticketmaster fallback is limited to an exact requested-artist billing", () => {
  const unclassified = ticketmasterEvent({ classifications: [] });
  assert.equal(ticketmasterMusicEvent(unclassified), null,
    "city and country discovery require explicit Music taxonomy");
  assert.equal(ticketmasterMusicEvent(unclassified, { requestedArtist: "Unrelated Artist" }), null);
  const matched = ticketmasterMusicEvent(unclassified, { requestedArtist: "The Beaches" });
  assert.equal(matched.evidence, "ticketmaster:artist-search:matched-attraction");
});

test("Ticketmaster discovery requires the Music segment, not a lower taxonomy label", () => {
  assert.equal(ticketmasterMusicEvent(ticketmasterEvent({
    classifications: [{ segment: { name: "Sports" }, genre: { name: "Music" } }],
  })), null);
  assert.equal(ticketmasterMusicEvent(ticketmasterEvent({
    classifications: [{ segment: { name: "Arts & Theatre" }, subGenre: { name: "Music" } }],
  })), null);
  assert.equal(ticketmasterMusicEvent(ticketmasterEvent({
    classifications: [{ segment: { name: "Music" }, genre: { name: "Sports" } }],
  })).evidence, "ticketmaster:classification:music");
});

test("Ticketmaster projection persists a bounded billed lineup for logging and public pages", () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ name: `Artist ${index + 1}` }));
  const rows = ticketmasterRows({ _embedded: { events: [ticketmasterEvent({
    name: "Boots and Hearts Music Festival",
    _embedded: { attractions: many, venues: [venue] },
  })] } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_kind, "festival");
  assert.equal(rows[0].music_qualified, 1);
  assert.equal(rows[0].billed_artists.length, 20);
  assert.equal(rows[0].artist, "Artist 1");
});
