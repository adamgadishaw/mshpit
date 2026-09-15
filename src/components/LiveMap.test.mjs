import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";

const require = createRequire(import.meta.url);
const compiled = transformSync(readFileSync(new URL("./LiveMap.jsx", import.meta.url), "utf8"), {
  filename: "LiveMap.jsx", configFile: false, babelrc: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const invalidPoints = [
  null, {}, { lat: null, lng: null }, { lat: "", lng: "" }, { lat: "  ", lng: "\t" },
  { lat: false, lng: false }, { lat: [], lng: [] }, { lat: {}, lng: {} },
  { lat: 43.6 }, { lat: "no", lng: -79 }, { lat: Infinity, lng: -79 },
  { lat: 91, lng: -79 }, { lat: 43, lng: -181 },
].map((point, index) => point && ({ name: `Invalid ${index}`, ...point }));

// Execute the actual component and its effects, with only React/RN and the Maps
// boundary replaced. No browser key, script download or provider request occurs.
function fixture(initial = {}) {
  const slots = [], props = { points: [], ...initial };
  const hostRefs = new Set();
  const calls = { maps: [], markers: [], bounds: [], center: [], zoom: [], fit: [], clicked: [] };
  let cursor = 0, pending = [];
  const windowMock = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  class MapFixture {
    constructor(host, options) { calls.maps.push({ host, options, map: this }); }
    addListener() { return { remove() {} }; }
    setCenter(point) { calls.center.push(point); }
    setZoom(value) { calls.zoom.push(value); }
    fitBounds(bounds, padding) { calls.fit.push({ points: bounds.points, padding }); }
  }
  class MarkerFixture {
    constructor(options) { this.options = options; this.map = options.map; this.listeners = {}; this.removed = false; calls.markers.push(this); }
    addListener(event, handler) { this.listeners[event] = handler; return { remove() {} }; }
    setMap(map) { this.map = map; if (map === null) this.removed = true; }
    getPosition() { return this.options.position; }
  }
  class BoundsFixture {
    constructor() { this.points = []; }
    extend(point) { this.points.push(point); calls.bounds.push(point); }
  }
  class OverlayFixture {
    setMap(map) { this.map = map; if (map) this.draw?.(); }
    getProjection() { return { fromLatLngToContainerPixel: () => ({ x: 100, y: 100 }) }; }
  }
  windowMock.google = { maps: {
    Map: MapFixture, Marker: MarkerFixture, LatLngBounds: BoundsFixture, OverlayView: OverlayFixture,
    Size: class {}, Point: class {}, event: { clearInstanceListeners() {} },
  } };
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value; return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useMemo(create, deps) { const index = cursor++, before = slots[index]; if (!before || !deps || deps.some((value, i) => !Object.is(value, before.deps?.[i]))) slots[index] = { value: create(), deps }; return slots[index].value; },
    useEffect(create, deps) {
      const index = cursor++, before = slots[index];
      if (!before || !deps || deps.some((value, i) => !Object.is(value, before.deps?.[i]))) {
        pending.push(() => { before?.cleanup?.(); slots[index] = { deps, cleanup: create() }; });
      }
    },
  };
  const seams = (name) => {
    if (name === "react") return react;
    if (name === "react-native") return { View: "View", Text: "Text", Image: "Image", Pressable: "Pressable", Platform: { OS: "web" }, Linking: {}, StyleSheet: { create: (value) => value, absoluteFill: { position: "absolute" } } };
    if (name === "../mapConfig") return { GOOGLE_KEY: "fixture-only" };
    if (name === "../theme") return { colors: new Proxy({}, { get: (_, key) => key }), mono: "mono", radius: { sm: 4, pill: 999 }, shadow: { sheet: {} } };
    if (name === "../lib/img") return { proxied: (url) => url, isHttp: () => false };
    if (name === "./Stars") return { __esModule: true, default: "Stars" };
    return require(name);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "window", compiled)(seams, module, module.exports, windowMock);
  const attach = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(attach);
    if (node.props?.ref) {
      hostRefs.add(node.props.ref);
      if (!node.props.ref.current) node.props.ref.current = { fixtureHost: true };
    }
    attach(node.props?.children);
  };
  const render = async (next = {}) => {
    Object.assign(props, next); cursor = 0; pending = [];
    const tree = module.exports.default(props);
    if (tree === null) { for (const ref of hostRefs) ref.current = null; hostRefs.clear(); }
    attach(tree);
    for (const effect of pending) effect();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    return tree;
  };
  const unmount = () => { for (const slot of slots) if (typeof slot?.cleanup === "function") slot.cleanup(); };
  return { calls, render, unmount };
}

test("LiveMap rejects missing/coercible coordinates before Google markers and fitBounds", async () => {
  const f = fixture({ points: [...invalidPoints, { name: "Toronto", lat: "43.65", lng: "-79.38" }, { name: "London", lat: 51.51, lng: -0.12 }], highlight: { lat: "", lng: " " } });
  await f.render();
  const expected = [{ lat: 43.65, lng: -79.38 }, { lat: 51.51, lng: -0.12 }];
  assert.deepEqual(f.calls.markers.map((marker) => marker.options.position), expected);
  assert.deepEqual(f.calls.bounds, expected);
  assert.deepEqual(f.calls.fit, [{ points: expected, padding: 44 }]);
  assert.deepEqual(f.calls.center, []);
});

test("LiveMap does not initialize Google for entirely invalid point and highlight sets", async () => {
  const f = fixture({ points: invalidPoints, highlight: { name: "Unknown", lat: null, lng: null } });
  await f.render();
  assert.equal(f.calls.maps.length, 0);
  assert.equal(f.calls.markers.length, 0);
  assert.equal(f.calls.bounds.length, 0);
  assert.equal(f.calls.center.length, 0);
  assert.equal(f.calls.fit.length, 0);
});

test("LiveMap preserves genuine numeric zero and normalized coordinate metadata on click", async () => {
  const clicked = [], point = { name: "Prime meridian", lat: "51.48", lng: "0", id: "venue-1", rating: 4.2, photoProvenance: { fixture: true } };
  const f = fixture({ points: [point], onPressPoint: (value) => clicked.push(value) });
  await f.render();
  assert.deepEqual(f.calls.center, [{ lat: 51.48, lng: 0 }]);
  assert.deepEqual(f.calls.zoom, [14]);
  f.calls.markers[0].listeners.click();
  assert.deepEqual(clicked, [{ ...point, lat: 51.48, lng: 0 }]);
  await f.render({ points: [{ name: "Equator", lat: 0, lng: -78 }] });
  assert.deepEqual(f.calls.center.at(-1), { lat: 0, lng: -78 });
  await f.render({ points: [{ name: "Recorded numeric origin", lat: 0, lng: 0 }] });
  assert.deepEqual(f.calls.center.at(-1), { lat: 0, lng: 0 });
});

test("LiveMap validates focal highlights without losing focal styling or metadata", async () => {
  const clicked = [], highlight = { id: "focal", name: "Original", lat: "43.65", lng: "-79.38", rating: 4.9 };
  const f = fixture({ points: invalidPoints, highlight, focalName: "Toronto focal", onPressPoint: (value) => clicked.push(value) });
  await f.render();
  assert.equal(f.calls.markers.length, 1);
  assert.equal(f.calls.markers[0].options.zIndex, 3);
  f.calls.markers[0].listeners.click();
  assert.deepEqual(clicked, [{ ...highlight, name: "Toronto focal", lat: 43.65, lng: -79.38, focal: true }]);
});

test("LiveMap removes existing markers when a new selection has no valid coordinates", async () => {
  const f = fixture({ points: [{ name: "Toronto", lat: 43.65, lng: -79.38 }] });
  await f.render();
  const original = f.calls.markers[0];
  assert.equal(original.removed, false);
  await f.render({ points: [{ name: "Location unknown", lat: "", lng: " " }], highlight: null });
  assert.equal(original.removed, true, "stale pins must not remain after switching to an unknown venue");
  assert.equal(f.calls.markers.length, 1, "unknown coordinates must not create an origin replacement pin");
  assert.deepEqual(f.calls.center, [{ lat: 43.65, lng: -79.38 }]);
  assert.equal(f.calls.fit.length, 0);
});

test("LiveMap also clears an existing map when the points array becomes empty", async () => {
  const f = fixture({ points: [{ name: "Toronto", lat: 43.65, lng: -79.38 }] });
  await f.render();
  await f.render({ points: [] });
  assert.equal(f.calls.markers[0].removed, true);
});

test("LiveMap detaches markers when the map component unmounts", async () => {
  const f = fixture({ points: [{ name: "Toronto", lat: 43.65, lng: -79.38 }] });
  await f.render();
  f.unmount();
  assert.equal(f.calls.markers[0].removed, true);
});

test("LiveMap recovers from empty or invalid selections with only the new locations", async () => {
  const london = { name: "London", lat: 51.51, lng: -0.12 };
  const berlin = { name: "Berlin", lat: 52.52, lng: 13.4 };
  for (const missing of [[], [{ name: "Unknown", lat: "", lng: " " }]]) {
    const f = fixture({ points: [{ name: "Toronto", lat: 43.65, lng: -79.38 }] });
    await f.render();
    const originalMap = f.calls.maps[0], originalMarker = f.calls.markers[0];
    assert.equal(await f.render({ points: missing }), null);
    assert.equal(originalMarker.removed, true);
    await f.render({ points: [london, berlin] });
    assert.equal(f.calls.maps.length, 2);
    assert.notEqual(f.calls.maps[1].map, originalMap.map);
    assert.notEqual(f.calls.maps[1].host, originalMap.host, "the map must attach to the newly mounted host");
    assert.equal(f.calls.markers.length, 3);
    const current = f.calls.markers.filter((marker) => !marker.removed);
    assert.deepEqual(current.map((marker) => marker.options.position), [{ lat: london.lat, lng: london.lng }, { lat: berlin.lat, lng: berlin.lng }]);
    assert.ok(current.every((marker) => marker.map === f.calls.maps[1].map));
    assert.deepEqual(f.calls.fit.at(-1), { points: [{ lat: london.lat, lng: london.lng }, { lat: berlin.lat, lng: berlin.lng }], padding: 44 });
    assert.deepEqual(f.calls.center, [{ lat: 43.65, lng: -79.38 }], "recovery must not center on coerced origin coordinates");
  }
});

test("LiveMap can initialize after its first selection has no coordinates", async () => {
  const f = fixture({ points: invalidPoints });
  assert.equal(await f.render(), null);
  assert.equal(f.calls.maps.length, 0);
  await f.render({ points: [{ name: "London", lat: "51.51", lng: "-0.12" }] });
  assert.equal(f.calls.maps.length, 1);
  assert.equal(f.calls.markers.length, 1);
  assert.deepEqual(f.calls.center, [{ lat: 51.51, lng: -0.12 }]);
});

test("LiveMap cancels initialization when it unmounts before Maps resolves", async () => {
  const f = fixture({ points: [{ name: "Toronto", lat: 43.65, lng: -79.38 }] });
  const rendering = f.render();
  f.unmount();
  await rendering;
  assert.equal(f.calls.maps.length, 0);
  assert.equal(f.calls.markers.length, 0);
});

test("LiveMap treats non-array points as empty and keeps a valid focal coordinate", async () => {
  for (const points of [null, {}, "bad payload"]) {
    const f = fixture({ points, highlight: { lat: 43.65, lng: -79.38 } });
    await f.render();
    assert.deepEqual(f.calls.markers.map((marker) => marker.options.position), [{ lat: 43.65, lng: -79.38 }]);
  }
});
