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
      limits: { lanes: mode === "catch_up" ? 10 : 1, maxArtistsPerPass: mode === "catch_up" ? 40 : 10,
        intervalMinutes: mode === "catch_up" ? 2 : 15, maxPassSeconds: 45,
        maxAttemptsPerDay: 10000, maxRequestsPerDay: 12000, providerSpacingMs: 1100,
        maxResponseKiB: 512, maxBiographyCharacters: 1200, maxGrowthMiB: 256 },
      budget: { utcDay: "2026-09-15", attempts: 23, requests: 69 },
      progress: { totalArtists: 30161, eligible: 9000, unprocessed: 8000, needsIdentity: 800,
        alreadyComplete: 20361, unresolved: 700, retrying: 300, attempted: 1000, totalTracked: 1300, filled: 987,
        fieldCoverage: { biographyPresent: 20000, biographyMissing: 9161, biographyProtected: 1000, countryPresent: 21000, countryMissing: 9161 } },
    },
    artistKnowledge: { enabled: true, state: mode === "paused" ? "paused" : "recent",
      lastPass: { at, checked: 23, filled: 20, bios: 18, countries: 4, unmatched: 2, failed: 0, deferred: 1, stoppedEarly: true, lanes: 3 },
      ledger: { filled: 987 }, cooldownUntil: null },
    artistPhotos: { enabled: true, configured: true, phase: mode === "paused" ? "paused" : "waiting",
      lastPass: { at, attempted: 20, filled: 18, noMatch: 2, failed: 0 } },
    venuePhotos: { installed: true, enabled: true, configured: true, state: mode === "paused" ? "paused" : "filled",
      counts: { filled: 12, no_match: 4 }, attemptsToday: 16, reservedTotalBytes: 2 * 1024 ** 2,
      nextPassAt: at + 900000, limits: { attemptsPerDay: 100, totalBytes: 256 * 1024 ** 2 } },
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
    newsDesk: { configured: true, enabled: true, budget: { dailyUsd: 0.3, monthlyUsd: 6 },
      spend: { today: { confirmedUsd: 0.02, heldUsd: 0, unconfirmedUsd: 0 }, month: { confirmedUsd: 0.4, heldUsd: 0.05, unconfirmedUsd: 0 } },
      publisherBound: true, publishedToday: 1, slotsPerDay: 5, nextSlot: { label: "17:00", timeZone: "America/Toronto" },
      published7d: 6, declined7d: 2, openReports: 41,
      lastPass: { at, reason: "waiting_for_slot", reportsAdded: 7, confirmed: 0, published: 0, declined: 0, budgetStops: 0, slot: "next_slot", headline: null },
      lastError: null },
    claudeSpend: { month: "2026-09", ceilingUsd: 10, totalUsd: 1.29, leftUsd: 8.71,
      news: { confirmedUsd: 0.4, heldUsd: 0.05, unconfirmedUsd: 0, totalUsd: 0.45 },
      research: { confirmedUsd: 0.64, heldUsd: 0, unconfirmedUsd: 0.2, totalUsd: 0.84 } },
    privacyJournal: { signingKey: false, storage: true, pending: 2, oldestPendingAt: at, lastShippedAt: null, lastError: null, lastReplay: null },
  };
}
const newsCandidate = { headline: "Radiohead Announce 2027 World Tour", reportUrls: ["https://www.nme.com/news/tour", "https://www.stereogum.com/tour"],
  outlets: [{ name: "NME", url: "https://www.nme.com/news/tour" }, { name: "Stereogum", url: "https://www.stereogum.com/tour" }],
  groups: 2, needed: 2, ready: true, category: "tour", ageHours: 5, lead: "Radiohead", score: 20 };
export const newsDraftFixture = (status = "draft") => ({ id: "draft-fixture-1", status, expired: false, headline: "Radiohead announce a 2027 world tour",
  summary: "Radiohead will tour the world in 2027, NME and Stereogum report.", body: "First paragraph. Second paragraph.", category: "tour",
  reason: null, costUsd: 0.018, sources: [{ name: "NME", url: "https://www.nme.com/news/tour", used: true }, { name: "Stereogum", url: "https://www.stereogum.com/tour", used: true }],
  postId: status === "published" ? "news_fixture" : null, createdAt: 1789488000000 });
export function newsEditorFixture(drafts = [], live = []) {
  return { configured: true, publisherReady: true, budget: { leftTodayUsd: 0.28, dailyUsd: 0.3, monthlyUsd: 6, typicalDraftUsd: 0.02 },
    drafts: { last24h: drafts.length, limit: 10, recent: drafts }, candidates: [newsCandidate], live };
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
    "/api/moderation/search-growth": {
      enabled: false, configured: false, mode: "monitor",
      connection: { state: "missing_property", property: null },
      lastSuccessAt: null, nextRunAt: null, lastErrorCode: null, running: false,
      window: null, previousWindow: null, totals: { current: null, previous: null },
      truncated: false, opportunities: [],
      limits: { maxPages: 1000, maxPrioritiesPerDay: 10, retentionDays: 90 },
      history: [], measurement: { state: "not_connected" },
    },
  };
  return fixtures[url.pathname] || null;
}
const bootstrapStaffPaths = ["/api/admin/moderation", "/api/admin/artist-requests"];
const unrelatedCatalogStaffRead = call => /^\/api\/(?:admin|moderation)(?:\/|$)/.test(call.path)
  && !call.path.startsWith("/api/admin/catalog-editor/");
export function assertCatalogEditorRequestIsolation(calls) {
  const unrelated = calls.filter(unrelatedCatalogStaffRead);
  // absorbServerUser already loads these two queues at sign-in. Retain the
  // complete ledger and account for them explicitly; do not reset it at entry.
  assert.deepEqual(unrelated.filter(call => call.phase === "bootstrap").map(call => `${call.method} ${call.path}`).sort(),
    bootstrapStaffPaths.map(path => `GET ${path}`).sort(), "Only the two existing sign-in queue reads may precede editor entry.");
  assert.deepEqual(unrelated.filter(call => call.phase !== "bootstrap"), [],
    "Opening and using the standalone catalog editor must not load unrelated private staff data.");
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
function catalogEditorFixture(type) {
  return { type, key: `${type}-fixture`, identity: { name: `Fixture ${type}`, city: "Toronto", country: "CA" },
    protectedFacts: { venue: "Provider hall", date: "2027-05-01" }, protectedReason: null, revision: 0,
    identityHash: "a".repeat(64), expectedHash: "b".repeat(64), content: null, identityCurrent: true,
    missingFields: ["sourced summary"] };
}
async function scenario(browser, origin, width, kind) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const state = { mode: "maintenance", phase: "bootstrap", calls: [], errors: [], reports: [], gets: 0, posts: 0, release: null, closing: false };
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
      const call = { path: url.pathname, method, phase: state.phase };
      state.calls.push(call);
      if (kind === "catalog-editor" && state.phase === "catalog-editor") {
        assert.equal(unrelatedCatalogStaffRead(call), false, `Unexpected private staff request after editor entry: ${url.pathname}`);
      }
      if (url.pathname === "/api/client-errors") state.reports.push(request.postDataJSON());
      if (url.pathname.startsWith("/api/admin/catalog-editor/")) {
        let body;
        if (url.pathname.endsWith("/prepare")) {
          assert.equal(method, "POST");
          body = { results: request.postDataJSON().entries.map((draft, index) => ({ index, ok: true, draft,
            current: catalogEditorFixture(draft.type), payloadHash: `fixture-payload-${index}` })) };
        } else if (url.pathname.endsWith("/save")) {
          assert.equal(method, "POST");
          const { draft, idempotencyKey } = request.postDataJSON();
          assert.ok(idempotencyKey.length >= 16); assert.equal(draft.expectedRevision, 0);
          state.posts++;
          body = { ok: true, revision: 1, auditId: `fixture-receipt-${draft.type}`, replayed: false,
            saved: { ...catalogEditorFixture(draft.type), revision: 1, content: { summary: draft.summary, sources: draft.sources } } };
        } else {
          assert.equal(method, "GET");
          const parts = url.pathname.split("/");
          const row = catalogEditorFixture(parts[4]);
          body = parts.length === 5 ? { items: [row], nextCursor: null } : row;
        }
        return await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      }

      if (url.pathname === "/api/moderation/news-desk/live") {
        assert.equal(method, "POST");
        assert.deepEqual(request.postDataJSON(), { title: "2026 MTV VMAs", keywords: "VMAs, Video Music Awards", hours: 4 });
        state.newsLive = [{ id: "live-1", slug: "2026-mtv-vmas", title: "2026 MTV VMAs", keywords: ["VMAs", "Video Music Awards"], live: true,
          startsAt: 1789488000000, endsAt: 1789488000000 + 4 * 3600000, updatedAt: 1789488000000, count: 0, items: [] }];
        return await route.fulfill({ contentType: "application/json", body: JSON.stringify({ live: state.newsLive }) });
      }
      if (url.pathname === "/api/moderation/news-desk/live/live-1/categories") {
        assert.equal(method, "POST");
        assert.match(request.postDataJSON().text, /^Video of the Year: Sabrina Carpenter - Manchild; Taylor Swift - Fortnight$/u);
        state.newsLive[0].winners = { total: 1, announced: 0, categories: [
          { id: "c1", name: "Video of the Year", nominees: ["Sabrina Carpenter - Manchild", "Taylor Swift - Fortnight"], winner: null, announcedAt: null }] };
        return await route.fulfill({ contentType: "application/json", body: JSON.stringify({ live: state.newsLive }) });
      }
      if (url.pathname === "/api/moderation/news-desk/live/live-1/categories/c1/winner") {
        assert.deepEqual(request.postDataJSON(), { nominee: "Sabrina Carpenter - Manchild" });
        Object.assign(state.newsLive[0].winners.categories[0], { winner: "Sabrina Carpenter - Manchild", announcedAt: 1789488000000 });
        state.newsLive[0].winners.announced = 1;
        return await route.fulfill({ contentType: "application/json", body: JSON.stringify({ live: state.newsLive }) });
      }
      if (url.pathname === "/api/moderation/news-desk/live/live-1/end") {
        assert.equal(method, "POST");
        state.newsLive[0].live = false;
        return await route.fulfill({ contentType: "application/json", body: JSON.stringify({ live: state.newsLive }) });
      }
      if (url.pathname.startsWith("/api/moderation/news-desk/editor")) {
        if (method === "POST" && url.pathname.endsWith("/drafts")) {
          assert.deepEqual(request.postDataJSON(), { reportUrls: ["https://www.nme.com/news/tour", "https://www.stereogum.com/tour"], links: [] });
          state.newsDraft = newsDraftFixture("draft");
        } else if (method === "POST" && url.pathname.endsWith("/draft-fixture-1/publish")) state.newsDraft = newsDraftFixture("published");
        else assert.equal(method, "GET");
        const body = method === "GET" ? newsEditorFixture(state.newsDraft ? [state.newsDraft] : [], state.newsLive || [])
          : url.pathname.endsWith("/publish") ? { draft: state.newsDraft, postId: "news_fixture" } : { draft: state.newsDraft };
        return await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      }
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
    const bootstrapStaffResponses = kind === "catalog-editor" ? Promise.all(bootstrapStaffPaths.map(path =>
      page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "GET" && response.status() === 200))) : null;
    await page.goto(origin + "/feed", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    if (kind === "catalog-editor") {
      await page.getByRole("button", { name: "Settings. Appearance, privacy, data, and account controls", exact: true }).click();
      await bootstrapStaffResponses;
      // Start before the click so lazy mounting and all editor requests count.
      state.phase = "catalog-editor";
      await page.getByRole("button", { name: /Catalog editor/ }).click();
      await page.setViewportSize({ width, height: 900 });
      await page.getByText("Fill missing page text", { exact: true }).waitFor();
      for (const type of ["artist", "venue", "event"]) {
        await page.getByRole("button", { name: `${type[0].toUpperCase()}${type.slice(1)}s`, exact: true }).click();
        await page.getByRole("button", { name: "Find pages", exact: true }).click();
        await page.getByRole("button", { name: "Edit text", exact: true }).click();
        await page.getByLabel("Sourced page text", { exact: true }).fill(`Sourced ${type} context for this isolated browser fixture.`);
        await page.getByLabel("Named source URLs", { exact: true }).fill("Official | https://official.example.com/context");
        await page.getByLabel("Reason for catalog change", { exact: true }).fill("Fill missing context");
        await page.getByRole("button", { name: "Add to batch", exact: true }).click();
      }
      await page.getByRole("button", { name: "Review prepared batch", exact: true }).click();
      assert.equal(state.posts, 0, "Preparation must not publish any page.");
      await page.getByRole("button", { name: "Confirm sources and publish", exact: true }).first().waitFor();
      for (const type of ["artist", "venue", "event"]) {
        await page.getByRole("button", { name: "Confirm sources and publish", exact: true }).first().click();
        await page.getByText(`Saved revision 1 · receipt fixture-receipt-${type}`, { exact: true }).waitFor();
      }
      assert.equal(state.posts, 3);
      assertCatalogEditorRequestIsolation(state.calls);
      assert.deepEqual(state.errors, []); assert.deepEqual(state.reports, []);
      console.log(JSON.stringify({ name: `catalog-editor-${width}`, passed: true, posts: state.posts }));
      return;
    }
    await page.getByRole("button", { name: "Newsroom. Write stories and run live coverage", exact: true }).click();
    await page.getByText("Newsroom", { exact: true }).first().waitFor();
    assert.equal(state.errors.some((error) => /appActive is not defined/i.test(error)), false,
      "opening Newsroom from Feed must not reference an undeclared appActive");
    await page.getByRole("button", { name: "Back", exact: true }).click();
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
    await panel.getByText(/Artist facts, profile photos and venue photography have separate bounded queues/).waitFor();
    await panel.getByText("Photo workers", { exact: true }).waitFor();
    await panel.getByText("18 saved / 20 checked", { exact: true }).waitFor();
    await panel.getByText("Verified venue photos saved", { exact: true }).waitFor();
    await panel.getByText(/18 biographies and 4 countries/).waitFor();
    await panel.getByText(/Interrupted work stays queued/).waitFor();
    await panel.getByText(/Show-date refresh \(not venue page enrichment\)/).waitFor();
    await panel.getByText(/Show-date scheduler: Disabled/).waitFor();
    await panel.getByText("News desk", { exact: true }).first().waitFor();
    await panel.getByText(/1 of 5 stories today\. Next slot: 17:00, Toronto time\./).waitFor();
    await panel.getByText(/Waiting for the next publishing slot\. 7 new outlet reports/).waitFor();
    await panel.getByText("Claude spending this month", { exact: true }).waitFor();
    await panel.getByText("$1.29 / $10.00", { exact: true }).waitFor();
    await panel.getByText("$0.64 confirmed, $0.00 held, $0.20 unconfirmed", { exact: true }).waitFor();
    await panel.getByText(/Privacy journal: 2 waiting to copy off-host/).waitFor();
    await panel.getByText(/Add PRIVACY_JOURNAL_KEY in Render/).waitFor();
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
    if (kind === "actions") {
      // The newsroom is its own Moderation tab, apart from catalog upkeep.
      assert.equal(await panel.getByTestId("news-desk-editor").count(), 0, "the news editor no longer sits inside Catalog");
      await page.getByRole("tab", { name: "Newsroom", exact: true }).click();
      const editor = page.getByTestId("news-desk-editor");
      await editor.getByText("Radiohead Announce 2027 World Tour", { exact: true }).waitFor();
      await editor.getByText(/about 2 cents, from the news budget: \$0\.28 left today\. 0 of 10 drafts/).waitFor();
      await editor.getByRole("button", { name: "Write a draft about Radiohead Announce 2027 World Tour", exact: true }).click();
      await editor.getByText("READY TO PUBLISH", { exact: true }).waitFor();
      await editor.getByText("Radiohead announce a 2027 world tour", { exact: true }).waitFor();
      await editor.getByRole("button", { name: "Publish Radiohead announce a 2027 world tour", exact: true }).click();
      await editor.getByText("Published. It is on the News tab now.", { exact: true }).waitFor();
      await editor.getByText("PUBLISHED", { exact: true }).waitFor();
      await editor.getByLabel("Event name", { exact: true }).fill("2026 MTV VMAs");
      await editor.getByLabel("Headline keywords", { exact: true }).fill("VMAs, Video Music Awards");
      // Inputs are one line tall, not the old 220 pixel boxes.
      assert.ok((await editor.getByLabel("Event name", { exact: true }).boundingBox()).height < 60);
      mkdirSync(join(root, ".tmp", "catalog-maintenance-browser"), { recursive: true });
      await page.screenshot({ path: join(root, ".tmp", "catalog-maintenance-browser", `newsroom-${width}.png`), fullPage: false });
      await editor.getByRole("button", { name: "Start live coverage", exact: true }).click();
      await editor.getByText("Live coverage started. It is at the top of the news now.", { exact: true }).waitFor();
      await editor.getByRole("button", { name: "Post the live update", exact: true }).waitFor();
      await editor.getByRole("button", { name: "End live coverage of 2026 MTV VMAs", exact: true }).waitFor();
      await editor.getByText("Public page: https://www.mshpit.com/news/live/2026-mtv-vmas", { exact: true }).waitFor();
      await editor.getByLabel("Award categories and nominees", { exact: true }).fill("Video of the Year: Sabrina Carpenter - Manchild; Taylor Swift - Fortnight");
      await editor.getByRole("button", { name: "Save the award categories", exact: true }).click();
      await editor.getByText("WINNERS · 0 OF 1 ANNOUNCED", { exact: true }).waitFor();
      await editor.getByRole("button", { name: "Sabrina Carpenter - Manchild won Video of the Year", exact: true }).click();
      await editor.getByText("Winner: Sabrina Carpenter - Manchild", { exact: true }).waitFor();
      await editor.getByRole("button", { name: "Clear the winner of Video of the Year", exact: true }).waitFor();
      // After the show: the recap keeps its winners controls, and a new show can start.
      await editor.getByRole("button", { name: "End live coverage of 2026 MTV VMAs", exact: true }).click();
      await editor.getByText("Recap: 2026 MTV VMAs", { exact: true }).waitFor();
      await editor.getByRole("button", { name: "Clear the winner of Video of the Year", exact: true }).waitFor();
      await editor.getByRole("button", { name: "Start live coverage", exact: true }).waitFor();
      assert.equal(await editor.getByRole("button", { name: "Post the live update", exact: true }).count(), 0, "no updates after the show");
      await page.getByRole("tab", { name: "Catalog", exact: true }).click();
      await panel.waitFor();
      // No element screenshot here: capturing an element taller than the
      // window resizes the page in Chromium and remounts Moderation.
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
    for (const width of [390, 1280]) for (const kind of ["actions", "load-retry", "action-retry", "access-loss", "catalog-editor"]) await scenario(browser, origin, width, kind);
    console.log(JSON.stringify({ passed: 10, failed: 0, network: "isolated fixtures only" }));
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
