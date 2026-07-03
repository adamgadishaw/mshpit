#!/usr/bin/env node
// Fill missing bios + hometown + formed/born year for every artist, keyless,
// from the Wikipedia summary (extract text). Music-aware disambiguation.
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

async function bestExtract(name) {
  for (const t of [`${name} (band)`, `${name} (musician)`, `${name} (rapper)`, `${name} (singer)`, name]) {
    const ex = await summary(t);
    await sleep(110);
    if (ex && MUSIC.test(ex)) return ex;
  }
  return null;
}

function parse(extract) {
  const out = {};
  // hometown: "from X[, Y[, Z]]" or "based in X"
  const from = extract.match(/\b(?:from|based in|formed in)\s+([A-Z][\w.'’-]+(?:,?\s+[A-Z][\w.'’-]+){0,2})/);
  if (from) out.hometown = from[1].replace(/\s+(and|is|was|are|were)$/i, "").trim();
  // year: "formed in YYYY" / "established YYYY" / "(born ... YYYY)"
  const formed = extract.match(/\b(?:formed|founded|established)\s+(?:in\s+)?(\d{4})/i);
  const born = extract.match(/\bborn[^)]*?(\d{4})/i);
  if (formed) out.since = formed[1];
  else if (born) { out.born = born[1]; out.since = born[1]; }
  return out;
}

async function main() {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const keys = Object.keys(cat.artists);
  let bios = 0, towns = 0, years = 0;
  for (const k of keys) {
    const a = cat.artists[k];
    const ex = await bestExtract(a.name);
    if (ex) {
      a.bio = ex.split(". ").slice(0, 2).join(". ").replace(/\.?$/, ".");
      bios++;
      const p = parse(ex);
      if (p.hometown) { a.hometown = p.hometown; towns++; }
      if (p.since) { a.since = p.since; years++; }
      if (p.born) a.born = p.born;
    }
    await sleep(120);
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`Enriched: ${bios} bios, ${towns} hometowns, ${years} years.`);
}
main();
