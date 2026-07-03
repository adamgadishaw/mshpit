// Mock data for the prototype. No backend - this stands in for what would come
// from the Performance / Artist / Venue spine described in the brief.
import { catalogShows } from "./seed/catalog";

let _id = 100;
export const newId = () => `log_${_id++}`;

export const seedFeed = [
  {
    id: "log_1",
    userId: "u_mara",
    user: { name: "Mara Quinn", handle: "maraq", initials: "MQ" },
    timeAgo: "2h",
    artist: "Turnstile",
    genre: "Hardcore",
    venue: "The Fillmore",
    city: "San Francisco, CA",
    date: "2026 · 06 · 21",
    media: 3,
    overall: 4.5,
    band: 4.8, // performance / setlist / energy
    room: 3.2, // sound / venue / crowd
    dims: { performance: 5, setlist: 4.5, sound: 3, venue: 3.5, crowd: 5, experience: 4.5 },
    review:
      "Floor was absolute chaos in the best way. They opened with HEALING and never let up. Sound got muddy in the back but who cares.",
    setlist: [
      "Mystery",
      "HEALING",
      "Holiday",
      "Underwater Boi",
      "Don't Play",
      "T.L.C. (Turnstile Love Connection)",
      "Blackout",
    ],
    likes: 42,
    comments: 6,
    inTourWindow: true, // auto-spoiler
  },
  {
    id: "log_2",
    userId: "u_devon",
    user: { name: "Devon Ash", handle: "dash", initials: "DA" },
    timeAgo: "5h",
    artist: "Japanese Breakfast",
    genre: "Indie",
    venue: "Brooklyn Steel",
    city: "Brooklyn, NY",
    date: "2026 · 06 · 20",
    media: 1,
    overall: 5,
    band: 5,
    room: 4.4,
    dims: { performance: 5, setlist: 5, sound: 4.5, venue: 4.5, crowd: 4, experience: 5 },
    review:
      "Michelle conducting the gong on Paprika is something everyone should see once. Room sounded gorgeous.",
    setlist: ["Paprika", "Be Sweet", "Slide Tackle", "Boyish", "Posing in Bondage", "Diving Woman"],
    likes: 88,
    comments: 12,
    inTourWindow: false,
  },
  {
    id: "log_3",
    userId: "u_priya",
    user: { name: "Priya N.", handle: "priyalive", initials: "PN" },
    timeAgo: "1d",
    artist: "King Gizzard & the Lizard Wizard",
    genre: "Psych Rock",
    venue: "Red Rocks Amphitheatre",
    city: "Morrison, CO",
    date: "2026 · 06 · 18",
    media: 5,
    overall: 4.0,
    band: 4.6,
    room: 5,
    dims: { performance: 4.5, setlist: 4.5, sound: 5, venue: 5, crowd: 4, experience: 4 },
    review:
      "Three-hour marathon set, no setlist repeats. Red Rocks at sunset behind a wall of riffs - unreal venue, slightly self-indulgent jams.",
    setlist: ["Rattlesnake", "Robot Stop", "The River", "Crumbling Castle", "Head On/Pill"],
    likes: 156,
    comments: 23,
    inTourWindow: true,
  },
];

// --- "Best rated near you" -------------------------------------------------
// Known cities for the location field (stands in for real geocoding).
export const cities = {
  "San Francisco": { lat: 37.7749, lng: -122.4194 },
  Oakland: { lat: 37.8044, lng: -122.2712 },
  "Los Angeles": { lat: 34.0522, lng: -118.2437 },
  Portland: { lat: 45.5152, lng: -122.6784 },
  Seattle: { lat: 47.6062, lng: -122.3321 },
  Denver: { lat: 39.7392, lng: -104.9903 },
};

// Aggregated shows (one artist + venue + date), with how many people rated them.
// Base seed + the ingested catalog (see src/seed/catalog.js).
const baseRatedShows = [
  { id: "rs1", artist: "Turnstile", genre: "Hardcore", venue: "The Fillmore", city: "San Francisco", lat: 37.7840, lng: -122.4330, rating: 4.7, reviews: 212, band: 4.8, room: 4.0, setlist: ["Mystery", "HEALING", "Blackout"] },
  { id: "rs2", artist: "Geese", genre: "Indie", venue: "The Independent", city: "San Francisco", lat: 37.7765, lng: -122.4376, rating: 4.9, reviews: 38, band: 4.9, room: 4.6, setlist: ["3D Country", "Cowboy Nudes", "Doghouse"] },
  { id: "rs3", artist: "Wednesday", genre: "Alt-Country", venue: "Great American Music Hall", city: "San Francisco", lat: 37.7855, lng: -122.4180, rating: 4.4, reviews: 91, band: 4.4, room: 4.7, setlist: ["Bull Believer", "Chosen to Deserve"] },
  { id: "rs4", artist: "boygenius", genre: "Indie", venue: "Fox Theater", city: "Oakland", lat: 37.8083, lng: -122.2690, rating: 4.8, reviews: 340, band: 4.9, room: 4.3, setlist: ["$20", "Not Strong Enough", "Cool About It"] },
  { id: "rs5", artist: "Militarie Gun", genre: "Hardcore", venue: "Bottom of the Hill", city: "San Francisco", lat: 37.7600, lng: -122.3950, rating: 4.5, reviews: 27, band: 4.6, room: 3.6, setlist: ["Do It Faster", "Very High"] },
  { id: "rs6", artist: "King Gizzard", genre: "Psych Rock", venue: "Hollywood Bowl", city: "Los Angeles", lat: 34.1122, lng: -118.3390, rating: 4.6, reviews: 410, band: 4.7, room: 5.0, setlist: ["Rattlesnake", "The River"] },
  { id: "rs7", artist: "Japanese Breakfast", genre: "Indie", venue: "Roseland Theater", city: "Portland", lat: 45.5260, lng: -122.6760, rating: 4.9, reviews: 64, band: 5.0, room: 4.4, setlist: ["Paprika", "Be Sweet"] },
  { id: "rs8", artist: "Snail Mail", genre: "Indie", venue: "Crocodile", city: "Seattle", lat: 47.6130, lng: -122.3430, rating: 4.2, reviews: 19, band: 4.3, room: 4.1, setlist: ["Pristine", "Valentine"] },
];

export const ratedShows = [...baseRatedShows, ...catalogShows];

export const GENRES = ["Hardcore", "Indie", "Psych Rock", "Alt-Country", "Punk", "Shoegaze", "Metal", "Electronic", "Hip-Hop", "Jazz"];

// --- Deeper, multi-factor ratings ------------------------------------------
// Six factors, grouped band / room / night. Overall is a weighted blend so the
// score reflects what actually matters most (the performance & the experience),
// not a flat average that lets a so-so venue drag a great show down.
export const RATING_DIMS = [
  { key: "performance", label: "Performance", group: "THE BAND" },
  { key: "setlist", label: "Setlist", group: "THE BAND" },
  { key: "sound", label: "Sound", group: "THE ROOM" },
  { key: "venue", label: "Venue & views", group: "THE ROOM" },
  { key: "crowd", label: "Crowd & energy", group: "THE NIGHT" },
  { key: "experience", label: "Overall experience", group: "THE NIGHT" },
];
const WEIGHTS = { performance: 1.6, setlist: 1, sound: 1, venue: 0.8, crowd: 1, experience: 1.4 };

const avg = (arr) => { const v = arr.filter((n) => n > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };

export function computeReview(dims = {}) {
  let s = 0, w = 0;
  for (const k in WEIGHTS) if (dims[k] > 0) { s += dims[k] * WEIGHTS[k]; w += WEIGHTS[k]; }
  return {
    overall: w ? Math.round((s / w) * 10) / 10 : 0,
    band: Math.round(avg([dims.performance, dims.setlist]) * 10) / 10,
    room: Math.round(avg([dims.sound, dims.venue, dims.crowd]) * 10) / 10,
  };
}

function haversine(a, b, R) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const haversineMi = (a, b) => haversine(a, b, 3958.8);
export const haversineKm = (a, b) => haversine(a, b, 6371);

// Coordinates for the cities in geo.js that have venues - stands in for real
// geocoding (the signup city picker resolves to these). Expand with the catalog.
// Coordinates for the major US + Canada cities in geo.js (stands in for real
// geocoding; the ingest fills exact venue coords from Ticketmaster).
export const cityCoords = {
  // - United States —
  Birmingham: { lat: 33.5186, lng: -86.8104 }, Montgomery: { lat: 32.3668, lng: -86.3 }, Huntsville: { lat: 34.7304, lng: -86.5861 }, Mobile: { lat: 30.6954, lng: -88.0399 },
  Anchorage: { lat: 61.2181, lng: -149.9003 }, Fairbanks: { lat: 64.8378, lng: -147.7164 }, Juneau: { lat: 58.3019, lng: -134.4197 },
  Phoenix: { lat: 33.4484, lng: -112.074 }, Tucson: { lat: 32.2226, lng: -110.9747 }, Tempe: { lat: 33.4255, lng: -111.94 }, Mesa: { lat: 33.4152, lng: -111.8315 }, Flagstaff: { lat: 35.1983, lng: -111.6513 },
  "Little Rock": { lat: 34.7465, lng: -92.2896 }, Fayetteville: { lat: 36.0626, lng: -94.1574 },
  "Los Angeles": { lat: 34.0522, lng: -118.2437 }, "San Francisco": { lat: 37.7749, lng: -122.4194 }, "San Diego": { lat: 32.7157, lng: -117.1611 }, Oakland: { lat: 37.8044, lng: -122.2712 }, Sacramento: { lat: 38.5816, lng: -121.4944 }, "San Jose": { lat: 37.3382, lng: -121.8863 }, "Long Beach": { lat: 33.7701, lng: -118.1937 }, Fresno: { lat: 36.7378, lng: -119.7871 },
  Denver: { lat: 39.7392, lng: -104.9903 }, "Colorado Springs": { lat: 38.8339, lng: -104.8214 }, Boulder: { lat: 40.015, lng: -105.2705 }, Morrison: { lat: 39.6536, lng: -105.1942 }, "Fort Collins": { lat: 40.5853, lng: -105.0844 },
  Hartford: { lat: 41.7658, lng: -72.6734 }, "New Haven": { lat: 41.3083, lng: -72.9279 }, Bridgeport: { lat: 41.1865, lng: -73.1952 },
  Wilmington: { lat: 39.7391, lng: -75.5398 }, Dover: { lat: 39.1582, lng: -75.5244 },
  Washington: { lat: 38.9072, lng: -77.0369 },
  Miami: { lat: 25.7617, lng: -80.1918 }, Orlando: { lat: 28.5383, lng: -81.3792 }, Tampa: { lat: 27.9506, lng: -82.4572 }, Jacksonville: { lat: 30.3322, lng: -81.6557 }, Tallahassee: { lat: 30.4383, lng: -84.2807 }, "St. Petersburg": { lat: 27.7676, lng: -82.6403 },
  Atlanta: { lat: 33.749, lng: -84.388 }, Savannah: { lat: 32.0809, lng: -81.0912 }, Athens: { lat: 33.9519, lng: -83.3576 },
  Honolulu: { lat: 21.3069, lng: -157.8583 },
  Boise: { lat: 43.615, lng: -116.2023 },
  Chicago: { lat: 41.8781, lng: -87.6298 }, Springfield: { lat: 39.7817, lng: -89.6501 },
  Indianapolis: { lat: 39.7684, lng: -86.1581 }, Bloomington: { lat: 39.1653, lng: -86.5264 },
  "Des Moines": { lat: 41.5868, lng: -93.625 }, "Iowa City": { lat: 41.6611, lng: -91.5302 },
  Wichita: { lat: 37.6872, lng: -97.3301 }, "Kansas City": { lat: 39.0997, lng: -94.5786 }, Lawrence: { lat: 38.9717, lng: -95.2353 },
  Louisville: { lat: 38.2527, lng: -85.7585 }, Lexington: { lat: 38.0406, lng: -84.5037 },
  "New Orleans": { lat: 29.9511, lng: -90.0715 }, "Baton Rouge": { lat: 30.4515, lng: -91.1871 },
  Portland: { lat: 45.5152, lng: -122.6784 }, Bangor: { lat: 44.8012, lng: -68.7778 },
  Baltimore: { lat: 39.2904, lng: -76.6122 }, Annapolis: { lat: 38.9784, lng: -76.4922 },
  Boston: { lat: 42.3601, lng: -71.0589 }, Cambridge: { lat: 42.3736, lng: -71.1097 }, Worcester: { lat: 42.2626, lng: -71.8023 },
  Detroit: { lat: 42.3314, lng: -83.0458 }, "Grand Rapids": { lat: 42.9634, lng: -85.6681 }, "Ann Arbor": { lat: 42.2808, lng: -83.743 },
  Minneapolis: { lat: 44.9778, lng: -93.265 }, "St. Paul": { lat: 44.9537, lng: -93.09 }, Duluth: { lat: 46.7867, lng: -92.1005 },
  Jackson: { lat: 32.2988, lng: -90.1848 },
  "St. Louis": { lat: 38.627, lng: -90.1994 }, Columbia: { lat: 38.9517, lng: -92.3341 },
  Billings: { lat: 45.7833, lng: -108.5007 }, Missoula: { lat: 46.8721, lng: -113.994 }, Bozeman: { lat: 45.6793, lng: -111.0373 },
  Omaha: { lat: 41.2565, lng: -95.9345 }, Lincoln: { lat: 40.8136, lng: -96.7026 },
  "Las Vegas": { lat: 36.1699, lng: -115.1398 }, Reno: { lat: 39.5296, lng: -119.8138 },
  Manchester: { lat: 42.9956, lng: -71.4548 },
  Newark: { lat: 40.7357, lng: -74.1724 }, "Jersey City": { lat: 40.7178, lng: -74.0431 }, "Atlantic City": { lat: 39.3643, lng: -74.4229 }, "Asbury Park": { lat: 40.2204, lng: -74.0121 },
  Albuquerque: { lat: 35.0844, lng: -106.6504 }, "Santa Fe": { lat: 35.687, lng: -105.9378 },
  "New York City": { lat: 40.7128, lng: -74.006 }, Brooklyn: { lat: 40.6782, lng: -73.9442 }, Buffalo: { lat: 42.8864, lng: -78.8784 }, Rochester: { lat: 43.1566, lng: -77.6088 }, Albany: { lat: 42.6526, lng: -73.7562 }, Syracuse: { lat: 43.0481, lng: -76.1474 },
  Charlotte: { lat: 35.2271, lng: -80.8431 }, Raleigh: { lat: 35.7796, lng: -78.6382 }, Durham: { lat: 35.994, lng: -78.8986 }, Asheville: { lat: 35.5951, lng: -82.5515 }, Greensboro: { lat: 36.0726, lng: -79.792 },
  Fargo: { lat: 46.8772, lng: -96.7898 },
  Columbus: { lat: 39.9612, lng: -82.9988 }, Cleveland: { lat: 41.4993, lng: -81.6944 }, Cincinnati: { lat: 39.1031, lng: -84.512 }, Dayton: { lat: 39.7589, lng: -84.1916 },
  "Oklahoma City": { lat: 35.4676, lng: -97.5164 }, Tulsa: { lat: 36.154, lng: -95.9928 },
  Eugene: { lat: 44.0521, lng: -123.0868 }, Bend: { lat: 44.0582, lng: -121.3153 },
  Philadelphia: { lat: 39.9526, lng: -75.1652 }, Pittsburgh: { lat: 40.4406, lng: -79.9959 }, Harrisburg: { lat: 40.2732, lng: -76.8867 },
  Providence: { lat: 41.824, lng: -71.4128 },
  Charleston: { lat: 32.7765, lng: -79.9311 }, Greenville: { lat: 34.8526, lng: -82.394 },
  "Sioux Falls": { lat: 43.5446, lng: -96.7311 },
  Nashville: { lat: 36.1627, lng: -86.7816 }, Memphis: { lat: 35.1495, lng: -90.049 }, Knoxville: { lat: 35.9606, lng: -83.9207 }, Chattanooga: { lat: 35.0456, lng: -85.3097 },
  Austin: { lat: 30.2672, lng: -97.7431 }, Dallas: { lat: 32.7767, lng: -96.797 }, Houston: { lat: 29.7604, lng: -95.3698 }, "San Antonio": { lat: 29.4241, lng: -98.4936 }, "Fort Worth": { lat: 32.7555, lng: -97.3308 }, "El Paso": { lat: 31.7619, lng: -106.485 },
  "Salt Lake City": { lat: 40.7608, lng: -111.891 }, Provo: { lat: 40.2338, lng: -111.6585 },
  Burlington: { lat: 44.4759, lng: -73.2121 },
  Richmond: { lat: 37.5407, lng: -77.436 }, "Virginia Beach": { lat: 36.8529, lng: -75.978 }, Norfolk: { lat: 36.8508, lng: -76.2859 }, Charlottesville: { lat: 38.0293, lng: -78.4767 },
  Seattle: { lat: 47.6062, lng: -122.3321 }, Tacoma: { lat: 47.2529, lng: -122.4443 }, Spokane: { lat: 47.6588, lng: -117.426 },
  Morgantown: { lat: 39.6295, lng: -79.9559 },
  Milwaukee: { lat: 43.0389, lng: -87.9065 }, Madison: { lat: 43.0731, lng: -89.4012 }, "Green Bay": { lat: 44.5133, lng: -88.0133 },
  Cheyenne: { lat: 41.14, lng: -104.8202 }, Jackson: { lat: 43.4799, lng: -110.7624 },
  // - Canada —
  Calgary: { lat: 51.0447, lng: -114.0719 }, Edmonton: { lat: 53.5461, lng: -113.4938 }, Banff: { lat: 51.1784, lng: -115.5708 },
  Vancouver: { lat: 49.2827, lng: -123.1207 }, Victoria: { lat: 48.4284, lng: -123.3656 }, Kelowna: { lat: 49.888, lng: -119.496 },
  Winnipeg: { lat: 49.8951, lng: -97.1384 },
  Moncton: { lat: 46.0878, lng: -64.7782 }, Fredericton: { lat: 45.9636, lng: -66.6431 }, "Saint John": { lat: 45.2733, lng: -66.0633 },
  "St. John's": { lat: 47.5615, lng: -52.7126 },
  Yellowknife: { lat: 62.454, lng: -114.3718 },
  Halifax: { lat: 44.6488, lng: -63.5752 },
  Iqaluit: { lat: 63.7467, lng: -68.517 },
  Toronto: { lat: 43.6532, lng: -79.3832 }, Ottawa: { lat: 45.4215, lng: -75.6972 }, Hamilton: { lat: 43.2557, lng: -79.8711 }, London: { lat: 42.9849, lng: -81.2453 }, Kingston: { lat: 44.2312, lng: -76.486 }, Windsor: { lat: 42.3149, lng: -83.0364 },
  Mississauga: { lat: 43.589, lng: -79.6441 }, Kitchener: { lat: 43.4516, lng: -80.4925 }, Guelph: { lat: 43.5448, lng: -80.2482 }, "Thunder Bay": { lat: 48.3809, lng: -89.2477 }, Sudbury: { lat: 46.4917, lng: -80.993 },
  Charlottetown: { lat: 46.2382, lng: -63.1311 },
  Montreal: { lat: 45.5019, lng: -73.5674 }, "Quebec City": { lat: 46.8139, lng: -71.208 }, Gatineau: { lat: 45.4765, lng: -75.7013 }, Laval: { lat: 45.6066, lng: -73.7124 }, Sherbrooke: { lat: 45.4042, lng: -71.8929 },
  Saskatoon: { lat: 52.1332, lng: -106.67 }, Regina: { lat: 50.4452, lng: -104.6189 },
  Whitehorse: { lat: 60.7212, lng: -135.0568 },
};

// Rank = rating quality (Bayesian-weighted by # of reviews) × proximity.
export function rankShows(origin) {
  const C = 4.3; // global mean rating (prior)
  const m = 30; // reviews needed to trust a show's own average
  return ratedShows
    .map((s) => {
      const bayes = (s.reviews / (s.reviews + m)) * s.rating + (m / (s.reviews + m)) * C;
      const distance = haversineMi(origin, { lat: s.lat, lng: s.lng });
      const proximity = 1 / (1 + distance / 25); // 25mi half-weight
      return { ...s, distance, bayes, score: bayes * proximity };
    })
    .sort((a, b) => b.score - a.score);
}

export const tasteMatches = [
  { artist: "Geese", reason: "3 people you follow rated this 5★", near: "Aug 14 · The Independent", band: 4.7 },
  { artist: "Wednesday", reason: "Matches your alt-country logs", near: "Sep 02 · Great American", band: 4.4 },
  { artist: "Militarie Gun", reason: "Trending in your scene", near: "Jul 28 · Bottom of the Hill", band: 4.5 },
];
