import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerPitSqliteFunctions } from "./sqliteFunctions.js";
import { runReviewedSashaEditorialCommand } from "../scripts/backfill-reviewed-sasha-editorial.mjs";
import { SASHA_EDITORIAL_OCCURRENCE as facts, previewReviewedSashaEditorialBackfill as preview,
  reviewedSashaAvailability as availability, applyReviewedSashaEditorialBackfill as apply } from "./reviewedSashaEditorialBackfill.js";

const dir=mkdtempSync(join(tmpdir(),"pit-sasha-editorial-fixture-"));
process.env.PIT_DATA_DIR=dir;
const { db }=await import("./db.js");
const { routes }=await import("./api.js");
const { publicVenueSnapshotForPath, resolveEntity, publicDocumentForPath }=await import("./seo.js");
const { renderPublicDocumentMain }=await import("./features/seo/publicDocumentRenderer.js");
const { upsertProviderTourDateRows }=await import("./tourdates.js");
after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});

const at=Date.parse("2027-03-20T16:00:00Z"), checkedAt=at-3600000;
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
const applyFixture = () => apply(db,{at,checkedAt});

test("reviewed apply is idempotent and serves the existing venue, city, artist, and direct official waitlist without any buy offer", t=>{
  inFixture(t);
  t.mock.timers.enable({apis:["Date"],now:at});
  assert.equal(read().status,"fixture_candidate");
  assert.equal(resolveEntity("/artist/sasha-keable"),null,"no fabricated fallback profile");
  const planned=read();
  assert.equal(applyFixture().status,"inserted");
  assert.equal(applyFixture().status,"already_prepared");
  assert.equal(applyFixture().evidenceUpdated,false);
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
  assert.equal(venue.events.filter(row=>row.id===facts.id).length,1);
  assert.equal(venue.events.find(row=>row.id===facts.id).venuePath,facts.venue.canonicalPath);
  assert.equal(venue.events.find(row=>row.id===facts.id).soldOut,true);
  assert.equal(city.upcoming.find(row=>row.id===facts.id).venuePath,facts.venue.canonicalPath);
  assert.equal(city.upcoming.find(row=>row.id===facts.id).soldOut,true);
  assert.equal(planned.availability.status,"sold_out");
  assert.equal(planned.availability.waitlistUrl,facts.availabilitySource);
  assert.equal(planned.availability.purchaseUrl,null);
  assert.equal(event.soldOut,true);
  assert.equal(event.venueCanonicalPath,facts.venue.canonicalPath);
  assert.equal(event.ticketWaitlistUrl,facts.availabilitySource);
  assert.equal(event.ticketAvailabilityCheckedAt,checkedAt);
  assert.equal(calendar.tourDates.find(row=>row.id===facts.id).soldOut,true);
  const document=publicDocumentForPath(eventPath);
  assert.equal(document.event.status,"https://schema.org/EventScheduled");
  assert.equal(document.jsonLd.find(item=>item["@type"]==="MusicEvent").offers,undefined);
  const html=renderPublicDocumentMain(document);
  assert.match(html,/Join official waitlist/);
  assert.ok(html.includes(facts.availabilitySource));
  assert.doesNotMatch(html,/View tickets|InStock|Cancelled/);
  t.mock.timers.setTime(at+86400000);
  assert.equal(resolveEntity(eventPath).ticketWaitlistUrl,null);
  assert.equal(resolveEntity(eventPath).soldOut,false);
  assert.doesNotMatch(renderPublicDocumentMain(publicDocumentForPath(eventPath)),/Join official waitlist|View tickets|InStock/);
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
  assert.equal(applyFixture().status,"inserted");
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
  db.exec(`CREATE TEMP TRIGGER sasha_fixture_failure BEFORE INSERT ON tour_dates
    WHEN NEW.id='editorial_sasha-keable_toronto_2027-03-30'
    BEGIN SELECT RAISE(ABORT,'injected event failure'); END`);
  assert.throws(()=>applyFixture(),/injected event failure/);
  db.exec("DROP TRIGGER sasha_fixture_failure");
  assert.deepEqual(snapshot(),before);
  assert.equal(read().status,"fixture_candidate");
});


test("later exact provider arrival defers only the same admission, keeps editorial stable, and suppresses stale waitlist on lifecycle disagreement", t=>{
  inFixture(t);
  t.mock.timers.enable({apis:["Date"],now:at});
  assert.equal(applyFixture().status,"inserted");
  const base={id:"tm_fixture-verified-provider-id",artist:facts.artist.name,venue:facts.venue.name,date:facts.date,
    source:"ticketmaster",ticket_url:facts.sellerSource,provider_event_id:"fixture-verified-provider-id",
    venue_provider_id:facts.venue.catalogueId,venue_city:facts.venue.city,venue_country_code:facts.venue.countryCode,
    start_local_time:facts.startLocalTime,start_date_time:facts.startDateTime,
    provider_active:1,music_qualified:1,music_evidence:"ticketmaster:classification:music",event_kind:"concert",
    event_name:facts.eventName,billed_artists:[facts.artist.name]};
  assert.equal(upsertProviderTourDateRows(db,[{...base,event_status:"onsale"}],{seenAt:at}),0);
  assert.equal(resolveEntity(eventPath).ticketWaitlistUrl,facts.availabilitySource);
  assert.equal(db.prepare("SELECT 1 FROM tour_dates WHERE id=?").get(base.id),undefined);
  assert.equal(upsertProviderTourDateRows(db,[{...base,event_status:"cancelled"}],{seenAt:at+1}),0);
  assert.equal(resolveEntity(eventPath).ticketWaitlistUrl,null,"provider conflict must not advertise a stale waitlist");
  assert.ok(read().blockers.includes("provider_lifecycle_requires_review"));
  const other={...base,id:"tm_other-fixture",provider_event_id:"other-fixture",date:"2027-03-31",
       venue_provider_id:"different-room",ticket_url:"https://www.ticketmaster.ca/event/0000000000000000"};
  assert.equal(upsertProviderTourDateRows(db,[other],{seenAt:at+1}),1);
  assert.ok(db.prepare("SELECT 1 FROM tour_dates WHERE id=?").get(other.id));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tour_dates WHERE id=?").get(facts.id).n,1);
});


test("exact seller with an unconfirmed clock flags review without suppressing a distinct provider row", t=>{
  inFixture(t);
  t.mock.timers.enable({apis:["Date"],now:at});
  assert.equal(applyFixture().status,"inserted");
  const mismatch={id:"tm_fixture-distinct-clock",artist:facts.artist.name,venue:facts.venue.name,date:facts.date,
    source:"ticketmaster",ticket_url:facts.sellerSource,provider_event_id:"fixture-distinct-clock",
    venue_provider_id:facts.venue.catalogueId,venue_city:facts.venue.city,venue_country_code:facts.venue.countryCode,
    provider_active:1,music_qualified:1,music_evidence:"ticketmaster:classification:music",event_kind:"concert",
    start_local_time:`${facts.date}T17:00:00`,event_name:facts.eventName,billed_artists:[facts.artist.name]};
  assert.equal(upsertProviderTourDateRows(db,[mismatch],{seenAt:at+1}),1);
  assert.ok(db.prepare("SELECT 1 FROM tour_dates WHERE id=?").get(mismatch.id));
  assert.equal(resolveEntity(eventPath).ticketWaitlistUrl,null);
  assert.ok(read().blockers.includes("provider_lifecycle_requires_review"));
});


test("operator defaults to read-only and requires explicit exact apply on a disposable copied database", ()=>{
  const filename=join(dir,"operator-copy.sqlite");
  db.prepare("VACUUM INTO ?").run(filename);
  const copy=registerPitSqliteFunctions(new DatabaseSync(filename));
  try {
    copy.prepare(`INSERT INTO tour_dates(id,artist,venue,date,venue_city,venue_region,venue_country_code,source,venue_provider_id,
      venue_address_line1,music_evidence,updated_at) VALUES ('operator-venue-fixture','Fixture Other Artist',?,'2027-03-26',?,?,?,?,?,?,?,?)`)
      .run(facts.venue.name,facts.venue.city,facts.venue.region,facts.venue.countryCode,facts.venue.catalogueSource,
        facts.venue.catalogueId,facts.venue.address,"ticketmaster:classification:music",at);
    const base=["--database",filename,"--checked-at",new Date(checkedAt).toISOString()];
    const preview=runReviewedSashaEditorialCommand(base,{at});
    assert.equal(preview.status,"fixture_candidate");
    assert.equal(preview.mode,"read_only");
    assert.equal(copy.prepare("SELECT 1 FROM tour_dates WHERE id=?").get(facts.id),undefined);
    assert.throws(()=>runReviewedSashaEditorialCommand([...base,"--apply","not-this-show"],{at}),/exact --apply/);
    const result=runReviewedSashaEditorialCommand([...base,"--apply","sasha-keable-toronto-2027-03-30"],{at});
    assert.equal(result.status,"inserted");
    assert.equal(result.mode,"explicit_maintenance");
    assert.equal(copy.prepare("SELECT COUNT(*) n FROM tour_dates WHERE id=?").get(facts.id).n,1);
    assert.equal(runReviewedSashaEditorialCommand(base,{at}).status,"already_prepared");
    assert.equal(db.prepare("SELECT 1 FROM tour_dates WHERE id=?").get(facts.id),undefined,"source fixture was never written");
  } finally { copy.close(); }
});
