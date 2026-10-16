#!/usr/bin/env node
// Actual exported app; synthetic public events and responses only. Every
// request is intercepted before it can leave the loopback fixture origin.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureApiResponse } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, ".tmp", "event-page-recovery-browser");
const event = {
  id: "tm_event_recovery_fixture", kind: "event", path: "/event/tm_event_recovery_fixture", publicEventSnapshot: true,
  name: "Les Solidarités", artist: "Les Solidarités", artistKey: null, artistIdentityPending: false,
  venue: "Fixture Venue", city: "Fixture City", date: "2026-10-20", source: "ticketmaster",
  ticketUrl: "https://www.ticketmaster.ca/event/recovery-fixture",
};
const artist = { name: event.artist, key: "les solidarités", publicSlug: "les-solidarites", transient: false };

async function serveBuild() {
  const directory = resolve(root, process.env.PIT_NAVIGATION_BROWSER_DIST || "dist");
  const html = join(directory, "index.html");
  assert.ok(statSync(html).isFile(), "Run npm run build:web first.");
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

async function scenario(browser, origin, { width, missingSnapshot = false }) {
  const name = `${missingSnapshot ? "missing-snapshot" : "retained-event"}-${width}`;
  const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  context.setDefaultTimeout(12_000);
  const state = { name, artistRequests: 0, snapshotRequests: 0, ticketOpens: 0, errors: [], external: [], api: [], closing: false, releaseArtist: null };
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on("pageerror", error => state.errors.push(error.message));
  await page.clock.install({ time: new Date("2026-10-16T14:00:00Z") });
  await context.addInitScript(() => { if (location.protocol === "http:") localStorage.setItem("pit_theme", "stage"); });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(body) });
    try {
      // Prove the ticket action works, but answer the opened URL locally.
      if (url.href === event.ticketUrl) {
        state.ticketOpens++;
        return await route.fulfill({ contentType: "text/html", body: "<title>Intercepted fixture ticket</title>Fixture ticket destination" });
      }
      if (url.origin !== origin) { state.external.push(url.href); return await route.abort(); }
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      state.api.push({ method: request.method(), path: url.pathname });
      assert.equal(request.method(), "GET", "Event recovery must not write data or create an artist");
      if (url.pathname === "/api/resolve") {
        assert.equal(url.searchParams.get("path"), event.path);
        state.snapshotRequests++;
        return await json({ entity: missingSnapshot && state.snapshotRequests > 1 ? null : event });
      }
      if (url.pathname === "/api/artists/resolve") {
        assert.equal(url.searchParams.get("name"), event.artist);
        state.artistRequests++;
        if (state.artistRequests === 1) return await json({ error: "Artist provider is temporarily unavailable.", code: "PROVIDER_UNAVAILABLE",
          retryable: true, requestId: "event-recovery-fixture" }, 502, { "Retry-After": "60" });
        assert.equal(state.artistRequests, 2, "Manual recovery may issue only one additional lookup");
        await new Promise(done => { state.releaseArtist = done; });
        state.releaseArtist = null;
        return await json({ artist, created: false });
      }
      if (/^\/api\/artists\/[^/]+\/memorial$/.test(url.pathname)) return await json({ memorial: null });
      if (url.pathname === "/api/health") return await json({ ok: true });
      return await json(fixtureApiResponse(url.pathname, { method: request.method(), resolvedPath: url.searchParams.get("path") || undefined }));
    } catch (error) {
      if (state.closing && /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message);
      await route.abort().catch(() => {});
    }
  });
  try {
    await page.goto(origin + event.path, { waitUntil: "domcontentloaded" });
    await page.getByText(/^Artist information is temporarily unavailable\.?$/, { exact: true }).waitFor();
    const retry = page.getByRole("button", { name: "Retry checking artist availability", exact: true });
    assert.equal(await retry.isDisabled(), true);
    assert.equal(state.artistRequests, 1);
    assert.equal(await page.getByText("Artist profile not linked yet", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: `Open ${artist.name}'s profile`, exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /Log \/ review|I'm going|Open .*Lounge/i }).count(), 0);
    await retry.evaluate(node => { node.click(); node.click(); });
    assert.equal(state.artistRequests, 1, "Disabled cooldown clicks dispatch no lookup");
    if (!missingSnapshot) {
      await page.getByText(event.name, { exact: true }).first().waitFor();
      await page.getByText("2026 · 10 · 20", { exact: true }).waitFor();
      const tickets = page.getByRole("link", { name: `Get tickets for ${event.name} at ${event.venue}`, exact: true });
      await tickets.waitFor();
      await page.getByRole("button", { name: `Open ${event.venue}'s venue page`, exact: true }).first().waitFor();
      const popupPromise = context.waitForEvent("page");
      await tickets.click();
      const popup = await popupPromise;
      await popup.getByText("Fixture ticket destination", { exact: true }).waitFor();
      await popup.close();
      assert.equal(state.ticketOpens, 1);
      const before = state.snapshotRequests;
      await page.getByRole("button", { name: "Refresh event details", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Refresh event details"]')?.getAttribute("aria-disabled") !== "true");
      assert.equal(state.snapshotRequests, before + 1);
      assert.equal(state.artistRequests, 1, "Details refresh never consumes an artist retry");
    } else {
      await page.getByText("This event is not available", { exact: true }).waitFor();
    }
    await page.screenshot({ path: join(output, `${name}-outage.png`), fullPage: true });
    await page.clock.fastForward(60_001);
    await page.waitForFunction(() => document.querySelector('[aria-label="Retry checking artist availability"]')?.getAttribute("aria-disabled") !== "true");
    assert.equal(state.artistRequests, 1, "Cooldown expiry only enables retry; it makes no request");
    await retry.evaluate(node => { node.click(); node.click(); });
    await page.getByText(/^Checking artist availability\.?$/, { exact: true }).waitFor();
    assert.equal(state.artistRequests, 2, "Rapid manual taps share one pending request");
    assert.equal(await retry.isDisabled(), true);
    assert.ok(state.releaseArtist);
    state.releaseArtist();
    await page.getByRole("button", { name: `Open ${artist.name}'s profile`, exact: true }).first().waitFor();
    await page.screenshot({ path: join(output, `${name}-recovered.png`), fullPage: true });
    assert.equal(state.artistRequests, 2);
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.external, []);
    const receipt = { ...state, releaseArtist: undefined, closing: undefined, passed: true, outboundRequests: 0 };
    console.log(JSON.stringify(receipt));
    return receipt;
  } catch (error) {
    await page.screenshot({ path: join(output, `${name}-failed.png`), fullPage: true }).catch(() => {});
    console.error(JSON.stringify({ ...state, releaseArtist: undefined, failure: error.message }));
    throw error;
  } finally {
    state.closing = true;
    state.releaseArtist?.();
    await context.close();
  }
}

mkdirSync(output, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
const { server, origin } = await serveBuild();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
  const results = [];
  for (const item of [{ width: 390 }, { width: 1280 }, { width: 390, missingSnapshot: true }]) results.push(await scenario(browser, origin, item));
  const receipt = { passed: results.length, failed: 0, network: "intercepted local fixtures only", results };
  writeFileSync(join(output, "results.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ passed: results.length, failed: 0, output }));
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
