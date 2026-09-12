#!/usr/bin/env node

// Exercise the exported app in a fresh local browser. Every API response is a
// fixture: no application server, real accounts, database, or external traffic.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const timeoutMs = 12_000;
const profileId = "concert-fixture-profile";
const profile = Object.freeze({
  id: profileId, name: "Fixture Profile", handle: "fixtureprofile", role: "fan",
  initials: "FP", avatarUri: null, banner: null, bio: "A fixture of logged concert nights.",
  home: { city: "Toronto, Ontario, Canada" }, genres: [], favoriteArtists: [],
  profileAudience: "everyone", concertMapVisible: true,
});
const concerts = Object.freeze(Array.from({ length: 8 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  const toronto = index < 4;
  return Object.freeze({
    id: `p_concert_fixture_${number}`, postId: `p_concert_fixture_${number}`,
    artist: `Fixture Artist ${number}`, venue: toronto ? "Fixture Toronto Hall" : "Fixture Vancouver Hall",
    venueKey: toronto ? "fixture-toronto-hall" : "fixture-vancouver-hall",
    city: toronto ? "Toronto" : "Vancouver", date: `2026-07-${String(8 - index).padStart(2, "0")}`,
    rating: index === 7 ? null : 4.5, photo: null,
    lat: toronto ? 43.654 : 49.282, lng: toronto ? -79.379 : -123.121,
    countryCode: "CA", country: "Canada",
  });
}));
const cases = [390, 1280].flatMap(width => [
  ...["preview-map-review", "map-off", "unmapped", "failure-retry", "empty"].map(kind => ({
    name: `${kind}-${width}`, kind, width,
  })),
]);

function loadChromium() {
  if (process.env.PIT_PLAYWRIGHT_MODULE) return require(process.env.PIT_PLAYWRIGHT_MODULE).chromium;
  for (const name of ["playwright", "playwright-core"]) {
    try { return require(name).chromium; } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error("Install Playwright separately or set PIT_PLAYWRIGHT_MODULE to its module path.");
}

async function localBuildServer() {
  const directory = resolve(root, process.env.PIT_CONCERT_BROWSER_DIST || "dist");
  const files = new Map();
  const visit = folder => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.set(file, readFileSync(file));
    }
  };
  visit(directory);
  assert.ok(files.has(join(directory, "index.html")), "Run npm run build:web first; dist/index.html is missing.");
  const mime = {
    ".js": "text/javascript", ".html": "text/html", ".css": "text/css",
    ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
    ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf",
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    if (!["GET", "HEAD"].includes(request.method) || url.pathname.startsWith("/api/")) {
      response.writeHead(405).end();
      return;
    }
    let file;
    try { file = resolve(directory, `.${decodeURIComponent(url.pathname)}`); }
    catch { response.writeHead(400).end(); return; }
    if (!file.startsWith(directory + sep) || !files.has(file)) file = join(directory, "index.html");
    response.setHeader("content-type", mime[extname(file)] || "application/octet-stream");
    response.setHeader("cache-control", "no-store");
    response.end(request.method === "HEAD" ? undefined : files.get(file));
  });
  await new Promise((fulfill, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", fulfill); });
  return {
    server, origin: `http://127.0.0.1:${server.address().port}`,
    entry: files.get(join(directory, "index.html")).toString().match(/index-[a-f0-9]+\.js/)?.[0] || "unknown",
  };
}

async function waitFor(check, message) {
  const deadline = Date.now() + timeoutMs;
  while (!await check()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(fulfill => setTimeout(fulfill, 25));
  }
}

async function runCase(browser, origin, item) {
  const context = await browser.newContext({
    viewport: { width: item.width, height: 900 },
    isMobile: item.width < 620, hasTouch: item.width < 620, serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  const mapVisible = item.kind !== "map-off";
  const missingLocation = !mapVisible || item.kind === "unmapped";
  const fixtureRows = item.kind === "empty" ? [] : concerts.map(row => missingLocation ? {
    ...row, lat: null, lng: null, country: null, countryCode: null,
  } : row);
  const state = { historyUnavailable: item.kind === "failure-retry", calls: [], routeErrors: [], pageErrors: [], consoleErrors: [], reports: [] };
  page.on("pageerror", error => state.pageErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") state.consoleErrors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem("pit_theme", "stage"));
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (!url.pathname.startsWith("/api/")) {
        if (url.origin === origin) return await route.continue();
        return await route.abort();
      }
      state.calls.push({ path: url.pathname, query: url.search, method: request.method(), account: request.headers()["x-pit-expected-account"] || null });
      if (url.pathname === "/api/client-errors") { state.reports.push(request.postDataJSON()); return await json({ ok: true }); }
      if (url.pathname === "/api/me") return await json({ user: null });
      if (url.pathname === "/api/resolve") {
        assert.equal(url.searchParams.get("path"), "/@fixtureprofile");
        return await json({ entity: { kind: "profile", id: profileId, path: "/@fixtureprofile" } });
      }
      if (url.pathname === `/api/users/${profileId}`) return await json({ user: { ...profile, concertMapVisible: mapVisible }, followers: 0, following: 0, isFollowing: false });
      if (url.pathname === `/api/users/${profileId}/posts`) return await json({ posts: [], hasMore: false, nextCursor: null });
      if (url.pathname === `/api/users/${profileId}/rewards`) return await json({ points: 0, earnedIds: [] });
      if (url.pathname === `/api/users/${profileId}/concert-history`) {
        assert.equal(request.method(), "GET");
        assert.equal(url.searchParams.get("limit"), "200");
        if (state.historyUnavailable) return await json({ error: "Fixture history temporarily unavailable", code: "INTERNAL_ERROR" }, 503);
        return await json({ concerts: fixtureRows, nextCursor: null, hasMore: false, complete: true, mapVisible,
          coverage: { source: "visible_reviews", includesPrivateAttendance: false, unmappedCount: mapVisible ? missingLocation ? fixtureRows.length : 0 : null } });
      }
      const postMatch = url.pathname.match(/^\/api\/posts\/(p_concert_fixture_\d+)(\/comments)?$/);
      if (postMatch) {
        assert.equal(request.method(), "GET");
        const row = concerts.find(concert => concert.postId === postMatch[1]);
        assert.ok(row, "Only an exact fixture concert may be opened.");
        if (postMatch[2]) return await json({ comments: [], hasMore: false, nextCursor: null });
        return await json({ post: {
          id: row.postId, userId: profileId, user: profile, kind: "concert", experienceType: "live",
          artist: row.artist, venue: row.venue, city: row.city, date: row.date,
          review: `Exact fixture review ${row.postId}.`, text: `Exact fixture review ${row.postId}.`,
          at: Date.parse(`${row.date}T20:00:00Z`), likes: 0, comments: 0,
          overall: row.rating, band: row.rating, room: row.rating, photos: [],
        } });
      }
      if (url.pathname === "/api/media/reactions") return await json({ reactions: {} });
      if (url.pathname.startsWith("/api/feed")) return await json({ posts: [], hasMore: false, hiddenPostIds: [] });
      if (url.pathname === "/api/tourdates") return await json({ tourDates: [] });
      if (url.pathname === "/api/discovery/sidebar") return await json({ upcomingEvents: [], suggestedUsers: [], topArtists: [], trendingVenues: [], popularLounges: [], landingMedia: [], catalogTotals: { artists: 40, venues: 80 } });
      if (url.pathname === "/api/discover/overview") return await json({ artists: [], venues: [], events: [], genres: [], countries: [] });
      throw new Error(`Missing fixture for ${request.method()} ${url.pathname}${url.search}`);
    } catch (error) {
      state.routeErrors.push(error.message);
      await route.abort().catch(() => {});
    }
  });
  let failure = null;
  try {
    await page.goto(`${origin}/@fixtureprofile`, { waitUntil: "networkidle", timeout: timeoutMs });
    const history = page.getByTestId("profile-concert-history");
    await history.waitFor();
    await history.scrollIntoViewIfNeeded();
    const rows = history.locator('[data-testid^="concert-history-row-"]');
    const map = history.getByTestId("profile-concert-map");
    if (item.kind === "failure-retry") {
      await history.getByRole("button", { name: "Retry concert history", exact: true }).waitFor();
      assert.equal(await rows.count(), 0, "A failed history request must not invent saved concerts.");
      const before = state.calls.filter(call => call.path.endsWith("/concert-history")).length;
      state.historyUnavailable = false;
      await history.getByRole("button", { name: "Retry concert history", exact: true }).click();
      await waitFor(() => state.calls.filter(call => call.path.endsWith("/concert-history")).length > before, "Retry did not read concert history again.");
    }
    if (item.kind === "empty") {
      await history.getByText("No concerts logged yet", { exact: true }).waitFor();
      assert.equal(await rows.count(), 0);
      assert.equal(await history.getByRole("button", { name: "See all concerts", exact: true }).count(), 0);
      await map.getByText("A map of nights to remember", { exact: true }).waitFor();
    } else {
      await history.getByText(missingLocation ? "8 concerts · 2 venues" : "8 concerts · 2 venues · 1 country", { exact: true }).waitFor();
      // Desktop has room for five rows; the phone preview stays at three.
      const expectedPreview = item.width < 620 ? 3 : 5;
      await waitFor(async () => await rows.count() === expectedPreview, `Expected ${expectedPreview} compact preview rows.`);
      await history.getByRole("button", { name: "See all concerts", exact: true }).click();
      await waitFor(async () => await rows.count() === 8, "See all did not reveal every fixture concert.");
      await history.getByRole("button", { name: "See less", exact: true }).click();
      await waitFor(async () => await rows.count() === expectedPreview, "See less did not restore the compact preview.");
      if (item.kind === "map-off") {
        assert.equal(await map.count(), 0, "The hidden map must not mount.");
        assert.equal(await history.getByRole("button", { name: /concert map/ }).count(), 0);
      } else if (item.kind === "unmapped") {
        await map.getByText("No mapped venues in this view", { exact: true }).waitFor();
        await map.getByText("8 concerts have no map location; still listed.", { exact: true }).waitFor();
        assert.equal(await map.getByRole("button").count(), 3, "Unmapped concerts must not create fabricated pins.");
        assert.equal(await history.getByText("Location not mapped", { exact: true }).count(), expectedPreview);
      } else if (item.kind === "preview-map-review") {
        const torontoPin = map.getByRole("button", { name: "Fixture Toronto Hall, Toronto. 4 logged concerts.", exact: true });
        const vancouverPin = map.getByRole("button", { name: "Fixture Vancouver Hall, Vancouver. 4 logged concerts.", exact: true });
        await torontoPin.waitFor();
        await history.getByTestId(`concert-history-row-${concerts[0].id}`).getByRole("button", { name: /Select concert on map/ }).click();
        await history.getByText("4 logged concerts · Toronto", { exact: true }).waitFor();
        await history.getByRole("button", { name: "View here", exact: true }).waitFor();
        await vancouverPin.click();
        await history.getByText("AT THIS VENUE", { exact: true }).waitFor();
        await waitFor(async () => await rows.count() === Math.min(expectedPreview, 4), "The venue pin did not filter the list.");
        assert.deepEqual(await rows.evaluateAll(elements => elements.map(element => element.getAttribute("data-testid"))), concerts.slice(4, 4 + expectedPreview).map(row => `concert-history-row-${row.id}`));
        await history.getByRole("button", { name: "All concerts", exact: true }).click();
        await waitFor(async () => await rows.count() === expectedPreview, "All concerts did not clear the venue filter.");
        const exact = concerts[0];
        await history.getByRole("button", { name: `Open review for ${exact.artist} at ${exact.venue}`, exact: true }).click();
        await page.getByText(`Exact fixture review ${exact.postId}.`, { exact: true }).last().waitFor();
        await page.getByRole("button", { name: "Sign in to comment", exact: true }).waitFor();
        const reads = state.calls.filter(call => /^\/api\/posts\/[^/]+$/.test(call.path));
        assert.deepEqual(reads.map(call => call.path), [`/api/posts/${exact.postId}`], "Open review must read the exact selected review once.");
        assert.equal(state.calls.some(call => /\/api\/artists\//.test(call.path)), false, "Open review must not open an artist page.");
        await page.goBack();
        await page.getByTestId("profile-concert-history").waitFor();
        assert.equal(new URL(page.url()).pathname, "/@fixtureprofile", "Back must return to the same public profile.");
      }
    }
    if (process.env.PIT_CONCERT_BROWSER_SCREENSHOTS === "1") {
      mkdirSync(join(root, ".tmp"), { recursive: true });
      await page.getByTestId("profile-concert-history").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(root, ".tmp", `concert-history-${item.name}.png`), fullPage: true });
    }
    await page.waitForTimeout(150);
    assert.deepEqual(state.routeErrors, [], "Fixture/interception failure.");
    assert.deepEqual(state.pageErrors, [], "Uncaught browser error.");
    assert.deepEqual(state.reports, [], "The app sent a crash receipt.");
    assert.deepEqual(state.calls.filter(call => call.method !== "GET" && call.path !== "/api/media/reactions"), [], "Reading concert history must not mutate account data.");
    assert.equal(state.calls.some(call => call.account !== null && call.account !== "guest"), false, "Guest history requests must not impersonate an account.");
    assert.equal(state.consoleErrors.some(message => /TypeError|ReferenceError|Minified React error/.test(message)), false, "Runtime console exception.");
  } catch (error) { failure = error.message; }
  finally { await context.close(); }
  return { name: item.name, passed: !failure, ...(failure ? { failure, ...state } : {}) };
}

async function main() {
  if (process.argv.includes("--list")) { console.log(cases.map(item => item.name).join("\n")); return; }
  const filter = process.argv[2] || "";
  const selected = cases.filter(item => item.name.includes(filter));
  assert.ok(selected.length, `No concert-history browser cases match ${JSON.stringify(filter)}.`);
  const { server, origin, entry } = await localBuildServer();
  let browser;
  try {
    browser = await loadChromium().launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    console.log(JSON.stringify({ build: entry, cases: selected.length, network: "loopback static only; every API request mocked" }));
    const results = [];
    for (const item of selected) {
      const result = await runCase(browser, origin, item);
      results.push(result);
      console.log(JSON.stringify(result));
    }
    console.log(JSON.stringify({ total: results.length, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length }));
    if (results.some(result => !result.passed)) process.exitCode = 1;
  } finally {
    await browser?.close();
    await new Promise(fulfill => server.close(fulfill));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
