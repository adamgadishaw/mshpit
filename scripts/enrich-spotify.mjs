#!/usr/bin/env node
/**
 * Enrich artists with OFFICIAL Spotify data — reliable CDN-hosted images (no dead
 * URLs), plus genres, popularity, and follower counts. This is how music apps get
 * clean artist photos.
 *
 *   SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy node scripts/enrich-spotify.mjs
 *   ... node scripts/enrich-spotify.mjs "Turnstile" "Alvvays"   # just these
 *
 * Spotify images lead the gallery pool (source "spotify"); the existing scraped
 * pool stays underneath as backup. Writes src/seed/catalog.generated.json.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findArtist, spotifyConfigured } from "./lib/spotify.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cap = (s) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : s);

async function main() {
  if (!spotifyConfigured()) {
    console.error("Spotify keys missing. Set them and re-run:");
    console.error("  SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... node scripts/enrich-spotify.mjs");
    console.error("Get free keys at https://developer.spotify.com/dashboard (create app → Client ID/Secret).");
    process.exit(1);
  }

  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const missingOnly = process.argv.includes("--missing");
  const filter = process.argv.slice(2).filter((s) => !s.startsWith("--")).map((s) => s.toLowerCase());
  const keys = Object.keys(cat.artists || {}).filter((k) => {
    if (filter.length) return filter.includes(k) || filter.includes(cat.artists[k].name?.toLowerCase());
    if (missingOnly) return !cat.artists[k].spotifyId; // pipeline mode: only newcomers
    return true;
  });
  console.log(`Enriching ${keys.length} artist(s) from Spotify…`);

  let matched = 0, done = 0;
  for (const k of keys) {
    const a = cat.artists[k];
    let info = null;
    try { info = await findArtist(a.name); } catch (e) { console.warn(`  ! ${a.name}: ${e.message}`); }
    await sleep(120); // gentle on the API

    if (info && info.images.length) {
      const spotifyPool = info.images.map((uri) => ({ uri, credit: "Spotify", source: "spotify" }));
      const rest = (a.galleryPool || []).filter((p) => p.source !== "spotify");
      // Spotify images lead (reliable); scraped pool stays as backup.
      const seen = new Set();
      a.galleryPool = [...spotifyPool, ...rest].filter((p) => p.uri && !seen.has(p.uri) && seen.add(p.uri)).slice(0, 14);
      a.photo = info.images[0];
      a.photoCredit = "Spotify";
      a.photos = [...new Set([...info.images, ...(a.photos || [])])].slice(0, 8);
      if (!a.genre || a.genre === "—") a.genre = cap(info.genres[0]) || a.genre;
      a.spotifyId = info.id;
      a.popularity = info.popularity;
      a.followers = info.followers;
      matched++;
    }
    if (++done % 20 === 0) {
      console.log(`  …${done}/${keys.length} (${matched} matched)`);
      await writeFile(OUT, JSON.stringify(cat, null, 2));
    }
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`\nDone. ${matched}/${keys.length} artists enriched with official Spotify images + metadata.`);
}
main();
