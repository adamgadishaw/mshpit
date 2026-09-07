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
  experienceType = "in_person",
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
  experience_type: experienceType,
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

test("regional top-rated projection resolves a Portugal provider code without a country name", () => {
  const rows = [post({
    id: "lisbon-review", userId: "lisbon-fan", artist: "Lisbon Night",
    venue: "Altice Arena", city: "Lisbon", overall: 4.5,
  })];
  const locations = [{
    ...provider({
      artist: "Lisbon Night", id: "pt-arena", country: "", countryCode: "PT",
      city: "Lisbon", venue: "Altice Arena",
    }),
    place: "Lisbon",
  }];

  const result = projectTopRatedShows(rows, locations, { country: "Portugal", limit: 10 });
  assert.equal(result.length, 1);
  assert.equal(result[0].venueCountry, "Portugal");
  assert.equal(result[0].venueCountryCode, "PT");
});

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,is_banned INTEGER NOT NULL DEFAULT 0,suspended_until INTEGER,dormant_at INTEGER
    );
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,artist TEXT NOT NULL,artist_key TEXT,
      venue TEXT NOT NULL,venue_key TEXT,city TEXT,date TEXT,overall REAL,review TEXT,
      tour TEXT,kind TEXT,experience_type TEXT NOT NULL DEFAULT 'in_person',
      removed INTEGER NOT NULL DEFAULT 0,created_at INTEGER,updated_at INTEGER
    );
    CREATE TABLE tour_dates (
      id TEXT PRIMARY KEY,artist TEXT,artist_key TEXT,venue TEXT,place TEXT,date TEXT,
      source TEXT,venue_provider_id TEXT,venue_city TEXT,venue_region TEXT,
      venue_country_code TEXT,venue_country TEXT,owner_id TEXT,updated_at INTEGER
    );
    CREATE INDEX idx_tourdates_artist_visibility ON tour_dates(artist_key,date,id) WHERE artist_key IS NOT NULL;
    CREATE INDEX idx_tourdates_artist_trim_date ON tour_dates(lower(trim(artist)),date,id);
    INSERT INTO users (id,is_banned,suspended_until) VALUES
      ('active',0,NULL),('banned',1,NULL),('suspended',0,4102444800000);
    INSERT INTO posts VALUES
      ('active-post','active','Visible Artist','visible artist','The Hall','the hall','Toronto','2026-08-01',4.5,'Visible review','World Tour','review','in_person',0,10,NULL),
      ('online-post','active','Visible Artist','visible artist','The Hall','the hall','Toronto','2026-08-01',5,'Online review',NULL,'review','online',0,15,NULL),
      ('banned-post','banned','Banned Artist','banned artist','The Hall','the hall','Toronto','2026-08-01',5,'Hidden','World Tour','review','in_person',0,11,NULL),
      ('suspended-post','suspended','Suspended Artist','suspended artist','The Hall','the hall','Toronto','2026-08-01',5,'Hidden','World Tour','review','in_person',0,12,NULL),
      ('removed-post','active','Removed Artist','removed artist','The Hall','the hall','Toronto','2026-08-01',5,'Hidden','World Tour','review','in_person',1,13,NULL),
      ('status-post','active','Status Artist','status artist','The Hall','the hall','Toronto','2026-08-01',5,'Hidden','World Tour','status','in_person',0,14,NULL);
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
    assert.equal(first[0].ratingCount, 1, "online reviews never enter physical-show rankings");
    assert.equal(first.length <= 30, true);
    assert.equal(second, first, "same-region reads reuse the short-lived immutable snapshot");
    assert.equal(reads, 1);
  } finally {
    raw.close();
  }
});

function tracked(raw,{rejectProvider=()=>false}={}) {
  const counts={posts:0,providers:0,providerSql:"",parameters:null};
  return {counts,database:{prepare(sql) {
    const statement=raw.prepare(sql);
    if(sql.includes("WITH requested"))counts.providerSql=sql;
    return {all(...args) {
      if(sql.includes("FROM posts p"))counts.posts++;
      if(sql.includes("WITH requested")) {
        counts.providers++;counts.parameters=args;
        if(rejectProvider())throw new Error("Synthetic provider-location read failure");
      }
      return statement.all(...args);
    }};
  }}};
}

test("changing countries and limits reuses one bounded aggregate snapshot without reviewer data",()=>{
  const raw=fixture(),{database,counts}=tracked(raw);
  try {
    const service=createTopRatedShowService({database,clock:()=>1000});
    const first=service.read({country:"Canada",limit:24});
    for(let i=1;i<=30;i++)service.read({country:i%2?"United States":"Canada",limit:i});
    const last=service.read({country:"Canada",limit:24});
    assert.deepEqual(last,first);
    assert.equal(counts.posts,1);assert.equal(counts.providers,1);
    assert.equal("user_id" in first[0],false);assert.equal("review" in first[0],false);
    assert.equal(counts.parameters.length,2,"one JSON batch and one limit, not a variable per reviewed show");
  } finally {raw.close();}
});

test("country switching cannot extend the moderation/deletion cache deadline",()=>{
  const raw=fixture(),{database,counts}=tracked(raw);let at=1000;
  try {
    const service=createTopRatedShowService({database,clock:()=>at});
    assert.equal(service.read({country:"Canada"}).length,1);
    raw.exec("UPDATE posts SET removed=1 WHERE id='active-post'");
    at=60_999;assert.equal(service.read({country:"Worldwide"}).length,1,"same original snapshot, still within its minute");
    at=61_000;assert.equal(service.read({country:"Worldwide"}).length,0,"a new country request did not restart the minute");
    assert.equal(service.read({country:"Canada"}).length,0);
    assert.equal(counts.posts,2);assert.equal(counts.providers,1,"empty valid reviews skip provider work");
  } finally {raw.close();}
});

test("clock rollback invalidates the snapshot and failed refreshes cannot return old rankings",()=>{
  const raw=fixture();let at=1000,fail=false;
  const {database}=tracked(raw,{rejectProvider:()=>fail});
  try {
    const service=createTopRatedShowService({database,clock:()=>at});
    assert.equal(service.read({country:"Canada"}).length,1);
    at=999;fail=true;
    assert.throws(()=>service.read({country:"Canada"}),/Synthetic/);
    assert.throws(()=>service.read({country:"Worldwide"}),/Synthetic/);
    fail=false;raw.exec("UPDATE users SET is_banned=1 WHERE id='active'");
    assert.deepEqual(service.read({country:"Canada"}),[]);
  } finally {raw.close();}
});

test("old reviewed shows keep their exact country after more than 5000 unrelated provider updates",()=>{
  const raw=fixture(),{database,counts}=tracked(raw);
  try {
    const insert=raw.prepare("INSERT INTO tour_dates(id,artist,artist_key,venue,date,updated_at) VALUES (?,'Unrelated','unrelated','Other Hall','2027-01-01',?)");
    raw.exec("BEGIN");for(let i=0;i<5100;i++)insert.run("newer-"+i,100+i);raw.exec("COMMIT");
    const rows=createTopRatedShowService({database,clock:()=>1000}).read({country:"Canada"});
    assert.equal(rows.length,1);assert.equal(rows[0].providerVenueId,"tm-ca-hall");
    const plan=raw.prepare("EXPLAIN QUERY PLAN "+counts.providerSql).all(...counts.parameters).map(row=>row.detail).join(" ");
    assert.match(plan,/idx_tourdates_artist_visibility/);assert.match(plan,/idx_tourdates_artist_trim_date/);
  } finally {raw.close();}
});

test("5000 distinct reviewed identities use two SQL bindings and retain bounded public results", () => {
  const raw = fixture();
  const { database, counts } = tracked(raw);
  try {
    const insertPost = raw.prepare(`INSERT INTO posts(id,user_id,artist,artist_key,venue,city,date,overall,kind,created_at)
      VALUES (?,'active',?,?,'The Hall','Toronto','2026-08-01',4.5,'review',?)`);
    const insertEvent = raw.prepare(`INSERT INTO tour_dates(id,artist,artist_key,venue,date,venue_country_code,venue_country,updated_at)
      VALUES (?,?,?,'The Hall','2026-08-01','CA','Canada',?)`);
    raw.exec("BEGIN");
    for (let index = 0; index < 5000; index++) {
      const key = `batch-${index}`;
      const name = `Batch ${index}`;
      insertPost.run(key, name, key, 100 + index);
      insertEvent.run(key, name, key, 100 + index);
    }
    raw.exec("COMMIT");
    const rows = createTopRatedShowService({ database, clock: () => 1000 }).read({ country: "Canada", limit: 100 });
    assert.equal(rows.length, 30);
    assert.equal(counts.parameters.length, 2);
    assert.equal(JSON.parse(counts.parameters[0]).length, 5000);
    assert.equal(counts.parameters[1], 5000);
  } finally {
    raw.close();
  }
});

test("provider matching never uses private dates or a different typed artist identity", () => {
  const raw = fixture();
  try {
    raw.exec("UPDATE tour_dates SET owner_id='active'");
    assert.deepEqual(createTopRatedShowService({ database: raw }).read({ country: "Canada" }), []);
    raw.exec("UPDATE tour_dates SET owner_id=NULL,artist_key='different-artist'");
    assert.deepEqual(createTopRatedShowService({ database: raw }).read({ country: "Canada" }), []);
    raw.exec("UPDATE tour_dates SET artist_key='visible artist',date='2026-08-02'");
    assert.deepEqual(createTopRatedShowService({ database: raw }).read({ country: "Canada" }), []);
  } finally {
    raw.close();
  }
});

test("typed artist keys survive a provider display-name change and legacy unkeyed reviews still resolve",()=>{
  const raw=fixture();
  try {
    raw.exec("UPDATE tour_dates SET artist='Updated Display Name'");
    assert.equal(createTopRatedShowService({database:raw,clock:()=>1000}).read({country:"Canada"}).length,1);
    raw.exec("UPDATE tour_dates SET artist='Visible Artist'; UPDATE posts SET artist_key=NULL WHERE id='active-post'");
    assert.equal(createTopRatedShowService({database:raw,clock:()=>1000}).read({country:"Canada"}).length,1);
  } finally {raw.close();}
});

test("blank review identity fields cannot consume the entire valid candidate budget",()=>{
  const raw=fixture();
  try {
    const insert=raw.prepare("INSERT INTO posts(id,user_id,artist,venue,date,overall,kind,created_at) VALUES (?,'active','  ','The Hall','2026-08-01',5,'review',?)");
    raw.exec("BEGIN");for(let i=0;i<5000;i++)insert.run("blank-"+i,100+i);raw.exec("COMMIT");
    const rows=createTopRatedShowService({database:raw,clock:()=>1000}).read({country:"Canada"});
    assert.equal(rows.length,1);assert.equal(rows[0].artist,"Visible Artist");
  } finally {raw.close();}
});
