#!/usr/bin/env node
// Accurate photos for the well-known venues (the ones a demo actually shows),
// from each venue's Wikipedia lead image (keyless, reliable, CC-licensed).
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "PitConcertApp/0.1 (contact@example.com)";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// normalized venue key -> Wikipedia article title
const VENUES = [
  ["the fillmore", "The Fillmore"],
  ["red rocks amphitheatre", "Red Rocks Amphitheatre"],
  ["brooklyn steel", "Brooklyn Steel"],
  ["the greek theatre", "Greek Theatre (Los Angeles)"],
  ["madison square garden", "Madison Square Garden"],
  ["the independent", "The Independent (music venue)"],
  ["great american music hall", "Great American Music Hall"],
  ["fox theater", "Fox Theater (Oakland, California)"],
  ["9:30 club", "9:30 Club"],
  ["first avenue", "First Avenue (nightclub)"],
  ["the troubadour", "Troubadour (West Hollywood, California)"],
  ["the showbox", "Showbox"],
  ["bottom of the hill", "Bottom of the Hill (music venue)"],
  ["the wiltern", "The Wiltern"],
  ["the observatory", "Observatory (concert venue)"],
  ["the roxy theatre", "The Roxy Theatre"],
  ["webster hall", "Webster Hall"],
  ["terminal 5", "Terminal 5 (New York City)"],
  ["the troubadour", "Troubadour (West Hollywood, California)"],
  ["the orpheum theatre", "Orpheum Theatre (Los Angeles)"],
];

async function leadImage(title) {
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const d = await r.json();
    return d.originalimage?.source || d.thumbnail?.source || null;
  } catch { return null; }
}

async function main() {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  cat.venues = cat.venues || {};
  let n = 0;
  for (const [key, title] of VENUES) {
    const img = await leadImage(title);
    if (img) {
      const v = cat.venues[key] || { name: title.split(" (")[0] };
      v.photos = [img];
      v.photo = img;
      v.photoCredit = "Wikipedia / Wikimedia Commons";
      cat.venues[key] = v;
      n++;
      console.log(`  ✓ ${key}`);
    } else {
      console.log(`  · ${key} (no image)`);
    }
    await sleep(150);
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log(`Wrote ${n} accurate venue photos.`);
}
main();
