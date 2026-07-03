// Shared map projection so the drawn map and the interactive pin overlay agree
// on where every venue sits. Two modes:
//   - linear:   simple lat/lng fit (matches the drawn CityMap)
//   - mercator: Web Mercator, aspect-corrected to match a Mapbox static image
export const MAP_W = 320;
export const MAP_H = 206;
export const MAP_PAD = 22;
const MIN_SPAN = 0.05;
const PAD_FRAC = 0.16;

export function fitBox(coords) {
  let minLat = Math.min(...coords.map((p) => p.lat));
  let maxLat = Math.max(...coords.map((p) => p.lat));
  let minLng = Math.min(...coords.map((p) => p.lng));
  let maxLng = Math.max(...coords.map((p) => p.lng));
  if (maxLat - minLat < MIN_SPAN) { const c = (minLat + maxLat) / 2; minLat = c - MIN_SPAN / 2; maxLat = c + MIN_SPAN / 2; }
  if (maxLng - minLng < MIN_SPAN) { const c = (minLng + maxLng) / 2; minLng = c - MIN_SPAN / 2; maxLng = c + MIN_SPAN / 2; }
  const pl = (maxLat - minLat) * PAD_FRAC, pn = (maxLng - minLng) * PAD_FRAC;
  return { minLat: minLat - pl, maxLat: maxLat + pl, minLng: minLng - pn, maxLng: maxLng + pn };
}

// linear projector → fractions 0..1 inside the padded viewBox
export function linearProjector(coords) {
  const b = fitBox(coords);
  const xPct = (lng) => (MAP_PAD + ((lng - b.minLng) / (b.maxLng - b.minLng)) * (MAP_W - 2 * MAP_PAD)) / MAP_W;
  const yPct = (lat) => (MAP_PAD + ((b.maxLat - lat) / (b.maxLat - b.minLat)) * (MAP_H - 2 * MAP_PAD)) / MAP_H;
  return { box: b, xPct, yPct };
}

// Center + integer zoom that fits the venues, plus a projector that lines pins
// up with a Google/Mapbox static image at that center/zoom. Both use 256px
// Web Mercator tiles, so this matches either provider exactly.
const TILE = 256;
const wX = (lng) => (lng + 180) / 360;
const wY = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
export function pixelProjector(coords, W, H) {
  const b = fitBox(coords);
  const fracW = wX(b.maxLng) - wX(b.minLng);
  const fracH = wY(b.minLat) - wY(b.maxLat);
  const zx = Math.log2(W / (TILE * fracW));
  const zy = Math.log2(H / (TILE * fracH));
  const zoom = Math.max(1, Math.min(18, Math.floor(Math.min(zx, zy))));
  const scale = TILE * Math.pow(2, zoom);
  const center = { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 };
  const cx = wX(center.lng) * scale, cy = wY(center.lat) * scale;
  const xPct = (lng) => (wX(lng) * scale - (cx - W / 2)) / W;
  const yPct = (lat) => (wY(lat) * scale - (cy - H / 2)) / H;
  return { center, zoom, xPct, yPct };
}

// Web Mercator helpers
const mx = (lng) => (lng + 180) / 360;
const my = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const invX = (x) => x * 360 - 180;
const invY = (y) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * y)));

// mercator projector, aspect-corrected to W/H. Returns a bbox for the Mapbox
// static request AND a projector that lines pins up with that image.
export function mercatorProjector(coords) {
  const b = fitBox(coords);
  let xL = mx(b.minLng), xR = mx(b.maxLng);
  let yT = my(b.maxLat), yB = my(b.minLat);
  let mw = xR - xL, mh = yB - yT;
  const target = MAP_W / MAP_H;
  if (mw / mh < target) { const want = mh * target, cx = (xL + xR) / 2; xL = cx - want / 2; xR = cx + want / 2; }
  else { const want = mw / target, cy = (yT + yB) / 2; yT = cy - want / 2; yB = cy + want / 2; }
  const bbox = [invX(xL), invY(yB), invX(xR), invY(yT)]; // [minLng,minLat,maxLng,maxLat]
  const xPct = (lng) => (mx(lng) - xL) / (xR - xL);
  const yPct = (lat) => (my(lat) - yT) / (yB - yT);
  return { bbox, xPct, yPct };
}
