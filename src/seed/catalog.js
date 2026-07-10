// Seed catalog - legally sourceable data only (venue facts, tour dates, setlists
// are factual / open-licensed; NOT copyrighted photos). This file is what
// `scripts/ingest.mjs` regenerates and extends from MusicBrainz / Setlist.fm /
// Ticketmaster Discovery / Wikidata. `photo` is filled by the ingest run from
// Wikimedia Commons (P18) with attribution - null until then, and the UI falls
// back to a drawn banner so nothing ever looks empty.

import generated from "./catalog.generated.json";
import { arenaVenues } from "./arenas";

// Hand-curated anchors (capacities etc.) - merged with the live-scraped catalog
// at the bottom of this file so curated data wins on conflicts.
const baseVenues = {
  "the fillmore": { name: "The Fillmore", place: "San Francisco, California, United States", capacity: 1150, lat: 37.784, lng: -122.433, photo: null, photoCredit: null },
  "brooklyn steel": { name: "Brooklyn Steel", place: "Brooklyn, New York, United States", capacity: 1800, lat: 40.7081, lng: -73.9571, photo: null, photoCredit: null },
  "red rocks amphitheatre": { name: "Red Rocks Amphitheatre", place: "Morrison, Colorado, United States", capacity: 9525, lat: 39.6655, lng: -105.2057, photo: null, photoCredit: null },
  "the greek theatre": { name: "The Greek Theatre", place: "Los Angeles, California, United States", capacity: 5900, lat: 34.118, lng: -118.297, photo: null, photoCredit: null },
  "madison square garden": { name: "Madison Square Garden", place: "New York City, New York, United States", capacity: 20000, lat: 40.7505, lng: -73.9934, photo: null, photoCredit: null },
  "the independent": { name: "The Independent", place: "San Francisco, California, United States", capacity: 500, lat: 37.7765, lng: -122.4376, photo: null, photoCredit: null },
  "great american music hall": { name: "Great American Music Hall", place: "San Francisco, California, United States", capacity: 600, lat: 37.7855, lng: -122.418, photo: null, photoCredit: null },
  "fox theater": { name: "Fox Theater", place: "Oakland, California, United States", capacity: 2800, lat: 37.8083, lng: -122.269, photo: null, photoCredit: null },
  "9:30 club": { name: "9:30 Club", place: "Washington, D.C., United States", capacity: 1200, lat: 38.9179, lng: -77.0238, photo: null, photoCredit: null },
  "first avenue": { name: "First Avenue", place: "Minneapolis, Minnesota, United States", capacity: 1550, lat: 44.9785, lng: -93.2762, photo: null, photoCredit: null },
  "the troubadour": { name: "The Troubadour", place: "Los Angeles, California, United States", capacity: 500, lat: 34.0817, lng: -118.3892, photo: null, photoCredit: null },
  "the showbox": { name: "The Showbox", place: "Seattle, Washington, United States", capacity: 1150, lat: 47.6086, lng: -122.3389, photo: null, photoCredit: null },
  "bottom of the hill": { name: "Bottom of the Hill", place: "San Francisco, California, United States", capacity: 350, lat: 37.76, lng: -122.395, photo: null, photoCredit: null },
};

// Community-aggregated shows (ratedShows shape). Coordinates approximate.
const baseShows = [
  { id: "cs1", artist: "IDLES", genre: "Punk", venue: "The Fillmore", city: "San Francisco", lat: 37.784, lng: -122.433, rating: 4.8, reviews: 174, band: 4.9, room: 4.0, setlist: ["Colossus", "Mr. Motivator", "Danny Nedelko"] },
  { id: "cs2", artist: "Mitski", genre: "Indie", venue: "The Greek Theatre", city: "Los Angeles", lat: 34.118, lng: -118.297, rating: 4.7, reviews: 388, band: 4.8, room: 4.6, setlist: ["Working for the Knife", "Nobody", "Your Best American Girl"] },
  { id: "cs3", artist: "Phoebe Bridgers", genre: "Indie", venue: "Madison Square Garden", city: "New York City", lat: 40.7505, lng: -73.9934, rating: 4.6, reviews: 902, band: 4.7, room: 4.2, setlist: ["Motion Sickness", "Kyoto", "I Know the End"] },
  { id: "cs4", artist: "Black Midi", genre: "Experimental", venue: "First Avenue", city: "Minneapolis", lat: 44.9785, lng: -93.2762, rating: 4.4, reviews: 56, band: 4.6, room: 4.3, setlist: ["953", "Sugar/Tzu", "Welcome to Hell"] },
  { id: "cs5", artist: "Khruangbin", genre: "Psych Rock", venue: "Red Rocks Amphitheatre", city: "Morrison", lat: 39.6655, lng: -105.2057, rating: 4.9, reviews: 511, band: 4.8, room: 5.0, setlist: ["August 10", "Time (You and I)", "White Gloves"] },
  { id: "cs6", artist: "Fontaines D.C.", genre: "Punk", venue: "9:30 Club", city: "Washington", lat: 38.9179, lng: -77.0238, rating: 4.5, reviews: 88, band: 4.6, room: 4.4, setlist: ["Starburster", "Boys in the Better Land", "I Love You"] },
  { id: "cs7", artist: "Big Thief", genre: "Indie", venue: "The Showbox", city: "Seattle", lat: 47.6086, lng: -122.3389, rating: 4.7, reviews: 132, band: 4.8, room: 4.1, setlist: ["Simulation Swarm", "Not", "Change"] },
  { id: "cs8", artist: "Beach House", genre: "Shoegaze", venue: "Fox Theater", city: "Oakland", lat: 37.8083, lng: -122.269, rating: 4.6, reviews: 207, band: 4.6, room: 4.3, setlist: ["Levitation", "Space Song", "Myth"] },
];

const DAY = 86400000;
const RELEASED = Date.now() - DAY;
const tm = (a) => `https://www.ticketmaster.com/search?q=${encodeURIComponent(a)}`;

// Upcoming tour dates (tourDates shape). createdBy "import" marks ingested rows.
// `soldOut` comes from Ticketmaster Discovery status (offsale/soldout) on ingest.
const baseTourDates = [
  { id: "ct1", artist: "IDLES", venue: "The Fillmore", place: "San Francisco, California, United States", date: "2026 · 09 · 18", ticketUrl: tm("IDLES"), releaseAt: RELEASED, createdBy: "import", soldOut: false },
  { id: "ct2", artist: "Mitski", venue: "The Greek Theatre", place: "Los Angeles, California, United States", date: "2026 · 10 · 04", ticketUrl: tm("Mitski"), releaseAt: RELEASED, createdBy: "import", soldOut: true },
  { id: "ct3", artist: "Khruangbin", venue: "Red Rocks Amphitheatre", place: "Morrison, Colorado, United States", date: "2026 · 08 · 29", ticketUrl: tm("Khruangbin"), releaseAt: RELEASED, createdBy: "import", soldOut: true },
  { id: "ct4", artist: "Big Thief", venue: "The Showbox", place: "Seattle, Washington, United States", date: "2026 · 11 · 12", ticketUrl: tm("Big Thief"), releaseAt: RELEASED, createdBy: "import", soldOut: false },
  { id: "ct5", artist: "Fontaines D.C.", venue: "9:30 Club", place: "Washington, D.C., United States", date: "2026 · 09 · 30", ticketUrl: tm("Fontaines D.C."), releaseAt: RELEASED, createdBy: "import", soldOut: false },
  { id: "ct6", artist: "Beach House", venue: "Fox Theater", place: "Oakland, California, United States", date: "2026 · 10 · 22", ticketUrl: tm("Beach House"), releaseAt: RELEASED, createdBy: "import", soldOut: false },
  { id: "ct7", artist: "Geese", venue: "The Independent", place: "San Francisco, California, United States", date: "2026 · 08 · 26", ticketUrl: tm("Geese"), releaseAt: RELEASED, createdBy: "import", soldOut: true },
  { id: "ct8", artist: "Militarie Gun", venue: "Bottom of the Hill", place: "San Francisco, California, United States", date: "2026 · 07 · 28", ticketUrl: tm("Militarie Gun"), releaseAt: RELEASED, createdBy: "import", soldOut: false },
];

// --- Merge live-scraped catalog (scripts/ingest-venues.mjs) -----------------
// Curated anchors win on conflicts; everything else is the real scraped data:
// 400+ venues with real coords across US/Canada + generated upcoming concerts.
export const catalogVenues = (() => {
  const out = { ...(generated.venues || {}) };
  // Curated anchors win on conflicts: hand-verified capacities/coords + the major
  // arenas & stadiums MusicBrainz files under non-"Venue" types.
  const anchors = { ...arenaVenues, ...baseVenues };
  for (const k in anchors) {
    const gen = out[k] || {};
    const a = anchors[k];
    // Anchors win on FACTS (name/place/coords/capacity); photos always come from
    // whichever side actually has them, a curated `photo: null` must never
    // blank out a scraped gallery (that bug hid the arena photos once already).
    out[k] = {
      ...gen,
      name: a.name,
      place: a.place ?? gen.place,
      lat: a.lat ?? gen.lat,
      lng: a.lng ?? gen.lng,
      capacity: a.capacity ?? gen.capacity ?? null,
      major: a.major || gen.major || false,
      photo: a.photo || gen.photo || null,
      photoCredit: a.photoCredit || gen.photoCredit || null,
    };
  }
  return out;
})();
export const catalogShows = [...baseShows, ...(generated.shows || [])];
export const catalogTourDates = [...baseTourDates, ...(generated.tourDates || [])];
export const catalogArtists = generated.artists || {}; // keyed by lowercase name, carries Commons photo
