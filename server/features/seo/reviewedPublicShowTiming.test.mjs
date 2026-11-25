import assert from "node:assert/strict";
import test from "node:test";
import { reviewedPublicShowTiming } from "./reviewedPublicShowTiming.js";

test("reviewed timing is exact and never guesses doors from generic access or new provider values", () => {
  const url = "https://www.ticketmaster.ca/default-toronto/event/100064C2F554E5D8?language=en-us";
  const row = { id:"tm_177Zv0G6G5g4C9b", source:"ticketmaster", date:"2026-11-26",
    venue:"The Danforth Music Hall", venue_city:"Toronto", venue_country_code:"CA", event_status:"onsale",
    event_timezone:"America/New_York", start_date_time:"2026-11-27T00:00:00.000Z", start_local_time:"2026-11-26T19:00:00" };
  assert.equal(reviewedPublicShowTiming(row,url).localTime,"20:00");
  for (const changed of [{owner_id:"member"}, {id:"tm_other"}, {provider_event_id:"other"}, {source:"manual"},
    {date:"2026-11-27"},{venue:"Other room"},{venue_city:"London"},{venue_country_code:"US"},
    {event_status:"cancelled"},{event_status:"rescheduled"},{event_timezone:"America/Vancouver"},
    {start_date_time:"2026-11-26T19:00:00"},{start_local_time:"20:30"},{start_date_time:null}]) {
    assert.equal(reviewedPublicShowTiming({...row,...changed},url),null,JSON.stringify(changed));
  }
  assert.equal(reviewedPublicShowTiming(row,"https://www.ticketmaster.ca/event/another"),null);
  assert.equal(reviewedPublicShowTiming(row,"https://ticketmaster.ca.example.com/event/100064C2F554E5D8"),null);
});
