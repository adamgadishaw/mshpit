#!/usr/bin/env node
// Current exported app, synthetic staff/member accounts, loopback-only mocked
// APIs. No real report, moderation action, credential or deletion request.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { localServer } from "./verify-artist-account-browser.mjs";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";
import { renderPublicPage, SUPPORT_EMAIL } from "../server/publicPages.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "launch-context", "browser");
const details = ('CONTEXT_ONLY_MARKER: second attachment\n<img src=x onerror="alert(1)"> & "quoted" 🎵\n' + "A long report with preserved context. ".repeat(20)).slice(0, 500);
const reports = [
  { id: "synthetic-context", targetType: "post", targetId: "synthetic-target", reason: "Non-consensual intimate image", category: "intimate_image", details,
    status: "open", createdAt: Date.now(), reporter: { id: "reporter", name: "Synthetic reporter", handle: "reporter" },
    content: { type: "post", exists: true, artist: "Synthetic Artist", excerpt: "Synthetic target preview", author: { id: "author", handle: "author", role: "fan" } } },
  { id: "synthetic-legacy", targetType: "post", targetId: "legacy-target", reason: "Legacy context without new fields", status: "open", createdAt: Date.now() },
];

async function scenario(browser, origin, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  const state = { user: { ...navigationUser, role: width < 620 ? "moderator" : "admin" }, errors: [], writes: [], queueReads: 0, closing: false };
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  page.on("pageerror", error => state.errors.push(error.message));
  await page.addInitScript(user => { localStorage.setItem("pit_theme", "stage"); localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user])); }, state.user);
  await context.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.origin !== origin) return await route.abort();
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      const method = req.method();
      if (method !== "GET") state.writes.push({ path: url.pathname, method });
      if (url.pathname === "/api/client-errors") { state.errors.push(req.postData()); return await json({ ok: true }); }
      if (url.pathname === "/api/me") return await json({ user: state.user });
      if (url.pathname === "/api/me/local-alerts/preferences") return await json({ preferences: { datesInbox: true, salesInbox: true, datesPush: false, salesPush: false }, homeCity: null, deliveryEnabled: false, pushDeliveryEnabled: false });
      if (url.pathname === "/api/admin/moderation") {
        state.queueReads++;
        if (!["admin", "moderator"].includes(state.user.role)) return await json({ error: "Staff only" }, 403);
        return await json({ reports, recentActions: [], summary: { open: 2, totalRecent: 2, byType: { post: 2 } } });
      }
      if (url.pathname === "/api/admin/members") return await json({ users: [state.user], total: 1, banned: 0, verified: 0, regions: [] });
      if (url.pathname === "/api/admin/artist-requests") return await json({ requests: [] });
      if (url.pathname === "/api/admin/health") return await json({ ok: true });
      if (url.pathname === "/api/admin/errors") return await json({ groups: [], counts: {}, total: 0 });
      if (url.pathname === "/api/admin/badges") return await json({ badges: [] });
      if (url.pathname === "/api/moderation/artist-death-watch") return await json({ candidates: [], counts: {}, settings: {} });
      return await json(fixtureApiResponse(url.pathname, { member: true, method, resolvedPath: url.searchParams.get("path") || undefined }));
    } catch (error) { if (!state.closing) { state.errors.push(error.message); await route.abort().catch(() => {}); } }
  });
  try {
    await page.goto(origin + "/you", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: /^Moderation/ }).click();
    await page.getByRole("tab", { name: /^Reports/ }).click();
    const detail = page.getByText(details, { exact: true });
    await detail.waitFor(); await detail.scrollIntoViewIfNeeded();
    assert.equal(await detail.textContent(), details);
    assert.equal(await detail.locator("img,script").count(), 0);
    assert.equal(await detail.evaluate(element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1), true);
    await page.getByText("intimate image", { exact: true }).waitFor();
    await page.getByText("Legacy context without new fields", { exact: true }).waitFor();
    assert.equal(await page.getByText("REPORTER DETAILS", { exact: true }).count(), 1);
    await page.screenshot({ path: join(shots, `context-${width}.png`) });
    const search = page.getByLabel("Search loaded reports", { exact: true });
    for (const query of ["CONTEXT_ONLY_MARKER", "intimate_image", "intimate image"]) {
      await search.fill(query);
      await page.getByText("1 matching / 1 rendered", { exact: true }).waitFor();
      assert.equal(await detail.count(), 1);
      assert.equal(await page.getByText("Legacy context without new fields", { exact: true }).count(), 0);
    }
    await search.fill("no synthetic match");
    await page.getByText("No loaded reports match these filters.", { exact: true }).waitFor();
    await search.fill(""); await detail.waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.ok(state.queueReads > 0);
    // A newly authenticated ordinary member must not receive this private UI.
    state.user = { ...state.user, role: "fan" };
    await page.goto(origin + "/you", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: /^Moderation/ }).count(), 0);
    assert.equal(await page.getByText(details, { exact: true }).count(), 0);
    assert.deepEqual(state.errors, []);
    assert.equal(state.writes.some(write => write.path.startsWith("/api/admin/")), false);
    console.log(JSON.stringify({ name: `report-context-${width}`, passed: 3, coverage: ["display", "search", "ordinary member privacy"] }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `failure-${width}.png`) });
    console.error(JSON.stringify({ error: error.message, errors: state.errors, body: (await page.locator("body").innerText()).slice(-5000) }));
    throw error;
  } finally { state.closing = true; await context.close(); }

  const publicContext = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: false, serviceWorkers: "block" });
  try {
    await publicContext.route("**/*", route => new URL(route.request().url()).pathname === "/account-deletion"
      ? route.fulfill({ status: 200, contentType: "text/html", body: renderPublicPage("/account-deletion") }) : route.abort());
    const publicPage = await publicContext.newPage();
    await publicPage.goto(origin + "/account-deletion");
    await publicPage.getByRole("heading", { name: "Request deletion by email" }).scrollIntoViewIfNeeded();
    assert.match(await publicPage.locator("body").innerText(), /whether or not you can sign in/);
    assert.equal(await publicPage.locator(`a[href="mailto:${SUPPORT_EMAIL}"]`).count() > 0, true);
    assert.equal(await publicPage.locator("form,input").count(), 0);
    await publicPage.screenshot({ path: join(shots, `deletion-${width}.png`) });
    console.log(JSON.stringify({ name: `public-deletion-${width}`, passed: 1, javascript: false }));
  } finally { await publicContext.close(); }
}

export async function main() {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
  mkdirSync(shots, { recursive: true });
  const { server, origin } = await localServer(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    for (const width of [375, 1280]) await scenario(browser, origin, width);
    console.log(JSON.stringify({ passed: 8, failed: 0, network: "isolated fixtures only", screenshots: shots }));
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
