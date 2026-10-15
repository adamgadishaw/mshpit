#!/usr/bin/env node
// The real web export with synthetic public records. All remote traffic is blocked.
// Usage: node scripts/verify-discover-cards-browser.mjs [before|after]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { fixtureApiResponse, discoverArtistEvent, discoverEventArtwork, navigationArtistCard } from "./verify-navigation-browser.mjs";

const require = createRequire(import.meta.url);
function loadChromium() {
  if (process.env.PIT_PLAYWRIGHT_MODULE) return require(process.env.PIT_PLAYWRIGHT_MODULE).chromium;
  for (const name of ["playwright", "playwright-core"]) {
    try { return require(name).chromium; } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
  }
  throw new Error("Set PIT_PLAYWRIGHT_MODULE to a separately installed Playwright module.");
}
const root = resolve(import.meta.dirname, ".."), directory = resolve(root, "dist");
const phase = process.argv[2] || "after";
assert.ok(["before", "after"].includes(phase));
const output = resolve(root, ".tmp/discover-cards", phase);
mkdirSync(output, { recursive: true });
const artist = { ...navigationArtistCard, name: "The Extraordinary Orchestra of Very Long Artist Names", genre: "Alternative rock", photo: null };
const event = { ...discoverArtistEvent, artist: artist.name, venue: "The Grand Ballroom and Centre for Live Performing Arts",
  eventName: "An Extraordinary Evening of Live Music with Special Guests", eventImage: discoverEventArtwork };
const festival = { ...event, id: "tm_festival_fixture", eventName: "Three Days of Extraordinary Music and Arts Festival", eventKind: "festival",
  eventEndDate: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10), eventImage: null };
const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="576"><rect width="1024" height="576" fill="#444"/><circle cx="512" cy="210" r="120" fill="#888"/><text x="40" y="80" fill="white" font-size="32">Synthetic event artwork</text></svg>';
const mime = { ".js": "text/javascript", ".html": "text/html", ".png": "image/png", ".ico": "image/x-icon" };
const server = createServer((request, response) => {
  let file = resolve(directory, "." + new URL(request.url, "http://local").pathname);
  if (!file.startsWith(directory + sep)) file = resolve(directory, "index.html");
  try { if (!statSync(file).isFile()) file = resolve(directory, "index.html"); } catch { file = resolve(directory, "index.html"); }
  response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
  response.end(readFileSync(file));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await loadChromium().launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
const results = [];
try {
  for (const width of [390, 1440]) for (const theme of ["stage", "daylight"]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const errors = [];
    let releaseOverview;
    const overviewReady = new Promise(done => { releaseOverview = done; });
    await context.addInitScript(theme => localStorage.setItem("pit_theme", theme), theme);
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === "https://images.fixture.invalid") return route.fulfill({ contentType: "image/svg+xml", body: artwork });
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      try {
        let body;
        if (url.pathname === "/api/tourdates") body = { tourDates: [event, festival], nextCursor: null };
        else if (url.pathname === "/api/discover/overview") {
          await overviewReady;
          body = {
          chart: { rows: [artist, { ...artist, key: "second", name: "Short Name", rank: 2 }], source: "popularity" }, genres: [],
          countries: [{ country: "Canada", count: 2 }], eventCoverage: { total: 2, venueTotal: 1, countries: [{ country: "Canada", count: 2 }] },
          };
        }
        else if (url.pathname === "/api/resolve" && url.searchParams.get("path") === `/event/${festival.id}`)
          body = { entity: { ...festival, kind: "event", name: festival.eventName, path: `/event/${festival.id}`, publicEventSnapshot: true } };
        else if (url.pathname === "/api/venue-snapshot") {
          assert.equal(request.method(), "GET");
          const path = url.searchParams.get("path");
          assert.match(path, /^\/venue\//);
          body = { path, venue: { name: event.venue, source: event.source, providerVenueId: null, place: event.place,
            coord: null, address: null, capacity: null }, events: [{ ...event, name: event.artist }],
            hasMore: false, nextCursor: null, after: null };
        }
        else if (/^\/api\/venues\/[^/]+\/photos$/.test(url.pathname)) body = { photos: [], fanPhotos: [], state: "ready" };
        else body = fixtureApiResponse(url.pathname, { method: request.method(), resolvedPath: url.searchParams.get("path") || undefined, discoverShow: true, discoverArtwork: true });
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      } catch (error) { errors.push(error.message); await route.abort(); }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/discover");
    await page.getByRole("heading", { name: "Discover", exact: true }).waitFor();
    await page.getByRole("tab", { name: "Artists", exact: true }).click();
    await page.getByText("Loading Discover", { exact: true }).waitFor();
    await page.screenshot({ path: resolve(output, `${width}-${theme}-loading.png`), fullPage: true });
    releaseOverview();
    for (const tab of ["Shows", "Artists", "Venues"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      let card;
      if (tab === "Shows") {
        card = page.getByRole("link", { name: new RegExp("Open " + artist.name + " at") }).first();
        await card.waitFor();
        assert.equal(await card.getAttribute("href"), `/event/${event.id}`);
        assert.equal(await page.getByRole("link", { name: new RegExp("Open " + festival.eventName + " at") }).count(), 0, "Festivals stay in their dedicated programme.");
        const credit = page.getByRole("button", { name: "Photo credits", exact: true });
        const box = await credit.boundingBox();
        assert.ok(box.height >= 44, "Photo credits remain a reachable touch target.");
        assert.equal(await page.getByText("Fixture Promoter · Source", { exact: true }).count(), 0);
        await credit.click();
        const originalSource = page.getByRole("link", { name: "Photo by Fixture Promoter. Open original source in browser.", exact: true });
        assert.equal(await originalSource.getAttribute("href"), discoverEventArtwork.sourcePage);
        assert.equal(await page.getByRole("link", { name: /Open null license/ }).count(), 0, "Provider photos must not invent a license.");
        // The native Modal fade must finish before capturing the credits footer.
        await page.waitForTimeout(350);
        await page.screenshot({ path: resolve(output, `${width}-${theme}-photo-credits.png`), fullPage: true });
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await originalSource.waitFor({ state: "hidden" });
        await page.getByRole("heading", { name: "Discover", exact: true }).click();
      } else if (tab === "Artists") {
        card = page.getByRole("link", { name: new RegExp("Open " + artist.name) }).first();
        await card.waitFor();
        assert.equal(await card.getAttribute("href"), "/artist/fixture-artist");
        await card.getByText("EO", { exact: true }).waitFor(); // Missing image uses the branded fallback.
        if (phase === "after") {
          const title = card.getByText(artist.name, { exact: true });
          const box = await title.boundingBox();
          assert.ok(box.height >= 39, "Long artist names have two readable lines.");
        }
      } else {
        card = page.getByRole("button", { name: "Open venue " + event.venue, exact: true });
        await card.waitFor();
        const box = await card.boundingBox();
        assert.ok(box.height >= 44, "Venue rows remain a reachable touch target.");
      }
      await card.screenshot({ path: resolve(output, `${width}-${theme}-${tab}-card.png`) });
      await page.getByRole("tab", { name: tab, exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(output, `${width}-${theme}-${tab}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} ${tab} page overflow`);
      if (tab === "Venues") {
        await card.focus();
        await page.keyboard.press("Enter");
        await page.getByRole("heading", { name: event.venue, exact: true }).waitFor();
        assert.match(new URL(page.url()).pathname, /^\/venue\//);
        await page.goBack();
        await page.getByRole("heading", { name: "Discover", exact: true }).waitFor();
      }
    }
    results.push({ width, theme, errors });
    await context.close();
  }
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  assert.ok(results.every(result => !result.errors.length));
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
