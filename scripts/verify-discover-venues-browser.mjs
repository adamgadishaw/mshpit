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
  const room = name => page.getByRole("button", { name: new RegExp(`^Select venue \\d+: ${name}$`) });
  const view = name => page.getByRole("button", { name: `View venue ${name}`, exact: true });
  const selectPin = async name => {
    // Use the actual reachable touch target, never a forced click or a list
    // shortcut. Repeated taps intentionally cycle crowded map clusters.
    for (let attempt = 0; attempt < 24; attempt++) {
      if (await view(name).count()) return;
      const before = await page.getByRole("button", { name: /^View venue / }).getAttribute("aria-label");
      if (width < 620) await pin(name).tap(); else await pin(name).click();
      await page.waitForFunction(previous => document.querySelector('[aria-label^="View venue "]')?.getAttribute("aria-label") !== previous, before);
    }
    assert.fail(`Repeated normal map-pin taps must reach ${name}.`);
  };
  const name = `discover-venues-${mode}-${width}`;
  try {
    await page.goto(origin + "/discover", { waitUntil: "domcontentloaded", timeout: 12_000 });
    await page.getByRole("tab", { name: "Venues", exact: true }).click();
    await page.getByRole("heading", { name: "Explore venues", exact: true }).waitFor();
    await page.getByRole("button", { name: "Explore Toronto, Ontario, Canada", exact: true }).click();
    await view("Fixture Harbour Hall").waitFor();
    await selected(page.getByRole("button", { name: "Explore Toronto, Ontario, Canada", exact: true }));
    await assertCityMap(page, state, "Toronto", mode);
    if (mode === "fallback") await page.getByText("LOCATION PLOT · STREET MAP UNAVAILABLE", { exact: true }).waitFor();
    const map = page.locator('[aria-label="Venue locations in Toronto"]');
    const legendHeading = page.getByText("2 · SELECT A VENUE", { exact: true });
    const mapBox = await map.boundingBox(), legendBox = await legendHeading.boundingBox();
    assert.ok(mapBox && mapBox.height > 160 && legendBox, "The map and venue legend must have usable dimensions.");
    if (width < 900) {
      const captionBox = await page.getByText(/^\d+ venues plotted/).boundingBox();
      assert.ok(captionBox, "The mobile map caption must remain visible.");
      const mapToCaptionGap = captionBox.y - (mapBox.y + mapBox.height);
      const detailBox = await page.locator('[aria-label="Selected venue: Fixture Harbour Hall"]').boundingBox();
      const detailToListGap = legendBox.y - (detailBox.y + detailBox.height);
      assert.ok(mapToCaptionGap >= 0 && mapToCaptionGap <= 20 && detailToListGap >= 0 && detailToListGap <= 40,
        `The mobile map, current venue preview and venue list must remain together (${mapToCaptionGap}px / ${detailToListGap}px).`);
    }
    await room("Fixture Harbour Hall").scrollIntoViewIfNeeded();
    const firstRoomBox = await room("Fixture Harbour Hall").boundingBox();
    assert.ok(firstRoomBox && firstRoomBox.height >= 44 && firstRoomBox.y < 900 && firstRoomBox.y + firstRoomBox.height > 0, "The first venue row must be visible and touchable after scrolling.");
    await page.screenshot({ path: join(screenshotDirectory, `${name}-list.png`), fullPage: true });
    await map.evaluate(node => node.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: join(screenshotDirectory, `${name}-map.png`), fullPage: true });
    const harbourPreview = page.locator('[aria-label="Selected venue: Fixture Harbour Hall"]');
    const harbourShows = harbourPreview.getByRole("button", { name: /^View Fixture Band harbour-/ });
    assert.equal(await harbourShows.count(), width < 900 ? 1 : 3);
    await harbourPreview.getByRole("button", { name: "Show all 4 listed shows at Fixture Harbour Hall", exact: true }).click();
    assert.equal(await harbourShows.count(), 4, "All loaded shows must be available directly within the selected venue preview.");
    await harbourPreview.getByRole("button", { name: "Show fewer listed shows at Fixture Harbour Hall", exact: true }).click();
    assert.equal(await harbourShows.count(), width < 900 ? 1 : 3);
    await selectPin("Fixture Basement");
    await view("Fixture Basement").waitFor();
    await selected(pin("Fixture Basement")); await selected(room("Fixture Basement"));
    await room("Fixture Harbour Hall").click();
    await view("Fixture Harbour Hall").waitFor();
    await selected(pin("Fixture Harbour Hall")); await selected(room("Fixture Harbour Hall"));
    await selectPin("Z Fixture Écho Room");
    await selected(room("Z Fixture Écho Room"));
    await page.waitForFunction(() => {
      const list = document.querySelector('[data-testid="discover-venue-list"]');
      const active = list?.querySelector('[aria-pressed="true"]');
      if (!list || !active) return false;
      const parent = list.getBoundingClientRect(), row = active.getBoundingClientRect();
      return row.top >= parent.top - 1 && row.bottom <= parent.bottom + 1;
    });
    const search = page.getByRole("textbox", { name: "Find a city or venue", exact: true });
    await search.fill("REBEL");
    assert.equal(await room("REBEL").count(), 1, "Reviewed duplicate REBEL listings should be one selectable venue.");
    assert.equal(await room("NOIR \\(inside REBEL\\)").count(), 1, "A different room inside REBEL must remain separate.");
    await room("REBEL").click();
    const rebelPreview = page.locator('[aria-label="Selected venue: REBEL"]');
    if (width < 900) await rebelPreview.getByRole("button", { name: "Show all 2 listed shows at REBEL", exact: true }).click();
    assert.equal(await rebelPreview.getByRole("button", { name: /^View Fixture Band rebel-/ }).count(), 2,
      "The merged REBEL preview must retain shows from both original provider venue IDs.");
    assert.equal(await page.getByText(/^Open the venue to see all/).count(), 0, "The preview must not promise a separate detail route has the merged inventory.");
    await room("NOIR \\(inside REBEL\\)").click();
    await room("REBEL").click();
    assert.equal(await rebelPreview.getByRole("button", { name: /^View Fixture Band rebel-/ }).count(), width < 900 ? 1 : 2,
      "Selecting another venue resets the expanded show window.");
    await search.fill("Fixture Echo");
    await view("Z Fixture Écho Room").waitFor();
    await selected(room("Z Fixture Écho Room")); await selected(pin("Z Fixture Écho Room"));
    assert.ok(await room("Z Fixture Écho Room").isVisible(), "An accent-insensitive venue search reveals the room, not just its city.");
    assert.equal(await room("Fixture Harbour Hall").count(), 0, "Venue-name search must filter unrelated list rows.");
    assert.equal(await pin("Fixture Harbour Hall").count(), 0, "The map must show the same filtered venues as its list.");
    await search.fill("Fixture Unmapped Room");
    await view("Fixture Unmapped Room").waitFor();
    assert.equal(await pin("Fixture Unmapped Room").count(), 0, "Missing coordinates cannot become an ocean pin.");
    await page.getByText("Map location not confirmed. Venue details and shows are still available.", { exact: true }).waitFor();
    await search.fill("");
    await page.getByRole("button", { name: "Explore Lisbon, Portugal", exact: true }).click();
    await view("Fixture Lisbon Room").waitFor(); await selected(pin("Fixture Lisbon Room"));
    await selected(page.getByRole("button", { name: "Explore Lisbon, Portugal", exact: true }));
    await selected(page.getByRole("button", { name: "Explore Toronto, Ontario, Canada", exact: true }), false);
    assert.equal(await view("Fixture Harbour Hall").count(), 0, "City change resets the previous city's venue selection.");
    await assertCityMap(page, state, "Lisbon", mode);
    await page.getByRole("button", { name: "Explore London, United Kingdom", exact: true }).click();
    await view("Fixture London Coliseum").waitFor();
    await selected(page.getByRole("button", { name: "Explore London, United Kingdom", exact: true }));
    await selected(page.getByRole("button", { name: "Explore Lisbon, Portugal", exact: true }), false);
    await assertCityMap(page, state, "London", mode);
    await selectPin("Fixture London River Room");
    await view("Fixture London River Room").waitFor();
    await selected(pin("Fixture London River Room")); await selected(room("Fixture London River Room"));
    if (width < 620) {
      assert.equal(await pin("Fixture London River Room").getAttribute("aria-label"), await pin("The O2 Arena").getAttribute("aria-label"), "Nearby London venues must share a mobile target instead of hiding each other.");
      assert.match(await pin("Fixture London River Room").getAttribute("aria-label"), /Tap to cycle venues$/);
    }
    await selectPin("The O2 Arena");
    await view("The O2 Arena").waitFor();
    await selected(pin("The O2 Arena")); await selected(room("The O2 Arena"));
    await selectPin("Fixture London River Room");
    await view("Fixture London River Room").waitFor();
    await selected(pin("Fixture London River Room")); await selected(room("Fixture London River Room"));
    await assertCityMap(page, state, "London", mode);
    await page.locator('[aria-label="Venue locations in London"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDirectory, `${name}-london.png`), fullPage: true });
    await search.fill("A definitely absent venue xyz");
    await page.getByText("No matching venues in Worldwide", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Clear city search", exact: true }).click();
    await page.getByRole("button", { name: "Explore Toronto, Ontario, Canada", exact: true }).click();
    await room("Fixture Basement").focus(); await page.keyboard.press("Enter");
    await view("Fixture Basement").waitFor(); await selected(pin("Fixture Basement"));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Explorer must not create horizontal document overflow.");
    assert.equal(state.calls.some(call => call.path.startsWith("/api/feed")), false);
    assert.deepEqual(state.calls.filter(call => call.method !== "GET"), [], "Guest browsing cannot issue mutations.");
    assert.deepEqual(state.reports, [], "No client crash reports may be emitted.");
    assert.deepEqual(state.errors, [], "No browser errors or missing fixtures may be hidden.");
    assert.ok(state.maps > 0, "Export with an inert EXPO_PUBLIC_GOOGLE_MAPS_KEY=fixture-only so this test covers successful and failed map images; all map traffic is intercepted locally.");
    await page.getByRole("heading", { name: "Explore venues", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDirectory, `${name}.png`), fullPage: true });
    console.log(JSON.stringify({ name, passed: true, mockedMapRequests: state.maps }));
  } catch (error) {
    await page.screenshot({ path: join(screenshotDirectory, `${name}-failed.png`), fullPage: true }).catch(() => {});
    console.error(JSON.stringify({ name, error: error.message, state, body: (await page.locator("body").innerText()).slice(-5500) }));
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
