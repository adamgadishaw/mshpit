#!/usr/bin/env node
/**
 * Real popular songs per artist — Spotify top tracks with 30s preview URLs
 * (when available) and Spotify links as the always-works fallback. Replaces the
 * hand-seeded SONGS list on artist pages.
 *
 *   node --env-file=.env scripts/enrich-toptracks.mjs            # artists missing tracks
 *   node --env-file=.env scripts/enrich-toptracks.mjs --all      # refresh everyone
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findArtist, topTracks, spotifyConfigured } from "./lib/spotify.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!spotifyConfigured()) {
    console.error("Set SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (see .env).");
    process.exit(1);
  }
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const all = process.argv.includes("--all");
  const keys = Object.keys(cat.artists || {}).filter((k) => all || !(cat.artists[k].topTracks || []).length);
  console.log(`Fetching top tracks for ${keys.length} artist(s)…`);

  let done = 0, got = 0, previews = 0;
  for (const k of keys) {
    const a = cat.artists[k];
    try {
      const tracks = (await topTracks(a.name)).slice(0, 8);
      if (tracks.length) {
        a.topTracks = tracks;
        got++;
        previews += tracks.filter((t) => t.preview).length;
      }
    } catch (e) { console.warn(`  ! ${a.name}: ${e.message}`); }
    if (++done % 25 === 0) {
      console.log(`  …${done}/${keys.length} (${got} with tracks, ${previews} previews)`);
      await writeFile(OUT, JSON.stringify(cat, null, 2));
    }
    await sleep(150);
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`Done. ${got}/${keys.length} artists with real top tracks · ${previews} 30s previews available.`);
}
main();
