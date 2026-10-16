import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import { parse } from "@babel/parser";
import { createUnifiedVenueSearchIndex, searchUnifiedVenueIndex } from "../domain/unifiedLocationSearch.mjs";
import * as nearby from "../domain/nearbyShowFinder.mjs";
import * as entry from "../domain/nearbyEntry.mjs";
import * as coordinates from "../domain/mapCoordinates.mjs";
import * as refresh from "../domain/scopedRefresh.mjs";
import { GEO } from "../domain/geo.mjs";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./NearbyScreen.jsx", import.meta.url), "utf8");
const compiled = transformSync(source, {
  filename: "NearbyScreen.jsx", configFile: false, babelrc: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
    require("@babel/plugin-transform-modules-commonjs")],
}).code;
const storeSource = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const storeAst = parse(storeSource, { sourceType: "module", plugins: ["jsx"] });
function storeVenueQuery(venueSearchIndex) {
  let implementation;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id?.name === "searchVenues") implementation = node.init;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value?.type) visit(value);
    }
  }
  visit(storeAst);
  assert.ok(implementation, "Expected the real store venue query");
  return new Function("venueSearchIndex", "searchUnifiedVenueIndex",
    `return (${storeSource.slice(implementation.start, implementation.end)});`)(venueSearchIndex, searchUnifiedVenueIndex);
}
const nodes = node => !node || typeof node !== "object" ? []
  : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];

function renderNearby(center, store, props = {}) {
  const noop = () => {};
  const dependencies = {
    react: { useState: value => [typeof value === "function" ? value() : value, noop],
      useMemo: fn => fn(), useEffect: noop, useRef: value => ({ current: value }) },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": { ActivityIndicator: "ActivityIndicator", FlatList: "FlatList", Pressable: "Pressable",
      Text: "Text", View: "View", StyleSheet: { create: value => value } },
    "../theme": { colors: {}, radius: {}, displayFont: "font", focusRing: {} },
    "../store": { useStore: () => ({ session: null, tourDates: [], ...store }) },
    "../geo": { GEO }, "../data": { cityCoords: {} },
    "../components/LocationPicker": "LocationPicker", "../components/DatePicker": "DatePicker",
    "../components/ScreenHeader": "ScreenHeader", "../components/VinylRefreshBoundary": "VinylRefreshBoundary",
    "../components/NearbyFinderRows": { NearbyShowRow: "NearbyShowRow", NearbyVenueRow: "NearbyVenueRow" },
    "../domain/scopedRefresh.mjs": refresh, "../domain/mapCoordinates.mjs": coordinates,
    "../domain/nearbyEntry.mjs": entry, "../domain/nearbyShowFinder.mjs": nearby,
    "../hooks/useScopedRefresh": () => ({ refresh: noop, refreshing: false }),
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports);
  const tree = module.exports.default({ initialTab: "venues", initialSelection: { center }, ...props });
  return nodes(tree).find(node => node.type === "FlatList");
}

test("Nearby renders the qualified city venue beyond 50 competing city-name matches through the real store query", () => {
  const selected = { city: "London", state: "Ontario", country: "Canada" };
  const center = nearby.nearbyManualCenter(selected, GEO, { London: { lat: 42.98, lng: -81.24 } });
  assert.equal(center.lat, null, "Ambiguous city names use qualified city browsing");
  const venueSearchIndex = createUnifiedVenueSearchIndex({ catalogVenues: [
    ...Array.from({ length: 50 }, (_, i) => ({ name: `A UK Room ${i}`, place: "London, England, United Kingdom" })),
    { name: "Z Canadian Room", place: "London, Ontario, Canada" },
  ] });
  const searchVenues = storeVenueQuery(venueSearchIndex);
  assert.equal(searchVenues("London", 500).length, 50, "Ordinary Search keeps its existing cap");
  const openVenue = () => {};
  const list = renderNearby(center, { searchVenues }, { onOpenVenue: openVenue });
  assert.deepEqual(list.props.data.map(row => row.name), ["Z Canadian Room"]);
  const row = list.props.renderItem({ item: list.props.data[0] });
  assert.equal(row.props.venue.name, "Z Canadian Room");
  assert.equal(row.props.onOpenVenue, openVenue);
});

test("Nearby keeps coordinate-based venue discovery when a selected city has a valid center", () => {
  const center = { city: "Toronto", lat: 43.65, lng: -79.38 };
  const expected = [{ name: "Nearest room" }];
  const list = renderNearby(center, {
    localVenues: (km, actualCenter) => { assert.equal(km, 75); assert.equal(actualCenter, center); return expected; },
    regionShows: () => [],
    searchVenues: () => { throw new Error("Mapped locations must use the distance query"); },
  });
  assert.equal(list.props.data, expected);
});
