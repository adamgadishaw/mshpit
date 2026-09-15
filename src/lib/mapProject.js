// Shared map projection so the drawn map and the interactive pin overlay agree
// on where every venue sits. Two modes:
//   - linear:   simple lat/lng fit (matches the drawn CityMap)
//   - mercator: Web Mercator, aspect-corrected to match a Mapbox static image
import { mapCoordinate } from "../domain/mapCoordinates.mjs";

export const MAP_W = 320;
export const MAP_H = 206;
export const MAP_PAD = 22;
const MIN_SPAN = 0.05;
const PAD_FRAC = 0.16;
const MERCATOR_LAT = 85.0511287798066;
const clampLat = lat => Math.max(-MERCATOR_LAT, Math.min(MERCATOR_LAT, lat));
const wrapLng = lng => {
  if (!Number.isFinite(lng)) return NaN;
  return lng >= 180 || lng < -180 ? ((lng + 180) % 360 + 360) % 360 - 180 : lng;
};
const nearLng = (lng, center) => center + wrapLng(lng - center);

// Remove the largest empty arc, rather than fitting -179 and +179 across
// almost the entire planet. Sorting makes the fit independent of input order.
function longitudeBounds(coords) {
  const values = coords.map(point => wrapLng(point.lng)).sort((a, b) => a - b);
  let largestGap = -1, start = values[0];
  for (let i = 0; i < values.length; i += 1) {
    const next = i + 1 < values.length ? values[i + 1] : values[0] + 360;
    if (next - values[i] > largestGap) {
      largestGap = next - values[i];
      start = i + 1 < values.length ? values[i + 1] : values[0];
    }
  }
  const unwrapped = values.map(lng => lng < start ? lng + 360 : lng);
  return { minLng: Math.min(...unwrapped), maxLng: Math.max(...unwrapped) };
}

export function fitBox(coords) {
  const valid = (Array.isArray(coords) ? coords : []).map(mapCoordinate).filter(Boolean);
  if (!valid.length) return null;
  let minLat = Math.min(...valid.map((p) => clampLat(p.lat)));
  let maxLat = Math.max(...valid.map((p) => clampLat(p.lat)));
  let { minLng, maxLng } = longitudeBounds(valid);
  if (maxLat - minLat < MIN_SPAN) { const c = (minLat + maxLat) / 2; minLat = c - MIN_SPAN / 2; maxLat = c + MIN_SPAN / 2; }
  if (maxLng - minLng < MIN_SPAN) { const c = (minLng + maxLng) / 2; minLng = c - MIN_SPAN / 2; maxLng = c + MIN_SPAN / 2; }
  const pl = (maxLat - minLat) * PAD_FRAC, pn = (maxLng - minLng) * PAD_FRAC;
  return { minLat: minLat - pl, maxLat: maxLat + pl, minLng: minLng - pn, maxLng: maxLng + pn };
}

// linear projector → fractions 0..1 inside the padded viewBox
export function linearProjector(coords) {
  const b = fitBox(coords);
  if (!b) return null;
  const centerLng = (b.minLng + b.maxLng) / 2;
  const xPct = (lng) => (MAP_PAD + ((nearLng(Number(lng), centerLng) - b.minLng) / (b.maxLng - b.minLng)) * (MAP_W - 2 * MAP_PAD)) / MAP_W;
  const yPct = (lat) => (MAP_PAD + ((b.maxLat - clampLat(lat)) / (b.maxLat - b.minLat)) * (MAP_H - 2 * MAP_PAD)) / MAP_H;
  return { box: b, xPct, yPct };
}

// Center + integer zoom that fits the venues, plus a projector that lines pins
// up with a Google static image at that center/zoom using 256px tiles. Mapbox
// callers lower the requested zoom by one to account for its 512px tiles.
const TILE = 256;
const wX = (lng) => (lng + 180) / 360;
const wY = (lat) => {
  const s = Math.sin((clampLat(lat) * Math.PI) / 180);
  return Math.max(0, Math.min(1, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)));
};
export function pixelProjector(coords, W = MAP_W, H = MAP_H) {
  const b = fitBox(coords);
  if (!b || !Number.isFinite(W) || W <= 0 || !Number.isFinite(H) || H <= 0) return null;
  const fracW = wX(b.maxLng) - wX(b.minLng);
  const fracH = wY(b.minLat) - wY(b.maxLat);
  const zx = Math.log2(W / (TILE * fracW));
  const zy = Math.log2(H / (TILE * fracH));
  const zoom = Math.max(1, Math.min(18, Math.floor(Math.min(zx, zy))));
  const scale = TILE * Math.pow(2, zoom);
  const centerLng = (b.minLng + b.maxLng) / 2;
  const center = { lat: clampLat((b.minLat + b.maxLat) / 2), lng: wrapLng(centerLng) };
  const cx = wX(centerLng) * scale, cy = wY(center.lat) * scale;
  const xPct = (lng) => (wX(nearLng(Number(lng), centerLng)) * scale - (cx - W / 2)) / W;
  const yPct = (lat) => (wY(lat) * scale - (cy - H / 2)) / H;
  return { center, zoom, xPct, yPct };
}

// Web Mercator helpers
const mx = wX;
const my = wY;
const invX = (x) => x * 360 - 180;
const invY = (y) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * y)));

// mercator projector, aspect-corrected to W/H. Returns a bbox for the Mapbox
// static request AND a projector that lines pins up with that image.
export function mercatorProjector(coords) {
  const b = fitBox(coords);
  if (!b) return null;
  let xL = mx(b.minLng), xR = mx(b.maxLng);
  let yT = my(b.maxLat), yB = my(b.minLat);
  let mw = xR - xL, mh = yB - yT;
  const target = MAP_W / MAP_H;
  if (mw / mh < target) { const want = mh * target, cx = (xL + xR) / 2; xL = cx - want / 2; xR = cx + want / 2; }
  else { const want = mw / target, cy = (yT + yB) / 2; yT = cy - want / 2; yB = cy + want / 2; }
  const bbox = [invX(xL), invY(yB), invX(xR), invY(yT)]; // [minLng,minLat,maxLng,maxLat]
  const centerLng = invX((xL + xR) / 2);
  const xPct = (lng) => (mx(nearLng(Number(lng), centerLng)) - xL) / (xR - xL);
  const yPct = (lat) => (my(lat) - yT) / (yB - yT);
  return { bbox, xPct, yPct };
}
