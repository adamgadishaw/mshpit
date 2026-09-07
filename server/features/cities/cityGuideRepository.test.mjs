import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ensureCitySchema } from "./citySchema.js";
import { createCityGuideRepository } from "./cityGuideRepository.js";
import { cityGuideRoutes } from "./cityGuideRoutes.js";
import { validateCityEditorial, validateCityPhoto, validateCityCopy, cityLocalDay, cityIdentity } from "./cityValidation.js";

const AT=Date.parse("2026-09-08T02:00:00Z");
function fixture() {
  const db=new DatabaseSync(":memory:");db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,is_banned INTEGER DEFAULT 0,suspended_until INTEGER,profile_audience TEXT DEFAULT 'everyone');
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,public_slug TEXT,mbid TEXT,rank_score INTEGER DEFAULT 0);
    CREATE TABLE artist_memorials(artist_key TEXT,artist_mbid TEXT,status TEXT,death_date TEXT);
    CREATE TABLE tour_dates(id TEXT PRIMARY KEY,artist TEXT,artist_key TEXT,venue TEXT,date TEXT,source TEXT,
      venue_provider_id TEXT,provider_event_id TEXT,venue_city TEXT,venue_region TEXT,venue_country TEXT,venue_country_code TEXT,
      event_name TEXT,event_kind TEXT DEFAULT 'concert',music_qualified INTEGER DEFAULT 1,music_evidence TEXT,billed_artists TEXT DEFAULT '[]',
      event_end_date TEXT,release_at INTEGER DEFAULT 0,updated_at INTEGER DEFAULT 0,owner_id TEXT,provider_active INTEGER DEFAULT 1,
      start_local_time TEXT,event_timezone TEXT,event_image_url TEXT,event_image_attribution TEXT,event_image_width INTEGER,event_image_height INTEGER,
      ticket_url TEXT,event_source_url TEXT);
    CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT,artist TEXT,artist_key TEXT,venue TEXT,venue_key TEXT,date TEXT,created_at INTEGER,
      removed INTEGER DEFAULT 0,photos_public INTEGER DEFAULT 1,kind TEXT DEFAULT 'review',experience_type TEXT DEFAULT 'in_person');
    CREATE TABLE reports(target_id TEXT,status TEXT);
    CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE post_media(post_id TEXT,asset_id TEXT,position INTEGER);
    CREATE TABLE media_assets(id TEXT,owner_id TEXT,kind TEXT,source_key TEXT,render_variant_id TEXT,status TEXT,source_verified_at INTEGER,
      metadata_status TEXT,codec_status TEXT,render_state TEXT,alt_text TEXT);
    CREATE TABLE media_objects(owner_id TEXT,object_key TEXT,status TEXT,storage_scope TEXT);
    CREATE TABLE media_variants(id TEXT,asset_id TEXT,role TEXT,object_key TEXT,public_url TEXT,width INTEGER,height INTEGER,status TEXT,verification_origin TEXT);
    CREATE TABLE moderation_actions(id TEXT,actor_id TEXT,action TEXT,target_type TEXT,target_id TEXT,reason TEXT,prior_state TEXT,next_state TEXT,request_id TEXT,created_at INTEGER);
    INSERT INTO users(id) VALUES ('admin'),('fan'),('viewer');
    INSERT INTO artists(norm,name,public_slug) VALUES ('alpha','Alpha','alpha');
  `);
  ensureCitySchema(db,{venues:[{key:"hall",name:"Hall",city:"Toronto",citySlug:"toronto",country:"Canada",countryCode:"CA"}],seeds:[],banner:null,geo:{}});
  function event({id="one",city="Toronto",countryCode="CA",region="",date="2026-09-07",timezone="America/Toronto",name="Alpha",qualified=1,owner=null,release=0,active=1}={}) {
    db.prepare(`INSERT INTO tour_dates(id,artist,artist_key,venue,date,source,venue_city,venue_country,venue_country_code,event_name,event_timezone,music_qualified,owner_id,release_at,provider_active,venue_region)
      VALUES (?, 'Alpha','alpha','Hall',?,'ticketmaster',?,?,?, ?,?,?,?, ?,?,?)`).run(id,date,city,countryCode==="CA"?"Canada":"Portugal",countryCode,name,timezone,qualified,owner,release,active,region);
  }
  function photo({id="p1",owner="fan",audience="everyone",status="ready",consent=1}={}) {
    db.prepare("UPDATE users SET profile_audience=? WHERE id=?").run(audience,owner);
    db.prepare("INSERT INTO posts(id,user_id,artist,artist_key,venue,date,created_at,photos_public) VALUES (?,?,'Alpha','alpha','Hall','2026-09-07',?,?)").run(id,owner,AT,consent);
    db.prepare("INSERT INTO post_media VALUES (?,?,0)").run(id,`a-${id}`);
    db.prepare("INSERT INTO media_assets VALUES (?,?,'image',?,?,?,1,'declared','not_applicable','ready','Alpha live')")
      .run(`a-${id}`,owner,`private/${id}`,`v-${id}`,status);
    db.prepare("INSERT INTO media_objects VALUES (?,?,'associated','private')").run(owner,`private/${id}`);
    db.prepare("INSERT INTO media_objects VALUES (?,?,'associated','public')").run(owner,`public/${id}`);
    db.prepare("INSERT INTO media_variants VALUES (?,?,'render',?,?,800,600,'verified','private_derivative_v1')")
      .run(`v-${id}`,`a-${id}`,`public/${id}`,`https://media.mshpit.com/${id}.jpg`);
  }
  return {db,event,photo,repository:()=>createCityGuideRepository(db)};
}

test("all trusted cities remain addressable without upcoming events, and cities are isolated by country",()=>{
  const f=fixture();f.event();f.event({id:"lisbon",city:"Lisbon",countryCode:"PT",date:"2026-09-09",timezone:"Europe/Lisbon"});
  f.event({id:"sport",city:"Fakeville",name:"Formula 1 admission"});
  f.event({id:"private",city:"Secret City",owner:"admin",release:AT+1000});
  const r=f.repository(),all=r.listCities({at:AT});
  assert.deepEqual(all.cities.map(v=>v.city).sort(),["Lisbon","Toronto"]);
  assert.equal(r.getGuide({countryCode:"PT",citySlug:"lisbon",at:AT}).upcoming.length,1);
  assert.equal(r.getGuide({countryCode:"US",citySlug:"toronto",at:AT}),null);
  assert.equal(r.getGuide({countryCode:"CA",citySlug:"toronto",at:AT+10*86400000}).venues.length,1);
  f.db.close();
});
test("today uses the concert city's local day rather than the visitor or UTC day",()=>{
  const f=fixture();f.event();const guide=f.repository().getGuide({countryCode:"CA",citySlug:"toronto",at:AT});
  assert.equal(cityLocalDay(AT,"America/Toronto"),"2026-09-07");
  assert.equal(guide.today.length,1);assert.equal(guide.today[0].timeZone,"America/Toronto");
  f.db.close();
});
test("same-country city names require a known region and never mix shows or galleries",()=>{
  const f=fixture();
  f.event({id:"maine",city:"Portland",countryCode:"US",region:"ME"});
  f.event({id:"oregon",city:"Portland",countryCode:"US",region:"Oregon"});
  f.event({id:"unknown",city:"Portland",countryCode:"US"});f.photo();
  const r=f.repository(),read=(citySlug)=>r.getGuide({countryCode:"US",citySlug,at:AT});
  assert.equal(read("portland"),null);
  assert.deepEqual(read("portland-maine").today.map(show=>show.id),["maine"]);
  assert.deepEqual(read("portland-oregon").today.map(show=>show.id),["oregon"]);
  assert.equal(read("portland-maine").photos.length,0);
  assert.equal(read("portland-oregon").photos.length,0);
  assert.equal(r.listSitemapCities({at:AT}).some(city=>city.path==="/city/us/portland"),false);
  assert.equal(cityIdentity("US","Columbia","MO").citySlug,"columbia-missouri");
  assert.equal(cityIdentity("US","Columbia","SC").citySlug,"columbia-south-carolina");
  assert.equal(cityIdentity("US","Columbia"),null);f.db.close();
});
test("native-script provider city labels resolve to their canonical guide",()=>{
  const f=fixture();f.event({id:"tokyo",city:"東京",countryCode:"JP",date:"2026-09-08",timezone:"Asia/Tokyo"});
  const guide=f.repository().getGuide({countryCode:"JP",citySlug:"tokyo",at:AT});
  assert.equal(guide.city.city,"Tokyo");assert.equal(guide.today[0].id,"tokyo");
  assert.match(cityIdentity("JP","高崎").citySlug,/^u-/);f.db.close();
});
test("city queries use the backup-safe country and raw-city alias index",()=>{
  const f=fixture();
  const plan=f.db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM tour_dates WHERE trim(COALESCE(venue_city,''))<>''
    AND upper(trim(venue_country_code))=? AND lower(trim(venue_city)) IN (SELECT value FROM json_each(?))`).all("CA",'["toronto"]');
  assert.match(plan.map(row=>row.detail).join(" "),/idx_city_tour_location/);
  assert.doesNotMatch(f.db.prepare("SELECT sql FROM sqlite_master WHERE name='idx_city_tour_location'").get().sql,/pit_/);f.db.close();
});
test("city galleries require public consent, active public profiles, unreported verified images, and mutual block visibility",()=>{
  const f=fixture();f.event();f.photo();const r=f.repository(),read=()=>r.getGuide({countryCode:"CA",citySlug:"toronto",viewerId:"viewer",at:AT}).photos;
  assert.equal(read().length,1);assert.equal(read()[0].kind,"fan");assert.equal("ownerId" in read()[0],false);
  f.db.exec("INSERT INTO blocks VALUES ('fan','viewer')");assert.equal(read().length,0);f.db.exec("DELETE FROM blocks");
  f.db.exec("INSERT INTO reports VALUES ('a-p1','open')");assert.equal(read().length,0);f.db.exec("DELETE FROM reports");
  for (const [sql,reset] of [["UPDATE posts SET removed=1","UPDATE posts SET removed=0"],
    ["UPDATE posts SET photos_public=0","UPDATE posts SET photos_public=1"],
    ["UPDATE users SET profile_audience='only_me' WHERE id='fan'","UPDATE users SET profile_audience='everyone' WHERE id='fan'"],
    ["UPDATE users SET is_banned=1 WHERE id='fan'","UPDATE users SET is_banned=0 WHERE id='fan'"],
    ["UPDATE media_variants SET verification_origin=NULL","UPDATE media_variants SET verification_origin='private_derivative_v1'"],
    ["UPDATE media_objects SET storage_scope='private'","UPDATE media_objects SET storage_scope='public' WHERE object_key='public/p1'"]]) {
    f.db.exec(sql);assert.equal(read().length,0,sql);f.db.exec(reset);
  }
  assert.equal(read().length,1);f.db.close();
});
test("same named shows in different structured cities cannot lend images to either city",()=>{
  const f=fixture();f.event();f.event({id:"ambiguous",city:"Lisbon",countryCode:"PT"});f.photo();
  assert.equal(f.repository().getGuide({countryCode:"CA",citySlug:"toronto",at:AT}).photos.length,0);f.db.close();
});

test("reviews at an exact curated venue still contribute photos when the historic event row is unavailable",()=>{
  const f=fixture();f.photo();
  const r=f.repository();
  assert.equal(r.getGuide({countryCode:"CA",citySlug:"toronto",at:AT}).photos.length,1);
  f.db.exec("INSERT INTO city_catalog_venues(venue_key,name,city,city_slug,country_code,country) VALUES ('other-hall','Hall','Lisbon','lisbon','PT','Portugal')");
  assert.equal(r.getGuide({countryCode:"CA",citySlug:"toronto",at:AT}).photos.length,0);
  f.db.close();
});
test("moderation writes are persisted, audited, conflict checked, and never overwritten by startup seeds",()=>{
  const f=fixture(),r=f.repository(),editorial={title:"Toronto music",seoTitle:"Toronto concerts and venues",seoDescription:"Upcoming concerts and music history in Toronto.",history:"History with a source.",sources:[{title:"City history",url:"https://www.toronto.ca/music/"}]};
  assert.deepEqual(r.saveEditorial({countryCode:"CA",citySlug:"toronto",revision:0,editorial,actorId:"admin",at:AT}),{ok:true});
  assert.deepEqual(r.saveEditorial({countryCode:"CA",citySlug:"toronto",revision:0,editorial:{title:"stale"},actorId:"admin",at:AT}),{conflict:true});
  ensureCitySchema(f.db,{venues:[],seeds:[{city:"Toronto",countryCode:"CA",editorial:{title:"new default"}}],banner:null,geo:{}});
  assert.equal(r.getGuide({countryCode:"CA",citySlug:"toronto",at:AT}).editorial.title,"Toronto music");
  assert.equal(r.getGuide({countryCode:"CA",citySlug:"toronto",at:AT}).editorial.seoTitle,editorial.seoTitle);
  assert.equal(r.getGuide({countryCode:"CA",citySlug:"toronto",at:AT}).editorial.seoDescription,editorial.seoDescription);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM moderation_actions").get().n,1);
  assert.equal(r.readCopy().copy.welcomeTitle,"Welcome to {city}");
  assert.deepEqual(r.saveCopy({revision:0,copy:{welcomeTitle:"Hi, {city}"},actorId:"admin",at:AT}),{ok:true});
  assert.equal(r.readCopy().copy.welcomeTitle,"Hi, {city}");assert.equal(r.readCopy().revision,1);f.db.close();
});
test("editorial history needs sources and external photos need complete credit while unsafe URLs are rejected",()=>{
  assert.throws(()=>validateCityEditorial({history:"unverified claim"}),/source/);
  assert.throws(()=>validateCityPhoto({url:"https://photos.example.com/a.jpg",alt:"City"}),/credit/);
  for(const url of ["javascript:alert(1)","https://127.0.0.1/image.jpg","https://localhost/image.jpg","https://user:pass@site.com/image.jpg"]) {
    assert.throws(()=>validateCityPhoto({url,alt:"City",owned:true}));
  }
  assert.throws(()=>validateCityCopy({welcomeBannerUrl:"https://photos.example.com/a.jpg"}),/credit/);
  assert.throws(()=>validateCityEditorial({timeZone:"Mars/Olympus"}),/time zone/);
});
test("public routes cannot write copy and admin routes enforce authentication before validation",()=>{
  const f=fixture();class ApiError extends Error{constructor(status,message,code){super(message);this.status=status;this.code=code;}}
  const routes=cityGuideRoutes({database:f.db,ApiError,rateLimit(){},now:()=>AT,requireAdmin(ctx){if(ctx.user?.id!=="admin")throw new ApiError(403,"Admin required","FORBIDDEN");return ctx.user;}});
  assert.throws(()=>routes["PUT /api/admin/city-copy"]({body:{}}),e=>e.status===403);
  assert.equal(routes["PUT /api/city-copy"],undefined);
  assert.throws(()=>routes["GET /api/cities/:countryCode/:citySlug"]({params:{countryCode:"CA",citySlug:"../private"}}),e=>e.status===400);
  const saved=routes["PUT /api/admin/city-copy"]({user:{id:"admin"},body:{revision:0,copy:{welcomeTitle:"Hello {city}"}}});
  assert.equal(saved.revision,1);
  assert.throws(()=>routes["PUT /api/admin/city-copy"]({user:{id:"admin"},body:{revision:0,copy:{welcomeTitle:"Overwrite"}}}),e=>e.status===409);
  f.db.close();
});
