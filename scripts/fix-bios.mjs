#!/usr/bin/env node
// Re-fetch bios with music-aware disambiguation so "Turnstile" gets the band,
// not the gate. Tries (band)/(musician)/(rapper) and validates the text.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "PitConcertApp/0.1 (contact@example.com)";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MUSIC = /\b(band|singer|songwriter|rapper|musician|duo|trio|group|album|EP|record|hip hop|indie|rock|pop|punk|metal|producer|DJ|vocalist|frontman|frontwoman)\b/i;

async function summary(title) {
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.type === "disambiguation" || !d.extract) return null;
    return d.extract;
  } catch { return null; }
}

async function bestBio(name) {
  for (const t of [`${name} (band)`, `${name} (musician)`, `${name} (rapper)`, `${name} (singer)`, name]) {
    const ex = await summary(t);
    await sleep(120);
    if (ex && MUSIC.test(ex)) return ex.split(". ").slice(0, 2).join(". ").replace(/\.?$/, ".");
  }
  return null;
}

async function main() {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const keys = Object.keys(cat.artists);
  let fixed = 0;
  for (const k of keys) {
    const a = cat.artists[k];
    if (a.bio && MUSIC.test(a.bio)) continue; // already good
    const b = await bestBio(a.name);
    if (b) { a.bio = b; fixed++; } else { delete a.bio; }
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`Fixed ${fixed} bios.`);
}
main();
