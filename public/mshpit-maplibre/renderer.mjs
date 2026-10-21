// Exact official module and same-origin version-matched worker. Catalogue data
// stays in the worker cluster index; only visible clusters become DOM buttons.
import * as maplibregl from "https://unpkg.com/maplibre-gl@6.15.0/dist/maplibre-gl.mjs";
import { nextGroupVenue, venueFeatureCollection, viewportFeatureKey } from "./cluster-model.mjs";
maplibregl.setWorkerUrl("/mshpit-maplibre/maplibre-gl-worker.mjs?v=6.15.0");

function createRenderer(host, style, callbacks) {
  const map = new maplibregl.Map({ container: host, style, center: [0, 20], zoom: 0,
    minZoom: -2, maxZoom: 18, renderWorldCopies: true, attributionControl: false, cooperativeGestures: true });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 85, unit: "metric" }), "bottom-left");
  let rows = [], selected = null, model = venueFeatureCollection([]), ready = false, disposed = false, signature = "";
  let markers = new Map(), frame = null, revision = 0, interaction = 0;
  const sourceId = "mshpit-venue-catalogue";
  const layerId = "mshpit-venue-source";
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = () => reduced() ? 0 : 450;
  const clear = () => { markers.forEach(entry => entry.marker.remove()); markers.clear(); };
  function fit() {
    interaction += 1;
    if (!ready || !rows.length || disposed) return;
    const bounds = new maplibregl.LngLatBounds();
    rows.forEach(row => bounds.extend([row.coord.lng, row.coord.lat]));
    map.fitBounds(bounds, { padding: { top: 100, bottom: 55, left: 45, right: 45 }, maxZoom: 14, duration: duration() });
  }
  function render() {
    frame = null;
    if (!ready || disposed || !map.getSource(sourceId)) return;
    const next = new Map(), box = host.getBoundingClientRect(), centerLng = map.getCenter().lng;
    // Loaded source tiles may retain parent/child cluster levels. Query only
    // the rendered venue layer, then deduplicate its buffered/world-copy hits.
    for (const feature of map.queryRenderedFeatures({ layers: [layerId] })) {
      const key = viewportFeatureKey(feature);
      if (next.has(key)) continue;
      // Cull and anchor the same nearest world copy without changing source
      // geometry or stable feature keys used for selection and deduplication.
      const canonical = feature.geometry.coordinates;
      const coordinates = [canonical[0] + 360 * Math.round((centerLng - canonical[0]) / 360), canonical[1]];
      const pixel = map.project(coordinates);
      if (pixel.x < -24 || pixel.y < -24 || pixel.x > box.width + 24 || pixel.y > box.height + 24) continue;
      const cluster = !!feature.properties.cluster;
      const members = cluster ? [] : model.groups.get(feature.properties.key) || [];
      if (!cluster && !members.length) continue;
      const count = cluster ? feature.properties.venueCount : members.length;
      const active = !cluster && members.some(row => row.id === selected);
      let entry = markers.get(key);
      if (!entry) {
        const button = document.createElement("button");
        button.type = "button";
        entry = { button, feature, members, marker: new maplibregl.Marker({ element: button }).setLngLat(coordinates).addTo(map) };
        button.addEventListener("click", async () => {
          if (disposed) return;
          const current = entry.feature;
          if (!current.properties.cluster) { callbacks.onSelect(nextGroupVenue(entry.members, selected)); return; }
          const currentRevision = revision, currentInteraction = ++interaction;
          button.disabled = true;
          try {
            const zoom = await map.getSource(sourceId).getClusterExpansionZoom(current.properties.cluster_id);
            if (!disposed && currentRevision === revision && currentInteraction === interaction) map.easeTo({ center: current.geometry.coordinates,
              zoom: Math.min(18, Math.max(map.getZoom() + 1, zoom)), duration: duration() });
          } catch { /* A filtered cluster may expire while the worker answers. */ }
          finally { button.disabled = false; }
        });
      }
      entry.feature = feature; entry.members = members;
      entry.marker.setLngLat(coordinates);
      // Marker owns positioning/anchor classes. Change only our styling flags.
      entry.button.classList.add("venue-marker");
      entry.button.classList.toggle("is-selected", active);
      entry.button.classList.toggle("group", count > 1);
      entry.button.textContent = cluster ? String(count) : count > 1 ? `${count}×` : members[0].mapNumber;
      entry.button.setAttribute("aria-label", cluster ? `Zoom into cluster of ${count} venues` :
        `Map pin ${members[0].mapNumber}: ${members.map(row => row.name).join(", ")}${count > 1 ? ". Tap to cycle venues" : ""}`);
      entry.button.setAttribute("aria-pressed", String(active));
      entry.button.title = cluster ? `${count} venues — zoom to explore` : members.map(row => row.name).join(" · ");
      next.set(key, entry);
    }
    markers.forEach((entry, key) => { if (!next.has(key)) entry.marker.remove(); });
    markers = next;
    host.dataset.markerGroups = String(markers.size);
    host.dataset.cataloguePoints = String(rows.length);
    host.dataset.zoom = map.getZoom().toFixed(2);
    host.dataset.clusters = String([...markers.values()].filter(entry => entry.feature.properties.cluster).length);
  }
  function schedule() { if (frame === null && !disposed) frame = requestAnimationFrame(render); }
  function updateSource() {
    revision += 1;
    model = venueFeatureCollection(rows);
    clear();
    map.getSource(sourceId)?.setData(model.data);
    fit(); schedule();
  }
  map.on("load", () => {
    if (disposed) return;
    map.addSource(sourceId, { type: "geojson", data: model.data, cluster: true, clusterRadius: 46,
      clusterMaxZoom: 16, clusterProperties: { venueCount: ["+", ["get", "venueCount"]] } });
    // This transparent layer drives loading of the source's viewport tiles.
    map.addLayer({ id: layerId, type: "circle", source: sourceId,
      paint: { "circle-radius": 1, "circle-opacity": 0 } });
    ready = true; callbacks.onReady(); updateSource();
  });
  map.on("move", schedule);
  map.on("movestart", event => { if (event.originalEvent) interaction += 1; });
  map.on("moveend", schedule);
  map.on("idle", schedule);
  map.on("sourcedata", event => { if (event.sourceId === sourceId) schedule(); });
  map.on("error", () => { if (!disposed) callbacks.onFail(); });
  map.on("webglcontextlost", () => { if (!disposed) callbacks.onFail(); });
  return {
    update(nextRows, nextSelected) {
      if (disposed) return;
      const nextSignature = nextRows.map(row => `${row.id}:${row.mapNumber}:${row.coord.lat}:${row.coord.lng}`).join("|");
      const changed = signature !== nextSignature, selectionChanged = selected !== nextSelected;
      if (selectionChanged) interaction += 1;
      rows = nextRows; selected = nextSelected; signature = nextSignature;
      if (changed) { model = venueFeatureCollection(rows); if (ready) updateSource(); }
      else schedule();
      if (selectionChanged && selected && ready) {
        const row = rows.find(entry => entry.id === selected);
        if (row) map.easeTo({ center: [row.coord.lng, row.coord.lat], zoom: Math.max(map.getZoom(), 14), duration: duration() });
      }
    },
    fit,
    dispose() { if (disposed) return; disposed = true; if (frame !== null) cancelAnimationFrame(frame); clear(); map.remove(); }
  };
}
window.__mshpitMapRenderer = Object.freeze({ createRenderer });
window.dispatchEvent(new CustomEvent("mshpit-map-renderer-ready", { detail: window.__mshpitMapRenderer }));
