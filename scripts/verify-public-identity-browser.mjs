#!/usr/bin/env node
// Real SQLite, public API route handlers and SEO documents over loopback HTTP.
// Other application reads are explicit fixtures; no schedulers or providers run.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureApiResponse } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const identityPaths = Object.freeze({
  toronto: "/venue/ticketmaster-identity-toronto-room",
  ottawa: "/venue/ticketmaster-identity-ottawa-room",
  ambiguousVenue: "/venue/identity-hall",
  event: "/event/identity-event",
  pending: "/event/identity-event-pending",
  conflict: "/event/identity-event-conflict",
  unknown: "/event/identity-event-unknown",
  artist: "/artist/identity-twins-ca",
  namesake: "/artist/identity-twins",
});

export async function createPublicIdentityFixture({ dist = null } = {}) {
  // Git injects safe.directory through COUNT/KEY/VALUE triplets in managed
  // workspaces. Preserve only a complete set of that non-secret option; other
  // Git options (including http.extraHeader credentials) must not survive.
  const gitCountText = process.env.GIT_CONFIG_COUNT || "";
  const gitCount = Number(gitCountText);
  const safeGitVariables = new Set();
  if (/^(?:0|[1-9][0-9]*)$/.test(gitCountText) && gitCount <= 32
    && Array.from({ length: gitCount }, (_, index) => index).every(index =>
      process.env[`GIT_CONFIG_KEY_${index}`] === "safe.directory"
      && typeof process.env[`GIT_CONFIG_VALUE_${index}`] === "string")) {
    safeGitVariables.add("GIT_CONFIG_COUNT");
    for (let index = 0; index < gitCount; index += 1) {
      safeGitVariables.add(`GIT_CONFIG_KEY_${index}`);
      safeGitVariables.add(`GIT_CONFIG_VALUE_${index}`);
    }
  }
  // Imported API modules must never inherit hosted credentials or data paths.
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("GIT_CONFIG_")) {
      if (!safeGitVariables.has(name)) delete process.env[name];
      continue;
    }
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)
      || /^(?:ADMIN_|MAIL_|RESEND_|RENDER|PUBLIC_ORIGIN$|PIT_DATA_DIR$)/.test(name)) delete process.env[name];
  }
  process.env.NODE_ENV = "test";
  process.env.PIT_ENV = "production";
  process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "false";
  const directory = mkdtempSync(join(tmpdir(), "pit-public-identity-"));
  process.env.PIT_DATA_DIR = directory;
  const nativeFetch = globalThis.fetch;
  const failures = [], requests = [];
  let origin, database, routes, seo;
  const output = dist ? resolve(dist) : null;
  const template = output ? readFileSync(join(output, "index.html"), "utf8")
    : '<!doctype html><html><head></head><body><div id="root"></div></body></html>';
  const server = createServer(async (request, response) => {
    try {
      assert.ok(["GET", "HEAD"].includes(request.method), "The identity fixture permits reads only");
      const url = new URL(request.url, origin);
      requests.push(url.pathname + url.search);
      response.setHeader("Cache-Control", "no-store");
      if (url.pathname.startsWith("/api/")) {
        const key = `${request.method} ${url.pathname}`;
        let body;
        if (["GET /api/resolve", "GET /api/page-head"].includes(key)) {
          body = await routes[key]({ query: Object.fromEntries(url.searchParams), ip: "identity-fixture", user: null,
            setHeader: (name, value) => response.setHeader(name, value) });
        } else if (url.pathname === "/api/artists/identity-twins-ca/memorial") body = { memorial: null };
        else if (/^\/api\/venues\/[^/]+\/photos$/.test(url.pathname)) body = { photos: [], state: "ready" };
        else body = fixtureApiResponse(url.pathname, { method: request.method, resolvedPath: url.searchParams.get("path") });
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(body));
        return;
      }
      if (output) {
        const asset = resolve(output, `.${decodeURIComponent(url.pathname)}`);
        if (asset.startsWith(output + sep) && existsSync(asset) && extname(asset)) {
          response.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
            ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ttf": "font/ttf", ".woff2": "font/woff2" })[extname(asset)] || "application/octet-stream");
          response.end(request.method === "HEAD" ? undefined : readFileSync(asset));
          return;
        }
      }
      const plan = seo.seoHttpPlan(url.pathname);
      if (plan.type === "redirect") { response.writeHead(plan.status, { Location: plan.location }).end(); return; }
      response.statusCode = plan.status || 200;
      response.setHeader("Content-Type", "text/html");
      response.end(request.method === "HEAD" ? undefined : seo.injectHead(template, url.pathname, plan, { PIT_ENV: "production" }));
    } catch (error) {
      failures.push(error.message);
      response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Fixture failure" }));
    }
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  origin = `http://127.0.0.1:${server.address().port}`;
  process.env.PUBLIC_ORIGIN = origin;
  globalThis.fetch = (input, options) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== origin) {
      failures.push(`Blocked external server request: ${url.origin}`);
      throw new Error("Identity fixtures prohibit external requests");
    }
    return nativeFetch(input, options);
  };
  const close = async () => {
    await new Promise(done => server.close(done));
    database?.close();
    globalThis.fetch = nativeFetch;
    const target = realpathSync(directory);
    assert.equal(dirname(target).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
    assert.ok(basename(target).startsWith("pit-public-identity-"));
    rmSync(target, { recursive: true, force: true });
  };
  try {
    ({ db: database } = await import("../server/db.js"));
    ({ routes } = await import("../server/api.js"));
    seo = await import("../server/seo.js");
    const artist = database.prepare(`INSERT INTO artists
      (norm,name,public_slug,search_key,genre,bio,data,source,created_at,updated_at)
      VALUES (?,'Identity Twins',?,'identitytwins','Rock','Synthetic identity regression biography.','{}','test',1,1)`);
    artist.run("identity-twins-ca", "identity-twins-ca");
    artist.run("identity-twins-us", "identity-twins");
    const event = database.prepare(`INSERT INTO tour_dates
      (id,event_name,artist,artist_key,venue,place,date,source,updated_at,release_at,provider_active,
        music_qualified,music_evidence,billed_artists,venue_provider_id,venue_city,venue_country_code,artist_identity_status)
      VALUES (?,'Identity Twins show','Identity Twins',?,'Identity Hall',?,'2099-01-01','ticketmaster',1,0,1,
        1,'ticketmaster:classification:music','["Identity Twins"]',?,?,'CA',?)`);
    event.run("identity-event", "identity-twins-ca", "Toronto, Canada", "identity-toronto-room", "Toronto", "registered");
    event.run("identity-ottawa", "identity-twins-ca", "Ottawa, Canada", "identity-ottawa-room", "Ottawa", "registered");
    for (const status of ["pending", "conflict"]) {
      event.run(`identity-event-${status}`, "identity-twins-ca", "Toronto, Canada", "identity-toronto-room", "Toronto", status);
    }
    event.run("identity-event-unknown", null, "Toronto, Canada", "identity-toronto-room", "Toronto", null);
    return { origin, database, seo, failures, requests, close };
  } catch (error) { await close(); throw error; }
}

export async function main() {
  const require = createRequire(import.meta.url);
  const chromium = process.env.PIT_PLAYWRIGHT_MODULE ? require(process.env.PIT_PLAYWRIGHT_MODULE).chromium : require("playwright").chromium;
  const fixture = await createPublicIdentityFixture({ dist: resolve(root, process.env.PIT_NAVIGATION_BROWSER_DIST || "dist") });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: "block" });
      const errors = [];
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== fixture.origin) { errors.push("External browser request"); return route.abort(); }
        if (route.request().isNavigationRequest() && url.pathname === identityPaths.artist) {
          // Native new-tab activation must reach the real canonical document.
          // Keep that target on SSR: artist-page hydration is a separate flow,
          // whereas this regression owns the hydrated event's outbound link.
          const response = await route.fetch();
          return route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": "script-src 'none'" } });
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12_000);
      page.on("pageerror", error => errors.push(error.message));
      const assertVenue = async (path) => {
        // SSR also has the heading and canonical. Require a client-only control
        // before checking that hydration retained the authoritative identity.
        await page.getByRole("tablist", { name: "Venue page sections", exact: true }).waitFor();
        await page.waitForFunction(() => !document.querySelector("style[data-mshpit-public-document]"));
        await page.getByRole("heading", { name: "Identity Hall", exact: true }).first().waitFor();
        await page.waitForFunction(expected => location.pathname === expected
          && document.querySelector('link[rel="canonical"]')?.getAttribute("href") === location.origin + expected, path);
        assert.equal(new URL(page.url()).pathname, path);
        assert.equal(await page.getByTestId("public-route-error").count(), 0);
        assert.match(await page.locator('meta[name="robots"]').getAttribute("content"), /(?:^|,)index(?:,|$)/);
      };
      try {
        for (const path of [identityPaths.toronto, identityPaths.ottawa]) {
          const providerVenueId = path === identityPaths.toronto ? "identity-toronto-room" : "identity-ottawa-room";
          const photos = page.waitForResponse(response => {
            const url = new URL(response.url());
            return /\/api\/venues\/[^/]+\/photos$/.test(url.pathname)
              && url.searchParams.get("source") === "ticketmaster"
              && url.searchParams.get("providerVenueId") === providerVenueId;
          });
          await page.goto(fixture.origin + path);
          await assertVenue(path);
          assert.equal((await photos).status(), 200, "hydrated photos retain the selected provider venue");
          await page.reload(); await assertVenue(path);
          await page.getByRole("link", { name: "Home", exact: true }).first().click();
          await page.waitForURL(fixture.origin + "/");
          await page.goBack(); await assertVenue(path);
          await page.goForward(); await page.waitForURL(fixture.origin + "/");
          await page.goBack(); await assertVenue(path);
        }
        for (const [path, linked] of [[identityPaths.event, true], [identityPaths.pending, false], [identityPaths.conflict, false], [identityPaths.unknown, false]]) {
          await page.goto(fixture.origin + path);
          await page.getByRole("button", { name: "Open Identity Hall's venue page", exact: true }).first().waitFor();
          const links = page.getByRole("link", { name: "Identity Twins", exact: true });
          if (linked) {
            assert.equal(await links.first().getAttribute("href"), identityPaths.artist);
            const response = await context.request.get(fixture.origin + await links.first().getAttribute("href"));
            assert.equal(response.status(), 200);
            assert.match(await response.text(), /canonical" href="[^"\s]+\/artist\/identity-twins-ca"/);
            const opened = context.waitForEvent("page");
            await links.first().click({ button: "middle" });
            const target = await opened;
            try {
              await target.waitForLoadState("domcontentloaded");
              assert.equal(new URL(target.url()).pathname, identityPaths.artist);
              assert.equal(await target.locator('link[rel="canonical"]').getAttribute("href"), fixture.origin + identityPaths.artist);
            } finally { await target.close(); }
          } else assert.equal(await links.count(), 0, `${path} must not infer a namesake artist link`);
          assert.equal(await page.locator(`a[href="${identityPaths.namesake}"]`).count(), 0);
          await page.getByRole("link", { name: "Identity Hall", exact: true }).first().click();
          await assertVenue(identityPaths.toronto);
          await page.goBack(); await page.waitForURL(fixture.origin + path);
          await page.goForward(); await assertVenue(identityPaths.toronto);
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(fixture.failures, []);
        console.log(JSON.stringify({ width, passed: true, venueCases: 2, eventCases: 4,
          network: "loopback HTTP; real SQLite resolver/head routes and SSR; remaining API reads mocked" }));
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); await fixture.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
