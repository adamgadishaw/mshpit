#!/usr/bin/env node
// Artist bios (Wikipedia) + albums/years (MusicBrainz release-groups), keyless.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "PitConcertApp/0.1 (contact@example.com)";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bio(name) {
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.type === "disambiguation") return null;
    return d.extract ? d.extract.split(". ").slice(0, 2).join(". ").replace(/\.$/, "") + "." : null;
  } catch { return null; }
}

async function albums(mbid) {
  if (!mbid) return [];
  try {
    const r = await fetch(`https://musicbrainz.org/ws/2/release-group?artist=${mbid}&type=album|ep&fmt=json&limit=40`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    const d = await r.json();
    return (d["release-groups"] || [])
      .filter((g) => g["first-release-date"])
      .map((g) => ({ title: g.title, year: g["first-release-date"].slice(0, 4), type: g["primary-type"] || "Album" }))
      .sort((a, b) => b.year.localeCompare(a.year))
      .filter((a, i, arr) => arr.findIndex((x) => x.title === a.title) === i)
      .slice(0, 12);
  } catch { return []; }
}

async function main() {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const artists = cat.artists || {};
  const keys = Object.keys(artists);
  console.log(`Fetching bio + albums for ${keys.length} artists…`);
  let done = 0, withBio = 0, withAlb = 0;
  for (const k of keys) {
    const a = artists[k];
    if (!a.bio) { const b = await bio(a.name); if (b) { a.bio = b; withBio++; } await sleep(120); }
    if (!a.albums) { const al = await albums(a.mbid); if (al.length) { a.albums = al; withAlb++; } }
    if (++done % 20 === 0) { console.log(`  …${done}/${keys.length}`); await writeFile(OUT, JSON.stringify(cat, null, 2)); }
    await sleep(1100); // MusicBrainz rate limit
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`Done. ${withBio} bios, ${withAlb} album lists.`);
}
main();
