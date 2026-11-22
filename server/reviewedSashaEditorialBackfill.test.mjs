import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { SASHA_EDITORIAL_OCCURRENCE as facts, previewReviewedSashaEditorialBackfill as preview,
  reviewedSashaAvailability as availability } from "./reviewedSashaEditorialBackfill.js";

const dir=mkdtempSync(join(tmpdir(),"pit-sasha-editorial-fixture-"));
process.env.PIT_DATA_DIR=dir;
const { db }=await import("./db.js");
const { routes }=await import("./api.js");
const { publicVenueSnapshotForPath, resolveEntity }=await import("./seo.js");
after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});

const at=Date.parse("2026-11-22T01:00:00Z"), checkedAt=at-3600000;
const read=()=>preview(db,{at,checkedAt});
const ctx=(params={},query={})=>({params,query,ip:"editorial-fixture",setHeader(){}});
const eventPath="/event/"+facts.id;

function inFixture(t) {
  const localId="Sasha-fixture-transaction";
  assert.ok(db.prepare("PRAGMA database_list").all().some(x=>x.name==="main" && x.file.includes("pit-sasha-editorial-fixture-")));
  db.exec(`SAVEPOINT "${localId}"`);
  t.after(()=>db.exec(`ROLLBACK TO "${localId}"; RELEASE "${localId}"`));
  db.prepare(`INSERT INTO tour_dates(id,artist,venue,date,venue_city,venue_region,venue_country_code,source,venue_provider_id,
    venue_address_line1,music_evidence,updated_at) VALUES ('toronto-opera-fixture','Fixture Other Artist',?,'2027-03-26',?,?,?,?,?,?,?,?)`)
    .run(facts.venue.name,facts.venue.city,facts.venue.region,facts.venue.countryCode,facts.venue.catalogueSource,
      facts.venue.catalogueId,facts.venue.address,"ticketmaster:classification:music",at);
}
function insertFixture(candidate) {
  assert.equal(candidate.status,"fixture_candidate");
  const a=facts.artist;
  db.prepare(`INSERT INTO artists(norm,name,public_slug,search_key,source,data,created_at,updated_at)
     VALUES(?,?,?,?,?,'{}',?,?)`).run(a.key,a.name,a.slug,a.searchKey,facts.source,at,at);
  const fields=Object.keys(candidate.eventRecord);
  db.prepare(`INSERT INTO tour_dates(${fields.join(",")}) VALUES(${fields.map(()=>"?").join(",")})`).run(...fields.map(x=>candidate.eventRecord[x]));
}

test("exact local fixture is idempotent and warns about the live venue/waitlist representation gap", t=>{
  inFixture(t);
  t.mock.timers.enable({apis:["Date"],now:Date.parse("2027-03-20T16:00:00Z")});
  assert.equal(read().status,"fixture_candidate");
  assert.equal(resolveEntity("/artist/sasha-keable"),null,"no fabricated fallback profile");
  const planned=read();
  insertFixture(planned);
  assert.equal(read().status,"already_prepared");
  assert.equal(read().status,"already_prepared");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM artists WHERE norm=?").get(facts.artist.key).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tour_dates WHERE id=?").get(facts.id).n,1);
  assert.equal(db.prepare("SELECT provider_event_id FROM tour_dates WHERE id=?").get(facts.id).provider_event_id,null);
  assert.equal(resolveEntity("/artist/sasha-keable").name,facts.artist.name);
  const event=resolveEntity(eventPath);
  assert.equal(event.artistKey,facts.artist.key);
  assert.equal(event.eventStatus,"scheduled");
  assert.equal(event.startDateTime,"2027-03-31T00:30:00Z");
  assert.equal(event.ticketUrl,null,"a checkout must not advertise an unavailable ticket");
  const calendar=routes["GET /api/tourdates"](ctx({}, {month:"2027-03",date:facts.date,city:"Toronto",country:"CA"}));
  assert.equal(calendar.tourDates.filter(row=>row.id===facts.id).length,1);
  const city=routes["GET /api/cities/:countryCode/:citySlug"](ctx({countryCode:"ca",citySlug:"toronto"}));
  assert.ok(city.upcoming.some(x=>JSON.stringify(x).includes(facts.id)),"city guide can project the correct structured location");
  const venue=publicVenueSnapshotForPath(facts.venue.canonicalPath);
  assert.equal(venue.path,facts.venue.canonicalPath);
  assert.ok(!venue.events.some(row=>row.id===facts.id),"deployed venue projection needs a separately sourced editorial venue binding");
  assert.equal(planned.availability.status,"sold_out");
  assert.equal(planned.availability.waitlistUrl,facts.availabilitySource);
  assert.equal(planned.availability.purchaseUrl,null);
  assert.equal(event.soldOut,false,"deployed renderer has no dated evidence contract; fixture must not create a permanent status flag");
});

test("a real existing provider row, ambiguous artist alias or drift blocks the plan without overwriting records", t=>{
  inFixture(t);
  const insert=db.prepare(`INSERT INTO tour_dates(id,artist,event_name,venue,venue_city,venue_country_code,date,
     source,provider_event_id,ticket_url,updated_at) VALUES (?,?,?,?,?,?,?,'ticketmaster',?,?,?)`);
  insert.run("tm_unverified-discovery-id",facts.artist.name,facts.eventName,facts.venue.name,facts.venue.city,facts.venue.countryCode,
    facts.date,"unverified-discovery-id",facts.sellerSource,at);
  assert.deepEqual(read().blockers,["existing_event_requires_dedupe_review"]);
  assert.equal(read().eventRecord,null);
  db.prepare("DELETE FROM tour_dates WHERE id='tm_unverified-discovery-id'").run();
  db.prepare("INSERT INTO artists(norm,name,public_slug,search_key,source,data,created_at,updated_at) VALUES('not-sasha','Other Artist','sasha-keable','otherartist','artist-created','{}',?,?)").run(at,at);
  assert.deepEqual(read().blockers,["existing_artist_requires_binding_review"]);
  assert.equal(read().eventRecord,null);
  db.prepare("DELETE FROM artists WHERE norm='not-sasha'").run();
  insertFixture(read());
  db.prepare("UPDATE tour_dates SET event_name='Not the same show' WHERE id=?").run(facts.id);
  assert.deepEqual(read().blockers,["editorial_identity_drift"]);
  assert.equal(db.prepare("SELECT event_name FROM tour_dates WHERE id=?").get(facts.id).event_name,"Not the same show");
});

test("unknown venue binding and stale or past availability fail closed, retaining no offers", t=>{
  inFixture(t);
  db.exec("UPDATE tour_dates SET venue_city='London' WHERE id='toronto-opera-fixture'");
  assert.deepEqual(read().blockers,["canonical_venue_requires_review"]);
  for(const options of [{at},{checkedAt:at+1,at},{checkedAt:at-86400000,at},
    {checkedAt:Date.parse(facts.startDateTime),at:Date.parse(facts.startDateTime)}]) {
    const result=availability(options);
    assert.deepEqual([result.status,result.waitlistUrl,result.purchaseUrl],["unknown",null,null]);
  }
});

test("fixture transaction rollback leaves artists, shows, saves and reviews untouched", t=>{
  inFixture(t);
  const tables=["artists","tour_dates","going","posts"];
  const snapshot=()=>tables.map(table=>db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
  const before=snapshot();
  db.exec("SAVEPOINT editorial_attempt");
  assert.throws(()=>{
    try { insertFixture(read()); throw new Error("injected failure after fixture writes"); }
    finally { db.exec("ROLLBACK TO editorial_attempt; RELEASE editorial_attempt"); }
  },/injected failure/);
  assert.deepEqual(snapshot(),before);
  assert.equal(read().status,"fixture_candidate");
});
