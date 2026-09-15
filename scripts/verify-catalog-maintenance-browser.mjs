#!/usr/bin/env node
// Exported app, loopback static files and synthetic staff accounts only.
// No live administrator session, database, provider calls, or production writes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, statSync, mkdirSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = "/api/moderation/catalog-maintenance";
export const upkeepAdmin = Object.freeze({ ...navigationUser, role: "admin" });
export function upkeepFixture(mode = "maintenance") {
  assert.ok(["maintenance", "catch_up", "paused"].includes(mode));
  const at = 1789488000000;
  return {
    catalog: { mode, nextPassAt: at + 120000, updatedAt: at, initialSweepFinishedAt: null,
      limits: { lanes: mode === "catch_up" ? 3 : 1, maxArtistsPerPass: mode === "catch_up" ? 40 : 10,
        intervalMinutes: mode === "catch_up" ? 2 : 15, maxPassSeconds: 45,
        maxAttemptsPerDay: 3000, maxRequestsPerDay: 12000, providerSpacingMs: 1100,
        maxResponseKiB: 512, maxBiographyCharacters: 1200, maxGrowthMiB: 256 },
      budget: { utcDay: "2026-09-15", attempts: 23, requests: 69 },
      progress: { totalArtists: 30161, eligible: 9000, unprocessed: 8000, needsIdentity: 800,
        alreadyComplete: 20361, unresolved: 700, retrying: 300, attempted: 1000, totalTracked: 1300, filled: 987,
        fieldCoverage: { biographyPresent: 20000, biographyMissing: 9161, biographyProtected: 1000, countryPresent: 21000, countryMissing: 9161 } },
    },
    artistKnowledge: { enabled: true, state: mode === "paused" ? "paused" : "recent",
      lastPass: { at, checked: 23, filled: 20, bios: 18, countries: 4, unmatched: 2, failed: 0, deferred: 1, stoppedEarly: true, lanes: 3 },
      ledger: { filled: 987 }, cooldownUntil: null },
    storage: { status: "healthy", checkedAt: at, databaseBytes: 148 * 1024 ** 2,
      walBytes: 15 * 1024 ** 2, freeBytes: 3953 * 1024 ** 2, snapshotHeadroomBytes: 512 * 1024 ** 2,
      issues: [], warnings: [] },
    sources: {
      artist: { name: "Wikidata / Wikipedia", scope: "Verified biography and country fields." },
      venues: { name: "Saved provider venue facts", scope: "Names and locations from provider records." },
      events: { name: "Ticketmaster / Bandsintown", scope: "Published dates and venue links." },
    },
    sourceRefresh: { enabled: false, configured: true, state: "failed", at, lastSuccessAt: null, stage: "fetching", category: "provider_network" },
    seo: { state: "ready", lastBuiltAt: at, totalUrls: 43200, nextRefreshMinutes: 15,
      indexingState: "not_measured", sitemapUrl: "https://catalog-fixture.invalid/sitemap.xml" },
  };
}
export function staffFixture(url, method = "GET") {
  assert.equal(method, "GET", "Only an explicit upkeep button may mutate a fixture.");
  const fixtures = {
    "/api/admin/moderation": { reports: [], requests: [], recentActions: [], nextCursor: null, hasMore: false, summary: {} },
    "/api/admin/members": { users: [upkeepAdmin], total: 1, banned: 0, verified: 1, regions: [] },
    "/api/admin/artist-requests": { requests: [] },
    "/api/admin/health": { services: { youtubeConfigured: false } },
    "/api/admin/errors": { errors: [], serious: { occurrences: 0, patterns: [] } },
    "/api/admin/artist-queue": { thin: [], missing: [], thinTotal: 0 },
    "/api/admin/catalog/seed": { running: false, total: 30161, phase: "idle" },
    "/api/admin/catalog/runs": { runs: [] },
    "/api/moderation/artist-death-watch": { candidates: [], counts: { pending: 0 }, settings: { enabled: false } },
  };
  return fixtures[url.pathname] || null;
}
async function localServer() {
  const directory = resolve(root, process.env.PIT_NAVIGATION_BROWSER_DIST || "dist");
  const htmlPath = join(directory, "index.html");
  assert.ok(statSync(htmlPath).isFile(), "Build the export before browser verification.");
  const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png",
    ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const state = { mode: "maintenance", calls: [], errors: [], reports: [], gets: 0, posts: 0, release: null, closing: false };
  await context.addInitScript(({ origin, user }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
  }, { origin, user: upkeepAdmin });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    try {
      if (url.origin !== origin) return await route.abort();
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      const method = request.method();
      state.calls.push({ path: url.pathname, method });
      if (url.pathname === "/api/client-errors") state.reports.push(request.postDataJSON());
      if (url.pathname === path) {
        if (method === "GET") {
          state.gets += 1;
          if (state.gets === 1) await new Promise(done => { state.release = done; });
          if (kind === "load-retry" && state.gets === 1) return await route.fulfill({
            status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary fixture outage.", code: "SERVICE_UNAVAILABLE" }),
          });
        } else {
          assert.equal(method, "POST");
          const body = request.postDataJSON();
          assert.deepEqual(Object.keys(body).sort(), ["expectedMode", "mode"]);
          assert.equal(body.expectedMode, state.mode);
          assert.ok(["catch_up", "maintenance", "paused"].includes(body.mode));
          state.posts += 1;
          if (kind === "action-retry" && state.posts === 1) return await route.fulfill({
            status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture mode change timed out.", code: "SERVICE_UNAVAILABLE" }),
          });
          if (kind === "access-loss") return await route.fulfill({
            status: 403, contentType: "application/json", body: JSON.stringify({ error: "Fixture access revoked.", code: "FORBIDDEN" }),
          });
          state.mode = body.mode;
        }
        return await route.fulfill({ contentType: "application/json", body: JSON.stringify(upkeepFixture(state.mode)) });
      }
      const body = url.pathname === "/api/me" ? { user: upkeepAdmin }
        : staffFixture(url, method) || fixtureApiResponse(url.pathname, { member: true, method, resolvedPath: url.searchParams.get("path") || undefined });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|canceled|cancelled/i.test(error.message)) return;
      state.errors.push(error.message);
      await route.abort().catch(() => {});
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    if (message.location().url.startsWith(origin + path) && /503|403/.test(message.text()) && kind !== "actions") return;
    state.errors.push(`${message.text()} (${message.location().url})`);
  });
  try {
    await page.goto(origin + "/feed", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Moderation. Reports, members, and content", exact: true }).click();
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("tab", { name: "Catalog", exact: true }).click();
    const panel = page.getByTestId("catalog-maintenance-panel");
    await panel.getByText("Loading catalog upkeep…", { exact: true }).waitFor();
    assert.equal(await panel.getByText("30,161", { exact: true }).count(), 0);
    state.release?.();
    if (kind === "load-retry") {
      await panel.getByText(/Catalog upkeep could not refresh/).waitFor();
      assert.equal(await panel.getByRole("button", { name: "Start catalog catch-up" }).count(), 0);
      await panel.getByRole("button", { name: "Refresh catalog upkeep status" }).click();
    }
    await panel.getByText("30,161", { exact: true }).waitFor();
    await panel.getByText(/Google indexing: not measured here/).waitFor();
    await panel.getByText(/These controls do not run venue or event page enrichment/).waitFor();
    await panel.getByText(/18 biographies and 4 countries/).waitFor();
    await panel.getByText(/Interrupted work stays queued/).waitFor();
    await panel.getByText(/Show-date refresh \(not venue page enrichment\)/).waitFor();
    await panel.getByText(/Show-date scheduler: Disabled/).waitFor();
    assert.equal(state.posts, 0, "Opening or refreshing the panel must not start work.");
    const catchUp = panel.getByRole("button", { name: "Start catalog catch-up", exact: true });
    await catchUp.click();
    if (kind === "access-loss") {
      await panel.getByText(/Administrator access is no longer confirmed/).waitFor();
      assert.equal(await panel.getByText("30,161", { exact: true }).count(), 0);
      assert.equal(await catchUp.count(), 0);
      assert.equal(state.posts, 1);
    } else {
      if (kind === "action-retry") {
        await panel.getByText(/The mode change could not be confirmed/).waitFor();
        assert.equal(await catchUp.isDisabled(), true);
        await panel.getByRole("button", { name: "Refresh catalog upkeep status" }).click();
        await page.waitForFunction(() => !document.querySelector('[aria-label="Start catalog catch-up"]')?.hasAttribute("disabled"));
        await catchUp.click();
      }
      await panel.getByText("Catch-up", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Pause catalog upkeep", exact: true }).click();
      await panel.getByText("Paused", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Use catalog maintenance mode", exact: true }).click();
      await panel.getByText("Maintenance", { exact: true }).waitFor();
      assert.equal(state.posts, kind === "action-retry" ? 4 : 3);
    }
    assert.deepEqual(state.reports, [], "No client crash reports may be emitted.");
    assert.deepEqual(state.errors, [], "Unhandled errors or missing fixtures fail verification.");
    if (kind === "actions") {
      const shots = join(root, ".tmp", "catalog-maintenance-browser");
      mkdirSync(shots, { recursive: true });
      await panel.evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
      await page.screenshot({ path: join(shots, `catalog-upkeep-${width}.png`), fullPage: false });
    }
    console.log(JSON.stringify({ name: `catalog-upkeep-${kind}-${width}`, passed: true, gets: state.gets, posts: state.posts }));
  } catch (error) {
    console.error(JSON.stringify({ name: `catalog-upkeep-${kind}-${width}`, error: error.message,
      state: { ...state, release: undefined }, body: (await page.locator("body").innerText()).slice(-6000) }));
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
    for (const width of [390, 1280]) for (const kind of ["actions", "load-retry", "action-retry", "access-loss"]) await scenario(browser, origin, width, kind);
    console.log(JSON.stringify({ passed: 8, failed: 0, network: "isolated fixtures only" }));
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
