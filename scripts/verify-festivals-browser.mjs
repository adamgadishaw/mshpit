#!/usr/bin/env node
// Current exported app, synthetic member, loopback-only mocked APIs. The
// festival page (lineup by day, going plan) and Discover's Festivals tab.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "festivals-browser");
const days = ["2027-07-29", "2027-07-30", "2027-07-31", "2027-08-01"];
const acts = ["Sabrina Carpenter", "Tyler, The Creator", "Olivia Rodrigo", "Doechii", "Clairo", "Glass Animals", "Muna", "Kaytranada"];
const lineup = acts.map((name, index) => ({ name, days: [days[index % 4]] }));
const edition = {
  id: "lollapalooza:2027-07-29:chicago", festivalSlug: "lollapalooza", festivalName: "Lollapalooza", name: "Lollapalooza 2027",
  startDate: "2027-07-29", endDate: "2027-08-01", days, venue: "Grant Park", city: "Chicago", region: "IL", countryCode: "US",
  imageUrl: null, ticketUrl: null, lineupCount: acts.length, headliners: acts.slice(0, 6), lineupChangedAt: null, going: 12,
};
const festival = { slug: "lollapalooza", name: "Lollapalooza", city: "Chicago", country: "US", foundedYear: 1991, website: null,
  about: "Lollapalooza is an annual music festival held in Grant Park in Chicago.", aboutSource: { url: "https://en.wikipedia.org/wiki/Lollapalooza", license: "CC BY-SA 4.0" } };

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
  // The phone pass also covers reduced motion: the page must be complete with no entrance animation.
  const context = await browser.newContext({ viewport: { width, height: 1200 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block",
    reducedMotion: width < 620 ? "reduce" : "no-preference" });
  const state = { plan: null, writes: [], errors: [], external: [], closing: false };
  await context.addInitScript((user) => {
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
  }, navigationUser);
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
      if (url.pathname === "/api/client-errors") return await json({ ok: true });
      if (url.pathname === "/api/festivals") return await json({ upcoming: [edition], festivals: [] });
      if (url.pathname === "/api/festivals/lollapalooza") {
        return await json({ festival, upcoming: [{ ...edition, lineup, going: 12 + (state.plan ? 1 : 0), goingByDay: {}, mustSee: [], plan: state.plan }],
          past: [], expected: null, reviews: [], reviewStats: { reviews: 0, average: null } });
      }
      if (url.pathname === "/api/festivals/lollapalooza/plan" && request.method() === "PUT") {
        const body = request.postDataJSON();
        assert.equal(request.headers()["x-pit-expected-account"], navigationUser.id);
        state.writes.push(body);
        state.plan = { days: body.days, mustSee: body.mustSee, updatedAt: 1 };
        return await json({ plan: { editionId: body.editionId, ...state.plan } });
      }
      return await json(fixtureApiResponse(url.pathname, { member: true, method: request.method() }));
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message);
      await route.abort().catch(() => { /* Fixture teardown may already have closed the route. */ });
    }
  });
  try {
    await page.goto(origin + "/festival/lollapalooza", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Lollapalooza 2027" }).first().waitFor();
    await page.getByText("Jul 29 to Aug 1, 2027", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("link", { name: "Open Muna", exact: true }).count(), 1);

    // Day tabs show only that day's sets.
    await page.getByRole("tab", { name: "Sat, Jul 31", exact: true }).click();
    await page.getByRole("link", { name: "Open Olivia Rodrigo", exact: true }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Open Sabrina Carpenter", exact: true }).count(), 0, "Thursday's headliner is not on Saturday");
    await page.getByRole("tab", { name: "All days", exact: true }).click();

    // Going: pick days and a must-see set.
    await page.getByRole("button", { name: "Say you're going", exact: true }).click();
    await page.getByRole("checkbox", { name: "Fri, Jul 30", exact: true }).click();
    await page.getByRole("checkbox", { name: "Sat, Jul 31", exact: true }).click();
    await page.getByRole("checkbox", { name: "Olivia Rodrigo is a must-see", exact: true }).click();
    await page.screenshot({ path: join(shots, `plan-${width}.png`) });
    await page.getByRole("button", { name: "Save my plan", exact: true }).click();
    await page.getByRole("button", { name: "Edit your festival plan", exact: true }).waitFor();
    assert.deepEqual(state.writes, [{ editionId: edition.id, days: ["2027-07-30", "2027-07-31"], mustSee: ["Olivia Rodrigo"] }]);
    await page.getByText("Going · Fri, Sat", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Share the days you're going", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: join(shots, `festival-${width}.png`) });

    // Discover keeps festivals in their own tab.
    await page.goto(origin + "/discover", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Festivals", exact: true }).click();
    await page.getByRole("link", { name: /^Lollapalooza 2027, Jul 29 to Aug 1, 2027/u }).waitFor();
    await page.getByRole("link", { name: /^Next up: Lollapalooza 2027/u }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "the lit marquee stays inside the page");
    // Let the cards finish rising in before the picture.
    await page.waitForTimeout(width < 620 ? 0 : 1000);
    await page.screenshot({ path: join(shots, `discover-${width}.png`) });
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.external, []);
    console.log(JSON.stringify({ name: `festivals-${width}`, passed: true, writes: state.writes.length }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `failed-${width}.png`) }).catch(() => {});
    console.error(JSON.stringify({ name: `festivals-${width}`, error: error.message, errors: state.errors }));
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
