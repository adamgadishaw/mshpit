import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clusterConcertMapPins, concertCoordinates, concertHistoryFrame, concertHistoryModel, concertHistorySummary, concertMapViewport, projectConcertPin } from "./concertHistoryModel.mjs";

const row = (id, patch = {}) => ({ id, postId: id, artist: "The National", venue: "Massey Hall", venueKey: "massey-hall", city: "Toronto", date: "2026-06-14", rating: 4.5, lat: 43.654, lng: -79.379, countryCode: "CA", country: "Canada", ...patch });

test("history deduplicates artist + canonical venue + date, then sorts by date and stable post ID", () => {
  const input = [row("b"), row("a", { artist: "  THE NATIONAL  ", venue: "Massey Hall renamed" }), row("c", { date: "2026-07-01" }), row("d", { venueKey: "another-hall" }), row("e", { artist: "Alvvays" })];
  const snapshot = structuredClone(input), model = concertHistoryModel(input);
  assert.deepEqual(model.concerts.map(({ id }) => id), ["c", "a", "d", "e"]);
  assert.equal(model.concertCount, 4);
  assert.equal(model.venueCount, 2);
  assert.equal(model.artistCount, 2);
  assert.equal(model.countryCount, 1);
  assert.deepEqual(concertHistoryModel([...input].reverse()).concerts, model.concerts);
  assert.deepEqual(input, snapshot, "the server rows remain immutable");
});

test("canonical venue name bindings never merge different cities", () => {
  const model = concertHistoryModel([row("a", { venue: "History", venueKey: "history", city: "Toronto" }), row("b", { venue: "History", venueKey: "history", city: "London", lat: null, lng: null })]);
  assert.equal(model.concertCount, 2);
  assert.equal(model.venueCount, 2);
  assert.equal(model.venues.filter((venue) => venue.coordinates).length, 1);
});

test("a review wins over private attendance for the same night even when attendance sorts first by ID", () => {
  const attendance = row("attendance:first", { postId: null, rating: null, lat: null, lng: null, photo: null, countryCode: "", country: "" });
  const review = row("review:last", { photo: "https://media.example.test/review.jpg" });
  for (const rows of [[attendance, review], [review, attendance]]) {
    const model = concertHistoryModel(rows);
    assert.equal(model.concertCount, 1);
    assert.equal(model.concerts[0].postId, review.postId);
    assert.equal(model.concerts[0].photo, review.photo);
    assert.equal(model.mappedConcertCount, 1);
    assert.equal(model.countryCount, 1);
  }
});

test("unknown and invalid coordinates remain listed without fabricated pins", () => {
  const unknowns = [null, undefined, "", "43.65", NaN, Infinity, 91, -91];
  for (const lat of unknowns) {
    const model = concertHistoryModel([row("a", { lat })]);
    assert.equal(model.concerts.length, 1);
    assert.equal(model.unmappedConcertCount, 1);
    assert.equal(model.venues[0].coordinates, null);
  }
  for (const lng of [null, "", "-79", NaN, Infinity, 181, -181]) assert.equal(concertCoordinates(row("a", { lng })), null);
  assert.deepEqual(concertCoordinates(row("zero", { lat: 0, lng: 0 })), { lat: 0, lng: 0, precision: "venue" });
  assert.equal(concertCoordinates(row("a", { locationPrecision: "country" })), null);
  assert.equal(concertCoordinates(row("a", { locationPrecision: "city" })).precision, "city");
});

test("unidentified venues and invalid dates do not collapse unrelated concerts", () => {
  const model = concertHistoryModel([row("a", { venue: "", venueKey: "", lat: null }), row("b", { venue: "", venueKey: "", lat: null }), row("c", { date: "invalid" }), row("d", { date: "invalid" })]);
  assert.equal(model.concertCount, 4);
  assert.equal(model.venueCount, 1);
  assert.equal(model.venues.length, 3);
});

test("one confirmed country uses its continent; two countries use the world even on the same continent", () => {
  const canada = concertHistoryModel([row("a"), row("b", { date: "2026-06-15" })]);
  assert.equal(concertHistoryFrame(canada).name, "North America");
  const usa = row("b", { venueKey: "us-hall", countryCode: "US", country: "United States", lat: 42, lng: -74 });
  assert.equal(concertHistoryFrame(concertHistoryModel([row("a"), usa])).name, "World");
  assert.equal(concertHistoryFrame(concertHistoryModel([row("jp", { countryCode: "JP", country: "Japan" })])).name, "Asia");
  assert.equal(concertHistoryFrame(concertHistoryModel([row("gb", { countryCode: "GB", country: "United Kingdom" })])).name, "Europe");
  assert.equal(concertHistoryFrame(concertHistoryModel([row("unknown", { countryCode: "", country: "" })])).name, "World");
  assert.equal(concertHistoryModel([row("a"), row("b", { date: "2026-06-15", countryCode: "", country: "Canada" })]).countryCount, 1);
});

test("continent and world pin projection agree with the real equirectangular map", () => {
  const model = concertHistoryModel([row("a")]), frame = concertHistoryFrame(model);
  const box = concertMapViewport(frame, 360, 240);
  const point = projectConcertPin({ lat: 43.654, lng: -79.379 }, box);
  assert.equal(point.visible, true);
  assert.ok(Math.abs(box.x + point.xPct * box.width - (180 - 79.379)) < 1e-8);
  assert.ok(Math.abs(box.y + point.yPct * box.height - (90 - 43.654)) < 1e-8);
  const zoomed = concertMapViewport(frame, 360, 240, 4, model.venues[0].coordinates);
  assert.equal(zoomed.width, box.width / 4);
  assert.equal(projectConcertPin(model.venues[0].coordinates, zoomed).xPct, 0.5);
  assert.equal(concertMapViewport(frame, 360, 240, 999).width, box.width / 8);
});

test("Pacific wrap retains Fiji and New Zealand inside an Oceania frame", () => {
  const frame = concertHistoryFrame(concertHistoryModel([row("fj", { countryCode: "FJ", country: "Fiji" })]));
  const box = concertMapViewport(frame, 360, 240);
  assert.equal(frame.name, "Oceania");
  assert.equal(projectConcertPin({ lat: -17.7, lng: 178.1 }, box).visible, true);
  assert.equal(projectConcertPin({ lat: -17.7, lng: -179.9 }, box).visible, true);
  assert.equal(projectConcertPin({ lat: -41.3, lng: 174.7 }, box).visible, true);
});

test("nearby map pins retain all venue identities behind one accessible choice", () => {
  const model = concertHistoryModel([row("a"), row("b", { venueKey: "next-door", venue: "Another room", lng: -79.378 })]);
  const box = concertMapViewport(concertHistoryFrame(model), 360, 240);
  const clusters = clusterConcertMapPins(model.venues, box, 360, 240);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].venues.map(({ key }) => key), model.venues.map(({ key }) => key));
  assert.equal(clusterConcertMapPins([{ key: "unknown", coordinates: null }], box, 360, 240).length, 0);
});

test("summary explicitly marks partial history and never invents a total", () => {
  const model = concertHistoryModel([row("a")]);
  assert.equal(concertHistorySummary(model, false), "1 concert · 1 venue · 1 country · partial history");
  assert.equal(concertHistorySummary(model, true), "1 concert · 1 venue · 1 country");
});

test("offline geography contains real licensed country boundaries and source provenance", () => {
  const asset = JSON.parse(readFileSync(new URL("./worldGeography.json", import.meta.url), "utf8"));
  assert.equal(asset.license, "Public domain");
  assert.match(asset.source, /nvkelso\/natural-earth-vector/);
  assert.match(asset.licenseUrl, /naturalearthdata.com\/about\/terms-of-use/);
  assert.match(asset.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(asset.countries.length, 177);
  assert.ok(asset.countries.find(({ code }) => code === "CA").d.length > 10000);
  assert.ok(asset.countries.every(({ d }) => /^M[\d.,LZM-]+$/.test(d)));
});
