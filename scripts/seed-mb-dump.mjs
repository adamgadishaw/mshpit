#!/usr/bin/env node
/**
 * Seed the DB artist catalog from a MusicBrainz data dump, filtered to NOTABLE
 * artists by release-group count — a comprehensive base without the ~2.4M-row
 * noise (most of which no one on a concerts app will ever search). On-demand
 * resolve (server GET /api/artists/resolve) handles anything this misses.
 *
 * Get the dump (CC0, no key):
 *   1. Download `mbdump.tar.bz2` from
 *      https://data.metabrainz.org/pub/musicbrainz/data/fullexport/latest/
 *   2. Extract it → an `mbdump/` folder with plain-TSV `artist`, `release_group`,
 *      `artist_credit_name`.
 *   3. Run it against the SAME DB the server uses (on Render set PIT_DATA_DIR=/data
 *      and run it in a one-off shell; locally it writes server/data/pit.db):
 *        node scripts/seed-mb-dump.mjs /path/to/mbdump --min-releases 3
 *
 * Seeds: name, mbid, begin year, rank_score (= release count, so the biggest
 * catalogs rank first in search). Genre/photo/bio fill in later via resolve +
 * the enrichers. Memory: builds a couple of large Maps — run on a dev box or a
 * beefy instance, not the small web dyno.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { artistStmts, db } from "../server/db.js";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const mi = args.indexOf("--min-releases");
const MIN_RELEASES = mi >= 0 ? Number(args[mi + 1]) || 3 : 3;
if (!dir) {
  console.error("Usage: node scripts/seed-mb-dump.mjs <mbdump-dir> [--min-releases N]");
  process.exit(1);
}

// MusicBrainz TSV column indices (stable export ordering):
//  artist_credit_name: credit_id[0] position[1] artist_id[2] name[3] join_phrase[4]
//  release_group:      id[0] gid[1] name[2] artist_credit[3] type[4] ...
//  artist:             id[0] gid[1] name[2] sort_name[3] begin_year[4] ... type[10] area[11] ...
const ACN = { credit: 0, position: 1, artist: 2 };
const RG = { artistCredit: 3 };
const ART = { id: 0, gid: 1, name: 2, beginYear: 4 };

async function eachLine(file, fn) {
  const rl = createInterface({ input: createReadStream(join(dir, file), "utf8"), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) { fn(line.split("\t")); n++; }
  return n;
}

async function main() {
  console.log(`Seeding notable artists (≥ ${MIN_RELEASES} release groups) from ${dir}…`);

  // 1) credit_id -> primary artist_id (position 0 = the lead credit).
  const creditToArtist = new Map();
  const acn = await eachLine("artist_credit_name", (c) => {
    if (c[ACN.position] === "0") creditToArtist.set(c[ACN.credit], c[ACN.artist]);
  });
  console.log(`  artist_credit_name: ${acn} rows → ${creditToArtist.size} credits`);

  // 2) count release groups per artist.
  const counts = new Map();
  const rg = await eachLine("release_group", (c) => {
    const artist = creditToArtist.get(c[RG.artistCredit]);
    if (artist) counts.set(artist, (counts.get(artist) || 0) + 1);
  });
  console.log(`  release_group: ${rg} rows → ${counts.size} artists with releases`);

  // 3) stream the artist file, insert those over the threshold.
  let seen = 0, inserted = 0;
  db.exec("BEGIN");
  const total = await eachLine("artist", (c) => {
    seen++;
    const id = c[ART.id];
    const releases = counts.get(id) || 0;
    if (releases < MIN_RELEASES) return;
    const name = c[ART.name];
    if (!name) return;
    const beginYear = c[ART.beginYear] && c[ART.beginYear] !== "\\N" ? c[ART.beginYear] : null;
    artistStmts.upsert.run({
      norm: name.trim().toLowerCase(),
      name, genre: null, photo: null, bio: null,
      mbid: c[ART.gid] || null, spotify_id: null, country: null, formed: beginYear,
      popularity: null, rank_score: releases, data: JSON.stringify({ name, mbid: c[ART.gid], beginYear }),
      source: "mb-dump", created_at: Date.now(), updated_at: Date.now(),
    });
    inserted++;
    if (inserted % 20000 === 0) { db.exec("COMMIT"); db.exec("BEGIN"); console.log(`  …inserted ${inserted}`); }
  });
  db.exec("COMMIT");
  console.log(`\nDone. Scanned ${total} artists, seeded ${inserted} notable ones. Catalog now: ${artistStmts.count.get().c}.`);
}
main().catch((e) => { try { db.exec("ROLLBACK"); } catch {} console.error("Failed:", e.message); process.exit(1); });
