import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createPublicCollectionRepository } from "./publicCollectionRepository.js";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const TODAY = "2026-08-25";
const LONG_REVIEW = "A detailed firsthand review of the performance, sound, crowd, venue, and encore that preserves a real concert memory.";

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,is_banned INTEGER NOT NULL DEFAULT 0,suspended_until INTEGER
    );
    CREATE TABLE artists (
      norm TEXT PRIMARY KEY,name TEXT NOT NULL,public_slug TEXT,genre TEXT,bio TEXT,updated_at INTEGER
    );
    CREATE TABLE tour_dates (
      id TEXT PRIMARY KEY,artist TEXT NOT NULL,artist_key TEXT,venue TEXT,place TEXT,date TEXT,
      source TEXT,updated_at INTEGER NOT NULL DEFAULT 0,owner_id TEXT,release_at INTEGER NOT NULL DEFAULT 0,
      provider_event_id TEXT,venue_provider_id TEXT,venue_city TEXT,venue_region TEXT,
      venue_country_code TEXT,venue_country TEXT,provider_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,artist TEXT NOT NULL,artist_key TEXT,venue TEXT NOT NULL,
      venue_key TEXT,city TEXT,date TEXT,overall REAL,review TEXT,photos_public INTEGER NOT NULL DEFAULT 0,
      kind TEXT DEFAULT 'review',removed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER
    );
    CREATE TABLE media_objects (
      object_key TEXT PRIMARY KEY,owner_id TEXT NOT NULL,storage_scope TEXT NOT NULL,status TEXT NOT NULL
    );
    CREATE TABLE media_assets (
      id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,kind TEXT NOT NULL,source_key TEXT NOT NULL,
      source_storage_scope TEXT,metadata_status TEXT,codec_status TEXT,status TEXT,
      source_verified_at INTEGER,render_state TEXT,render_variant_id TEXT
    );
    CREATE TABLE media_variants (
      id TEXT PRIMARY KEY,asset_id TEXT NOT NULL,role TEXT NOT NULL,object_key TEXT NOT NULL,
      status TEXT,verification_origin TEXT
    );
    CREATE TABLE post_media (
      post_id TEXT NOT NULL,asset_id TEXT NOT NULL,position INTEGER NOT NULL,
      PRIMARY KEY(post_id,asset_id)
    );
    CREATE INDEX city_lookup ON tour_dates(venue_country_code,venue_city,release_at,date,id);
    CREATE INDEX post_artist_archive ON posts(artist_key,date DESC,id);
  `);
  return db;
}

function addUser(db,id,{ banned = false,suspended = false } = {}) {
  db.prepare("INSERT INTO users (id,is_banned,suspended_until) VALUES (?,?,?)")
    .run(id,banned ? 1 : 0,suspended ? NOW + 86_400_000 : null);
}
function addArtist(db,{ key = "alpha",name = "Alpha",slug = key,bio = "" } = {}) {
  db.prepare("INSERT INTO artists (norm,name,public_slug,genre,bio,updated_at) VALUES (?,?,?,?,?,?)")
    .run(key,name,slug,"Rock",bio,NOW);
}
function addTour(db,{
  id,artist = "Alpha",artistKey = "alpha",venue = "Hall A",date = "2026-12-01",
  city = "Toronto",countryCode = "CA",country = "Canada",place = "ignored free form",
  source = "ticketmaster",providerVenueId = null,providerEventId = null,ownerId = null,
  releaseAt = 0,providerActive = true,
} = {}) {
  db.prepare(`INSERT INTO tour_dates
    (id,artist,artist_key,venue,place,date,source,updated_at,owner_id,release_at,
      provider_event_id,venue_provider_id,venue_city,venue_region,venue_country_code,venue_country,provider_active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,artist,artistKey,venue,place,date,source,NOW,ownerId,releaseAt,
    providerEventId || `provider-${id}`,providerVenueId,city,"Ontario",countryCode,country,providerActive ? 1 : 0,
  );
}
function addPost(db,{
  id,userId = "active",artist = "Alpha",artistKey = "alpha",venue = "Hall A",
  venueKey = null,date = "2026-08-01",review = LONG_REVIEW,overall = 4,
  photosPublic = false,removed = false,kind = "review",createdAt = NOW,
} = {}) {
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,artist_key,venue,venue_key,city,date,overall,review,photos_public,kind,removed,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,userId,artist,artistKey,venue,venueKey || venue.toLowerCase(),"USER AUTHORED CITY MUST NOT IDENTIFY",date,
    overall,review,photosPublic ? 1 : 0,kind,removed ? 1 : 0,createdAt,createdAt + 1,
  );
}
function addReadyImage(db,{ postId,ownerId = "active",assetId = `asset-${postId}` }) {
  const source = `private/${assetId}`;
  const render = `public/${assetId}.jpg`;
  const variant = `variant-${assetId}`;
  db.prepare("INSERT INTO media_objects VALUES (?,?,?,?)").run(source,ownerId,"private","associated");
  db.prepare("INSERT INTO media_objects VALUES (?,?,?,?)").run(render,ownerId,"public","associated");
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,kind,source_key,source_storage_scope,metadata_status,codec_status,status,
      source_verified_at,render_state,render_variant_id)
    VALUES (?,?,?,?,?,'declared','not_applicable','ready',?,'ready',?)`)
    .run(assetId,ownerId,"image",source,"private",NOW,variant);
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,role,object_key,status,verification_origin)
    VALUES (?,?,'render',?,'verified','private_derivative_v1')`).run(variant,assetId,render);
  db.prepare("INSERT INTO post_media VALUES (?,?,0)").run(postId,assetId);
}

test("city venue qualification uses structured country/city and exact thresholds", () => {
  const db = createDatabase();
  try {
    addUser(db,"active");
    addArtist(db);
    addTour(db,{ id:"ca-1",venue:"North Hall",providerVenueId:"north",date:"2026-12-01" });
    addTour(db,{ id:"ca-2",venue:"South Hall",providerVenueId:"south",date:"2026-12-02" });
    addTour(db,{ id:"free-1",venue:"Paris One",city:null,countryCode:null,place:"Paris, France" });
    addTour(db,{ id:"free-2",venue:"Paris Two",city:null,countryCode:null,place:"Paris, France" });
    addTour(db,{ id:"free-3",venue:"Paris Two",city:null,countryCode:null,place:"Paris, France" });
    const repo = createPublicCollectionRepository(db);
    assert.equal(repo.readCityVenues({ countryCode:"CA",citySlug:"toronto",at:NOW,today:TODAY }),null);
    assert.equal(repo.readCityVenues({ countryCode:"FR",citySlug:"paris",at:NOW,today:TODAY }),null);
    addTour(db,{ id:"ca-3",venue:"North Hall",providerVenueId:"north",date:"2026-12-03" });
    for (const [id,venue,date] of [["us-1","US North","2026-11-01"],["us-2","US South","2026-11-02"],["us-3","US North","2026-11-03"]]) {
      addTour(db,{ id,venue,date,city:"Toronto",countryCode:"US",country:"United States",providerVenueId:id });
    }
    const ca = repo.readCityVenues({ countryCode:"ca",citySlug:"toronto",limit:99,at:NOW,today:TODAY });
    const us = repo.readCityVenues({ countryCode:"us",citySlug:"toronto",at:NOW,today:TODAY });
    assert.equal(ca.itemCount,3);
    assert.equal(ca.venueCount,2);
    assert.equal(ca.pageSize,12);
    assert.equal(ca.city,"Toronto");
    assert.equal(ca.country,"Canada");
    assert.equal(us.itemCount,3);
    assert.equal(us.countryCode,"US");
  } finally { db.close(); }
});

test("city venue rows fail closed for collisions and exclude inactive, unreleased, restricted, and invalid records", () => {
  const db = createDatabase();
  try {
    addUser(db,"active");
    addUser(db,"banned",{ banned:true });
    addArtist(db);
    addTour(db,{ id:"good-1",artist:"One",venue:"North",date:"2026-12-01",providerVenueId:"north" });
    addTour(db,{ id:"good-2",artist:"Two",venue:"South",date:"2026-12-02",providerVenueId:"south" });
    addTour(db,{ id:"collision-ca",artist:"Three",venue:"Collision",date:"2026-12-03",providerVenueId:"collision-ca" });
    addTour(db,{ id:"collision-us",artist:"Three",venue:"Collision",date:"2026-12-03",city:"Detroit",countryCode:"US",country:"United States",providerVenueId:"collision-us" });
    addTour(db,{ id:"inactive",artist:"Four",venue:"Inactive",date:"2026-12-04",providerActive:false });
    addTour(db,{ id:"unreleased",artist:"Five",venue:"Private",date:"2026-12-05",releaseAt:NOW + 10_000 });
    addTour(db,{ id:"restricted",artist:"Six",venue:"Restricted",date:"2026-12-06",ownerId:"banned" });
    addTour(db,{ id:"invalid",artist:"Seven",venue:"Invalid",date:"2026-02-31" });
    const repo = createPublicCollectionRepository(db);
    assert.equal(repo.readCityVenues({ countryCode:"CA",citySlug:"toronto",at:NOW,today:TODAY }),null);
    addTour(db,{ id:"good-3",artist:"Eight",venue:"North",date:"2026-12-07",providerVenueId:"north" });
    const result = repo.readCityVenues({ countryCode:"CA",citySlug:"toronto",at:NOW,today:TODAY });
    assert.equal(result.itemCount,3);
    assert.deepEqual(new Set(result.venues.map((row) => row.venue)),new Set(["North","South"]));
    assert.equal(repo.readCityVenues({ countryCode:"CA",citySlug:"toronto",page:2,at:NOW,today:TODAY }),null);
    assert.equal(repo.readCityVenues({ countryCode:"CA",citySlug:"toronto",page:1001,at:NOW,today:TODAY }),null);
  } finally { db.close(); }
});
test("city concert directories require three eligible archives across two venues and reject location ambiguity", () => {
  const db = createDatabase();
  try {
    addUser(db,"active");
    addUser(db,"banned",{ banned:true });
    addArtist(db);
    for (const [index,venue] of [[1,"North"],[2,"South"],[3,"North"]]) {
      const date = `2026-08-0${index}`;
      addTour(db,{ id:`history-${index}`,venue,date,providerVenueId:venue.toLowerCase() });
      addPost(db,{ id:`review-${index}`,venue,date,createdAt:NOW + index });
    }
    const repo = createPublicCollectionRepository(db);
    const qualified = repo.readCityConcerts({ countryCode:"CA",citySlug:"toronto",at:NOW,today:TODAY });
    assert.equal(qualified.itemCount,3);
    assert.equal(qualified.venueCount,2);
    assert.deepEqual(qualified.concerts.map((row) => row.date),["2026-08-03","2026-08-02","2026-08-01"]);

    addTour(db,{ id:"history-3-conflict",venue:"North",date:"2026-08-03",city:"Buffalo",countryCode:"US",country:"United States" });
    const collided = repo.readCityConcerts({ countryCode:"CA",citySlug:"toronto",at:NOW,today:TODAY });
    assert.equal(collided,null);

    addTour(db,{ id:"history-4",venue:"South",date:"2026-08-04" });
    addPost(db,{ id:"review-4",venue:"South",date:"2026-08-04" });
    addPost(db,{ id:"removed",venue:"South",date:"2026-08-04",removed:true });
    addPost(db,{ id:"banned",userId:"banned",venue:"North",date:"2026-08-01" });
    addPost(db,{ id:"status",venue:"North",date:"2026-08-01",kind:"status" });
    addPost(db,{ id:"short",venue:"North",date:"2026-08-01",review:"short" });
    addPost(db,{ id:"private-media",venue:"North",date:"2026-08-01",review:"",photosPublic:false });
    addPost(db,{ id:"impossible",venue:"North",date:"2026-02-31" });
    const recovered = repo.readCityConcerts({ countryCode:"CA",citySlug:"toronto",at:NOW,today:TODAY });
    assert.equal(recovered.itemCount,3);
    assert.equal(recovered.concerts.some((row) => row.date === "2026-02-31"),false);
    assert.equal(Object.hasOwn(recovered.concerts[0],"user_id"),false);
  } finally { db.close(); }
});

test("artist archives paginate without overlap and accept only substantive text or verified public media", () => {
  const db = createDatabase();
  try {
    addUser(db,"active");
    addUser(db,"banned",{ banned:true });
    addArtist(db,{ bio:"An established artist with a meaningful public catalogue and a documented live performance history for fans." });
    for (let index = 0; index < 13; index += 1) {
      const day = String(index + 1).padStart(2,"0");
      addPost(db,{ id:`archive-${index}`,venue:`Hall ${index}`,date:`2026-07-${day}`,createdAt:NOW + index });
    }
    addPost(db,{ id:"removed-archive",venue:"Removed",date:"2026-06-01",removed:true });
    addPost(db,{ id:"banned-archive",userId:"banned",venue:"Banned",date:"2026-06-02" });
    addPost(db,{ id:"invalid-archive",venue:"Invalid",date:"2026-02-31" });
    addPost(db,{ id:"pending-media",venue:"Pending",date:"2026-06-03",review:"",photosPublic:true });
    addPost(db,{ id:"private-choice",venue:"Private",date:"2026-06-04",review:"",photosPublic:false });
    addReadyImage(db,{ postId:"private-choice" });
    addPost(db,{ id:"ready-media",venue:"Gallery",date:"2026-06-05",review:"",photosPublic:true });
    addReadyImage(db,{ postId:"ready-media",assetId:"ready-gallery" });

    const repo = createPublicCollectionRepository(db);
    const first = repo.readArtistConcerts({ publicSlug:"alpha",page:1,at:NOW,today:TODAY });
    const second = repo.readArtistConcerts({ publicSlug:"alpha",page:2,at:NOW,today:TODAY });
    assert.equal(first.concerts.length,12);
    assert.equal(first.hasNext,true);
    assert.equal(second.concerts.length,2);
    assert.equal(second.hasNext,false);
    assert.equal(first.itemCount,14);
    assert.equal(second.itemCount,14);
    const firstKeys = new Set(first.concerts.map((row) => `${row.show_venue}|${row.date}`));
    assert.equal(second.concerts.some((row) => firstKeys.has(`${row.show_venue}|${row.date}`)),false);
    assert.equal(second.concerts.some((row) => row.venue === "Gallery"),true);
    assert.equal(second.concerts.some((row) => ["Pending","Private","Invalid","Removed","Banned"].includes(row.venue)),false);
    assert.equal(repo.readArtistConcerts({ publicSlug:"alpha",page:3,at:NOW,today:TODAY }),null);
  } finally { db.close(); }
});

test("artist identity resolution and legacy rows fail closed when catalogue names are ambiguous", () => {
  const db = createDatabase();
  try {
    addUser(db,"active");
    addArtist(db,{ key:"one",name:"Shared Name",slug:"shared-one" });
    addArtist(db,{ key:"two",name:"shared name",slug:"shared-two" });
    addPost(db,{ id:"legacy",artist:"Shared Name",artistKey:null,venue:"Legacy Hall",date:"2026-08-01" });
    const repo = createPublicCollectionRepository(db);
    assert.equal(repo.readArtistConcerts({ name:"Shared Name",at:NOW,today:TODAY }),null);
    assert.equal(repo.readArtistConcerts({ publicSlug:"shared-one",at:NOW,today:TODAY }),null);
    addPost(db,{ id:"bound",artist:"Shared Name",artistKey:"one",venue:"Bound Hall",date:"2026-08-02" });
    const bound = repo.readArtistConcerts({ publicSlug:"shared-one",at:NOW,today:TODAY });
    assert.equal(bound.concerts.length,1);
    assert.equal(bound.concerts[0].venue,"Bound Hall");

    addArtist(db,{ key:"hidden",name:"Hidden",slug:null });
    addPost(db,{ id:"hidden-post",artist:"Hidden",artistKey:"hidden",venue:"Hidden Hall",date:"2026-08-01" });
    assert.equal(repo.readArtistConcerts({ artistKey:"hidden",at:NOW,today:TODAY }),null);
  } finally { db.close(); }
});
test("name-only city venues are excluded when their public identity can merge across locations or providers", () => {
  const db = createDatabase();
  try {
    addUser(db,"active");
    addArtist(db);
    addTour(db,{ id:"name-toronto-1",artist:"One",venue:"Shared Room",date:"2026-12-01",providerVenueId:null });
    addTour(db,{ id:"name-toronto-2",artist:"Two",venue:"Shared Room",date:"2026-12-02",providerVenueId:null });
    addTour(db,{ id:"name-vancouver",artist:"Other",venue:"Shared Room",date:"2026-11-01",city:"Vancouver",providerVenueId:null });
    addTour(db,{ id:"unstructured-poison",artist:"Other",venue:"Loose Room",date:"2026-11-02",city:null,countryCode:null,providerVenueId:null });
    addTour(db,{ id:"loose-target",artist:"Three",venue:"Loose Room",date:"2026-12-03",providerVenueId:null });

    addTour(db,{ id:"provider-1",artist:"Four",venue:"Shared Room",date:"2026-12-04",providerVenueId:"shared-toronto" });
    addTour(db,{ id:"provider-2",artist:"Five",venue:"Shared Room",date:"2026-12-05",providerVenueId:"shared-toronto" });
    addTour(db,{ id:"provider-3",artist:"Six",venue:"Stable South",date:"2026-12-06",providerVenueId:"stable-south" });

    const result = createPublicCollectionRepository(db)
      .readCityVenues({ countryCode:"CA",citySlug:"toronto",at:NOW,today:TODAY });
    assert.equal(result.itemCount,3);
    assert.equal(result.venueCount,2);
    assert.equal(result.venues.some((row) => row.venue_identity === "name:shared room"),false);
    assert.equal(result.venues.some((row) => row.venue_identity === "name:loose room"),false);
    assert.deepEqual(
      new Set(result.venues.map((row) => row.venue_provider_id)),
      new Set(["shared-toronto","stable-south"]),
    );
  } finally { db.close(); }
});

test("city concert joins use canonical artist keys and reject ambiguous display-name fallback", () => {
  const db = createDatabase();
  try {
    addUser(db,"active");
    addArtist(db);
    addArtist(db,{ key:"twin-one",name:"Twin Name",slug:"twin-one" });
    addArtist(db,{ key:"twin-two",name:"twin name",slug:"twin-two" });

    addTour(db,{ id:"good-city-1",artist:"Alpha",artistKey:"alpha",venue:"North",date:"2026-08-01" });
    addPost(db,{ id:"good-city-post-1",artist:"Alpha",artistKey:"alpha",venue:"North",date:"2026-08-01" });
    addTour(db,{ id:"good-city-2",artist:"Alpha",artistKey:"alpha",venue:"South",date:"2026-08-02" });
    addPost(db,{ id:"good-city-post-2",artist:"Alpha",artistKey:"alpha",venue:"South",date:"2026-08-02" });
    addTour(db,{ id:"ambiguous-city",artist:"Twin Name",artistKey:null,venue:"Other",date:"2026-08-03" });
    addPost(db,{ id:"ambiguous-city-post",artist:"Twin Name",artistKey:null,venue:"Other",date:"2026-08-03" });

    const repo = createPublicCollectionRepository(db);
    assert.equal(repo.readCityConcerts({ countryCode:"CA",citySlug:"toronto",at:NOW,today:TODAY }),null);

    addTour(db,{ id:"good-city-3",artist:"Alpha",artistKey:"alpha",venue:"North",date:"2026-08-04" });
    addPost(db,{ id:"good-city-post-3",artist:"Alpha",artistKey:"alpha",venue:"North",date:"2026-08-04" });
    const result = repo.readCityConcerts({ countryCode:"CA",citySlug:"toronto",at:NOW,today:TODAY });
    assert.equal(result.itemCount,3);
    assert.equal(result.concerts.some((row) => row.artist === "Twin Name"),false);
  } finally { db.close(); }
});
