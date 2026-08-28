import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createTopRatedShowService,
  projectTopRatedShows,
} from "./topRatedShowService.js";

const post = ({
  id,
  userId,
  artist,
  venue = "The Hall",
  city,
  date = "2026-08-01",
  overall,
  review = "A real review",
  createdAt = 1,
  tour = null,
}) => ({
  id,
  user_id: userId,
  artist,
  artist_key: artist.toLocaleLowerCase(),
  venue,
  venue_key: venue.toLocaleLowerCase(),
  city,
  date,
  overall,
  review,
  tour,
  created_at: createdAt,
  updated_at: null,
});

const provider = ({
  artist,
  id,
  country,
  countryCode,
  city,
  venue = "The Hall",
  date = "2026-08-01",
}) => ({
  artist,
  artist_key: artist.toLocaleLowerCase(),
  venue,
  place: `${city}, Region, ${country}`,
  date,
  source: "ticketmaster",
  venue_provider_id: id,
  venue_city: city,
  venue_region: "Region",
  venue_country_code: countryCode,
  venue_country: country,
});

test("regional top-rated projection uses real provider identity and one latest rating per account", () => {
  const rows = [
    post({ id: "repeat-new", userId: "repeat", artist: "Crowd", city: "Toronto", overall: 4, createdAt: 30, tour: "World Tour" }),
    post({ id: "repeat-old", userId: "repeat", artist: "Crowd", city: "Toronto", overall: 1, createdAt: 20, tour: "World Tour" }),
    ...Array.from({ length: 12 }, (_, index) => post({
      id: `crowd-${index}`,
      userId: `crowd-user-${index}`,
      artist: "Crowd",
      city: "Toronto",
      overall: index < 9 ? 5 : 4,
      createdAt: 19 - index,
      tour: "World Tour",
    })),
    post({ id: "lone", userId: "solo", artist: "Lone Five", city: "Toronto", overall: 5, createdAt: 40 }),
    post({ id: "us", userId: "us-user", artist: "US Night", city: "Chicago", overall: 5, createdAt: 50 }),
  ];
  const locations = [
    provider({ artist: "Crowd", id: "ca-hall", country: "Canada", countryCode: "CA", city: "Toronto" }),
    provider({ artist: "Lone Five", id: "ca-hall", country: "Canada", countryCode: "CA", city: "Toronto" }),
    provider({ artist: "US Night", id: "us-hall", country: "United States", countryCode: "US", city: "Chicago" }),
  ];

  const result = projectTopRatedShows(rows, locations, { country: "Canada", limit: 10 });
  assert.deepEqual(result.map((row) => row.artist), ["Crowd", "Lone Five"], "confidence beats a lone perfect score");
  assert.equal(result[0].ratingCount, 13, "one member's older rating does not count twice");
  assert.equal(result[0].providerVenueId, "ca-hall");
  assert.equal(result[0].venueIdentity, "provider:ticketmaster:ca-hall");
  assert.equal(result[0].venueCountryCode, "CA");
  assert.equal(result[0].tourName, "World Tour");
  assert.equal(result.some((row) => row.artist === "US Night"), false);
});

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,is_banned INTEGER NOT NULL DEFAULT 0,suspended_until INTEGER
    );
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,artist TEXT NOT NULL,artist_key TEXT,
      venue TEXT NOT NULL,venue_key TEXT,city TEXT,date TEXT,overall REAL,review TEXT,
      tour TEXT,kind TEXT,removed INTEGER NOT NULL DEFAULT 0,created_at INTEGER,updated_at INTEGER
    );
    CREATE TABLE tour_dates (
      id TEXT PRIMARY KEY,artist TEXT,artist_key TEXT,venue TEXT,place TEXT,date TEXT,
      source TEXT,venue_provider_id TEXT,venue_city TEXT,venue_region TEXT,
      venue_country_code TEXT,venue_country TEXT,owner_id TEXT,updated_at INTEGER
    );
    INSERT INTO users VALUES
      ('active',0,NULL),('banned',1,NULL),('suspended',0,4102444800000);
    INSERT INTO posts VALUES
      ('active-post','active','Visible Artist','visible artist','The Hall','the hall','Toronto','2026-08-01',4.5,'Visible review','World Tour','review',0,10,NULL),
      ('banned-post','banned','Banned Artist','banned artist','The Hall','the hall','Toronto','2026-08-01',5,'Hidden','World Tour','review',0,11,NULL),
      ('suspended-post','suspended','Suspended Artist','suspended artist','The Hall','the hall','Toronto','2026-08-01',5,'Hidden','World Tour','review',0,12,NULL),
      ('removed-post','active','Removed Artist','removed artist','The Hall','the hall','Toronto','2026-08-01',5,'Hidden','World Tour','review',1,13,NULL),
      ('status-post','active','Status Artist','status artist','The Hall','the hall','Toronto','2026-08-01',5,'Hidden','World Tour','status',0,14,NULL);
    INSERT INTO tour_dates VALUES
      ('venue','Visible Artist','visible artist','The Hall','Toronto, Ontario, Canada','2026-08-01',
        'ticketmaster','tm-ca-hall','Toronto','Ontario','CA','Canada',NULL,20);
  `);
  return database;
}

test("server-backed read excludes moderated accounts and caches bounded public results", () => {
  const raw = fixture();
  let reads = 0;
  const database = {
    prepare(sql) {
      if (sql.includes("FROM posts p")) reads += 1;
      return raw.prepare(sql);
    },
  };
  try {
    const service = createTopRatedShowService({ database, clock: () => 1_000 });
    const first = service.read({ country: "Canada", limit: 60 });
    const second = service.read({ country: "Canada", limit: 60 });
    assert.deepEqual(first.map((row) => row.artist), ["Visible Artist"]);
    assert.equal(first.length <= 30, true);
    assert.equal(second, first, "same-region reads reuse the short-lived immutable snapshot");
    assert.equal(reads, 1);
  } finally {
    raw.close();
  }
});
