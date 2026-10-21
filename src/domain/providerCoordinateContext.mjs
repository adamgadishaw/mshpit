import { mapCoordinate } from "./mapCoordinates.mjs";

// Coarse contradiction screening, not venue verification or a border test.
// Bounds below are per-ring bounding boxes derived from the existing contextual
// Natural Earth snapshot. No large geometry import enters the map bundle.
export const PROVIDER_COORDINATE_CONTEXT_SOURCE = Object.freeze({
  sourceUrl: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
  sourceSha256: "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f",
  snapshotPath: "src/features/concertHistory/worldGeography.json",
  snapshotSha256: "ecdbd27e63a59544af9ee83ca86cbe163c1585de78a3bda1d8de46495cc37dc7",
  license: "Public domain",
  licenseUrl: "https://www.naturalearthdata.com/about/terms-of-use/",
  paddingDegrees: 2,
});

// [west, south, east, north], rounded to the source snapshot's 0.001 degree.
// These constants are checked against the source geometry in the Node tests.
export const PROVIDER_COUNTRY_RING_BOUNDS = Object.freeze(Object.fromEntries(Object.entries({
  US: [
    [-124.687, 25.080, -66.965, 49.389], [-156.073, 18.916, -154.807, 20.267],
    [-156.711, 20.572, -155.996, 21.012], [-157.325, 21.069, -156.758, 21.220],
    [-158.293, 21.264, -157.653, 21.717], [-159.801, 21.883, -159.345, 22.236],
    [-167.455, 59.754, -165.579, 60.384], [-154.671, 56.735, -152.141, 57.969],
    [-168.111, 54.404, -129.980, 71.358], [-171.791, 62.977, -168.689, 63.783],
  ],
  CA: [
    [-140.998, 41.675, -55.683, 71.921], [-83.994, 62.159, -81.877, 62.914],
    [-80.876, 72.742, -76.251, 73.760], [-80.362, 61.633, -79.266, 62.386],
    [-96.821, 74.592, -93.613, 75.647], [-96.436, 77.491, -93.721, 77.835],
    [-98.632, 77.851, -95.559, 78.872], [-97.121, 74.392, -79.834, 77.161],
    [-113.534, 77.409, -109.854, 78.153], [-112.542, 78.407, -109.663, 78.850],
    [-59.419, 46.618, -52.648, 51.632], [-87.222, 63.052, -80.103, 65.739],
    [-90.205, 61.931, -61.852, 73.804], [-96.034, 72.025, -90.510, 74.135],
    [-122.855, 75.900, -116.199, 77.645], [-133.240, 52.180, -131.179, 54.170],
    [-105.492, 77.908, -99.671, 79.302], [-128.445, 48.371, -123.510, 50.771],
    [-125.929, 70.902, -115.511, 74.449], [-117.710, 74.394, -105.705, 76.794],
    [-119.402, 68.536, -100.981, 73.315], [-102.500, 71.273, -96.540, 73.844],
    [-106.940, 72.760, -104.500, 73.640], [-102.566, 74.897, -97.704, 76.720],
    [-96.710, 78.215, -85.814, 81.257], [-91.587, 76.178, -61.850, 83.233],
    [-77.236, 67.099, -75.103, 68.287], [-99.797, 68.757, -95.648, 70.144],
    [-64.519, 49.087, -61.806, 49.957], [-64.393, 45.968, -62.012, 47.036],
  ],
  PL: [[14.075, 49.027, 24.030, 54.852]],
  NZ: [[172.636, -41.688, 178.517, -34.451], [166.509, -46.641, 174.249, -40.494]],
  MX: [[-117.128, 14.539, -86.812, 32.721]],
}).map(([code, boxes]) => [code, Object.freeze(boxes.map((box) => Object.freeze(box)))])));

const normalized = (value) => typeof value === "string"
  ? value.trim().normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en").replace(/\s+/gu, " ") : "";
const regionTable = (pairs) => Object.fromEntries(pairs.split("|").flatMap((pair) => {
  const [code, name] = pair.split(":");
  return [[normalized(code), code], [normalized(name), code]];
}));
const regions = {
  US: regionTable("AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming"),
  CA: regionTable("ON:Ontario|QC:Quebec|BC:British Columbia|AB:Alberta|SK:Saskatchewan|MB:Manitoba|NS:Nova Scotia|NB:New Brunswick|NL:Newfoundland and Labrador|PE:Prince Edward Island|YT:Yukon|NT:Northwest Territories|NU:Nunavut"),
};
const names = {
  US: new Set(["us", "usa", "united states", "united states of america"]),
  CA: new Set(["ca", "can", "canada"]), PL: new Set(["pl", "pol", "poland"]),
  NZ: new Set(["nz", "nzl", "new zealand"]), MX: new Set(["mx", "mex", "mexico"]),
};
const padding = PROVIDER_COORDINATE_CONTEXT_SOURCE.paddingDegrees;
const insideBox = ({ lat, lng }, [west, south, east, north]) =>
  lat >= south - padding && lat <= north + padding && lng >= west - padding && lng <= east + padding;
const latitudeRange = (boxes) => [Math.min(...boxes.map((box) => box[1])) - padding, Math.max(...boxes.map((box) => box[3])) + padding];

/**
 * Returns an identified coarse country contradiction, never a repaired point.
 * null means no supported contradiction was found; it does not validate the
 * number, identity, provenance, locality, coast, state, or actual venue position.
 * The caller must apply its existing numeric/source/locality gates separately.
 */
export function providerCoordinateContextIssue(row, coordinate = row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const point = mapCoordinate(coordinate);
  const countryCode = typeof row.venueCountryCode === "string" ? row.venueCountryCode.trim().toUpperCase() : "";
  const boxes = PROVIDER_COUNTRY_RING_BOUNDS[countryCode];
  if (!point || !boxes || !names[countryCode].has(normalized(row.venueCountry))) return null;
  const regionKey = normalized(row.venueRegion).replace(/\.$/u, "");
  const regionCode = Object.hasOwn(regions[countryCode] || {}, regionKey) ? regions[countryCode][regionKey] : undefined;
  // The coarse source omits many US territories. Do not apply US/CA screening
  // unless the source identifies a known state or province/territory explicitly.
  if (regions[countryCode] && !regionCode) return null;
  let contradiction;
  if (countryCode === "US" && ["AK", "HI"].includes(regionCode)) {
    // The 110m snapshot omits western Aleutian and northwestern Hawaiian islands.
    // Its longitude boxes cannot exclude these states' points safely. Keep only
    // the broad US latitude envelope, still catching an opposite hemisphere.
    const [south, north] = latitudeRange(boxes);
    contradiction = point.lat < south || point.lat > north;
  } else if (countryCode === "NZ") {
    // Chatham, Kermadec and subantarctic islands are missing at this scale.
    // Screen only the opposite hemisphere, with the same generous padding;
    // the mainland's northern extent cannot exclude outlying islands safely.
    contradiction = point.lat > padding;
  } else {
    contradiction = !boxes.some((box) => insideBox(point, box));
  }
  return contradiction ? Object.freeze({ reason: "provider-coordinate-country-context", countryCode, ...(regionCode ? { regionCode } : {}) }) : null;
}
