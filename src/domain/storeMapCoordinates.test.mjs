import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { mapCoordinate } from "./mapCoordinates.mjs";

const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
function storeFunction(name, dependencies) {
  let body;
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id?.name === name && node.init?.type === "ArrowFunctionExpression") body = node.init;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value?.type) visit(value);
    }
  };
  visit(ast);
  assert.ok(body, `Expected the real store ${name} implementation`);
  const bindings = { mapCoordinate, ...dependencies };
  return new Function(...Object.keys(bindings), `return (${source.slice(body.start, body.end)});`)(...Object.values(bindings));
}
const venueResolver = (catalog, ratedShows = [], tourDates = []) => storeFunction("venueCoord", {
  canonicalVenueKey: value => String(value).toLowerCase(), norm: value => String(value).toLowerCase(),
  venueCatalogEntry: () => catalog, ratedShows, tourDates,
});

test("venue store skips incomplete catalog and review coordinates to use a valid matching show", () => {
  const resolve = venueResolver({ lat: 51.5, lng: null }, [
    { venue: "London Room", lat: null, lng: null },
    { venue: "London Room", lat: " ", lng: "" },
  ], [{ venue: "Other room", lat: 0, lng: 0 }, { venue: "London Room", lat: "51.5", lng: "-.12" }]);
  assert.deepEqual(resolve("London Room"), { lat: 51.5, lng: -.12 });
});

test("venue store returns absence rather than a partial or invented location", () => {
  const resolve = venueResolver({ lat: "", lng: "" }, [{ venue: "Room", lat: false, lng: 0 }], [{ venue: "Room", lat: 91, lng: 0 }]);
  assert.equal(resolve("Room"), null);
  assert.deepEqual(venueResolver({ lat: 0, lng: "0" })("Room"), { lat: 0, lng: 0 });
});

test("nearby venue and show queries reject invalid centers before distance calculations", () => {
  for (const name of ["localVenues", "regionShows"]) {
    const query = storeFunction(name, { home: null,
      allVenues: () => { throw new Error("Invalid center must not scan venues"); },
      tourDates: [{ lat: 0, lng: 0 }],
      isUpcomingEventDate: () => { throw new Error("Invalid center must not scan shows"); },
    });
    for (const center of [null, {}, { lat: 0 }, { lat: "", lng: "" }, { lat: false, lng: 0 }, { lat: 51, lng: 181 }]) {
      assert.deepEqual(query(75, center), []);
    }
  }
});

test("nearby queries normalize a real numeric-string center without dropping valid zero", () => {
  const coords = [];
  const query = storeFunction("localVenues", { home: null,
    allVenues: () => [{ name: "Equator room", coord: { lat: 0, lng: 0 } }],
    tourDates: [], haversineKm: (center) => { coords.push(center); return 0; },
  });
  assert.equal(query(75, { city: "Fixture", lat: "0", lng: "0" }).length, 1);
  assert.deepEqual(coords, [{ lat: 0, lng: 0 }]);
});
