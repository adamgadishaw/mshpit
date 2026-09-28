import assert from "node:assert/strict";
import test from "node:test";
import { publicEntryFrame, publicFramePath } from "./publicFrameNavigation.mjs";
import { festivalPath, isReservedSlug, parsePath } from "./urls.mjs";
import { upcomingEventsForScope } from "./liveDiscovery.mjs";

test("festival pages have their own public URLs", () => {
  assert.equal(festivalPath("rolling-loud"), "/festival/rolling-loud");
  assert.equal(festivalPath("../admin"), null);
  assert.deepEqual(publicEntryFrame("/festival/rolling-loud"), { festival: { slug: "rolling-loud" } });
  assert.deepEqual(publicEntryFrame("/festivals"), { festivals: true });
  assert.equal(publicEntryFrame("/festival/Rolling Loud"), null);
  assert.equal(publicFramePath({ festival: { slug: "rolling-loud", editionId: "x" } }), "/festival/rolling-loud");
  assert.equal(publicFramePath({ festivals: true }), "/festivals");
  assert.equal(isReservedSlug("festival"), true, "a band called Festival cannot take over the route");
  assert.equal(parsePath("/festival/rolling-loud"), null, "not an artist, venue or profile path");
});

test("regular show lists leave festivals to the festivals section", () => {
  const events = [
    { id: "a", artist: "SZA", date: "2099-01-01", venue: "Arena" },
    { id: "b", artist: "Lollapalooza", eventName: "Lollapalooza 2099", eventKind: "festival", date: "2099-01-02", venue: "Grant Park" },
  ];
  assert.deepEqual(upcomingEventsForScope({ scope: "worldwide", worldwideEvents: events, now: Date.parse("2098-12-01") }).map((event) => event.id), ["a"]);
});
