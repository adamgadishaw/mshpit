// Mock data for the prototype. No backend - this stands in for what would come
// from the Performance / Artist / Venue spine described in the brief.
import { ENABLE_DEMO_DATA } from "./config/runtime.mjs";

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
    photos: [
      "https://upload.wikimedia.org/wikipedia/commons/3/3e/The_Fillmore.jpg",
      "https://live.staticflickr.com/8070/29219848934_a5ff3b64da_b.jpg",
      "https://live.staticflickr.com/111/256049291_abaab71b2b.jpg",
    ],
    photosPublic: true,
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
// The small hand-authored fixture is synchronous. The larger generated demo
// catalogue is installed after a development-only dynamic import so production
// does not parse it before the first screen can render.
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

// These aggregates are prototype fixtures, not verified community reviews.
// Production rankings are built from server posts only. Keep one exported array
// identity because legacy screen helpers import it directly; installing demo
// rows in place lets those helpers observe the lazy catalogue on their next
// render without pulling the JSON into the entry module.
export const ratedShows = ENABLE_DEMO_DATA ? [...baseRatedShows] : [];
export function installDemoCatalogShows(shows) {
  if (!ENABLE_DEMO_DATA) return;
  const merged = new Map(baseRatedShows.map((show) => [show.id, show]));
  for (const show of Array.isArray(shows) ? shows : []) {
    if (show?.id) merged.set(show.id, show);
  }
  ratedShows.splice(0, ratedShows.length, ...merged.values());
}

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

export const tasteMatches = ENABLE_DEMO_DATA ? [
  { artist: "Geese", reason: "3 people you follow rated this 5★", near: "Aug 14 · The Independent", band: 4.7 },
  { artist: "Wednesday", reason: "Matches your alt-country logs", near: "Sep 02 · Great American", band: 4.4 },
  { artist: "Militarie Gun", reason: "Trending in your scene", near: "Jul 28 · Bottom of the Hill", band: 4.5 },
] : [];
