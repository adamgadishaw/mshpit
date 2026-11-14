#!/usr/bin/env node
// Exported app, fresh browser contexts, synthetic public records, no live API.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureApiResponse } from "./verify-navigation-browser.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "concert-page-browser");
mkdirSync(shots, { recursive: true });
const image = readFileSync(join(root, "public/images/news/live-music-context.jpg"));
const path = "/concert/fixture-night";
const review = { id: "concert-fixture-review", kind: "review", userId: "public-fixture-author",
  user: { id: "public-fixture-author", name: "Alex Fixture", handle: "alexfixture", role: "fan" },
  artist: "Fixture Artist", artistKey: "fixture-artist", venue: "Fixture Venue", city: "Toronto",
  date: "2026-10-01", overall: 4.7, band: 4.1, room: 3.6, review: "A patient opening, then a great encore. Synthetic review for layout testing.",
  dims: { performance: 4.1, setlist: 4.1, sound: 3.6, venue: 3.6 },
  likes: 3, comments: 0, photos: [], at: 1790812800000 };
const concert = { id: "fixture-night", kind: "concert", path, archiveShowKey: "fixture-night",
  artist: "Fixture Artist", artistKey: "fixture-artist", venue: "Fixture Venue", city: "Toronto",
  date: "2026-10-01", overall: 4.3, ratingCount: 17, reviewCount: 2,
  cover: { uri: "https://concert.fixture.invalid/photo.jpg", by: "Fixture photographer", postId: review.id },
  setlist: ["Fixture opener", "Fixture encore"], inTourWindow: true };

async function localServer() {
  const directory = resolve(root, process.env.PIT_NAVIGATION_BROWSER_DIST || "dist");
  const html = join(directory, "index.html");
  assert.ok(statSync(html).isFile(), "Run npm run build:web first.");
  const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };
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
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function scenario(browser, origin, width, theme, mode = "archive") {
  const name = `${mode}-${theme}-${width}`;
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block", isMobile: width < 620, hasTouch: width < 620 });
  const state = { errors: [], external: [], requests: 0, fail: mode === "error", moreFailed: false, release: null };
  await context.addInitScript(({ theme }) => { localStorage.setItem("pit_theme", theme); localStorage.setItem("pit_theme_owner", "guest"); }, { theme });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => state.errors.push(error.message));
  const upcoming = mode === "upcoming" || mode === "cancelled";
  const individual = mode === "individual" || mode === "individual-archive";
  const post = { ...review, archiveShowKey: "fixture-night" };
  const targetPath = upcoming ? "/event/fixture-night" : individual ? `/post/${review.id}` : path;
  const entity = { ...concert, ...(mode === "empty" ? { overall: null, ratingCount: 0, cover: null, setlist: [] } : {}),
    ...(mode === "long" ? { eventName: "Fixture Artist and Friends: An Evening of Very Long Concert Titles", venue: "Fixture Venue with an Exceptionally Long Name and Outdoor Stage" } : {}),
    ...(upcoming ? { kind: "event", path: targetPath, name: "Fixture Artist", publicEventSnapshot: true, archiveShowKey: null, overall: null, date: "2099-10-01", ticketUrl: "https://www.ticketmaster.com/event/fixture", eventStatus: mode === "cancelled" ? "cancelled" : "active", cover: null,
      eventImage: { uri: "https://concert.fixture.invalid/photo.jpg", attribution: "Fixture promoter", sourcePage: "https://www.ticketmaster.com/event/fixture", width: 1200, height: 800 }, source: "ticketmaster" } : {}) };
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.hostname === "concert.fixture.invalid") return await route.fulfill({ contentType: "image/jpeg", body: image });
      if (url.origin !== origin) { state.external.push(url.origin); return await route.abort(); }
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      if (url.pathname === "/api/health") return await json({ ok: true });
      if (url.pathname === "/api/venue-snapshot") return await json({ path: url.searchParams.get("path"), venue: {
        name: entity.venue, place: "Toronto", source: null, providerVenueId: null, coord: { lat: 43.65, lng: -79.38 }, address: null, capacity: null,
      }, events: [], hasMore: false, nextCursor: null });
      if (url.pathname === `/api/venues/${encodeURIComponent(entity.venue.toLowerCase())}/photos`) return await json({ photos: [], state: "ready" });
      if (url.pathname === "/api/resolve" && url.searchParams.get("path") === (upcoming ? targetPath : path)) return await json({ entity });
      if (url.pathname === "/api/resolve" && url.searchParams.get("path") === `/post/${review.id}`) return await json({ entity: { kind: "show", id: review.id, path: `/post/${review.id}` } });
      if (url.pathname === `/api/posts/${review.id}`) return await json({ post });
      if (url.pathname === `/api/posts/${review.id}/comments`) return await json({ comments: [] });
      if (url.pathname === "/api/artists/archive/reviews") {
        state.requests++;
        if (mode === "loading" && !state.release) await new Promise(done => { state.release = done; });
        if (state.fail) return await json({ reviews: "invalid" });
        if (mode === "empty") return await json({ reviews: [], total: 0, nextCursor: null });
        if (url.searchParams.get("cursor")) {
          if (!state.moreFailed) { state.moreFailed = true; return await json({ reviews: "invalid" }); }
          return await json({ reviews: [{ ...review, id: "concert-fixture-review-2", overall: null, user: { ...review.user, name: "Sam Fixture" } }], total: 2, nextCursor: null });
        }
        return await json({ reviews: [review], total: 2, nextCursor: "next-page" });
      }
      return await json(fixtureApiResponse(url.pathname, { method: request.method(), resolvedPath: url.searchParams.get("path") || path }));
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message);
      await route.abort().catch(() => {});
    }
  });
  try {
    await page.goto(origin + targetPath, { waitUntil: "domcontentloaded" });
    if (individual) {
      // A persisted review permalink owns its discussion. Enter ShowScreen via
      // its explicit show action, preserving the review route contract.
      await page.getByText("No comments yet. Start the conversation.", { exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, `/post/${review.id}`);
      assert.equal(await page.getByRole("button", { name: "Event details", exact: true }).count(), 0);
      const showLink = page.getByRole("link", { name: "View event page", exact: true });
      assert.equal(await showLink.innerText(), "View event page");
      await showLink.click();
    }
    await page.getByRole("button", { name: "Event details", exact: true }).waitFor();
    const section = title => page.getByRole("button", { name: title, exact: true });
    assert.equal(await section("Event details").getAttribute("aria-expanded"), "false");
    assert.equal(await section("Reviews").getAttribute("aria-expanded"), "true");
    if (mode === "loading") {
      await page.getByText("Loading reviews…", { exact: true }).waitFor();
      assert.equal(await page.getByText("No reviews to show yet.", { exact: true }).count(), 0);
      state.release();
    }
    if (mode === "error") {
      await page.getByRole("button", { name: "Couldn't load reviews. Try again", exact: true }).waitFor();
      state.fail = false;
      await page.getByRole("button", { name: "Couldn't load reviews. Try again", exact: true }).click();
    }
    if (mode === "empty") {
      await page.getByText("No reviews to show yet.", { exact: true }).waitFor();
      await page.getByText("No overall show rating yet", { exact: true }).waitFor();
      assert.equal(await page.getByText("0.0", { exact: true }).count(), 0);
    } else if (!upcoming && !individual) {
      await page.getByText("17 ratings", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Open Alex Fixture's review and comments", exact: true }).waitFor();
    }
    if (mode === "individual-archive") {
      await page.getByRole("button", { name: "Open Alex Fixture's review and comments", exact: true }).waitFor();
    }
    if (mode !== "empty" && !individual) {
      await page.waitForFunction(() => [...document.images].some(img => img.src.includes("concert.fixture.invalid") && img.complete && img.naturalWidth > 0));
    }
    await page.screenshot({ path: join(shots, `${name}-overview.png`), fullPage: true });
    const reviewRequestsBeforeToggles = state.requests;
    for (const title of ["Reviews", "Event details", "Crowd & Lounge", mode === "upcoming" ? "After the show" : "Around the venue"]) {
      const toggle = section(title), initial = await toggle.getAttribute("aria-expanded");
      for (let i = 0; i < 4; i++) await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), initial);
    }
    assert.equal(state.requests, reviewRequestsBeforeToggles, "Repeated disclosure actions must not refetch reviews");
    await section("Reviews").click();
    await page.screenshot({ path: join(shots, `${name}-collapsed.png`), fullPage: true });
    await section("Reviews").click();
    // Native-style buttons work with a keyboard, without losing focus on collapse.
    await section("Event details").focus();
    await page.keyboard.press("Enter");
    assert.equal(await section("Event details").getAttribute("aria-expanded"), "true");
    await page.keyboard.press("Enter");
    assert.equal(await section("Event details").getAttribute("aria-expanded"), "false");
    if (mode === "archive") {
      await section("Setlist").click();
      await page.getByRole("button", { name: "Reveal setlist spoilers", exact: true }).click();
      await page.getByText("Fixture opener", { exact: true }).waitFor();
      await section("Setlist").click();
      await page.getByRole("button", { name: "Load more reviews", exact: true }).click();
      await page.getByRole("button", { name: "Retry loading more reviews", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Open Alex Fixture's review and comments", exact: true }).count(), 1);
      await page.getByRole("button", { name: "Retry loading more reviews", exact: true }).click();
      await page.getByText("Sam Fixture", { exact: true }).waitFor();
      assert.equal(await page.getByText("0.0", { exact: true }).count(), 0);
      await page.getByRole("button", { name: "Open Alex Fixture's review and comments", exact: true }).click();
      await page.waitForURL(`**/post/${review.id}`);
      await page.goBack();
      await section("Reviews").waitFor();
      await page.goForward();
      await page.waitForURL(`**/post/${review.id}`);
      await page.goBack();
      await section("Reviews").waitFor();
    }
    if (individual) {
      // The explicit event action always resolves canonical aggregate data.
      await page.getByText("Overall show rating", { exact: true }).waitFor();
      await page.getByLabel("4.3 out of 5", { exact: true }).waitFor();
      await page.getByText("17 ratings", { exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, path);
      await page.goBack();
      await page.getByRole("button", { name: "Close review", exact: true }).waitFor();
      await page.getByRole("button", { name: "Overall 4.7 out of 5. Show the rating breakdown.", exact: true }).waitFor();
      await page.goForward();
      await page.getByText("17 ratings", { exact: true }).waitFor();
      if (mode === "individual-archive") {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByLabel("4.3 out of 5", { exact: true }).waitFor();
        await page.getByText("17 ratings", { exact: true }).waitFor();
      }
    }
    if (upcoming) {
      await page.getByText("Event artwork · Fixture promoter", { exact: true }).waitFor();
      await section("Event details").click();
      await page.getByRole("link", { name: "Open original photo by Fixture promoter", exact: true }).waitFor();
      await section("Event details").click();
      if (mode === "cancelled") await page.getByText("THIS SHOW WAS CANCELLED", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: /Log or review/ }).count(), 0);
      assert.equal(await page.getByRole("link", { name: /Get tickets for/ }).count(), mode === "cancelled" ? 0 : 1);
      if (mode === "upcoming") {
        await page.getByRole("button", { name: "Add this show to Going", exact: true }).click();
        await page.getByRole("heading", { name: "Good to see you.", exact: true }).waitFor();
        await page.goBack();
        await section("Reviews").waitFor();
      }
    } else {
      await section("Reviews").click();
      await page.getByRole("button", { name: /^Log or review / }).click();
      await page.getByRole("heading", { name: "Good to see you.", exact: true }).waitFor();
      await page.goBack();
      await section("Reviews").waitFor();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "No horizontal page overflow");
    const expectedBg = theme === "daylight" ? "rgb(251, 247, 240)" : "rgb(9, 9, 11)";
    assert.ok(await page.evaluate(bg => [...document.querySelectorAll("div")].some(el => getComputedStyle(el).backgroundColor === bg), expectedBg), "Requested theme renders");
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.external, []);
    console.log(JSON.stringify({ name, passed: true, reviewRequests: state.requests }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `${name}-failed.png`), fullPage: true }).catch(() => {});
    console.error(JSON.stringify({ name, error: error.message, errors: state.errors, external: state.external }));
    throw error;
  } finally { state.closing = true; await context.close(); }
}

const chromium = process.env.PIT_PLAYWRIGHT_MODULE ? require(process.env.PIT_PLAYWRIGHT_MODULE).chromium : require("playwright").chromium;
const { server, origin } = await localServer();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
  const filter = process.argv[2] || "";
  for (const width of [390, 1280]) for (const theme of ["stage", "daylight"]) if (`archive-${theme}-${width}`.includes(filter)) await scenario(browser, origin, width, theme);
  for (const mode of ["empty", "loading", "error", "individual", "upcoming", "cancelled"]) if (`${mode}-stage-390`.includes(filter)) await scenario(browser, origin, 390, "stage", mode);
  for (const width of [390, 1280]) if (`individual-archive-stage-${width}`.includes(filter)) await scenario(browser, origin, width, "stage", "individual-archive");
  if ("long-stage-320".includes(filter)) await scenario(browser, origin, 320, "stage", "long");
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
