import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { iosVenueMapModel, iosVenueMapsURL } from "./iosVenueMap.mjs";

const venue = (id, coord = { lat: 43.64, lng: -79.4 }) => ({ id, name: `Venue ${id}`, coord });

test("iOS map uses only valid supplied coordinates, deduplicates IDs, and keeps list numbering", () => {
  const model = iosVenueMapModel([venue("a"), venue("a"), venue("blank", { lat: "", lng: 2 }), venue("null", { lat: null, lng: 2 }), venue("infinite", { lat: Infinity, lng: 2 }), venue("pole", { lat: 86, lng: 0 }), venue("bad-longitude", { lat: 0, lng: 181 }), venue("zero", { lat: 0, lng: 0 }), venue(9, { lat: "12.5", lng: "-72.5" }), null], 9);
  assert.deepEqual(model.points.map(point => point.id), ["a", "zero", "9"]);
  assert.deepEqual(model.points.map(point => point.number), [1, 8, 9]);
  assert.equal(model.active.sourceId, 9);
  assert.equal(model.mappedCount, 3);
  assert.equal(model.unmappedCount, 7);
  assert.equal(model.nativePoints.some(point => "sourceId" in point), false);
  assert.equal(iosVenueMapModel(undefined).points.length, 0);
});

test("bounded pins always include a selected venue and never mutate the supplied list", () => {
  const venues = Array.from({ length: 35 }, (_, index) => venue(String(index)));
  const copy = structuredClone(venues);
  const initial = iosVenueMapModel(venues, "0"), selected = iosVenueMapModel(venues, "34");
  assert.equal(initial.points.length, 24);
  assert.equal(selected.points.length, 24);
  assert.equal(selected.points.at(-1).id, "34");
  assert.equal(selected.points.at(-1).number, 35);
  assert.deepEqual(venues, copy);
  assert.equal(iosVenueMapModel(venues, "removed").active, null);
  assert.equal(iosVenueMapModel(venues, "1").key, initial.key, "selection within the current pins does not reset the camera");
  assert.notEqual(selected.key, initial.key);
  assert.notEqual(iosVenueMapModel([venue("0", { lat: 1, lng: 2 })]).key, iosVenueMapModel([venue("0")]).key);
});

test("external Maps link is generated only from the current valid point and encodes its label", () => {
  const point = iosVenueMapModel([{ ...venue("a"), name: "Room & Hall / #1" }], "a").active;
  const url = new URL(iosVenueMapsURL(point));
  assert.equal(url.origin, "https://maps.apple.com");
  assert.equal(url.searchParams.get("ll"), "43.64,-79.4");
  assert.equal(url.searchParams.get("q"), "Room & Hall / #1");
  assert.equal(iosVenueMapsURL(null), null);
  assert.equal(iosVenueMapsURL({ latitude: null, longitude: 1 }), null);
});

test("native module is iOS-only with the existing 16.4 floor and no permission or provider setup", () => {
  const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
  const config = JSON.parse(read("../../modules/mshpit-venue-map/expo-module.config.json"));
  assert.deepEqual(config, { platforms: ["ios"], apple: { modules: ["MshpitVenueMapModule"] } });
  const pod = read("../../modules/mshpit-venue-map/ios/MshpitVenueMap.podspec");
  assert.match(pod, /:ios => '16\.4'/);
  assert.deepEqual([...pod.matchAll(/s\.dependency '([^']+)'/g)].map(match => match[1]), ["ExpoModulesCore"]);
  const view = read("../../modules/mshpit-venue-map/ios/MshpitVenueMapView.swift");
  const module = read("../../modules/mshpit-venue-map/ios/MshpitVenueMapModule.swift");
  assert.match(view, /class MshpitVenueMapView: ExpoView, MKMapViewDelegate/);
  assert.match(view, /MKMapView\(\)/);
  assert.match(view, /mapView\.mapType = \.standard/);
  assert.match(view, /snapshot\.venues\.prefix\(24\)/);
  assert.match(view, /point\.latitude\.isFinite && point\.longitude\.isFinite/);
  assert.match(view, /mapView\.delegate = window == nil \? nil : self/);
  assert.match(view, /report\(fullyRendered \? "ready" : "partial"\)/);
  assert.match(module, /Prop\("snapshot"\)/);
  assert.match(module, /@Field var selectedId: String = ""/);
  assert.doesNotMatch(view + module + pod, /request.*Authorization|requestPermissions|CLLocationManager|showsUserLocation\s*=\s*true|setUserTrackingMode|apiKey|Google|Mapbox|\.subviews|attribution.*hidden/i);
  assert.equal(read("../components/discover/DiscoverVenueMap.jsx").includes('export { default } from "./DiscoverVenueMapLegacy"'), true);
  assert.doesNotMatch(read("../components/discover/DiscoverVenueMap.web.jsx"), /iosVenueMap|MshpitVenueMap/);
  assert.doesNotMatch(read("../../package.json"), /mshpit-venue-map|expo-maps|react-native-maps/);
});


test("long Unicode and malformed provider labels cannot crash Maps URL generation", () => {
  const name = "x".repeat(199) + "🎶";
  const model = iosVenueMapModel([{ ...venue("unicode"), name }], "unicode");
  assert.equal(model.active.name, name);
  assert.equal(new URL(iosVenueMapsURL(model.active)).searchParams.get("q"), name);
  const invalid = iosVenueMapModel([{ ...venue("bad"), name: "Room \ud800" }], "bad");
  assert.equal(invalid.active.name, "Room \ufffd");
  assert.doesNotThrow(() => iosVenueMapsURL({ ...invalid.active, name: "\udfff" }));
});
