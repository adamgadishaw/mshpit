// Actual exported app, loopback documents and synthetic APIs only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), directory = join(root, "dist");
const receipt = resolve(root, process.env.PIT_ALERT_BROWSER_OUTPUT || ".tmp/local-alert-browser"); mkdirSync(receipt, { recursive: true });
const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf" };
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://fixture.invalid");
  if (!["GET", "HEAD"].includes(request.method) || url.pathname.startsWith("/api/")) return void response.writeHead(405).end();
  let file;
  try { file = resolve(directory, `.${decodeURIComponent(url.pathname)}`); } catch { return void response.writeHead(400).end(); }
  if (!file.startsWith(directory + sep)) return void response.writeHead(400).end();
  try { if (!statSync(file).isFile()) file = join(directory, "index.html"); } catch { file = join(directory, "index.html"); }
  response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  response.end(request.method === "HEAD" ? undefined : readFileSync(file));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(import.meta.url), { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
const results = [];
try {
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = [], calls = []; let failedWrite = false, rejectTarget = false, writes = 0;
    let preferences = { datesInbox: true, salesInbox: true, datesPush: false, salesPush: false };
    const event = { id: "tm_navigation_fixture", performanceEvent: true, artist: "Fixture Artist", artistKey: "fixture-artist", venue: "Fixture Venue", city: "Toronto", date: "2027-02-15", source: "ticketmaster" };
    const notices = [{ id: "n_date", alertId: "a_date", type: "artist_tour_date", artist: "Fixture Artist", text: "New show: 2027-02-15 at Fixture Venue.", ts: Date.now(), read: false },
      { id: "n_sale", alertId: "a_sale", type: "local_ticket_sale", artist: "Fixture Artist", text: "Tickets are on sale in Toronto.", ts: Date.now() - 100, read: false }];
    page.on("pageerror", error => errors.push(error.message));
    await context.addInitScript(({ origin, user }) => { if (location.origin !== origin) return; localStorage.setItem("pit_theme", "stage"); localStorage.setItem("pit.session", JSON.stringify(user)); }, { origin, user: navigationUser });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
      if (url.origin !== origin) return route.abort();
      if (!path.startsWith("/api/")) return route.continue();
      calls.push({ path, method });
      let result, status = 200;
      if (path.startsWith("/api/me/local-alerts")) {
        assert.equal(request.headers()["x-pit-expected-account"], navigationUser.id);
        if (path.endsWith("/preferences")) {
          if (method === "PUT") {
            writes++;
            if (failedWrite) { status = 503; result = { error: "Fixture connection lost.", code: "UNAVAILABLE" }; }
            else preferences = request.postDataJSON();
          }
          result ||= { preferences, homeCity: { city: "Toronto", path: "/city/ca/toronto" }, deliveryEnabled: true };
        } else if (path.endsWith("/target")) {
          if (rejectTarget) { status = 404; result = { error: "This show update is no longer available.", code: "NOT_FOUND" }; }
          else result = { target: { eventId: event.id, event } };
        } else throw new Error("Unexpected device call");
      } else if (path === "/api/me") result = { user: navigationUser };
      else if (path === "/api/me/notifications") result = { notifications: notices, unread: 2, inboxUnread: 0, nextCursor: null, readContract: "notification-ids-v1" };
      else if (path === "/api/me/notifications/read/scoped") result = { ok: true, notificationIds: request.postDataJSON().notificationIds, unread: 0, readContract: "notification-ids-v1" };
      else if (method === "POST") result = { ok: true, post: null, invalidPostIds: [] };
      else if (path.includes("/event-accounts/")) result = { account: null, claims: [], entity: null };
      else result = fixtureApiResponse(path, { member: true, method, resolvedPath: url.searchParams.get("path") || undefined });
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(result) });
    });
    try {
      await page.goto(origin + "/feed", { waitUntil: "networkidle" });
      if (width < 620) await page.getByRole("tab", { name: "You", exact: true }).click();
      else await page.getByRole("button", { name: /Account menu for/ }).click();
      await page.getByText("Settings", { exact: true }).click();
      const dates = page.getByRole("switch", { name: /Tour dates in Activity/ });
      await dates.waitFor(); assert.equal(await dates.isChecked(), true);
      await page.getByText("Phone and tablet notifications are managed in the mobile app. Activity alerts work separately.", { exact: true }).waitFor();
      failedWrite = true; await dates.click(); await page.getByRole("button", { name: /Try notification settings again/ }).waitFor();
      assert.equal(await dates.isChecked(), true);
      failedWrite = false; await page.getByRole("button", { name: /Try notification settings again/ }).click();
      await dates.click(); await page.waitForFunction(() => [...document.querySelectorAll('[role="switch"]')].some(element => element.checked === false || element.getAttribute("aria-checked") === "false"));
      assert.equal(preferences.datesInbox, false); assert.equal(preferences.salesInbox, true); assert.equal(writes, 2);
      await page.screenshot({ path: join(receipt, `settings-${width}.png`), fullPage: true });
      await page.goto(origin + "/feed", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Activity(?:,|$)/ }).first().click();
      await page.getByRole("tab", { name: "Updates activity view" }).click();
      const sale = page.getByRole("button", { name: "Fixture Artist: Tickets are on sale in Toronto.", exact: true });
      await sale.waitFor(); await page.screenshot({ path: join(receipt, `activity-${width}.png`), fullPage: true });
      rejectTarget = true; await sale.click(); await page.getByText("This show update is no longer available.", { exact: true }).waitFor();
      rejectTarget = false; await sale.click();
      await page.getByRole("button", { name: "Open Fixture Venue's venue page", exact: true }).first().waitFor();
      assert.deepEqual(errors, []);
      assert.equal(calls.some(call => call.path.includes("/devices")), false);
      const result = { width, settingsErrorRetry: true, separateChannels: true, updates: 2, unavailableRetry: true, canonicalEventNavigation: true, deviceCalls: 0 };
      results.push(result); console.log(JSON.stringify(result));
    } catch (error) {
      await page.screenshot({ path: join(receipt, `failure-${width}.png`), fullPage: true });
      throw new Error(JSON.stringify({ width, message: error.message, errors, calls: calls.slice(-15), text: (await page.locator("body").innerText()).slice(-3500) }));
    } finally { await context.close(); }
  }
  writeFileSync(join(receipt, "results.json"), JSON.stringify(results, null, 2));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
