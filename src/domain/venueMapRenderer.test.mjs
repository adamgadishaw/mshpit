import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { nextGroupVenue, venueFeatureCollection, viewportFeatureKey } from "../../public/mshpit-maplibre/cluster-model.mjs";

// Run the actual renderer function, without evaluating its remote browser-module
// import. Fake only MapLibre/DOM/event scheduling; clustering-model logic is real.
const rendererSource = readFileSync(new URL("../../public/mshpit-maplibre/renderer.mjs", import.meta.url), "utf8");
const declaration = parse(rendererSource, { sourceType: "module" }).program.body
  .find(node => node.type === "FunctionDeclaration" && node.id?.name === "createRenderer");
assert.ok(declaration, "The production renderer must exist");
const implementation = rendererSource.slice(declaration.start, declaration.end);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const row = (id, lat = 10, lng = 5, mapNumber = 1) => ({ id, name: `Venue ${id}`, mapNumber, coord: { lat, lng } });
const cluster = (id, count, coordinates = [5, 10]) => ({
  type: "Feature", geometry: { type: "Point", coordinates },
  properties: { cluster: true, cluster_id: id, venueCount: count },
});

function fixture({ project = (coordinates, center) => ({ x: coordinates[0] - center.lng + 180, y: 85 - coordinates[1] }), reducedMotion = true } = {}) {
  const maps = [], frames = new Map(), selected = [], errors = [];
  let frameId = 0, ready = 0;
  const host = { dataset: {}, getBoundingClientRect: () => ({ width: 360, height: 340 }) };
  class Button {
    constructor() {
      this.attributes = {}; this.listeners = {}; this.disabled = false; this.classes = new Set();
      this.classList = {
        add: (...tokens) => tokens.forEach(token => this.classes.add(token)),
        contains: token => this.classes.has(token),
        toggle: (token, force) => {
          const enabled = force === undefined ? !this.classes.has(token) : !!force;
          if (enabled) this.classes.add(token); else this.classes.delete(token);
          return enabled;
        },
      };
    }
    get className() { return [...this.classes].join(" "); }
    set className(value) { this.classes = new Set(value.split(/\s+/u).filter(Boolean)); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    setAttribute(name, value) { this.attributes[name] = value; }
    async click() { if (!this.disabled) await this.listeners.click(); }
  }
  class FakeSource {
    constructor(options) { this.options = options; this.data = options.data; this.updates = []; this.expansions = []; }
    setData(data) { this.data = data; this.updates.push(data); }
    getClusterExpansionZoom(id) { this.expansions.push(id); return this.expand ? this.expand(id) : Promise.resolve(8); }
  }
  class FakeMap {
    constructor(options) {
      this.options = options; this.zoom = options.zoom; this.center = { lng: options.center[0], lat: options.center[1] }; this.handlers = new Map(); this.sources = new Map();
      this.markers = new Set(); this.controls = []; this.layers = []; this.fits = []; this.pans = [];
      this.sourceQueries = []; this.renderedQueries = [];
      maps.push(this);
    }
    addControl(control, position) { this.controls.push({ control, position }); }
    on(name, callback) {
      if (!this.handlers.has(name)) this.handlers.set(name, []);
      this.handlers.get(name).push(callback);
    }
    emit(name, event = {}) { this.handlers.get(name)?.forEach(callback => callback(event)); }
    addSource(id, options) { this.sources.set(id, new FakeSource(options)); }
    getSource(id) { return this.sources.get(id); }
    addLayer(layer) { this.layers.push(layer); }
    querySourceFeatures(id) { this.sourceQueries.push(id); return this.loadedFeatures ?? this.visibleFeatures ?? this.getSource(id).data.features; }
    queryRenderedFeatures(options) {
      this.renderedQueries.push(options);
      assert.deepEqual(options.layers, ["mshpit-venue-source"], "Only the transparent venue layer can create map buttons");
      const layer = this.layers.find(entry => entry.id === options.layers[0]);
      assert.ok(layer, "The venue layer must exist before querying it");
      return this.visibleFeatures ?? this.getSource(layer.source).data.features;
    }
    project(coordinates) { return project(coordinates, this.center); }
    getCenter() { return this.center; }
    getZoom() { return this.zoom; }
    fitBounds(bounds, options) { this.fits.push({ coordinates: bounds.coordinates, options }); }
    easeTo(options) {
      this.pans.push(options);
      if (options.zoom !== undefined) this.zoom = options.zoom;
      if (options.center !== undefined) this.center = { lng: options.center[0], lat: options.center[1] };
    }
    remove() { this.removed = true; }
  }
  class Marker {
    constructor({ element }) {
      this.button = element;
      // MapLibre owns structural/anchor classes; the application may append
      // styling classes but must never replace the library's positioning hooks.
      element.classList.add("maplibregl-marker", "maplibregl-marker-anchor-center");
    }
    setLngLat(coordinates) { this.coordinates = coordinates; return this; }
    addTo(map) { this.map = map; map.markers.add(this); return this; }
    remove() { this.removed = true; this.map.markers.delete(this); }
  }
  class Bounds {
    constructor() { this.coordinates = []; }
    extend(coordinates) { this.coordinates.push(coordinates); return this; }
  }
  const dependencies = {
    maplibregl: { Map: FakeMap, Marker, LngLatBounds: Bounds, NavigationControl: class {}, AttributionControl: class {}, ScaleControl: class {} },
    nextGroupVenue, venueFeatureCollection, viewportFeatureKey,
    document: { createElement: tag => { assert.equal(tag, "button"); return new Button(); } },
    matchMedia: query => { assert.equal(query, "(prefers-reduced-motion: reduce)"); return { matches: reducedMotion }; },
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  const createRenderer = new Function(...Object.keys(dependencies), `return (${implementation});`)(...Object.values(dependencies));
  const engine = createRenderer(host, { version: 8, layers: [], sources: {} }, {
    onSelect: id => selected.push(id), onReady: () => { ready++; }, onFail: () => errors.push("map-failure"),
  });
  const map = maps[0];
  function flush() {
    // One frame can schedule another through a MapLibre event in production.
    // The bounded assertion catches accidental scheduling loops in this seam.
    let count = 0;
    while (frames.size) {
      assert.ok(count++ < 10, "Renderer must settle its scheduled work");
      const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback());
    }
  }
  return {
    engine, map, host, selected, errors, flush, frames,
    readyCount: () => ready,
    source: () => map.getSource("mshpit-venue-catalogue"),
    markers: () => [...map.markers],
    load(rows, selectedId = null) { engine.update(rows, selectedId); map.emit("load"); flush(); },
    viewport(features) { map.visibleFeatures = features; map.emit("sourcedata", { sourceId: "mshpit-venue-catalogue" }); flush(); },
  };
}

test("the entire catalogue enters the worker source while DOM markers remain viewport-only", () => {
  const rows = Array.from({ length: 10001 }, (_, index) => row(`room-${index}`, 10, index / 100, index + 1));
  const f = fixture({ project: coordinates => ({ x: coordinates[0] < .1 ? 100 : 1000, y: 100 }) });
  f.load(rows);
  assert.equal(f.readyCount(), 1);
  assert.equal(f.source().data.features.length, 10001);
  assert.equal(f.source().options.cluster, true);
  assert.equal(f.source().options.clusterMaxZoom, 16);
  assert.equal(f.markers().length, 10);
  assert.equal(f.host.dataset.cataloguePoints, "10001");
  assert.equal(f.host.dataset.markerGroups, "10");
  assert.equal(f.host.dataset.clusters, "0");
  assert.equal(f.map.fits.at(-1).coordinates.length, 10001, "Fit includes offscreen catalogue points");
  assert.equal(f.map.options.minZoom, -2, "The map can zoom out beyond a single world width");
  assert.equal(f.map.options.renderWorldCopies, true, "A wide map must not force the world to fill its width and defeat global bounds fitting");
});

for (const centerLng of [-360, 360]) {
  test(`wrapped center ${centerLng} projects one nearest marker per feature and preserves canonical source geometry`, async () => {
    const f = fixture(), rows = [row("a", 43, -79), row("b", -35, 120, 2), row("c", -34, 121, 3)];
    f.load(rows);
    const canonicalGeometry = structuredClone(f.source().data.features.map(feature => feature.geometry));
    const point = f.source().data.features[0], pointCopy = structuredClone(point);
    pointCopy.geometry.coordinates[0] += 360;
    const grouped = cluster(91, 2, [120, -35]), groupCopy = structuredClone(grouped);
    groupCopy.geometry.coordinates[0] -= 360;
    f.map.center = { lng: centerLng, lat: 0 };
    f.viewport([point, pointCopy, grouped, groupCopy]);
    assert.equal(f.markers().length, 2, "Repeated source tiles/world copies must not duplicate buttons");
    assert.equal(f.host.dataset.markerGroups, "2");
    assert.equal(f.host.dataset.clusters, "1");
    assert.equal(f.host.dataset.cataloguePoints, "3");
    assert.deepEqual(f.markers().map(marker => marker.coordinates), [[-79 + centerLng, 43], [120 + centerLng, -35]]);
    assert.deepEqual(f.source().data.features.map(feature => feature.geometry), canonicalGeometry);
    f.map.emit("moveend"); f.flush();
    assert.equal(f.markers().length, 2, "Subsequent viewport updates keep the same deduplicated features");
    await f.markers()[1].button.click();
    assert.deepEqual(f.map.pans.at(-1).center, [120, -35], "Cluster clicks retain canonical source geometry");
  });
}

test("duplicate source-tile features produce one button per cluster or actual coordinate group", () => {
  const f = fixture(), rows = [row("a"), row("b", 20, 10, 2)];
  f.load(rows);
  const point = f.source().data.features[0], grouped = cluster(42, 27, [20, 15]);
  f.viewport([point, structuredClone(point), grouped, structuredClone(grouped), cluster(43, 5, [1000, 1000])]);
  assert.equal(f.markers().length, 2);
  assert.equal(f.host.dataset.markerGroups, "2");
  assert.equal(f.host.dataset.clusters, "1");
  assert.equal(f.host.dataset.cataloguePoints, "2");
  assert.deepEqual(f.markers().map(marker => marker.button.textContent).sort(), [1, "27"]);
  const buttons = f.markers().map(marker => marker.button);
  f.map.emit("move"); f.map.emit("moveend"); f.flush();
  assert.deepEqual(f.markers().map(marker => marker.button), buttons, "Unchanged viewport buttons are reused");
  f.viewport([]);
  assert.equal(f.markers().length, 0);
  assert.equal(f.host.dataset.cataloguePoints, "2", "Panning does not truncate catalogue data");
});

test("only the visible cluster partition creates buttons when loaded source tiles retain a parent level", async () => {
  const f = fixture(), rows = Array.from({ length: 8 }, (_, index) => row(`a${index}`, 10 + index, 5 + index, index + 1));
  f.load(rows);
  const point = f.source().data.features[0], parent = cluster(900, 8, [15, 17]);
  const children = [cluster(101, 3, [10, 15]), cluster(102, 4, [20, 18]), point];
  f.map.loadedFeatures = [parent, ...children, structuredClone(parent)];
  f.viewport([...children, structuredClone(point)]);
  assert.equal(f.map.sourceQueries.length, 0, "A loaded parent level must not contribute an extra cluster");
  assert.ok(f.map.renderedQueries.length > 0);
  assert.equal(f.map.layers[0].paint["circle-opacity"], 0, "The query layer keeps the approved map appearance");
  assert.equal(f.markers().length, 3);
  assert.deepEqual(f.markers().map(marker => String(marker.button.textContent)).sort(), ["1", "3", "4"]);
  assert.equal(f.markers().reduce((sum, marker) => sum + (marker.button.attributes["aria-label"].startsWith("Zoom into") ? Number(marker.button.textContent) : 1), 0), rows.length);
  assert.equal(f.host.dataset.cataloguePoints, "8");
  await f.markers().find(marker => marker.button.attributes["aria-label"] === "Zoom into cluster of 4 venues").button.click();
  assert.deepEqual(f.source().expansions, [102], "Expansion must use the current rendered child's cluster identity");
  assert.deepEqual(f.map.pans.at(-1).center, [20, 18]);
});

test("the settled idle frame replaces an earlier cluster level without requiring another user gesture", () => {
  const f = fixture();
  f.load([row("a"), row("b", 20, 10, 2)]);
  f.viewport([cluster(900, 2)]);
  const previous = f.markers()[0];
  f.map.visibleFeatures = f.source().data.features;
  f.map.emit("idle"); f.flush();
  assert.equal(previous.removed, true);
  assert.equal(f.markers().length, 2);
  assert.equal(f.host.dataset.clusters, "0");
  assert.equal(f.host.dataset.cataloguePoints, "2");
  assert.equal(f.map.sourceQueries.length, 0);
});

test("MapLibre structural classes survive app selection/group styling and reused marker updates", () => {
  const f = fixture(), rows = [row("a"), row("b"), row("c", 20, 10, 3)];
  const assertStructural = button => {
    assert.equal(button.classList.contains("maplibregl-marker"), true, "MapLibre's absolute-positioning class must survive");
    assert.equal(button.classList.contains("maplibregl-marker-anchor-center"), true, "MapLibre's anchor class must survive");
    assert.equal(button.classList.contains("venue-marker"), true);
  };
  f.load(rows);
  const group = f.markers()[0], single = f.markers()[1];
  assertStructural(group.button); assertStructural(single.button);
  assert.equal(group.button.classList.contains("group"), true);
  assert.equal(single.button.classList.contains("group"), false);
  group.button.classList.add("maplibregl-marker-covered");
  f.engine.update(rows, "a"); f.flush();
  assert.equal(f.markers()[0], group, "Selection reuses the existing MapLibre marker");
  assertStructural(group.button);
  assert.equal(group.button.classList.contains("maplibregl-marker-covered"), true, "Later library-owned classes must also survive");
  assert.equal(group.button.classList.contains("is-selected"), true);
  f.engine.update(rows, "c"); f.flush();
  assertStructural(group.button); assertStructural(single.button);
  assert.equal(group.button.classList.contains("is-selected"), false);
  assert.equal(single.button.classList.contains("is-selected"), true);
  assert.equal(group.button.classList.contains("maplibregl-marker-covered"), true);
  f.engine.update([rows[0]], null); f.flush();
  assertStructural(f.markers()[0].button);
  assert.equal(f.markers()[0].button.classList.contains("group"), false);
  assert.equal(f.markers()[0].button.classList.contains("is-selected"), false);
});

test("cluster clicks use the worker expansion zoom and full venue count", async () => {
  const f = fixture(), rows = Array.from({ length: 32 }, (_, index) => row(`a${index}`, 10, 5 + index / 100, index + 1));
  f.load(rows);
  f.map.zoom = 2;
  const expansion = deferred();
  f.source().expand = () => expansion.promise;
  f.viewport([cluster(91, 32, [12, 15])]);
  const button = f.markers()[0].button;
  assert.equal(button.textContent, "32");
  assert.equal(button.attributes["aria-label"], "Zoom into cluster of 32 venues");
  const pending = button.click();
  assert.equal(button.disabled, true);
  assert.deepEqual(f.source().expansions, [91]);
  assert.deepEqual(f.map.pans, []);
  expansion.resolve(7);
  await pending;
  assert.deepEqual(f.map.pans, [{ center: [12, 15], zoom: 7, duration: 0 }]);
  assert.equal(button.disabled, false);
  assert.deepEqual(f.selected, [], "Clusters expand instead of selecting an invented venue");
});

test("cluster expansion advances zoom, is bounded at 18 and honors reduced-motion preferences", async () => {
  const f = fixture({ reducedMotion: false });
  f.load([row("a")]);
  f.viewport([cluster(5, 2)]);
  f.map.zoom = 10;
  f.source().expand = async () => 3;
  await f.markers()[0].button.click();
  assert.equal(f.map.pans.at(-1).zoom, 11);
  assert.equal(f.map.pans.at(-1).duration, 450);
  f.map.zoom = 17;
  f.source().expand = async () => 24;
  await f.markers()[0].button.click();
  assert.equal(f.map.pans.at(-1).zoom, 18);
});

for (const transition of ["filter", "dispose"]) {
  test(`a late cluster expansion after ${transition} cannot pan the map`, async () => {
    const f = fixture(), rows = [row("a"), row("b", 20, 10, 2)], expansion = deferred();
    f.load(rows);
    f.source().expand = () => expansion.promise;
    f.viewport([cluster(10, 2)]);
    const pending = f.markers()[0].button.click();
    if (transition === "filter") {
      f.map.visibleFeatures = undefined;
      f.engine.update([rows[1]], null);
      f.flush();
      assert.equal(f.source().data.features.length, 1);
      assert.equal(f.host.dataset.cataloguePoints, "1");
    } else {
      f.engine.dispose();
      assert.equal(f.map.removed, true);
      assert.equal(f.markers().length, 0);
    }
    expansion.resolve(15);
    await pending;
    assert.deepEqual(f.map.pans, []);
    assert.deepEqual(f.selected, []);
  });
}

test("a late cluster answer cannot override a newer venue selection", async () => {
  const f = fixture(), rows = [row("a", 10, 5), row("b", 48, 2, 2)], expansion = deferred();
  f.load(rows);
  f.source().expand = () => expansion.promise;
  f.viewport([cluster(10, 2, [5, 10])]);
  const pending = f.markers()[0].button.click();
  f.engine.update(rows, "b"); f.flush();
  assert.deepEqual(f.map.pans, [{ center: [2, 48], zoom: 14, duration: 0 }]);
  expansion.resolve(16);
  await pending;
  assert.deepEqual(f.map.pans, [{ center: [2, 48], zoom: 14, duration: 0 }]);
});

for (const order of ["newer-first", "older-first"]) {
  test(`competing cluster answers preserve the latest click when resolved ${order}`, async () => {
    const f = fixture(), older = deferred(), newer = deferred();
    f.load([row("a"), row("b", 20, 10, 2)]);
    f.source().expand = id => id === 10 ? older.promise : newer.promise;
    f.viewport([cluster(10, 2, [5, 10]), cluster(20, 2, [12, 25])]);
    const first = f.markers()[0].button.click(), second = f.markers()[1].button.click();
    if (order === "newer-first") {
      newer.resolve(8); await second;
      older.resolve(13); await first;
    } else {
      older.resolve(13); await first;
      assert.deepEqual(f.map.pans, [], "An older answer cannot act after a newer click");
      newer.resolve(8); await second;
    }
    assert.deepEqual(f.map.pans, [{ center: [12, 25], zoom: 8, duration: 0 }]);
    assert.ok(f.markers().every(marker => !marker.button.disabled));
  });
}

test("fitting all venues invalidates a pending cluster answer", async () => {
  const f = fixture(), expansion = deferred();
  f.load([row("a"), row("b", 20, 10, 2)]);
  f.source().expand = () => expansion.promise;
  f.viewport([cluster(10, 2)]);
  const pending = f.markers()[0].button.click(), fitsBefore = f.map.fits.length;
  f.engine.fit();
  assert.equal(f.map.fits.length, fitsBefore + 1);
  assert.deepEqual(f.map.fits.at(-1).coordinates, [[5, 10], [10, 20]]);
  expansion.resolve(10); await pending;
  assert.deepEqual(f.map.pans, []);
});

test("a manual map gesture invalidates an older cluster answer", async () => {
  const f = fixture(), expansion = deferred();
  f.load([row("a")]);
  f.source().expand = () => expansion.promise;
  f.viewport([cluster(10, 2)]);
  const pending = f.markers()[0].button.click();
  f.map.emit("movestart", { originalEvent: { type: "pointermove" } });
  expansion.resolve(12); await pending;
  assert.deepEqual(f.map.pans, []);
});

test("programmatic movement without a user event does not discard a current cluster answer", async () => {
  const f = fixture(), expansion = deferred();
  f.load([row("a")]);
  f.source().expand = () => expansion.promise;
  f.viewport([cluster(10, 2)]);
  const pending = f.markers()[0].button.click();
  f.map.emit("movestart", {});
  expansion.resolve(7); await pending;
  assert.deepEqual(f.map.pans, [{ center: [5, 10], zoom: 7, duration: 0 }]);
});

test("an expired cluster answer leaves the map usable for a later expansion", async () => {
  const f = fixture();
  f.load([row("a")]);
  f.viewport([cluster(8, 2)]);
  f.source().expand = async () => { throw new Error("Fixture worker cluster expired"); };
  const button = f.markers()[0].button;
  await button.click();
  assert.equal(button.disabled, false);
  assert.deepEqual(f.map.pans, []);
  assert.deepEqual(f.errors, []);
  f.source().expand = async () => 6;
  await button.click();
  assert.equal(f.map.pans.at(-1).zoom, 6);
});

test("coincident venues cycle their actual identities and keep their real coordinate", async () => {
  const f = fixture(), rows = [row("a", 43, -79, 11), row("b", 43, -79, 12), row("c", 43, -79, 13)];
  f.load(rows);
  assert.equal(f.source().data.features.length, 1);
  assert.equal(f.source().data.features[0].properties.venueCount, 3);
  assert.equal(f.markers().length, 1);
  assert.match(f.markers()[0].button.textContent, /^3[×x]$/u);
  for (const id of ["a", "b", "c", "a"]) {
    await f.markers()[0].button.click();
    assert.equal(f.selected.at(-1), id);
    f.engine.update(rows, id); f.flush();
    assert.deepEqual(f.markers()[0].coordinates, [-79, 43]);
    assert.equal(f.markers()[0].button.attributes["aria-pressed"], "true");
  }
  assert.equal(f.host.dataset.cataloguePoints, "3");
  assert.equal(f.host.dataset.markerGroups, "1");
});

test("venue selection recenters to at least zoom 14 without zooming out an already close map", () => {
  const f = fixture(), rows = [row("a", 43, -79, 1), row("b", 48, 2, 2)];
  f.load(rows);
  f.map.zoom = 1;
  f.engine.update(rows, "b"); f.flush();
  assert.deepEqual(f.map.pans.at(-1), { center: [2, 48], zoom: 14, duration: 0 });
  const sourceUpdates = f.source().updates.length;
  f.engine.update(rows, "b"); f.flush();
  assert.equal(f.map.pans.length, 1, "Unchanged selection does not recenter repeatedly");
  assert.equal(f.source().updates.length, sourceUpdates, "Selection does not rebuild the worker index");
  f.map.zoom = 16;
  f.engine.update(rows, "a"); f.flush();
  assert.deepEqual(f.map.pans.at(-1), { center: [-79, 43], zoom: 16, duration: 0 });
});

test("filtered rows and renumbered cards replace marker labels without losing catalogue counts", () => {
  const f = fixture(), rows = [row("a", 10, 5, 14), row("b", 20, 10, 15)];
  f.load(rows);
  assert.equal(f.markers()[0].button.textContent, 14);
  f.engine.update([{ ...rows[1], mapNumber: 1 }], null); f.flush();
  assert.equal(f.source().data.features.length, 1);
  assert.equal(f.markers().length, 1);
  assert.equal(f.markers()[0].button.textContent, 1);
  assert.match(f.markers()[0].button.attributes["aria-label"], /^Map pin 1: Venue b/);
  assert.equal(f.host.dataset.cataloguePoints, "1");
  assert.equal(f.host.dataset.zoom, "0.00");
});

test("disposing cancels pending frames and prevents late source or load events from restoring markers", () => {
  const f = fixture();
  f.load([row("a")]);
  f.map.emit("move");
  assert.equal(f.frames.size, 1);
  f.engine.dispose(); f.engine.dispose();
  assert.equal(f.frames.size, 0);
  assert.equal(f.markers().length, 0);
  f.map.emit("sourcedata", { sourceId: "mshpit-venue-catalogue" }); f.map.emit("load"); f.flush();
  f.engine.update([row("b")], "b"); f.engine.fit();
  assert.equal(f.markers().length, 0);
  assert.deepEqual(f.map.pans, []);
  assert.equal(f.readyCount(), 1);
});
