import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";

const require = createRequire(import.meta.url);
const compiled = transformSync(readFileSync(new URL("./ConcertMap.jsx", import.meta.url), "utf8"), {
  filename: "ConcertMap.jsx", configFile: false, babelrc: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const invalidPoints = [
  null, {}, { lat: null, lng: null }, { lat: "", lng: "" }, { lat: "  ", lng: "\t" },
  { lat: false, lng: false }, { lat: [], lng: [] }, { lat: {}, lng: {} },
  { lat: 43.6 }, { lat: "no", lng: -79 }, { lat: Infinity, lng: -79 },
  { lat: 91, lng: -79 }, { lat: 43, lng: -181 },
].map((point, index) => point && ({ name: `Invalid ${index}`, ...point }));
const venue = { id: "toronto", name: "Toronto room", lat: "43.65", lng: "-79.38", photoProvenance: { source: "fixture" }, rating: 4.5 };

function fixture({ provider = "google", hasMap = true } = {}) {
  const slots = [], calls = { projections: [], static: [] };
  let cursor = 0;
  const projection = (points) => {
    calls.projections.push(points);
    return { center: { lat: 43.65, lng: -79.38 }, zoom: 12, xPct: () => 0.5, yPct: () => 0.5 };
  };
  const seams = (name) => {
    if (name === "react") return {
      useMemo: (create) => create(),
      useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value; return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    };
    if (name === "react-native") return { View: "View", Text: "Text", Image: "Image", Pressable: "Pressable", Platform: { OS: "web" }, StyleSheet: { create: (value) => value, absoluteFill: { position: "absolute" } } };
    if (name === "./LiveMap" || name === "./CityMap") return { __esModule: true, default: name.slice(2) };
    if (name === "../mapConfig") return { HAS_MAP: hasMap, MAP_PROVIDER: provider, GOOGLE_KEY: "fixture-only", mapStaticUrl: (...args) => { calls.static.push(args); return "https://example.invalid/map"; } };
    if (name === "../lib/mapProject") return { linearProjector: projection, pixelProjector: projection, MAP_W: 320, MAP_H: 206 };
    if (name === "../theme") return { colors: new Proxy({}, { get: (_, key) => key }), mono: "mono", radius: { sm: 4, pill: 999 } };
    return require(name);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "window", compiled)(seams, module, module.exports, {});
  const flatten = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(flatten);
    return [node, ...flatten(typeof node.type === "function" ? node.type(node.props) : node.props?.children)];
  };
  const render = (props = {}) => { cursor = 0; const tree = module.exports.default(props); return { tree, nodes: flatten(tree) }; };
  return { calls, render };
}

test("ConcertMap removes missing, coercible and out-of-range coordinates before LiveMap", () => {
  const f = fixture(), view = f.render({ points: [...invalidPoints, venue], highlight: { lat: "", lng: " " } });
  assert.equal(view.tree.type, "LiveMap");
  assert.deepEqual(view.tree.props.points, [{ ...venue, lat: 43.65, lng: -79.38 }]);
  assert.equal(view.tree.props.highlight == null, true);
  assert.equal(f.calls.projections.length, 0);
  assert.equal(f.calls.static.length, 0);
});

test("ConcertMap retains legitimate zero coordinates and focal venue metadata", () => {
  const focal = { id: "meridian", name: "Prime meridian", lat: "51.48", lng: "0", rating: 4.2 };
  const view = fixture().render({ points: [{ name: "Equator", lat: 0, lng: -78 }], highlight: focal });
  assert.deepEqual(view.tree.props.points, [{ name: "Equator", lat: 0, lng: -78 }]);
  assert.deepEqual(view.tree.props.highlight, { ...focal, lat: 51.48, lng: 0 });
});

test("ConcertMap does not create any map or request when all coordinates are invalid", () => {
  for (const provider of ["google", "mapbox"]) {
    const f = fixture({ provider });
    assert.equal(f.render({ points: invalidPoints, highlight: { lat: null, lng: null } }).tree, null);
    assert.equal(f.calls.projections.length, 0);
    assert.equal(f.calls.static.length, 0);
  }
});

test("ConcertMap safely handles non-array point payloads", () => {
  for (const points of [null, {}, "bad payload"]) {
    const f = fixture();
    assert.equal(f.render({ points }).tree, null);
    assert.equal(f.render({ points, highlight: venue }).tree.type, "LiveMap");
  }
});

test("ConcertMap static fallback fits only validated coordinates and omits invalid focal pins", () => {
  const f = fixture({ provider: "mapbox" });
  const view = f.render({ points: [...invalidPoints, venue], highlight: { lat: 43, lng: null }, focalName: "Missing location" });
  assert.deepEqual(f.calls.projections, [[{ ...venue, lat: 43.65, lng: -79.38 }]]);
  assert.equal(f.calls.static.length, 1);
  assert.equal(f.calls.static[0][1], 11, "Mapbox's 512px tiles need zoom minus one to match the 256px overlay projector");
  assert.equal(view.nodes.find((node) => node.type === "Image").props.resizeMode, "stretch", "snapshot and percentage pins must share the same rendered bounds");
  assert.deepEqual(view.nodes.filter((node) => node.type === "Pressable").map((node) => node.props.accessibilityLabel), ["Open Toronto room"]);
});

test("ConcertMap drawn fallback receives the same normalized set as its pin projection", () => {
  const f = fixture({ provider: "none", hasMap: false });
  const view = f.render({ points: [...invalidPoints, venue], highlight: { lat: true, lng: false } });
  const drawn = view.nodes.find((node) => node.type === "CityMap");
  assert.deepEqual(drawn.props.points, [{ ...venue, lat: 43.65, lng: -79.38 }]);
  assert.equal(drawn.props.highlight == null, true);
  assert.deepEqual(f.calls.projections, [drawn.props.points]);
  assert.equal(f.calls.static.length, 0);
});

test("ConcertMap provider failure cannot bypass coordinate validation in fallback", () => {
  const f = fixture(), props = { points: [...invalidPoints, venue], highlight: { lat: "", lng: "" } };
  f.render(props).tree.props.onFail();
  const fallback = f.render(props);
  assert.notEqual(fallback.tree.type, "LiveMap");
  assert.deepEqual(f.calls.projections, [[{ ...venue, lat: 43.65, lng: -79.38 }]]);
});
