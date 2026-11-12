#!/usr/bin/env node
// Exported app, fresh browser contexts, synthetic public records, no live API.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveShowKey, decodeArchiveShowKey } from "../server/features/artistArchive/artistArchiveKeys.js";
import { fixtureApiResponse, navigationUser, navigationArtist } from "./verify-navigation-browser.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "review-entrypoints-browser");
mkdirSync(shots, { recursive: true });
const image = readFileSync(join(root, "public/images/news/live-music-context.jpg"));
let video;
const archiveKey = archiveShowKey({ artistIdentity: "fixture-artist", venueIdentity: "Fixture Venue", date: "2026-10-01" });
const path = `/concert/${encodeURIComponent(archiveKey)}`;
const review = { id: "concert-fixture-review", archiveShowKey: archiveKey, version: 2, kind: "review", userId: "public-fixture-author",
  user: { id: "public-fixture-author", name: "Alex Fixture", handle: "alexfixture", role: "fan" },
  artist: "Fixture Artist", artistKey: "fixture-artist", venue: "Fixture Venue", city: "Toronto",
  date: "2026-10-01", overall: 4.7, band: 4.1, room: 3.6, review: "FULL REVIEW START. " + "A vivid live memory with independent scores. ".repeat(720) + " FULL REVIEW END.",
  dims: { performance: 4.1, setlist: 4.1, sound: 3.6, venue: 3.6 },
  likes: 3, comments: 0, photos: ["https://concert.fixture.invalid/featured.jpg", "https://concert.fixture.invalid/clip.webm", "https://concert.fixture.invalid/last.jpg"],
  featuredMediaId: "first", media: [
    { id: "first", uri: "https://concert.fixture.invalid/featured.jpg", kind: "image", altText: "Featured encore photo" },
    { id: "clip", uri: "https://concert.fixture.invalid/clip.webm", kind: "video", posterUrl: "https://concert.fixture.invalid/poster.jpg", altText: "Encore video" },
    { id: "last", uri: "https://concert.fixture.invalid/last.jpg", kind: "image", altText: "Final crowd photo" },
  ], at: 1790812800000 };
const concert = { id: archiveKey, kind: "concert", path, archiveShowKey: archiveKey,
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

const ranked = { key: "show:fixture-artist:provider%3Aticketmaster%3Avenue-7:2026-10-01", artist: review.artist,
  artistKey: review.artistKey, venue: review.venue, date: review.date, city: "Toronto, Canada", place: "Toronto, Canada",
  avgRating: 4.3, ratingCount: 17, reviewCount: 2, source: "ticketmaster", providerVenueId: "venue-7" };
const archiveShow = { ...ranked, key: archiveKey, tourKey: "tour.fixture" };
const archive = { artist: navigationArtist, shows: [archiveShow], topShows: [archiveShow], tours: [{ key: "tour.fixture", name: "Fixture Tour", showCount: 1, reviewCount: 1, ratingCount: 17, avgRating: 4.3 }], upcoming: [], totals: {}, truncated: false };
async function scenario(browser, origin, width, mode) {
  const name = `${mode}-${width}`, before = process.env.PIT_EXPECT_BASELINE === "1";
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: "block" });
  await context.addInitScript(user => { localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user])); }, navigationUser);
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const calls = [], errors = []; let denied = mode === "private";
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.hostname === "concert.fixture.invalid" && url.pathname.endsWith(".webm")) return route.fulfill({ contentType: "video/webm", body: video });
    if (["wsrv.nl", "concert.fixture.invalid"].includes(url.hostname)) return route.fulfill({ contentType: "image/jpeg", body: image });
    if (url.origin !== origin) { errors.push(`Blocked external ${url.origin}`); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    calls.push(url.pathname + url.search);
    if (url.pathname === "/api/page-head") return json({ path: url.searchParams.get("path"), head: "<title>Review entry fixtures</title>" });
    if (url.pathname === "/api/discover/overview") return json({ artists: [], venues: [], events: [], genres: [], countries: [], topRatedShows: [{ ...ranked, ...(mode === "legacy" ? { artistKey: null } : {}) }] });
    if (url.pathname === "/api/artists/reviews") return json({ reviews: [{ ...review, photosPublic: true }] });
    if (url.pathname === "/api/artists/archive") return json({ archive });
    if (url.pathname === "/api/artists/archive/reviews") {
      if (url.searchParams.get("tourKey") === "tour.fixture") return json({ reviews: [{ ...review, archiveShowKey: undefined }], nextCursor: null, total: 1 });
      const key = url.searchParams.get("showKey");
      if (!decodeArchiveShowKey(key) || key !== archiveKey) return json({ error: "That archive selection is invalid.", code: "VALIDATION_FAILED" }, 400);
      return json({ reviews: [review], nextCursor: null, total: 1 });
    }
    if (url.pathname === "/api/resolve" && url.searchParams.get("path") === path) return json({ entity: concert });
    if (url.pathname === "/api/resolve" && url.searchParams.get("path")?.startsWith("/post/")) return json({ entity: { kind: "show", id: review.id, path: `/post/${review.id}` } });
    if (url.pathname === `/api/posts/${review.id}`) return denied ? json({ error: "Not found" }, 404) : json({ post: review });
    if (url.pathname === `/api/posts/${review.id}/comments`) return json({ comments: [] });
    if (url.pathname === "/api/media/reactions") return json({ reactions: {} });
    return json(fixtureApiResponse(url.pathname, { member: true, method: request.method(), resolvedPath: url.searchParams.get("path") || "/artist/fixture-artist" }));
  });
  try {
    const artistMode = ["artist", "private", "artist-event", "tour"].includes(mode);
    await page.goto(origin + (artistMode ? "/artist/fixture-artist" : "/discover"), { waitUntil: "domcontentloaded" });
    let opener;
    if (artistMode) {
      await page.getByText("TOP TAKE", { exact: true }).waitFor();
      if (before) {
        await page.getByText(/FULL REVIEW START/).first().click();
        assert.equal(await page.getByRole("button", { name: "Close review", exact: true }).count(), 0);
        console.log(JSON.stringify({ name, reproduced: "Top Take body does not open review" }));
        await page.screenshot({ path: join(shots, `before-${name}.png`) }); return;
      }
      opener = page.getByRole("link", { name: "Open Alex Fixture's full review of Fixture Artist", exact: true });
      if (mode === "tour") {
        await page.getByLabel("Shows artist page section", { exact: true }).click();
        await page.getByRole("button", { name: "Open Fixture Artist live archive", exact: true }).click();
        await page.getByRole("button", { name: "Open Fixture Tour, 1 shows and 1 reviews", exact: true }).click();
        opener = page.getByRole("button", { name: "Open Alex Fixture's review of Fixture Artist", exact: true });
      }
      if (mode === "artist-event") {
        await page.getByRole("link", { name: "View the exact Fixture Artist show reviewed by Alex Fixture", exact: true }).click();
        await page.getByRole("button", { name: "Open Alex Fixture's review and comments", exact: true }).waitFor();
        await page.getByText("4.3", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Close review", exact: true }).count(), 0);
        assert.equal(new URL(page.url()).pathname, path);
        await page.screenshot({ path: join(shots, `${name}.png`) });
        console.log(JSON.stringify({ name, passed: true, canonicalEvent: true })); return;
      }
    } else {
      await page.getByRole("button", { name: /Top-rated shows/ }).click();
      await page.getByRole("button", { name: /^Number 1, Fixture Artist/ }).click();
      if (before) {
        await page.getByRole("button", { name: "Couldn't load reviews. Try again", exact: true }).waitFor();
        assert.ok(calls.some(call => call.includes("showKey=show%3A")));
        await page.screenshot({ path: join(shots, `before-${name}.png`) });
        console.log(JSON.stringify({ name, reproduced: "Ranking key rejected by archive reviews endpoint" })); return;
      }
      opener = page.getByRole("button", { name: "Open Alex Fixture's review and comments", exact: true });
      await page.getByText("4.3", { exact: true }).waitFor();
    }
    await opener.waitFor(); await opener.focus();
    await opener.evaluate(node => {
      window.originReview = node; let p = node.parentElement;
      while (p && p.scrollHeight <= p.clientHeight) p = p.parentElement;
      window.originScroll = p;
      // Playwright may scroll the focused link before dispatching its click.
      // Capture the actual user-opening position, not the earlier locator position.
      node.addEventListener("click", () => { window.originY = p?.scrollTop; }, { capture: true, once: true });
    });
    await opener.click();
    const close = page.getByRole("button", { name: "Close review", exact: true }); await close.waitFor();
    if (denied) {
      await page.getByText(/review.*unavailable/i).first().waitFor();
      assert.equal(await page.getByRole("dialog").getByText(/FULL REVIEW START[\s\S]*FULL REVIEW END\./).count(), 0);
    } else {
      const full = page.getByRole("dialog").getByText(/FULL REVIEW START[\s\S]*FULL REVIEW END\./); await full.waitFor();
      assert.equal(await full.textContent(), review.review);
      assert.equal(new URL(page.url()).pathname, `/post/${review.id}`);
      assert.equal(await page.getByRole("link", { name: "View event page", exact: true }).getAttribute("href"), path);
      await page.getByRole("button", { name: "Overall 4.7 out of 5. Show the rating breakdown.", exact: true }).click();
      await page.getByText(/Alex Fixture.s ratings/).waitFor();
      await page.screenshot({ path: join(shots, `${name}-review.png`) });
      if ((mode === "artist" && width === 390) || (mode === "ranked" && width === 1280)) {
        await page.getByRole("button", { name: "Featured encore photo", exact: true }).click();
        await page.getByLabel("Media 1 of 3", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Next media", exact: true }).click();
        await page.getByLabel("Media 2 of 3", { exact: true }).waitFor();
        assert.ok(await page.locator('video[src*="clip.webm"]').count() > 0, "Authored video retains its second position");
        await page.getByRole("button", { name: "Next media", exact: true }).click();
        await page.getByLabel("Media 3 of 3", { exact: true }).waitFor();
        await page.screenshot({ path: join(shots, `${name}-gallery.png`) });
        await page.keyboard.press("Escape"); await close.waitFor();
        assert.equal(new URL(page.url()).pathname, `/post/${review.id}`);
        await page.getByRole("link", { name: "View event page", exact: true }).click();
        await page.waitForURL(origin + path); await page.getByText("17 ratings", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Close review", exact: true }).count(), 0);
        await page.goBack(); await close.waitFor(); await full.waitFor();
      }
    }
    await close.click(); await opener.waitFor();
    assert.equal(await page.evaluate(() => window.originReview.isConnected), true);
    assert.equal(await page.evaluate(() => window.originScroll?.scrollTop), await page.evaluate(() => window.originY), "Origin scroll returns to its actual opening position");
    if (mode === "tour") {
      const beforeRead = calls.filter(call => call === `/api/posts/${review.id}`).length;
      await page.getByRole("button", { name: /^Open Fixture Venue,/ }).last().click();
      await page.waitForURL(origin + path);
      await page.getByText("17 ratings", { exact: true }).waitFor();
      assert.ok(calls.filter(call => call === `/api/posts/${review.id}`).length > beforeRead, "Archive projection without event key hydrates its saved post before event resolution");
      assert.equal(await close.count(), 0);
    }
    if (mode === "artist" && width === 390) {
      await page.goto(origin + `/post/${review.id}`); await close.waitFor();
      await page.getByRole("dialog").getByText(/FULL REVIEW START[\s\S]*FULL REVIEW END\./).waitFor();
      assert.equal(new URL(page.url()).pathname, `/post/${review.id}`);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ name, passed: true, canonicalReviewRequest: calls.filter(x => x.startsWith("/api/artists/archive/reviews")) }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `${name}-failed.png`) }).catch(() => {});
    console.error(JSON.stringify({ name, error: error.message, errors, calls })); throw error;
  } finally { await context.close(); }
}

const chromium = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright").chromium;
const { server, origin } = await localServer(); let browser;
try {
  browser = await chromium.launch({ headless: true });
  // Create an actual short playable fixture locally, without a download or API.
  const recorder = await browser.newPage();
  video = Buffer.from(await recorder.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext("2d"), stream = canvas.captureStream(12), chunks = [];
    const recording = new MediaRecorder(stream, { mimeType: "video/webm" });
    const result = new Promise(resolve => { recording.onstop = async () => resolve([...new Uint8Array(await new Blob(chunks).arrayBuffer())]); });
    recording.ondataavailable = event => chunks.push(event.data); recording.start();
    for (let index = 0; index < 12; index++) { context.fillStyle = index % 2 ? "#ff9c41" : "#211832"; context.fillRect(0, 0, 160, 90); await new Promise(resolve => setTimeout(resolve, 90)); }
    recording.stop(); return await result;
  }));
  await recorder.close();
  const modes = process.env.PIT_EXPECT_BASELINE === "1" ? ["artist", "ranked"] : ["artist", "ranked", "legacy", "private", "artist-event", "tour"];
  for (const width of [390, 1280]) for (const mode of modes) if (`${mode}-${width}`.includes(process.argv[2] || "")) await scenario(browser, origin, width, mode);
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
