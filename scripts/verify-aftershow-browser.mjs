// Current exported app; synthetic event and intercepted external handoffs only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { eventPath, fixtureApiResponse } from "./verify-navigation-browser.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, ".tmp", "aftershow-browser");
const venue = "Aftershow Fixture Hall with a deliberately long name";
const coord = { lat: 43.654, lng: -79.379 };
const show = { id: "tm_navigation_fixture", kind: "event", path: eventPath, publicEventSnapshot: true,
  name: "Fixture Artist Live", artist: "Fixture Artist", artistKey: "fixture-artist", venue, city: "Toronto",
  date: "2030-11-11", ...coord };
async function server() {
  const directory = join(root, "dist");
  const host = createServer((request, response) => {
    if (request.method !== "GET" || request.url.startsWith("/api/")) return void response.writeHead(405).end();
    let file = resolve(directory, "." + new URL(request.url, "http://fixture.invalid").pathname);
    if (!file.startsWith(directory + sep)) return void response.writeHead(400).end();
    try { if (!statSync(file).isFile()) file = join(directory, "index.html"); } catch { file = join(directory, "index.html"); }
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" }); response.end(readFileSync(file));
  });
  await new Promise(done => host.listen(0, "127.0.0.1", done));
  return { host, origin: "http://127.0.0.1:" + host.address().port };
}
async function scenario(browser, origin, { width, theme = "stage", missing = false, lifecycle = "upcoming", largeText = false, locationFailure = false }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", timezoneId: "Pacific/Honolulu" });
  const page = await context.newPage();
  const errors = [], calls = [], blocked = [];
  let locationRequests = 0;
  const name = [width, theme, missing ? "empty" : lifecycle, ...(largeText ? ["large-text"] : []), ...(locationFailure ? ["location-retry"] : [])].join("-");
  page.setDefaultTimeout(15000);
  await page.addInitScript(({ theme }) => {
    localStorage.setItem("pit_theme", theme);
    window.__aftershowOpened = [];
    window.__aftershowFail = false;
    window.open = (url) => { if (window.__aftershowFail) throw new Error("Fixture handoff failure"); window.__aftershowOpened.push(url); return null; };
  }, { theme });
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { blocked.push(url.hostname); return await route.abort(); }
    if (!url.pathname.startsWith("/api/")) return await route.continue();
    calls.push({ path: url.pathname, method: request.method() });
    const event = { ...show, ...(lifecycle === "completed" ? { date: "2020-11-11" } : {}), ...(lifecycle === "cancelled" ? { eventStatus: "cancelled" } : {}), ...(missing ? { venue: "Unmapped fixture", lat: null, lng: null } : {}) };
    const json = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.pathname === "/api/resolve") return await json({ entity: event });
      // A name-only cache entry points elsewhere. Canonical coordinates must win.
      if (url.pathname === "/api/venues") return await json({ venues: missing ? [] : [{ name: venue, place: "Wrong city", lat: 1, lng: 2 }] });
      if (url.pathname === "/api/venue-snapshot") {
        locationRequests++;
        if (locationFailure && locationRequests <= 3) return await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Location fixture unavailable' }) });
        return await json({ path: url.searchParams.get('path'),
        venue: { name: event.venue, place: 'Toronto', source: null, providerVenueId: null, coord: missing ? null : coord, address: null, capacity: null },
        events: [], hasMore: false, nextCursor: null, after: null });
      }
      if (url.pathname === "/api/tourdates") return await json({ tourDates: [event] });
      if (url.pathname === "/api/health") return await json({ ok: true });
      if (url.pathname.startsWith("/api/catalog-text/")) return await json({ text: null });
      if (/^\/api\/venues\/.+\/photos$/.test(url.pathname)) return await json({ photos: [], state: "ready" });
      if (url.pathname === "/api/client-errors") { errors.push(request.postDataJSON()); return await json({ ok: true }); }
      return await json(fixtureApiResponse(url.pathname, { method: request.method(), resolvedPath: eventPath }));
    } catch (error) { errors.push(error.message); return await json({}); }
  });
  try {
    await page.goto(origin + eventPath, { waitUntil: "domcontentloaded" });
    const module = page.getByTestId("after-show");
    const toggle = page.getByRole("button", { name: lifecycle === "upcoming" ? "After the show" : "Around the venue", exact: true });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(calls.some(call => call.path === '/api/venue-snapshot'), false, 'The collapsed section makes no venue-location request');
    await toggle.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, name + "-collapsed.png") });
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    if (locationFailure) {
      await page.getByText('Venue location could not load.', { exact: true }).waitFor();
      assert.equal(await module.count(), 0, 'A failed canonical lookup cannot offer a stale route');
      locationRequests = 3;
      await page.getByRole('button', { name: 'Retry venue location', exact: true }).click();
    }
    if (missing) {
      await module.getByText("Nearby planning unavailable", { exact: true }).waitFor();
      assert.equal(await module.getByRole("link").count(), 0);
    } else {
      const food = module.getByRole("link", { name: /Search Google Maps for Late-night food/ });
      await food.waitFor();
      assert.equal(await module.getByRole("link").count(), 2);
      await food.focus(); await food.press("Enter");
      let opened = await page.evaluate(() => window.__aftershowOpened);
      assert.ok(new URL(opened[0]).searchParams.get("query").endsWith(" near " + venue + ", Toronto"));
      await module.getByRole("button", { name: "Stay out", exact: true }).click();
      assert.equal(await module.getByRole("button", { name: "Stay out", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await module.getByRole("link").count(), 3);
      assert.equal(await module.getByText("Coffee & dessert", { exact: true }).count(), 0);
      await page.evaluate(() => { window.__aftershowFail = true; });
      await module.getByRole("link", { name: /Search Google Maps for Bars near/ }).click();
      await module.getByRole("alert").waitFor();
      await page.screenshot({ path: join(output, name + "-error.png") });
      await page.evaluate(() => { window.__aftershowFail = false; });
      await module.getByRole("link", { name: /Search Google Maps for Bars near/ }).click();
      await module.getByRole("alert").waitFor({ state: "hidden" });
      await module.getByRole("button", { name: "Get home", exact: true }).click();
      const input = module.getByRole("textbox", { name: "Where are you heading after the show?" });
      const route = module.getByRole("button", { name: "Open route in Google Maps", exact: true });
      assert.equal(await route.isDisabled(), true);
      await input.fill("Union Station & hotel");
      for (const [label, mode] of [["Transit", "transit"], ["Walking", "walking"], ["Driving", "driving"]]) {
        await module.getByRole("button", { name: label, exact: true }).click();
        await route.click();
        const last = new URL(await page.evaluate(() => window.__aftershowOpened.at(-1)));
        assert.equal(last.searchParams.get("origin"), "43.654,-79.379");
        assert.equal(last.searchParams.get("destination"), "Union Station & hotel");
        assert.equal(last.searchParams.get("travelmode"), mode);
      }
      // Collapse/reopen keeps same-target intent and input, with no stale error.
      await toggle.click(); await toggle.click();
      assert.equal(await input.inputValue(), "Union Station & hotel");
      assert.equal(await module.getByRole("alert").count(), 0);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes("Union Station")), false);
      await module.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, name + "-route.png") });
      // Browser navigation destroys the form. Reopening the show has no destination.
      await page.goto(origin + "/discover", { waitUntil: "domcontentloaded" });
      await page.goto(origin + eventPath, { waitUntil: "domcontentloaded" });
      await toggle.click();
      await module.getByRole("button", { name: "Get home", exact: true }).click();
      assert.equal(await input.inputValue(), "");
      await module.getByRole("button", { name: "Food", exact: true }).click();
    }
    await module.scrollIntoViewIfNeeded();
    if (largeText) {
      // Browser approximation of enlarged text; native Dynamic Type remains
      // a device acceptance check. Read all sizes before changing inheritance.
      await module.evaluate(el => {
        const sizes = [...el.querySelectorAll("div")].filter(node => !node.children.length && node.textContent.trim())
          .map(node => ({ node, size: parseFloat(getComputedStyle(node).fontSize), line: parseFloat(getComputedStyle(node).lineHeight) }));
        for (const { node, size, line } of sizes) { node.style.fontSize = size * 1.6 + "px"; node.style.lineHeight = line * 1.6 + "px"; }
      });
    }
    const overflows = await module.evaluate(el => [el, ...el.querySelectorAll("*")].filter(node => node.getBoundingClientRect().right > innerWidth + 1 || node.getBoundingClientRect().left < -1).length);
    assert.equal(overflows, 0, "Narrow layout has no clipped controls or horizontal overflow.");
    await page.screenshot({ path: join(output, name + ".png") });
    assert.equal(calls.some(call => call.method !== "GET"), false, "Planning must not write app data.");
    assert.deepEqual(errors, []);
    return { name, passed: true, requests: calls.length, externalRequestsBlocked: blocked.length };
  } catch (error) {
    await page.screenshot({ path: join(output, name + "-failed.png") });
    writeFileSync(join(output, name + "-failure.json"), JSON.stringify({ error: error.message, errors, calls, text: await page.locator("body").innerText() }, null, 2));
    throw error;
  } finally { await context.close(); }
}
export async function main() {
  mkdirSync(output, { recursive: true });
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
  const { host, origin } = await server();
  const browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
  const results = [];
  try {
    for (const options of [
      { width: 320 }, { width: 375, theme: "daylight" }, { width: 1280 },
      { width: 375, missing: true }, { width: 375, lifecycle: "completed" }, { width: 375, lifecycle: "cancelled" },
      { width: 375, locationFailure: true },
      { width: 320, largeText: true },
    ]) { const result = await scenario(browser, origin, options); results.push(result); console.log(JSON.stringify(result)); }
    writeFileSync(join(output, "results.json"), JSON.stringify({ results, productionAccess: false }, null, 2));
  } finally { await browser.close(); await new Promise(done => host.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error); process.exitCode = 1; });
