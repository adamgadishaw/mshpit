const CDN = "https://unpkg.com/maplibre-gl@6.15.0/dist/";
export const OPEN_FREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const LOCAL_REVIEW_STYLE = "/mshpit-maplibre/preview-style.json";
let modulePromise = null;

function stylesheet(href) {
  if (document.querySelector(`link[data-mshpit-map-style="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet"; link.href = href; link.dataset.mshpitMapStyle = href;
  document.head.appendChild(link);
}

export function ensureVenueMapCardStyle() {
  stylesheet("/mshpit-maplibre/card.css");
}

function loadRenderer() {
  if (window.__mshpitMapRenderer?.createRenderer) return Promise.resolve(window.__mshpitMapRenderer);
  if (modulePromise) return modulePromise;
  modulePromise = new Promise((resolve, reject) => {
    stylesheet(CDN + "maplibre-gl.css");
    ensureVenueMapCardStyle();
    const script = document.createElement("script");
    script.type = "module"; script.src = "/mshpit-maplibre/renderer.mjs";
    const ready = event => { cleanup(); resolve(event.detail); };
    const failed = () => { cleanup(); script.remove(); modulePromise = null; reject(new Error("venue-map-renderer-unavailable")); };
    const timer = setTimeout(failed, 15000);
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("mshpit-map-renderer-ready", ready); script.onerror = null; };
    window.addEventListener("mshpit-map-renderer-ready", ready, { once: true });
    script.onerror = failed;
    document.head.appendChild(script);
  });
  return modulePromise;
}

export function venueMapStyle(style) {
  // OpenFreeMap permits omitting its branding. Keep the published required
  // OpenMapTiles/OSM credit, overriding only this known hosted vector source.
  for (const source of Object.values(style.sources || {})) {
    if (source.type === "vector" && source.url === "https://tiles.openfreemap.org/planet") {
      source.attribution = '© <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';
    }
  }
  for (const layer of style.layers || []) {
    layer.paint ||= {};
    const id = layer.id.toLowerCase();
    if (layer.type === "background") layer.paint["background-color"] = "#151a1b";
    if (layer.type === "fill") {
      if (/water/.test(id)) layer.paint["fill-color"] = "#0b222c";
      else if (/park|wood|grass|landcover/.test(id)) layer.paint["fill-color"] = "#1d2c25";
      else if (/building/.test(id)) { layer.paint["fill-color"] = "#29312e"; layer.paint["fill-opacity"] = .7; }
      else if (/land|residential|industrial/.test(id)) layer.paint["fill-color"] = "#19201e";
    }
    if (layer.type === "line" && /road|highway|motorway|transport|rail|bridge|tunnel/.test(id)) layer.paint["line-color"] = /casing|outline/.test(id) ? "#1c2422" : /motorway|trunk/.test(id) ? "#626447" : "#38443c";
    if (layer.type === "symbol" && layer.layout?.["text-field"]) {
      layer.paint["text-color"] = /place|city|town|suburb/.test(id) ? "#c1cabb" : "#919e8d";
      layer.paint["text-halo-color"] = "#151d19"; layer.paint["text-halo-width"] = 1.4;
      if (/poi/.test(id)) layer.layout.visibility = "none";
    }
  }
  return style;
}

// Native never imports this adapter. The local style override is a fixed review
// endpoint, not an arbitrary URL or a browser/query-controlled provider switch.
export async function mountVenueMap(host, { signal, onReady, onFail, onSelect }) {
  const renderer = await loadRenderer();
  if (signal.aborted) return null;
  const styleUrl = process.env.EXPO_PUBLIC_MAPLIBRE_STYLE_URL === LOCAL_REVIEW_STYLE ? LOCAL_REVIEW_STYLE : OPEN_FREE_MAP_STYLE;
  const response = await fetch(styleUrl, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("venue-map-style-unavailable");
  const style = await response.json();
  if (signal.aborted) return null;
  return renderer.createRenderer(host, venueMapStyle(style), { onReady, onFail, onSelect });
}
