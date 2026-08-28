import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DISCOVER_REGION,
  DISCOVER_AREA_SCOPE,
  defaultDiscoverAreaChoice,
  discoverAreaIsLocal,
  resolveDiscoverAreaChoice,
  selectDiscoverCountryArea,
  selectDiscoverScopeArea,
  syncDiscoverAreaChoice,
} from "./discoverArea.mjs";
import { discoverRowMatchesRegion, projectDiscoverScene } from "./discoverScene.mjs";
import { LIVE_EVENT_SCOPE, upcomingEventsForScope } from "./liveDiscovery.mjs";

const NOW = Date.UTC(2026, 7, 28, 12);

test("saved locations default to Nearby while location-free accounts default to country or Worldwide", () => {
  assert.deepEqual(defaultDiscoverAreaChoice({
    accountId: "fan-1",
    homeCity: "Toronto",
    homeCountry: "Canada",
  }), {
    accountId: "fan-1",
    region: "Canada",
    scope: DISCOVER_AREA_SCOPE.LOCAL,
    touched: false,
  });

  assert.deepEqual(defaultDiscoverAreaChoice({
    accountId: "fan-2",
    homeCountry: "Ireland",
  }), {
    accountId: "fan-2",
    region: "Ireland",
    scope: DISCOVER_AREA_SCOPE.COUNTRY,
    touched: false,
  });

  assert.deepEqual(defaultDiscoverAreaChoice(), {
    accountId: null,
    region: DEFAULT_DISCOVER_REGION,
    scope: DISCOVER_AREA_SCOPE.COUNTRY,
    touched: false,
  });
});

test("late home-location hydration updates only an untouched selection", () => {
  const initial = defaultDiscoverAreaChoice({ accountId: "fan" });
  const hydrated = syncDiscoverAreaChoice(initial, {
    accountId: "fan",
    homeCity: "Toronto",
    homeCountry: "Canada",
  });
  assert.deepEqual(hydrated, {
    accountId: "fan",
    region: "Canada",
    scope: DISCOVER_AREA_SCOPE.LOCAL,
    touched: false,
  });

  const selected = selectDiscoverCountryArea(initial, "United Kingdom");
  assert.strictEqual(syncDiscoverAreaChoice(selected, {
    accountId: "fan",
    homeCity: "Toronto",
    homeCountry: "Canada",
  }), selected, "hydration must preserve an intentional nation selection");
});

test("switching accounts always resets area defaults", () => {
  const selected = selectDiscoverCountryArea(defaultDiscoverAreaChoice({
    accountId: "first",
    homeCity: "Toronto",
    homeCountry: "Canada",
  }), "United States");

  assert.deepEqual(resolveDiscoverAreaChoice(selected, {
    accountId: "second",
    homeCity: "Dublin",
    homeCountry: "Ireland",
  }), {
    accountId: "second",
    region: "Ireland",
    scope: DISCOVER_AREA_SCOPE.LOCAL,
    touched: false,
  });
});

test("selecting a nation atomically selects country mode for live events", () => {
  const local = defaultDiscoverAreaChoice({
    accountId: "fan",
    homeCity: "Toronto",
    homeCountry: "Canada",
  });
  const unitedStates = selectDiscoverCountryArea(local, "United States");

  assert.deepEqual(unitedStates, {
    accountId: "fan",
    region: "United States",
    scope: DISCOVER_AREA_SCOPE.COUNTRY,
    touched: true,
  });
  assert.equal(discoverAreaIsLocal(unitedStates), false);

  assert.deepEqual(selectDiscoverCountryArea(unitedStates, ""), {
    accountId: "fan",
    region: DEFAULT_DISCOVER_REGION,
    scope: DISCOVER_AREA_SCOPE.COUNTRY,
    touched: true,
  });
});

test("Nearby resets the region home while the country toggle retains it", () => {
  const ireland = selectDiscoverCountryArea(defaultDiscoverAreaChoice({ accountId: "fan" }), "Ireland");
  const nearby = selectDiscoverScopeArea(ireland, DISCOVER_AREA_SCOPE.LOCAL, { homeCountry: "Canada" });
  assert.deepEqual(nearby, {
    accountId: "fan",
    region: "Canada",
    scope: DISCOVER_AREA_SCOPE.LOCAL,
    touched: true,
  });
  assert.equal(discoverAreaIsLocal(nearby), true);

  const country = selectDiscoverScopeArea(nearby, DISCOVER_AREA_SCOPE.COUNTRY);
  assert.deepEqual(country, {
    accountId: "fan",
    region: "Canada",
    scope: DISCOVER_AREA_SCOPE.COUNTRY,
    touched: true,
  });
  assert.equal(discoverAreaIsLocal(country), false);
});

test("area transitions are pure, sanitize inputs, and remain referentially stable on no-ops", () => {
  const source = Object.freeze({
    accountId: " fan ",
    region: " Canada ",
    scope: "unexpected",
    touched: false,
  });
  assert.deepEqual(selectDiscoverScopeArea(source, DISCOVER_AREA_SCOPE.COUNTRY), {
    accountId: "fan",
    region: "Canada",
    scope: DISCOVER_AREA_SCOPE.COUNTRY,
    touched: true,
  });
  assert.deepEqual(source, {
    accountId: " fan ",
    region: " Canada ",
    scope: "unexpected",
    touched: false,
  });

  const stable = selectDiscoverCountryArea(defaultDiscoverAreaChoice({ accountId: "fan" }), "Worldwide");
  assert.strictEqual(selectDiscoverCountryArea(stable, "Worldwide"), stable);
  assert.strictEqual(selectDiscoverScopeArea(stable, DISCOVER_AREA_SCOPE.COUNTRY), stable);
  assert.strictEqual(syncDiscoverAreaChoice(stable, {
    accountId: "fan",
    homeCity: "Toronto",
    homeCountry: "Canada",
  }), stable);
});

test("a nation selection changes the rendered live-event IDs without falling back to Nearby", () => {
  const events = [
    { id: "ca-1", artist: "Canada One", place: "Toronto, Ontario, Canada", date: "2026-09-01" },
    { id: "ca-2", artist: "Canada Two", venueCountryCode: "CA", date: "2026-09-02" },
    { id: "us-1", artist: "US One", place: "Chicago, Illinois, United States", date: "2026-09-01" },
    { id: "us-2", artist: "US Two", venueCountryCode: "US", date: "2026-09-03" },
  ];
  const localEvents = [{ ...events[0], local: true }];
  const initial = defaultDiscoverAreaChoice({
    accountId: "fan",
    homeCity: "Toronto",
    homeCountry: "Canada",
  });
  const renderEvents = (area) => {
    const projection = projectDiscoverScene(events, { region: area.region, now: NOW });
    return upcomingEventsForScope({
      scope: discoverAreaIsLocal(area) ? LIVE_EVENT_SCOPE.LOCAL : LIVE_EVENT_SCOPE.WORLDWIDE,
      localEvents,
      worldwideEvents: projection.events,
      limit: 4,
    });
  };

  assert.deepEqual(renderEvents(initial).map((event) => event.id), ["ca-1"]);
  const unitedStates = selectDiscoverCountryArea(initial, "United States");
  const usRows = renderEvents(unitedStates);
  assert.deepEqual(usRows.map((event) => event.id), ["us-1", "us-2"]);
  assert.ok(usRows.every((event) => discoverRowMatchesRegion(event, "United States")));

  const aliasRows = renderEvents(selectDiscoverCountryArea(initial, "USA"));
  assert.deepEqual(aliasRows.map((event) => event.id), ["us-1", "us-2"]);
  assert.deepEqual(renderEvents(selectDiscoverCountryArea(initial, "France")), [],
    "an empty nation must not silently reuse local or worldwide events");
});
