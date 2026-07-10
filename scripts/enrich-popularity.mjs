#!/usr/bin/env node
/**
 * Backfill Spotify POPULARITY + FOLLOWERS for every artist that has a spotifyId.
 * The /search endpoint (used by enrich-spotify) omits these fields for restricted
 * (post-2024 dev-mode) apps, so this pulls them from the batch /artists endpoint
 * (50 ids per call — ~33 calls for the whole catalog instead of thousands).
 *
 * These values drive the Top-100 ranking + badge.
 *
 *   SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy node scripts/enrich-popularity.mjs
 *   ... enrich-popularity.mjs --all   # refresh everyone, not just the missing
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getArtistsByIds, spotifyConfigured } from "./lib/spotify.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!spotifyConfigured()) {
    console.error("Spotify keys missing. Set SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET and re-run.");
    process.exit(1);
  }
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const all = Object.values(cat.artists || {});
  const force = process.argv.includes("--all");
  const targets = all.filter((a) => a.spotifyId && (force || a.popularity == null));
  console.log(`Backfilling popularity/followers for ${targets.length} artist(s) with a Spotify id…`);

  const byId = {};
  targets.forEach((a) => { byId[a.spotifyId] = a; });
  const ids = Object.keys(byId);

  let done = 0, filled = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    let map = {};
    try { map = await getArtistsByIds(chunk); } catch (e) { console.warn(`  ! chunk ${i}: ${e.message}`); }
    // Restricted (dev-mode) Spotify apps 403 the batch /artists endpoint and strip
    // popularity everywhere. Detect that on the first chunk and stop with guidance
    // instead of grinding through the whole catalog for nothing.
    if (i === 0 && (Object.keys(map).length === 0 || Object.values(map).every((a) => a.popularity == null))) {
      console.error("\nSpotify returned NO popularity for the first batch. This app is almost certainly in\nrestricted/development mode — popularity/followers are unavailable. Apply for\n'extended quota mode' in the Spotify dashboard, then re-run. Aborting.");
      process.exit(2);
    }
    for (const id of chunk) {
      const full = map[id], a = byId[id];
      if (full && a) {
        if (full.popularity != null) { a.popularity = full.popularity; filled++; }
        if (full.followers?.total != null) a.followers = full.followers.total;
        if ((!a.genre || a.genre === "—") && full.genres?.[0]) a.genre = full.genres[0].replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
    done += chunk.length;
    console.log(`  …${done}/${ids.length} (${filled} filled)`);
    await writeFile(OUT, JSON.stringify(cat, null, 2));
    await sleep(250); // gentle — avoids 429s
  }
  console.log(`\nDone. ${filled}/${targets.length} artists now have popularity.`);
}
main();
