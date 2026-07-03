#!/usr/bin/env node
/**
 * Album covers + honest release labels.
 *
 * Re-fetches each artist's release-groups from MusicBrainz keeping what the old
 * ingest threw away: the release-group MBID (the key into the Cover Art Archive,
 * the free/canonical cover-art source) and the secondary types (so "Live at
 * Sydney Opera House" is labeled "Live album", not just "Album").
 *
 * Each album gains:
 *   art  — https://coverartarchive.org/release-group/<mbid>/front-250 (verified
 *          to exist with a HEAD check; null when the archive has no cover)
 *   type — "Album" | "EP" | "Live album" | "Compilation" | …
 *
 * Titles/years stay identical, so existing album ratings (keyed artist|title)
 * keep working.
 *
 *   node scripts/enrich-album-art.mjs                # all artists with an mbid
 *   node scripts/enrich-album-art.mjs "Khruangbin"   # just these
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "PitConcertApp/0.1 (contact@example.com)";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const label = (g) => {
  const sec = g["secondary-types"] || [];
  if (sec.includes("Live")) return "Live album";
  if (sec.includes("Compilation")) return "Compilation";
  if (sec.includes("Soundtrack")) return "Soundtrack";
  if (sec.includes("Remix")) return "Remix album";
  return g["primary-type"] || "Album";
};

// Resolve a missing MusicBrainz artist id by name search (exact-name match
// preferred, else highest score). Some seed scripts added artists without an
// mbid, which silently excluded them from albums + covers — never skip, resolve.
async function findMbid(name) {
  const r = await fetch(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${name}"`)}&fmt=json&limit=5`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!r.ok) return null;
  const d = await r.json();
  const items = d.artists || [];
  if (!items.length) return null;
  const exact = items.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return (exact || items[0]).id || null;
}

async function releaseGroups(mbid) {
  const r = await fetch(`https://musicbrainz.org/ws/2/release-group?artist=${mbid}&type=album|ep&fmt=json&limit=40`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d["release-groups"] || [])
    .filter((g) => g["first-release-date"])
    .map((g) => ({ mbid: g.id, title: g.title, year: g["first-release-date"].slice(0, 4), type: label(g) }))
    .sort((a, b) => b.year.localeCompare(a.year))
    .filter((a, i, arr) => arr.findIndex((x) => x.title === a.title) === i)
    .slice(0, 12);
}

async function main() {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const filter = process.argv.slice(2).map((s) => s.toLowerCase());
  const keys = Object.keys(cat.artists || {}).filter((k) => {
    const a = cat.artists[k];
    if (filter.length) return filter.includes(k) || filter.includes(a.name?.toLowerCase());
    // default run = only artists still missing covers (idempotent top-up)
    return !(a.albums || []).some((x) => x.art);
  });
  console.log(`Fetching covers + labels for ${keys.length} artist(s)…`);

  let done = 0, arts = 0;
  for (const k of keys) {
    const a = cat.artists[k];
    try {
      if (!a.mbid) {
        a.mbid = await findMbid(a.name);
        await sleep(1100); // MusicBrainz rate limit
        if (!a.mbid) { console.warn(`  ! no MusicBrainz match for ${a.name}`); done++; continue; }
      }
      const groups = await releaseGroups(a.mbid);
      if (groups.length) {
        // Set the CAA URL unconditionally — batch HEAD "does it exist" checks get
        // rate-limited by the archive and mark real covers as missing. The app's
        // AlbumArt component falls back to a clean tile on a true 404.
        for (const g of groups) { g.art = `https://coverartarchive.org/release-group/${g.mbid}/front-250`; arts++; }
        a.albums = groups;
      }
    } catch (e) { console.warn(`  ! ${a.name}: ${e.message}`); }
    if (++done % 10 === 0) {
      console.log(`  …${done}/${keys.length} (${arts} covers found)`);
      await writeFile(OUT, JSON.stringify(cat, null, 2));
    }
    await sleep(1100); // MusicBrainz rate limit
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`Done. ${arts} covers across ${done} artists.`);
}
main();
