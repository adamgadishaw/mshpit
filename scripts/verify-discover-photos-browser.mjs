#!/usr/bin/env node
// Real exported UI, fresh browser contexts, loopback static files and explicit
// synthetic fixtures only. No production requests or account mutations.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureApiResponse } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const photoOrigin = "https://discover-photo-fixture.invalid";
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=", "base64");
export const publicTorontoPhoto = Object.freeze({
  id: "fixture-image", uri: `${photoOrigin}/toronto.png`, kind: "image", photosPublic: true,
  artist: "Toronto Photo Fixture", venue: "Toronto Fixture Venue", city: "Toronto, Ontario", country: "canada",
  postId: "public-photo-fixture", logId: "public-photo-fixture", ownerId: "public-photo-owner", by: "Public Fixture Fan",
});
export function discoverPhotoFixture(query = new URLSearchParams()) {
  assert.equal(query.get("city"), null, "Worldwide/country Photos must not inherit a nearby event city.");
  const country = query.get("country");
  return { photos: !country || country === "canada" ? [publicTorontoPhoto] : [] };
}

async function localServer() {
  const directory = resolve(root, process.env.PIT_NAVIGATION_BROWSER_DIST || "dist");
  const htmlPath = join(directory, "index.html");
  assert.ok(statSync(htmlPath).isFile(), "Build the web export before browser verification.");
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

async function scenario(browser, origin, width, kind) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  const state = { calls: [], errors: [], reports: [], photoAttempts: 0, release: null, closing: false };
  let signalFirstPhoto;
  const firstPhotoStarted = new Promise(done => { signalFirstPhoto = done; });
  await context.addInitScript((allowedOrigin) => {
    if (location.origin === allowedOrigin) localStorage.setItem("pit_theme", "stage");
  }, origin);
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    try {
      if (url.origin === photoOrigin) return await route.fulfill({ contentType: "image/png", body: pixel });
      // SmartImage asks the thumbnail proxy for its bounded preview. Only this
      // exact synthetic source may receive a fixture; no proxy request is sent.
      if (url.origin === "https://wsrv.nl" && url.searchParams.get("url") === publicTorontoPhoto.uri)
        return await route.fulfill({ contentType: "image/png", body: pixel });
      if (url.origin !== origin) return await route.abort();
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      state.calls.push({ path: url.pathname, method: request.method(), query: url.search });
      if (url.pathname === "/api/client-errors") state.reports.push(request.postDataJSON());
      if (url.pathname === "/api/discover/photos") {
        assert.equal(request.method(), "GET");
        state.photoAttempts += 1;
        if (state.photoAttempts === 1) await new Promise(done => { state.release = done; signalFirstPhoto(); });
        if (kind === "failure-retry" && state.photoAttempts === 1) return await route.fulfill({
          status: 503, contentType: "application/json", body: JSON.stringify({ code: "TEMPORARY_UNAVAILABLE", error: "Temporary fixture outage." }),
        });
        return await route.fulfill({ contentType: "application/json", body: JSON.stringify(discoverPhotoFixture(url.searchParams)) });
      }
      const body = url.pathname === "/api/discover/overview" ? {
        chart: { rows: [], source: "popularity" }, genres: [], countries: [{ country: "Canada", count: 2 }, { country: "United States", count: 1 }],
        eventCoverage: { total: 3, venueTotal: 3, countries: [{ country: "Canada", count: 2 }, { country: "United States", count: 1 }] },
      } : fixtureApiResponse(url.pathname, { member: false, method: request.method(), resolvedPath: url.searchParams.get("path") || undefined });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|canceled|cancelled/i.test(error.message)) return;
      state.errors.push(error.message);
      await route.abort().catch(() => {});
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    if (kind === "failure-retry" && message.location().url.startsWith(origin + "/api/discover/photos?") && /503/.test(message.text())) return;
    state.errors.push(`${message.text()} (${message.location().url})`);
  });
  const tile = page.getByRole("button", { name: "Open concert photo 1, Toronto Photo Fixture", exact: true });
  const noPhotos = page.getByText(/No public concert photos or videos are shared/);
  const chooseCountry = async country => {
    await page.getByRole("button", { name: /^Choose an area to explore\. Current area:/ }).click();
    const choice = page.getByRole("radio", { name: new RegExp(`^${country}(?:,|$)`) });
    if (!await choice.count()) await page.getByRole("button", { name: /^Show \d+ more areas$/ }).click();
    await choice.click();
  };
  try {
    await page.goto(origin + "/discover", { waitUntil: "domcontentloaded", timeout: 12_000 });
    await page.getByRole("tab", { name: "Photos", exact: true }).click();
    await page.getByText("Loading concert photos…", { exact: true }).waitFor();
    let startTimer;
    try {
      await Promise.race([firstPhotoStarted, new Promise((_, reject) => {
        startTimer = setTimeout(() => reject(new Error("Photo request did not start.")), 12_000);
      })]);
    } finally { clearTimeout(startTimer); }
    assert.equal(await noPhotos.count(), 0, "Loading cannot display a false empty gallery.");
    await page.waitForFunction(() => document.querySelector('[aria-label="Photos"][role="tab"]')?.getAttribute("aria-selected") === "true");
    if (kind === "scope-race") {
      await chooseCountry("United States");
      await noPhotos.waitFor();
      state.release?.();
      await page.waitForTimeout(150);
      assert.equal(await tile.count(), 0, "A late Worldwide response cannot paint Toronto into the selected US gallery.");
      await chooseCountry("Worldwide");
      await tile.waitFor();
    } else {
      state.release?.();
      if (kind === "failure-retry") {
        await page.getByText("Concert photos could not load. Please try again.", { exact: true }).waitFor();
        assert.equal(await noPhotos.count(), 0, "A server outage cannot masquerade as zero photos.");
        await page.getByRole("button", { name: "Retry concert photos", exact: true }).click();
      }
      await tile.waitFor();
      assert.equal(await noPhotos.count(), 0);
    }
    assert.ok(state.photoAttempts >= (kind === "content" ? 1 : 2));
    assert.equal(state.calls.some(call => call.path.startsWith("/api/feed")), false);
    assert.deepEqual(state.reports, [], "No client crash reports may be emitted.");
    assert.deepEqual(state.errors, [], "No unhandled error, missing fixture, or console error may be emitted.");
    console.log(JSON.stringify({ name: `discover-photos-${kind}-${width}`, passed: true, photoRequests: state.photoAttempts }));
  } catch (error) {
    console.error(JSON.stringify({ name: `discover-photos-${kind}-${width}`, error: error.message, state: { ...state, release: undefined }, body: (await page.locator("body").innerText()).slice(-5000) }));
    throw error;
  } finally { state.closing = true; state.release?.(); await context.close(); }
}

export async function main() {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
  const { server, origin } = await localServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    for (const width of [390, 1280]) for (const kind of ["content", "failure-retry", "scope-race"]) await scenario(browser, origin, width, kind);
    console.log(JSON.stringify({ passed: 6, failed: 0, network: "isolated fixtures only" }));
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
