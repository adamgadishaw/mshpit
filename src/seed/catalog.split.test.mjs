// The app boots off catalog.core.json, derived from the scraper's
// catalog.generated.json by scripts/split-catalog.mjs. These tests defend the
// two properties that make the split worth having: the startup catalogue stays
// small, and the deferred half stays out of startup.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(js|jsx|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(path);
  }
  return out;
};

test("the derived catalogue split is in sync with the scraper output", () => {
  // `npm run check` regenerates before testing, so a failure here means a build
  // ran without the split step rather than that the scraper moved.
  execFileSync(process.execPath, ["scripts/split-catalog.mjs", "--check"], { stdio: "pipe" });
});

test("startup only pays for the core, and the heavy fields stay out of it", () => {
  const core = JSON.parse(readFileSync("src/seed/catalog.core.json", "utf8"));

  const artists = Object.values(core.artists || {});
  assert.ok(artists.length > 0, "the core must still carry the artist roster");
  assert.ok(artists.some((a) => a.name), "names are needed for search");
  assert.ok(artists.some((a) => a.topTracks?.length), "top tracks feed the recommendation pool");
  for (const field of ["albums", "galleryPool", "photos"]) {
    assert.equal(artists.some((a) => a[field]), false, `artist ${field} must not be in the startup catalogue`);
  }

  const venues = Object.values(core.venues || {});
  assert.ok(venues.length > 0, "venues must survive the split");
  assert.ok(venues.some((v) => v.name && v.place), "venue identity stays in the core");
  for (const field of ["galleryPool", "photos"]) {
    assert.equal(venues.some((v) => v[field]), false, `venue ${field} belongs in the lazy half`);
  }

  // Regressing this number is what re-introduces the startup stall, so the
  // build checks it rather than trusting anyone to remember.
  const coreMb = statSync("src/seed/catalog.core.json").size / 1048576;
  assert.ok(coreMb < 1.8, `startup catalogue grew to ${coreMb.toFixed(2)} MB; it was cut to 1.24, keep it under 1.8`);
});

test("nothing imports the full scraper output at startup", () => {
  for (const file of ["src/seed/catalog.js", "src/seed/ingested.js"]) {
    const text = readFileSync(file, "utf8");
    const pulls = /(?:from\s*|require\s*\(\s*)["'][^"']*catalog\.generated\.json["']/;
    assert.equal(pulls.test(text), false, `${file} must read catalog.core.json, not the 9.9 MB scraper output`);
  }
});

test("venue photo pools are reached only through the lazy accessor", () => {
  // Metro bundles whatever is required but only runs a module's factory on
  // first require, so one lazy require keeps 2.1 MB out of startup. A static
  // import anywhere, or a second consumer, would defeat that.
  const pulls = /(?:from\s*|require\s*\(\s*)["'][^"']*catalog\.venue-photos\.json["']/;
  const offenders = walk("src")
    .filter((file) => pulls.test(readFileSync(file, "utf8")))
    .filter((file) => !/ingested\.js$/.test(file));
  assert.deepEqual(offenders, [], "only src/seed/ingested.js may require the venue photo pool");

  const accessor = readFileSync("src/seed/ingested.js", "utf8");
  const staticImport = /^\s*import[^\n]*catalog\.venue-photos/m;
  assert.equal(staticImport.test(accessor), false, "a static import would defeat the whole split");
});
