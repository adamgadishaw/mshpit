#!/usr/bin/env node
// Exported app, fresh browser contexts, synthetic public records, no live API.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveShowKey } from "../server/features/artistArchive/artistArchiveKeys.js";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "review-overlay-browser");
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

async function scenario(browser, origin, width, theme, mode = "visit") {
  const name = `${mode}-${theme}-${width}`;
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block", isMobile: width < 620, hasTouch: width < 620 });
  const state = { errors: [], external: [], reads: 0, member: ["account", "feed"].includes(mode), unavailable: false, fail: false, delayed: false, releases: [] };
  await context.addInitScript(({ theme, user }) => {
    localStorage.setItem("pit_theme", theme); localStorage.setItem("pit_theme_owner", user?.id || "guest");
    if (user) { localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user])); }
  }, { theme, user: state.member ? navigationUser : null });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => state.errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.hostname === "wsrv.nl") return await route.fulfill({ contentType: "image/jpeg", body: image });
      if (url.hostname === "concert.fixture.invalid") {
        if (url.pathname.endsWith(".webm")) return await route.fulfill({ contentType: "video/webm", body: video });
        return await route.fulfill({ contentType: "image/jpeg", body: image });
      }
      if (url.origin !== origin) { state.external.push(url.origin); return await route.abort(); }
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      if (url.pathname === "/api/media/reactions") return await json({ reactions: {} });
      if (url.pathname === "/api/page-head") return await json({ path: url.searchParams.get("path"), head: "<title>Review overlay fixture</title>" });
      if (url.pathname === "/api/health") return await json({ ok: true });
      if (url.pathname === "/api/resolve" && url.searchParams.get("path") === path) return await json({ entity: concert });
      if (url.pathname === "/api/resolve" && url.searchParams.get("path")?.startsWith("/post/")) return await json({ entity: { kind: "show", id: review.id, path: `/post/${review.id}` } });
      if (url.pathname === `/api/posts/${review.id}`) {
        state.reads++;
        if (state.delayed) await new Promise(resolve => state.releases.push(resolve));
        if (state.unavailable) return await json({ error: "Not found" }, 404);
        if (state.fail) return await json({ error: "Fixture failure" }, 503);
        return await json({ post: review });
      }
      if (url.pathname === `/api/posts/${review.id}/comments`) return await json({ comments: [] });
      if (url.pathname === "/api/artists/archive/reviews") return await json({ reviews: [{ ...review, review: "Short preview from a stale list", version: 1 }], total: 1, nextCursor: null });
      if (url.pathname.startsWith("/api/feed")) return await json({ posts: mode === "feed" ? [{ ...review, review: "Short preview from a stale list", version: 1 }] : [], hasMore: false, hiddenPostIds: [] });
      if (url.pathname === "/api/venue-snapshot") return await json({ path: url.searchParams.get("path"), venue: { name: concert.venue, place: "Toronto", source: null, coord: { lat: 43.65, lng: -79.38 } }, events: [], hasMore: false, nextCursor: null });
      if (/\/api\/venues\/.+\/photos/.test(url.pathname)) return await json({ photos: [], state: "ready" });
      return await json(fixtureApiResponse(url.pathname, { member: state.member, method: request.method(), resolvedPath: url.searchParams.get("path") || path }));
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message); await route.abort().catch(() => {});
    }
  });
  const open = mode === "feed" ? page.getByRole("link", { name: /Short preview from a stale list/ }) : page.getByRole("button", { name: "Open Alex Fixture's review and comments", exact: true });
  const close = page.getByRole("button", { name: "Close review", exact: true });
  const full = page.getByText(/FULL REVIEW START[\s\S]*FULL REVIEW END\./);
  const assertReview = async () => {
    await close.waitFor(); await full.waitFor();
    assert.equal(await page.getByRole("dialog", { name: "Concert review", exact: true }).count(), 1, "The active review dialog has a computed accessible name");
    assert.equal(new URL(page.url()).pathname, `/post/${review.id}`);
    assert.equal(await full.textContent(), review.review);
    assert.equal(await page.getByRole("link", { name: "View event page", exact: true }).getAttribute("href"), path);
    assert.equal(await page.getByTestId("review-dialog").count(), 1);
  };
  try {
    await page.goto(origin + (mode === "direct" ? `/post/${review.id}` : mode === "feed" ? "/feed" : path), { waitUntil: "domcontentloaded" });
    if (mode === "standalone") {
      await page.getByLabel("Open media 1 of 3 from Alex Fixture's review", { exact: true }).click();
      await page.getByLabel("Media 1 of 3", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await open.waitFor();
      assert.equal(new URL(page.url()).pathname, path);
      assert.equal(await close.count(), 0);
      assert.deepEqual(state.errors, []); assert.deepEqual(state.external, []);
      console.log(JSON.stringify({ name, passed: true, standaloneGalleryEscape: true }));
      return;
    }
    if (mode !== "direct") {
      await open.waitFor();
      if (mode !== "feed") await page.getByRole("button", { name: "Event details", exact: true }).click();
      await open.focus();
      await open.evaluate(element => {
        window.reviewOrigin = element;
        let parent = element.parentElement;
        while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement;
        window.reviewOriginScroll = parent; if (parent) { parent.scrollTop = 130; window.reviewOriginTop = parent.scrollTop; }
      });
      if (mode === "unavailable") state.unavailable = true;
      if (mode === "retry") state.fail = true;
      if (mode === "account" || mode === "late") state.delayed = true;
      await open.click();
      await page.evaluate(() => { window.reviewOriginTop = window.reviewOriginScroll?.scrollTop; });
    }
    if (mode === "unavailable") {
      await page.getByText("This review is unavailable. It may be private or removed.", { exact: true }).waitFor();
      assert.equal(await full.count(), 0);
      await close.click(); await open.waitFor();
    } else if (mode === "late" || mode === "account") {
      await page.getByText("Loading review...", { exact: true }).waitFor();
      await page.waitForFunction(() => true);
      if (mode === "account") {
        state.member = false;
        await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "pit.auth.epoch.v1", newValue: JSON.stringify({ at: Date.now() }) })));
        await page.waitForURL(origin + "/");
      } else { await close.click(); await open.waitFor(); }
      state.delayed = false; state.releases.forEach(resolve => resolve());
      await page.waitForTimeout(300);
      assert.equal(await full.count(), 0, "Late read cannot restore dismissed or former-account review");
      assert.equal(await close.count(), 0);
    } else {
      if (mode === "retry") {
        await page.getByText("Retry review", { exact: true }).waitFor();
        state.fail = false; await page.getByText("Retry review", { exact: true }).click();
      }
      await assertReview();
      for (let index = 0; index < 18; index++) {
        await page.keyboard.press(index % 2 ? "Tab" : "Shift+Tab");
        assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true, "Keyboard focus stays in modal");
      }
      await page.screenshot({ path: join(shots, `${name}-review.png`), fullPage: true });
      await page.getByRole("button", { name: "Overall 4.7 out of 5. Show the rating breakdown.", exact: true }).click();
      await page.getByText("Alex Fixture’s ratings", { exact: true }).waitFor();
      assert.equal(await page.getByText("Your overall score", { exact: true }).count(), 0);
      await full.click({ position: { x: 10, y: 10 } });
      assert.equal(new URL(page.url()).pathname, `/post/${review.id}`, "Reading text must not navigate");
      const firstPhoto = page.getByRole("button", { name: "Featured encore photo", exact: true });
      await firstPhoto.click();
      await page.getByLabel("Media 1 of 3", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Next media", exact: true }).click();
      await page.getByLabel("Media 2 of 3", { exact: true }).waitFor();
      assert.ok(await page.locator('video[src*="clip.webm"]').count() > 0, "Second item is the author's video");
      await page.locator('video[src*="clip.webm"]').evaluate(async element => { element.muted = true; await element.play(); });
      await page.waitForFunction(() => [...document.querySelectorAll('video')].some(element => element.src.includes('clip.webm') && element.readyState >= 2 && element.currentTime > 0));
      await page.getByRole("button", { name: "Next media", exact: true }).click();
      await page.getByLabel("Media 3 of 3", { exact: true }).waitFor();
      await page.screenshot({ path: join(shots, `${name}-gallery.png`), fullPage: true });
      if (mode === "visit") {
        await page.getByRole("button", { name: "Like this photo, 0 likes", exact: true }).click();
        await page.getByRole("heading", { name: "Good to see you.", exact: true }).waitFor();
        assert.equal(await page.getByLabel("Media 3 of 3", { exact: true }).count(), 0, "Hidden gallery portal must not cover authentication");
        await page.goBack(); await page.getByLabel("Media 3 of 3", { exact: true }).waitFor();
      }
      await page.keyboard.press("Escape");
      await close.waitFor();
      assert.equal(new URL(page.url()).pathname, `/post/${review.id}`, "Gallery Escape only closes gallery");
      await page.getByRole("link", { name: "View event page", exact: true }).click();
      await page.waitForURL(origin + path);
      await page.getByText("17 ratings", { exact: true }).waitFor();
      await page.goBack(); await assertReview();
      await close.click();
      if (mode !== "direct") {
        await open.waitFor();
        if (mode !== "feed") assert.equal(await page.getByRole("button", { name: "Event details", exact: true }).getAttribute("aria-expanded"), "true");
        assert.equal(await page.evaluate(() => document.activeElement === window.reviewOrigin), true, "Focus returns to the opener");
        assert.equal(await page.evaluate(() => window.reviewOrigin?.isConnected), true, "Actual originating screen stays mounted");
        assert.equal(await page.evaluate(() => window.reviewOriginScroll?.scrollTop), await page.evaluate(() => window.reviewOriginTop), "Origin scroll restored");
        for (const dismiss of ["escape", "outside", "back"]) {
          await open.click(); await assertReview();
          if (dismiss === "escape") await page.keyboard.press("Escape");
          if (dismiss === "outside") await page.getByTestId("review-backdrop").click({ position: { x: 2, y: 2 } });
          if (dismiss === "back") await page.goBack();
          await open.waitFor();
          if (dismiss === "back") { await page.goForward(); await assertReview(); await close.click(); await open.waitFor(); }
        }
        // Fresh authorization on reopen: an old visible card is not a grant.
        state.unavailable = true; await open.click();
        await page.getByText("This review is unavailable. It may be private or removed.", { exact: true }).waitFor();
        assert.equal(await full.count(), 0);
        await close.click();
      } else await page.waitForURL(origin + "/");
    }
    assert.deepEqual(state.errors, []); assert.deepEqual(state.external, []);
    console.log(JSON.stringify({ name, passed: true, reads: state.reads }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `${name}-failed.png`), fullPage: true }).catch(() => {});
    console.error(JSON.stringify({ name, error: error.message, errors: state.errors, external: state.external })); throw error;
  } finally { state.closing = true; state.releases.forEach(resolve => resolve()); await context.close(); }
}

const chromium = process.env.PIT_PLAYWRIGHT_MODULE ? require(process.env.PIT_PLAYWRIGHT_MODULE).chromium : require("playwright").chromium;
const { server, origin } = await localServer();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
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
  const filter = process.argv[2] || "";
  for (const width of [390, 1280]) for (const theme of ["stage", "daylight"]) if (`visit-${theme}-${width}`.includes(filter)) await scenario(browser, origin, width, theme);
  for (const width of [390, 1280]) for (const mode of ["direct", "unavailable", "retry", "late", "account", "feed", "standalone"]) if (`${mode}-stage-${width}`.includes(filter)) await scenario(browser, origin, width, "stage", mode);
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
