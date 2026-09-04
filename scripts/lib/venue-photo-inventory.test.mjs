import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  buildVenuePhotoInventory,
  readTourDateVenueRows,
  venuePhotoCoverageReport,
} from "./venue-photo-inventory.mjs";

const licensed = (uri) => ({
  uri,
  sourcePage: "https://commons.wikimedia.org/wiki/File:Venue.jpg",
  creator: "Venue Photographer",
  license: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  source: "commons",
});

test("tour-date venue inventory is provider scoped, deterministic, and collision safe", () => {
  const inventory = buildVenuePhotoInventory({
    "known hall": { name: "Known Hall", place: "Toronto, Canada" },
  }, [
    {
      venue: "Known Hall", source: "ticketmaster", venue_provider_id: "ONE",
      venue_city: "Toronto", venue_country_code: "CA", venue_country: "Canada",
    },
    {
      venue: "New Room", source: "ticketmaster", venue_provider_id: "TWO",
      venue_city: "Ottawa", venue_country_code: "CA", venue_country: "Canada",
    },
    {
      venue: "New Room", source: "ticketmaster", venue_provider_id: "TWO",
      venue_city: "Montreal", venue_country_code: "CA", venue_country: "Canada",
    },
  ]);
  assert.deepEqual(inventory.entries.map(([key]) => key), [
    "known hall",
    "provider:ticketmaster:one",
  ]);
  assert.equal(inventory.stats.addedFromTourDates, 1);
  assert.equal(inventory.stats.ambiguousVenueIdentities, 1);
  assert.deepEqual(inventory.entries[1][1]._inventoryOrigins, ["tour_dates"]);
  assert.equal(inventory.entries[1][1].lat, null);
  assert.equal(inventory.entries[1][1].lng, null);
});

test("coverage does not report a name photo as served for a provider-scoped tour venue", () => {
  const inventory = buildVenuePhotoInventory({
    "known hall": { name: "Known Hall" },
  }, [{
    venue: "Known Hall", source: "ticketmaster", venue_provider_id: "ONE",
    venue_city: "Toronto", venue_country_code: "CA",
  }]);
  const verified = {
    "known hall": { galleryPool: [licensed("https://media.example/known.webp")] },
  };
  const report = venuePhotoCoverageReport(inventory, verified);
  assert.equal(report.total, 2);
  assert.equal(report.exactCovered, 1);
  assert.equal(report.servedCovered, 1);
  assert.equal(report.tourDateExactCovered, 0);
  assert.equal(report.tourDateServedCovered, 0);
  assert.equal(report.tourDateServedMissing, 1);
  assert.equal(report.tourDateServedCoveragePercent, 0);
});

test("coverage still counts a verified name fallback for a name-only legacy identity", () => {
  const inventory = {
    entries: [[
      "legacy-import-key",
      { name: "Known Hall", _inventoryOrigins: ["catalog", "tour_dates"] },
    ]],
  };
  const verified = {
    "known hall": { galleryPool: [licensed("https://media.example/known.webp")] },
  };
  const report = venuePhotoCoverageReport(inventory, verified);
  assert.equal(report.exactCovered, 0);
  assert.equal(report.servedCovered, 1);
  assert.equal(report.tourDateExactCovered, 0);
  assert.equal(report.tourDateServedCovered, 1);
});

test("tour-date inventory reads a bounded read-only projection of the live schema", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-venue-inventory-"));
  const path = join(directory, "pit.db");
  try {
    const database = new DatabaseSync(path);
    database.exec(`CREATE TABLE tour_dates (
      venue TEXT,source TEXT,venue_provider_id TEXT,place TEXT,venue_city TEXT,
      venue_region TEXT,venue_country_code TEXT,venue_country TEXT,
      lat REAL,lng REAL,updated_at INTEGER
    )`);
    database.prepare(`INSERT INTO tour_dates VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      "Rogers Centre", "ticketmaster", "KovZpZAEkkIA", "Toronto, Canada",
      "Toronto", "Ontario", "CA", "Canada", 43.6414, -79.3894, 123,
    );
    database.close();
    const result = readTourDateVenueRows(path, { limit: 10 });
    assert.equal(result.available, true);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].venue_provider_id, "KovZpZAEkkIA");
    assert.throws(() => readTourDateVenueRows(path, { limit: 0 }), /inventory limit/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
