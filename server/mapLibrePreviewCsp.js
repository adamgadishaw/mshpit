import { mapLibreServerEnabled } from "./mapLibreConfiguration.mjs";

// Off by default. Production requires separate explicit server authority;
// neither the preview flag nor the public renderer flag changes live policy.
const MAPLIBRE_CDN_PREFIX = "https://unpkg.com/maplibre-gl@6.15.0/dist/";
const OPENFREEMAP_ORIGIN = "https://tiles.openfreemap.org";

export function mapLibrePreviewCspSources(env = process.env) {
  if (!mapLibreServerEnabled(env)) {
    return { script: [], style: [], connect: [] };
  }
  return {
    script: [MAPLIBRE_CDN_PREFIX],
    // Only the pinned MapLibre package CSS is remote; our bridge/card CSS is local.
    style: [MAPLIBRE_CDN_PREFIX],
    connect: [OPENFREEMAP_ORIGIN],
  };
}
