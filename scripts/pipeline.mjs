#!/usr/bin/env node
/**
 * The self-running catalog pipeline. One process, runs forever:
 *
 *   every cycle:
 *     1. grow the roster (MusicBrainz tag search) until ARTIST_TARGET
 *     2. sync curated venues (arenas.js) into the catalog
 *     3. official Spotify photos for artists that lack them
 *     4. album covers + honest release labels for artists that lack them
 *     5. real top tracks for artists that lack them
 *     6. photos for venues that lack them
 *     then sleep CYCLE_H hours and do it again.
 *
 * Every stage is PRECHECKED against the catalog first — when there is nothing to
 * do, nothing is written, so the dev server doesn't hot-reload the app for
 * no-op cycles. Stages run sequentially (never two writers on the catalog).
 *
 *   npm run pipeline                # uses .env for Spotify keys
 *   ARTIST_TARGET=1000 CYCLE_H=12 npm run pipeline
 *
 * Stop with Ctrl+C (finishes the current stage first). Until the SQLite
 * migration, active stages rewrite the bundled catalog and the dev app reloads —
 * run it overnight or while you're not clicking around.
 */
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAT = join(HERE, "..", "src", "seed", "catalog.generated.json");
const ARTIST_TARGET = Number(process.env.ARTIST_TARGET) || 10000;
const PER_TAG = Number(process.env.PER_TAG) || 400; // deep-crawl depth per genre tag (paginated) so the roster can climb toward ARTIST_TARGET
const CYCLE_H = Number(process.env.CYCLE_H) || 6;

const ts = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[pipeline ${ts()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stopping = false;
process.on("SIGINT", () => { stopping = true; log("stopping after current stage…"); });

const STAGE_TIMEOUT_MS = Number(process.env.STAGE_TIMEOUT_MS) || 45 * 60 * 1000; // 45 min

function run(script, args = [], env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(HERE, script), ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "inherit", "inherit"],
    });
    // Watchdog: if a stage wedges (hung socket, etc.), kill it and move on so the
    // pipeline can never freeze the way it did before.
    const t = setTimeout(() => {
      log(`stage ${script} exceeded ${Math.round(STAGE_TIMEOUT_MS / 60000)}m — killing and continuing.`);
      try { p.kill("SIGKILL"); } catch {}
    }, STAGE_TIMEOUT_MS);
    p.on("exit", (code) => { clearTimeout(t); resolve(code ?? 1); });
    p.on("error", () => { clearTimeout(t); resolve(1); });
  });
}

async function stats() {
  const cat = JSON.parse(await readFile(CAT, "utf8"));
  const artists = Object.values(cat.artists || {});
  const venues = Object.values(cat.venues || {});
  const { arenaVenues } = await import("../src/seed/arenas.js");
  return {
    artistCount: artists.length,
    missingSpotify: artists.filter((a) => !a.spotifyId).length,
    missingPopularity: artists.filter((a) => a.spotifyId && a.popularity == null).length,
    missingArt: artists.filter((a) => !(a.albums || []).some((x) => x.art)).length,
    missingTracks: artists.filter((a) => !(a.topTracks || []).length).length,
    blankVenues: venues.filter((v) => !(v.galleryPool || []).length && !v.photo).length,
    missingAnchors: Object.keys(arenaVenues).filter((k) => !cat.venues?.[k]).length,
  };
}

async function cycle(n) {
  const s = await stats();
  log(`cycle ${n} — artists ${s.artistCount}/${ARTIST_TARGET} · missing: spotify ${s.missingSpotify}, covers ${s.missingArt}, tracks ${s.missingTracks} · blank venues ${s.blankVenues} · unsynced anchors ${s.missingAnchors}`);

  let did = false;
  if (!stopping && s.artistCount < ARTIST_TARGET) {
    log("stage: roster growth");
    await run("ingest-artists.mjs", [], { PER_TAG: String(PER_TAG), ARTIST_TARGET: String(ARTIST_TARGET) });
    did = true;
  }
  if (!stopping && s.missingAnchors > 0) {
    log("stage: sync curated venues");
    await run("sync-anchors.mjs");
    did = true;
  }
  // Re-read after growth so the enrichers see the newcomers.
  const s2 = did ? await stats() : s;
  if (!stopping && s2.missingSpotify > 0) {
    log(`stage: spotify photos (${s2.missingSpotify} artists)`);
    await run("enrich-spotify.mjs", ["--missing"]);
    did = true;
  }
  // NOTE: no popularity stage — this Spotify app is in restricted/dev mode, which
  // strips popularity/followers/genres from all artist endpoints (search omits
  // them, /artists/{id} returns a stub, /artists?ids= 403s). Re-enable
  // enrich-popularity.mjs only once the app is approved for extended quota mode.
  if (!stopping && s2.missingArt > 0) {
    log(`stage: album covers (${s2.missingArt} artists)`);
    await run("enrich-album-art.mjs");
    did = true;
  }
  if (!stopping && s2.missingTracks > 0) {
    log(`stage: top tracks (${s2.missingTracks} artists)`);
    await run("enrich-toptracks.mjs");
    did = true;
  }
  if (!stopping && s2.blankVenues > 0) {
    log(`stage: venue photos (${s2.blankVenues} venues)`);
    await run("enrich-venue-photos.mjs");
    did = true;
  }
  // Tour dates from the official Ticketmaster Discovery API. Runs only when a key
  // is set; polls the top artists by popularity each cycle so newly-announced
  // dates get picked up (tour dates are dynamic — unlike photos, we re-check).
  if (!stopping && (process.env.TICKETMASTER_KEY || process.env.BANDSINTOWN_APP_ID)) {
    log("stage: tour dates (Ticketmaster / Bandsintown)");
    await run("enrich-tourdates.mjs");
    did = true;
  }
  if (!did) log("nothing to do — catalog is complete and fresh (no writes, no reloads). Set TICKETMASTER_KEY to also pull tour dates.");
  return did;
}

async function main() {
  // --once: run a single cycle and exit. That's the mode the Render cron job uses
  // (it invokes this on a schedule, then commits + pushes the refreshed catalog).
  const once = process.argv.includes("--once");
  log(`pipeline up. target ${ARTIST_TARGET} artists${once ? " · single cycle (--once)" : ` · cycle every ${CYCLE_H}h`}.`);
  let n = 1;
  do {
    try { await cycle(n++); } catch (e) { log(`cycle error: ${e.message} (will retry next cycle)`); }
    if (once || stopping) break;
    log(`sleeping ${CYCLE_H}h…`);
    // sleep in 30s slices so Ctrl+C exits promptly
    for (let i = 0; i < CYCLE_H * 120 && !stopping; i++) await sleep(30000);
  } while (!stopping);
  log("stopped.");
}
main();
