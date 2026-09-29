#!/usr/bin/env node
// Current exported app, guest visitor, loopback-only mocked APIs. Discover's
// Shows tab: four cards, then every show in range as a list a week at a time
// (no endless "load more"), later pages fetched once each, and festival
// listings kept out of Shows for the Festivals tab.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureApiResponse } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "discover-events-browser");
const DAY_MS = 86_400_000;
const day = (offset) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
// Synthetic shows spread over four weeks; the names are fixtures, not real bookings.
const shows = Array.from({ length: 40 }, (_, index) => ({
  id: `tm_list_fixture_${index + 1}`, artist: `Fixture Act ${index + 1}`, venue: `Fixture Hall ${(index % 5) + 1}`,
  city: "Toronto", place: "Toronto, Ontario, Canada", venueCountry: "Canada", venueCountryCode: "CA",
  source: "ticketmaster", providerActive: true, date: day(1 + Math.floor(index * 26 / 40)), releaseAt: 0, eventKind: "concert",
}));
const festival = { id: "tm_list_fixture_festival", artist: "Fixture Headliner", eventName: "Fixture Fest", eventKind: "festival",
  venue: "Fixture Park", city: "Toronto", place: "Toronto, Ontario, Canada", venueCountry: "Canada", venueCountryCode: "CA",
  source: "ticketmaster", providerActive: true, date: day(3), eventEndDate: day(5), releaseAt: 0 };

async function serverForBuild() {
  const directory = resolve(root, process.env.PIT_NAVIGATION_BROWSER_DIST || "dist");
  const html = join(directory, "index.html");
  assert.ok(statSync(html).isFile(), "Run the web export first.");
  const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    if (!["GET", "HEAD"].includes(request.method) || url.pathname.startsWith("/api/")) return void response.writeHead(405).end();
    let file;
    try { file = resolve(directory, "." + decodeURIComponent(url.pathname)); } catch { return void response.writeHead(400).end(); }
    if (file !== directory && !file.startsWith(directory + sep)) return void response.writeHead(400).end();
    try { if (!statSync(file).isFile()) file = html; } catch { file = html; }
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : readFileSync(file));
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  return { server, origin: "http://127.0.0.1:" + server.address().port };
}

async function scenario(browser, origin, width) {
  const context = await browser.newContext({ viewport: { width, height: 1100 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  const state = { pages: [], errors: [], external: [], closing: false };
  await context.addInitScript(() => { localStorage.setItem("pit_theme", "stage"); });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => state.errors.push(error.message));
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.origin !== origin) { state.external.push(url.origin); return await route.abort(); }
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      if (url.pathname === "/api/health") return await json({ ok: true });
      if (url.pathname === "/api/tourdates" && url.searchParams.get("days")) {
        const after = url.searchParams.get("after");
        state.pages.push(after || "first");
        // Two pages: the festival rides on the first to prove Shows leaves it out.
        if (!after) return await json({ tourDates: [festival, ...shows.slice(0, 25)], nextCursor: "fixture-page-2", range: { days: 30, through: day(30) } });
        if (after === "fixture-page-2") return await json({ tourDates: shows.slice(25), nextCursor: null, range: { days: 30, through: day(30) } });
        return await json({ error: "unknown cursor" }, 400);
      }
      if (url.pathname === "/api/tourdates") return await json({ tourDates: [], nextCursor: null });
      return await json(fixtureApiResponse(url.pathname, { method: request.method() }));
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message);
      await route.abort().catch(() => { /* Fixture teardown may already have closed the route. */ });
    }
  });
  try {
    await page.goto(origin + "/discover", { waitUntil: "domcontentloaded" });
    // Cards first: four shows and a way to see them all.
    const seeAll = page.getByRole("button", { name: /^See all \d+ shows as a list/u });
    await seeAll.waitFor();
    await page.getByText(/^Showing 4 of \d+ shows over the next 30 days\.$/u).waitFor();
    assert.equal(await page.getByRole("button", { name: /more (upcoming )?events/iu }).count(), 0, "no load more button");

    // The app's startup snapshot also reads the first page; count from here.
    const before = state.pages.length;
    await seeAll.click();
    await page.getByRole("radio", { name: "Show events as list", exact: true }).waitFor();
    assert.equal(await page.getByRole("radio", { name: "Show events as list", exact: true }).getAttribute("aria-checked"), "true");
    // Page two arrives on its own, once.
    await page.getByText("40 shows over the next 30 days.", { exact: true }).waitFor();
    assert.deepEqual(state.pages.slice(before), ["fixture-page-2"], "opening the list fetches the later page once");
    assert.equal(await page.getByText("Fixture Fest", { exact: false }).count(), 0, "festival listings stay in the Festivals tab");

    const tabs = page.getByRole("tablist", { name: "Weeks", exact: true }).getByRole("tab");
    const tabCount = await tabs.count();
    assert.ok(tabCount >= 4, `weeks across the month (${tabCount})`);
    const firstTab = await tabs.first().getAttribute("aria-label");
    assert.equal(await tabs.first().getAttribute("aria-selected"), "true");
    const rows = page.getByRole("link", { name: /^Open Fixture Act \d+ at Fixture Hall/u });
    const firstWeekRows = await rows.count();
    assert.ok(firstWeekRows > 0 && firstWeekRows < 40, `one week at a time (${firstWeekRows})`);
    await page.screenshot({ path: join(shots, `list-${width}.png`), fullPage: true });

    // Next week, by the button at the bottom.
    await page.getByRole("button", { name: /^Next week: /u }).click();
    await page.getByRole("button", { name: /^Previous week: /u }).waitFor();
    assert.equal(await tabs.first().getAttribute("aria-selected"), "false", `moved on from ${firstTab}`);
    assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);

    // Back to cards keeps the page tidy.
    await page.getByRole("radio", { name: "Show events as cards", exact: true }).click();
    await page.getByRole("button", { name: /^See all 40 shows as a list/u }).waitFor();
    assert.deepEqual(state.pages.slice(before), ["fixture-page-2"], "switching views does not refetch");
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.external, []);
    console.log(JSON.stringify({ name: `discover-events-${width}`, passed: true, weeks: tabCount, firstWeekRows }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `failed-${width}.png`), fullPage: true }).catch(() => {});
    console.error(JSON.stringify({ name: `discover-events-${width}`, error: error.message, errors: state.errors, pages: state.pages }));
    throw error;
  } finally { state.closing = true; await context.close(); }
}

mkdirSync(shots, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
const { server, origin } = await serverForBuild();
const browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
try {
  for (const width of [390, 1280]) await scenario(browser, origin, width);
  console.log(JSON.stringify({ passed: 2, failed: 0, network: "isolated fixtures only", screenshots: shots }));
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
