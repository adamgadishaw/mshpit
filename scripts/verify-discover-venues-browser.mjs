#!/usr/bin/env node
// Real exported app, synthetic public venues and loopback-only API responses.
// External map images are mocked, never downloaded or billed during this test.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureApiResponse } from "./verify-navigation-browser.mjs";
import { arenaVenueEntries } from "../src/domain/majorVenueFacts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDirectory = join(root, ".tmp", "discover-venues-browser");
const mapHosts = new Set(["maps.googleapis.com", "api.mapbox.com"]);
const fixtureYear = new Date().getUTCFullYear() + 1;
const mapSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#0f1a24"/><path d="M0 90H640M0 210H640M0 330H640M100 0V420M320 0V420M540 0V420" stroke="#485768" stroke-width="3"/><text x="16" y="24" font-family="sans-serif" font-size="12" fill="#b9c6d4">Synthetic basemap — no external map request</text></svg>`;
const event = (id, venue, providerVenueId, { city = "Toronto", region = "Ontario", country = "Canada", lat = 43.65, lng = -79.38, day = 1 } = {}) => Object.freeze({
  id, artist: `Fixture Band ${id}`, artistKey: `fixture-${id}`, venue, providerVenueId, source: "ticketmaster",
  place: [city, region, country].filter(Boolean).join(", "), venueCity: city, venueRegion: region, venueCountry: country,
  venueCountryCode: ({ Canada: "CA", Portugal: "PT", "United Kingdom": "GB" })[country], lat, lng,
  date: `${fixtureYear}-09-${String(day).padStart(2, "0")}`, releaseAt: 0, providerActive: true,
});
export const discoverVenueEvents = Object.freeze([
  ...[1, 2, 3, 4].map(day => event(`harbour-${day}`, "Fixture Harbour Hall", "fixture-harbour", { lat: 43.63, lng: -79.35, day })),
  ...[4, 5].map(day => event(`basement-${day}`, "Fixture Basement", "fixture-basement", { lat: 43.66, lng: -79.41, day })),
  ...Array.from({ length: 9 }, (_, index) => event(`room-${index}`, `A Fixture Room ${index}`, `fixture-room-${index}`, { lat: 43.7 + index * .004, lng: -79.49 + index * .006, day: index + 6 })),
  event("echo", "Z Fixture Écho Room", "fixture-echo", { lat: 43.68, lng: -79.32, day: 20 }),
  event("unmapped", "Fixture Unmapped Room", "fixture-unmapped", { lat: null, lng: null, day: 21 }),
  event("rebel-primary", "REBEL", "KovZpZAdIFaA", { lat: 43.6417, lng: -79.3547, day: 22 }),
  event("rebel-secondary", "REBEL", "rZ7HnEZae-8", { lat: 43.6417, lng: -79.3547, day: 23 }),
  event("noir-distinct", "NOIR (inside REBEL)", "rZ7HnEZ178UZA", { lat: 43.6417, lng: -79.3547, day: 24 }),
  event("lisbon", "Fixture Lisbon Room", "fixture-lisbon", { city: "Lisbon", region: "", country: "Portugal", lat: 38.735, lng: -9.14, day: 22 }),
  event("london-coliseum", "Fixture London Coliseum", "fixture-london-coliseum", { city: "London", region: "", country: "United Kingdom", lat: 51.5097, lng: -.1267, day: 23 }),
  event("london-palladium", "Fixture London Palladium", "fixture-london-palladium", { city: "London", region: "", country: "United Kingdom", lat: 51.5143, lng: -.1408, day: 24 }),
  event("london-river", "Fixture London River Room", "fixture-london-river", { city: "London", region: "", country: "United Kingdom", lat: 51.5019, lng: -.018, day: 25 }),
]);

// Parse the outgoing provider request independently of the app's projection.
// A generic mocked image alone can conceal a basemap 180 degrees from its pins.
export function requestedVenueBasemap(value) {
  const url = new URL(value);
  let provider, lat, lng, zoom, width, height;
  if (url.hostname === "maps.googleapis.com" && url.pathname === "/maps/api/staticmap") {
    provider = "google";
    [lat, lng] = (url.searchParams.get("center") || "").split(",").map(Number);
    zoom = Number(url.searchParams.get("zoom"));
    [width, height] = (url.searchParams.get("size") || "").split("x").map(Number);
  } else if (url.hostname === "api.mapbox.com") {
    provider = "mapbox";
    const match = url.pathname.match(/\/static\/([^/]+)\/(\d+)x(\d+)(?:@2x)?$/);
    assert.ok(match, "Expected a center-based Mapbox static image request.");
    [lng, lat, zoom] = match[1].split(",").map(Number);
    width = Number(match[2]); height = Number(match[3]);
  } else assert.fail("Unexpected basemap provider or path.");
  assert.ok([lat, lng, zoom, width, height].every(Number.isFinite), "Basemap coordinates and dimensions must be numeric.");
  assert.ok(Math.abs(lat) <= 85 && Math.abs(lng) <= 180 && zoom >= 0 && zoom <= 22 && width > 0 && height > 0, "Basemap coordinates and dimensions must be valid.");
  return { provider, lat, lng, zoom, width, height };
}

export function assertVenueBasemapCity(basemap, city) {
  const cities = { Toronto: [43.65, -79.38], Lisbon: [38.735, -9.14], London: [51.51, -.13] };
  const center = cities[city];
  assert.ok(center, "Map assertions need an explicitly known fixture city.");
  assert.ok(Math.abs(basemap.lat - center[0]) < .5 && Math.abs(basemap.lng - center[1]) < .5,
    `The requested ${city} basemap must cover that city, not another part of Earth (${basemap.lat}, ${basemap.lng}).`);
  const googleEquivalentZoom = basemap.zoom + (basemap.provider === "mapbox" ? 1 : 0);
  assert.ok(googleEquivalentZoom >= 9 && googleEquivalentZoom <= 14, `${city} needs a usable city/street zoom, not a world map.`);
  assert.deepEqual([basemap.width, basemap.height], [640, 420], "The image and overlay must use the same logical aspect ratio.");
}

// Provider pixels: independent sin-based Mercator form, not discoverVenueMap().
export function requestedVenuePixel(basemap, coordinate) {
  const worldSize = (basemap.provider === "mapbox" ? 512 : 256) * 2 ** basemap.zoom;
  const mercatorY = lat => { const sine = Math.sin(lat * Math.PI / 180); return .5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI); };
  const longitudeDelta = ((coordinate.lng - basemap.lng + 540) % 360) - 180;
  return { x: basemap.width / 2 + longitudeDelta / 360 * worldSize,
    y: basemap.height / 2 + (mercatorY(coordinate.lat) - mercatorY(basemap.lat)) * worldSize };
}

export function venuePinLabelPattern(name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^Map pin \\d+: (?:.*?, )?${escaped}(?:, |\\. Tap to cycle venues$|$)`);
}

export function requestedVenueGroupPixel(basemap, coordinates) {
  assert.ok(coordinates.length, "A map cluster needs at least one coordinate.");
  const points = coordinates.map(coordinate => requestedVenuePixel(basemap, coordinate));
  return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
}

export function venuePinMembers(label) {
  assert.match(label || "", /^Map pin \d+: /, "A map pin must identify its venues accessibly.");
  return label.replace(/^Map pin \d+: /, "").replace(/\. Tap to cycle venues$/, "").split(", ");
}

async function assertCityMap(page, state, city, mode) {
  const map = page.locator(`[aria-label="Venue locations in ${city}"]`);
  await map.waitFor();
  let basemap;
  if (mode === "fallback") {
    await map.getByText("LOCATION PLOT · STREET MAP UNAVAILABLE", { exact: true }).waitFor();
    basemap = state.mapRequests.at(-1);
  } else {
    const image = map.locator(`[aria-label="Street map of ${city}"]`);
    await image.waitFor();
    await page.waitForFunction(label => {
      const node = document.querySelector(`[aria-label="${label}"]`);
      const image = node?.matches("img") ? node : node?.querySelector("img");
      return image?.complete && image.naturalWidth > 0;
    }, `Street map of ${city}`);
    const source = await image.evaluate(node => { const image = node.matches("img") ? node : node.querySelector("img"); return image.currentSrc || image.src; });
    basemap = requestedVenueBasemap(source);
    assert.ok(state.mapRequests.some(request => JSON.stringify(request) === JSON.stringify(basemap)), "The visible basemap must correspond to an intercepted outgoing request.");
  }
  assert.ok(basemap, `Expected an actual outgoing ${city} basemap request.`);
  assertVenueBasemapCity(basemap, city);
  const mapBox = await map.boundingBox();
  // Public coordinate facts are safe to reuse; the provider projection above is
  // intentionally independent of both the app projection and cluster helper.
  const coordinates = new Map(arenaVenueEntries.map(([, row]) => row).filter(row => row.place.split(",")[0] === city).map(row => [row.name, row]));
  discoverVenueEvents.filter(row => row.venueCity === city && row.lat != null && row.lng != null).forEach(row => coordinates.set(row.venue, row));
  let checkedPins = 0;
  const hitboxes = [];
  for (const pin of await map.getByRole("button", { name: /^Map pin / }).all()) {
    const members = venuePinMembers(await pin.getAttribute("aria-label"));
    const box = await pin.boundingBox();
    assert.ok(box && mapBox, `The ${members.join(", ")} overlay must be measurable.`);
    hitboxes.push({ ...box, members });
    if (!members.every(name => coordinates.has(name))) continue;
    checkedPins++;
    const expected = requestedVenueGroupPixel(basemap, members.map(name => coordinates.get(name)));
    const actual = { x: (box.x + box.width / 2 - mapBox.x) * basemap.width / mapBox.width, y: (box.y + box.height / 2 - mapBox.y) * basemap.height / mapBox.height };
    assert.ok(Math.abs(actual.x - expected.x) < 2 && Math.abs(actual.y - expected.y) < 2,
      `${city}: ${members.join(", ")} must land on its requested basemap coordinate/cluster centroid, not merely inside an unrelated mock image.`);
  }
  assert.ok(checkedPins > 0, `The ${city} basemap regression must compare at least one real fixture pin.`);
  for (let i = 0; i < hitboxes.length; i++) for (let j = i + 1; j < hitboxes.length; j++) {
    const first = hitboxes[i], second = hitboxes[j];
    const overlapWidth = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
    const overlapHeight = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
    assert.ok(overlapWidth <= .5 || overlapHeight <= .5, `${city}: nearby pin hitboxes must not block each other (${first.members.join(", ")} / ${second.members.join(", ")}).`);
  }
}

export function discoverVenueFixture(pathname, options = {}) {
  assert.equal(options.method || "GET", "GET", "The guest venue explorer must not mutate data.");
  if (pathname === "/api/tourdates") return { tourDates: discoverVenueEvents };
  if (pathname === "/api/venues/fixture%20london%20river%20room/photos") return { photos: [], fanPhotos: [], state: "ready" };
  if (pathname === "/api/discover/overview") return {
    chart: { rows: [], source: "popularity" }, genres: [], countries: [{ country: "Canada", count: 16 }, { country: "Portugal", count: 1 }, { country: "United Kingdom", count: 3 }],
    eventCoverage: { total: discoverVenueEvents.length, venueTotal: 17, countries: [{ country: "Canada", count: 16 }, { country: "Portugal", count: 1 }, { country: "United Kingdom", count: 3 }] },
  };
  return fixtureApiResponse(pathname, { ...options, member: false });
}

async function localServer() {
  const directory = resolve(root, process.env.PIT_NAVIGATION_BROWSER_DIST || "dist");
  const htmlPath = join(directory, "index.html");
  assert.ok(statSync(htmlPath).isFile(), "Build the current web export first.");
  const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    if (request.method !== "GET" || url.pathname.startsWith("/api/")) return void response.writeHead(405).end();
    let file;
    try { file = resolve(directory, `.${decodeURIComponent(url.pathname)}`); } catch { return void response.writeHead(400).end(); }
    if (!file.startsWith(directory + sep)) return void response.writeHead(400).end();
    try { if (!statSync(file).isFile()) file = htmlPath; } catch { file = htmlPath; }
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(readFileSync(file));
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function selected(locator, value = true) {
  await locator.waitFor();
  const actual = await locator.getAttribute("aria-pressed") ?? await locator.getAttribute("aria-selected");
  assert.equal(actual, String(value), `Selected venue controls need an accessible selected/pressed state: ${await locator.evaluate(node => node.outerHTML.slice(0, 900))}`);
}

async function scenario(browser, origin, width, mode) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  const state = { errors: [], calls: [], maps: 0, mapRequests: [], reports: [], closing: false };
  await context.addInitScript(allowedOrigin => {
    if (location.origin === allowedOrigin) localStorage.setItem("pit_theme", "stage");
    window.__venueHistory = [];
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function(state, title, url) {
        window.__venueHistory.push({ method, url, index: state?.index });
        return original.apply(this, arguments);
      };
    }
    addEventListener("popstate", () => window.__venueHistory.push({ method: "popstate", url: location.pathname }));
  }, origin);
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    try {
      if (mapHosts.has(url.hostname)) {
        assert.equal(request.method(), "GET"); state.maps++;
        state.mapRequests.push(requestedVenueBasemap(url));
        return await route.fulfill({ contentType: mode === "fallback" ? "image/png" : "image/svg+xml", body: mode === "fallback" ? "intentionally invalid fixture image" : mapSvg });
      }
      if (url.origin !== origin) return await route.abort();
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      state.calls.push({ path: url.pathname, method: request.method() });
      if (url.pathname === "/api/client-errors") {
        state.reports.push(request.postDataJSON());
        return await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
      const body = discoverVenueFixture(url.pathname, { method: request.method(), resolvedPath: url.searchParams.get("path") || undefined });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|canceled|cancelled/i.test(error.message)) return;
      state.errors.push(error.message);
      await route.abort().catch(() => {});
    }
  });
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") state.errors.push(message.text()); });
  const pin = name => page.getByRole("button", { name: venuePinLabelPattern(name) });
  const room = name => page.getByRole("button", { name: `Open venue ${name}`, exact: true });
  const shows = name => page.locator(`[aria-label="Upcoming shows at ${name}"]`);
  const selectPin = async name => {
    // Exercise reachable clustered targets, not forced clicks or list shortcuts.
    for (let attempt = 0; attempt < 24; attempt++) {
      if (await shows(name).count()) return;
      const current = page.locator('[aria-label^="Upcoming shows at "]');
      const before = await current.count() ? await current.getAttribute("aria-label") : null;
      if (width < 620) await pin(name).tap(); else await pin(name).click();
      await page.waitForFunction(previous => document.querySelector('[aria-label^="Upcoming shows at "]')?.getAttribute("aria-label") !== previous, before);
    }
    assert.fail(`Repeated normal map-pin taps must reach ${name}.`);
  };
  const changeCity = async (city, region) => {
    await page.getByRole("button", { name: "Change city", exact: true }).click();
    const citySearch = page.getByRole("textbox", { name: "Find a city", exact: true });
    await citySearch.fill(city);
    await page.getByRole("button", { name: `Explore ${city}, ${region}`, exact: true }).click();
    await page.getByRole("heading", { name: `Venues in ${city}`, exact: true }).waitFor();
    assert.equal(await citySearch.count(), 0, "Picking a city closes the city disclosure.");
  };
  const name = `discover-venues-${mode}-${width}`;
  try {
    await page.goto(origin + "/discover", { waitUntil: "domcontentloaded", timeout: 12_000 });
    await page.getByRole("tab", { name: "Venues", exact: true }).click();
    await page.getByRole("heading", { name: /^Venues in / }).waitFor();
    await changeCity("Toronto", "Ontario, Canada");
    await room("Fixture Harbour Hall").waitFor();
    assert.equal(await page.locator('[aria-label^="Upcoming shows at "]').count(), 0, "The initial list must not open a second detail panel.");
    assert.equal(await page.locator('[aria-label^="Venue locations in "]').count(), 0, "Maps are optional, not a prerequisite to browsing.");
    assert.equal(state.maps, 0, "Browsing the initial venue list must not fetch a map image.");
    const firstRoomBox = await room("Fixture Harbour Hall").boundingBox();
    assert.ok(firstRoomBox && firstRoomBox.height >= 44, "The venue's direct open target must be touch-sized.");
    await page.getByRole("heading", { name: "Venues in Toronto", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDirectory, `${name}-list.png`), fullPage: true });

    const harbourToggle = page.getByRole("button", { name: "Show 4 upcoming shows at Fixture Harbour Hall", exact: true });
    await harbourToggle.focus(); await page.keyboard.press("Enter");
    const harbourShows = shows("Fixture Harbour Hall").getByRole("button", { name: /^View Fixture Band harbour-/ });
    assert.equal(await harbourShows.count(), 3, "Show disclosure initially reveals a bounded preview.");
    await shows("Fixture Harbour Hall").getByRole("button", { name: "Show all 4 listed shows at Fixture Harbour Hall", exact: true }).click();
    assert.equal(await harbourShows.count(), 4);
    await shows("Fixture Harbour Hall").getByRole("button", { name: "Show fewer listed shows at Fixture Harbour Hall", exact: true }).click();
    assert.equal(await harbourShows.count(), 3);
    await page.getByRole("button", { name: "Hide 4 upcoming shows at Fixture Harbour Hall", exact: true }).click();
    assert.equal(await shows("Fixture Harbour Hall").count(), 0);

    await page.getByRole("button", { name: "Show venue map", exact: true }).click();
    await assertCityMap(page, state, "Toronto", mode);
    const map = page.locator('[aria-label="Venue locations in Toronto"]');
    const mapBox = await map.boundingBox();
    assert.ok(mapBox && mapBox.height >= 160, "The optional map has a usable size even on narrow phones.");
    await map.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDirectory, `${name}-map.png`), fullPage: true });
    await selectPin("Fixture Basement");
    await selected(pin("Fixture Basement"));
    assert.equal(await shows("Fixture Basement").count(), 1);
    await selectPin("Z Fixture Écho Room");
    await room("Z Fixture Écho Room").waitFor();
    assert.equal(await shows("Z Fixture Écho Room").count(), 1, "A map selection reveals a venue outside the initial row window.");
    const revealed = await room("Z Fixture Écho Room").boundingBox();
    assert.ok(revealed && revealed.y < 900 && revealed.y + revealed.height > 0, "A map selection scrolls the selected venue into view.");

    const search = page.getByRole("textbox", { name: "Search venues in Toronto", exact: true });
    await search.fill("REBEL");
    assert.equal(await room("REBEL").count(), 1, "Reviewed duplicate REBEL listings are one direct-open venue.");
    assert.equal(await room("NOIR (inside REBEL)").count(), 1, "A separately identified room stays separate.");
    await page.getByRole("button", { name: "Show 2 upcoming shows at REBEL", exact: true }).click();
    assert.equal(await shows("REBEL").getByRole("button", { name: /^View Fixture Band rebel-/ }).count(), 2, "Both original REBEL provider IDs retain their shows.");
    assert.equal(await page.getByText(/^Open the venue to see all/).count(), 0);
    await page.getByRole("button", { name: "Show 1 upcoming show at NOIR (inside REBEL)", exact: true }).click();
    assert.equal(await shows("REBEL").count(), 0, "Only one venue's optional show preview is open at a time.");

    await search.fill("Fixture Echo");
    await room("Z Fixture Écho Room").waitFor();
    assert.equal(await room("Fixture Harbour Hall").count(), 0);
    assert.equal(await pin("Fixture Harbour Hall").count(), 0, "The optional map and list use the same city-scoped search.");
    assert.equal(await page.getByRole("heading", { name: "Venues in Toronto", exact: true }).count(), 1, "Typing a venue name must never switch cities.");
    await search.fill("Fixture Unmapped Room");
    await room("Fixture Unmapped Room").waitFor();
    assert.equal(await pin("Fixture Unmapped Room").count(), 0, "Missing coordinates cannot turn into an ocean pin.");
    await page.getByText("VENUE COORDINATES NOT YET AVAILABLE", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Show 1 upcoming show at Fixture Unmapped Room", exact: true }).click();
    await page.getByText("Map location not confirmed. You can still open this venue and its shows.", { exact: true }).waitFor();

    await search.fill("A definitely absent venue xyz");
    await page.getByText('No venues match “A definitely absent venue xyz”', { exact: true }).waitFor();
    await page.getByRole("button", { name: "Show all venues in Toronto", exact: true }).click();
    await room("Fixture Harbour Hall").waitFor();
    await page.getByRole("button", { name: "Hide venue map", exact: true }).click();
    assert.equal(await page.locator('[aria-label^="Venue locations in "]').count(), 0);

    const cityDisclosure = page.getByRole("button", { name: "Change city", exact: true });
    await cityDisclosure.focus(); await page.keyboard.press("Enter");
    const citySearch = page.getByRole("textbox", { name: "Find a city", exact: true });
    await citySearch.fill("There is no such city xyz");
    await page.getByText("No cities match. Try another name or change the country above.", { exact: true }).waitFor();
    assert.equal(await room("Fixture Harbour Hall").count(), 1, "An unsuccessful city search cannot hide the current city's venues.");
    await page.getByRole("button", { name: "Clear city search", exact: true }).click();
    await cityDisclosure.click();

    await changeCity("Lisbon", "Portugal");
    await room("Fixture Lisbon Room").waitFor();
    assert.equal(await room("Fixture Harbour Hall").count(), 0);
    assert.equal(await page.locator('[aria-label^="Upcoming shows at "]').count(), 0, "Changing city resets the previous venue selection.");
    await page.getByRole("button", { name: "Show venue map", exact: true }).click();
    await assertCityMap(page, state, "Lisbon", mode);
    await changeCity("London", "United Kingdom");
    await room("Fixture London Coliseum").waitFor();
    await assertCityMap(page, state, "London", mode);
    await selectPin("Fixture London River Room");
    await selected(pin("Fixture London River Room"));
    if (width < 620) {
      assert.equal(await pin("Fixture London River Room").getAttribute("aria-label"), await pin("The O2 Arena").getAttribute("aria-label"), "Nearby rooms share a usable mobile map target.");
    }
    await selectPin("The O2 Arena");
    await selected(pin("The O2 Arena"));
    await selectPin("Fixture London River Room");
    await selected(pin("Fixture London River Room"));
    await assertCityMap(page, state, "London", mode);
    await page.locator('[aria-label="Venue locations in London"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDirectory, `${name}-london.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Explorer must not create horizontal overflow.");
    assert.equal(state.calls.some(call => call.path.startsWith("/api/feed")), false);
    assert.deepEqual(state.calls.filter(call => call.method !== "GET"), [], "Guest browsing cannot issue mutations.");
    assert.deepEqual(state.reports, [], "No client crash reports may be emitted.");
    assert.deepEqual(state.errors, [], "No browser errors or missing fixtures may be hidden.");
    assert.ok(state.maps > 0, "Build with an inert EXPO_PUBLIC_GOOGLE_MAPS_KEY=fixture-only; all map traffic stays local.");
    await page.getByRole("button", { name: "Hide venue map", exact: true }).click();
    await page.getByRole("heading", { name: "Venues in London", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDirectory, `${name}.png`), fullPage: true });
    await room("Fixture London River Room").focus(); await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Fixture London River Room", exact: true }).waitFor();
    assert.match(new URL(page.url()).pathname, /^\/venue\/.*fixture-london-river/, "Opening a venue must update the browser address, not only the visible panel.");
    await page.goBack();
    await page.getByRole("heading", { name: /^Venues in / }).waitFor();
    await page.waitForURL(origin + "/discover");
    assert.equal(new URL(page.url()).pathname, "/discover", "Browser Back must restore the Discover route.");
    assert.deepEqual(state.reports, []);
    assert.deepEqual(state.errors, [], "Primary venue navigation must not hide missing API fixture errors.");
    console.log(JSON.stringify({ name, passed: true, mockedMapRequests: state.maps }));
  } catch (error) {
    await page.screenshot({ path: join(screenshotDirectory, `${name}-failed.png`), fullPage: true }).catch(() => {});
    console.error(JSON.stringify({ name, error: error.message, state, history: await page.evaluate(() => window.__venueHistory), body: (await page.locator("body").innerText()).slice(-5500) }));
    throw error;
  } finally { state.closing = true; await context.close(); }
}

export async function main() {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
  mkdirSync(screenshotDirectory, { recursive: true });
  const { server, origin } = await localServer(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    for (const width of [320, 375, 1280]) for (const mode of ["map", "fallback"]) await scenario(browser, origin, width, mode);
    console.log(JSON.stringify({ passed: 6, failed: 0, network: "isolated fixtures only", screenshots: screenshotDirectory }));
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
