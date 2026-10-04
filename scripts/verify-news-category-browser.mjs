#!/usr/bin/env node
// Exact local export + synthetic responses only. Server authorization/CAS is
// separately exercised by newsCategoryCorrection.http.test.mjs.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureApiResponse } from "./verify-navigation-browser.mjs";
import { newsEditorFixture, upkeepAdmin } from "./verify-catalog-maintenance-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "news-category-browser");
const postId = "news_category-browser";
const endpoint = `/api/moderation/news-desk/editor/stories/${postId}/category`;
const originalStory = { postId, headline: "Synthetic artist announces new music", origin: "self_written", category: "charts", updatedAt: 1000,
  body: "The full reported article stays intact.", summary: "A retained summary", sources: [{ name: "Synthetic source", url: "https://example.test/article" }],
  media: [{ kind: "image", url: "https://media.example.test/retained.jpg" }], likes: 3, commentCount: 2 };

export const newsroomSettingsCases = [390, 1280].flatMap(width =>
  ["admin", "editor", "moderator", "fan"].map(role => ({ width, role })));
const bootstrapPaths = role => role === "admin" ? ["/api/admin/moderation", "/api/admin/artist-requests"]
  : role === "moderator" ? ["/api/admin/moderation"] : [];
export function assertNewsroomEntryIsolation(calls, role, accountId) {
  const staff = calls.filter(call => /^\/api\/(?:admin|moderation)(?:\/|$)/u.test(call.path));
  assert.deepEqual(staff.filter(call => call.phase === "bootstrap").map(call => `${call.method} ${call.path}`).sort(),
    bootstrapPaths(role).map(path => `GET ${path}`).sort(), "Only existing role-specific sign-in reads may precede Newsroom entry");
  const allowed = role === "admin" || role === "editor";
  assert.deepEqual(staff.filter(call => call.phase !== "bootstrap"
    && !(allowed && call.path === "/api/moderation/news-desk/editor" && call.method === "GET")), [],
  "Newsroom navigation must not read the private moderation overview or perform writes");
  for (const call of staff.filter(call => call.path === "/api/moderation/news-desk/editor")) {
    assert.equal(call.expectedAccount, accountId, "Newsroom reads must bind the active account");
  }
}

export async function verifyNewsroomMenuAccess(page, user, accountReady) {
  // Clicking Menu schedules a lazy screen; count() does not wait for that
  // screen or the cookie handshake. A missing row is only meaningful once
  // the exact authenticated account and its full Menu have rendered.
  await accountReady;
  await page.getByRole("heading", { name: "Menu", exact: true }).waitFor();
  await page.getByRole("button", { name: `View ${user.name}'s public profile`, exact: true }).waitFor();
  await page.getByRole("button", { name: "Settings. Appearance, privacy, data, and account controls", exact: true }).waitFor();
  const allowed = user.role === "admin" || user.role === "editor";
  const menuEntry = page.getByRole("button", { name: "Newsroom. Write stories and run live coverage", exact: true });
  assert.equal(await menuEntry.count(), allowed ? 1 : 0, "Preserve the existing Menu role boundary");
  if (allowed) {
    await menuEntry.scrollIntoViewIfNeeded();
    assert.equal(await menuEntry.isVisible(), true, "The existing Menu entry remains reachable at this viewport");
  }
}

async function verifySettingsEntry(page, state, user, accountReady) {
  const { role } = user;
  const allowed = role === "admin" || role === "editor";
  await verifyNewsroomMenuAccess(page, user, accountReady);
  state.phase = "newsroom-entry";
  await page.getByRole("button", { name: "Settings. Appearance, privacy, data, and account controls", exact: true }).click();
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  const settingsEntry = page.getByRole("button", { name: /^Newsroom\s+Write stories and run live coverage$/u });
  assert.equal(await settingsEntry.count(), allowed ? 1 : 0);
  const composer = page.getByTestId("self-written-news-composer");
  const openNewsroom = async () => {
    // The lazy form can mount before its overview read finishes. Account for
    // the exact response before Back or the final complete-ledger assertion.
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === "/api/moderation/news-desk/editor"
      && response.request().method() === "GET" && response.status() === 200);
    await settingsEntry.click();
    await (await loaded).finished();
    await composer.waitFor();
  };
  if (allowed) {
    await openNewsroom();
    assert.equal(await page.getByText("Overview", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Reports", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await settingsEntry.waitFor();
    assert.equal(await composer.count(), 0, "Clean Back returns to Settings");
    await openNewsroom();
    const headline = composer.getByLabel("Self-written news headline", { exact: true });
    await headline.fill("Retained Settings entry draft");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    assert.equal(await headline.inputValue(), "Retained Settings entry draft");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Leave", exact: true }).click();
    await settingsEntry.waitFor();
    await openNewsroom();
    assert.equal(await headline.inputValue(), "Retained Settings entry draft", "Draft survives dismissal and re-entry");
    await headline.fill("");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await settingsEntry.waitFor();
    assert.ok(state.calls.some(call => call.path === "/api/moderation/news-desk/editor"), "The standalone Newsroom actually loaded");
  } else {
    assert.equal(await composer.count(), 0);
  }
  await page.waitForLoadState("networkidle");
  assertNewsroomEntryIsolation(state.calls, role, user.id);
  assert.deepEqual(state.patches, []);
  assert.deepEqual(state.reports, []);
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.external, []);
}

async function serve() {
  const directory = resolve(root, process.env.PIT_NEWSROOM_BROWSER_DIST || "dist");
  const html = join(directory, "index.html");
  assert.ok(statSync(html).isFile(), "Build the current web export first");
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url.startsWith("/api/")) return void response.writeHead(405).end();
    let file;
    try { file = resolve(directory, `.${decodeURIComponent(new URL(request.url, "http://fixture.invalid").pathname)}`); }
    catch { return void response.writeHead(400).end(); }
    if (!file.startsWith(directory + sep)) return void response.writeHead(400).end();
    try { if (!statSync(file).isFile()) file = html; } catch { file = html; }
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(readFileSync(file));
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function scenario(browser, origin, width, mode) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  const settingsCase = mode.startsWith("settings-");
  const user = { ...upkeepAdmin, role: settingsCase ? mode.slice("settings-".length) : mode === "member" ? "fan" : width < 620 ? "editor" : "admin" };
  const state = { story: structuredClone(originalStory), patches: [], reads: 0, calls: [], phase: "bootstrap", reports: [], errors: [], external: [], denied: Number(mode) || 0, loseResponse: false, holdResponse: false, release: null, readFailure: false, closing: false };
  if (mode === "generated") state.story.origin = "generated";
  await context.addInitScript(({ origin, user }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
    window.__categoryHidden = false;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__categoryHidden ? "hidden" : "visible" });
  }, { origin, user });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.origin !== origin) { state.external.push(url.origin); return await route.abort(); }
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      if (settingsCase) {
        state.calls.push({ path: url.pathname, method: request.method(), phase: state.phase, expectedAccount: request.headers()["x-pit-expected-account"] });
        if (url.pathname !== "/api/client-errors") assert.equal(request.method(), "GET", "Settings navigation cannot publish or mutate");
      }
      if (url.pathname === "/api/client-errors") { state.reports.push(request.postDataJSON()); return await json({ ok: true }); }
      if (url.pathname === "/api/me") return await json({ user });
      if (url.pathname === `/api/posts/${postId}`) {
        assert.equal(request.method(), "GET");
        assert.equal(request.headers()["x-pit-expected-account"], user.id);
        state.reads += 1;
        if (state.readFailure) return await json({ error: "Synthetic read failure", code: "SERVICE_UNAVAILABLE" }, 503);
        return await json({ post: { id: postId, kind: "status", news: state.story } });
      }
      if (url.pathname === endpoint) {
        assert.equal(request.method(), "PATCH");
        assert.equal(request.headers()["x-pit-expected-account"], user.id);
        const body = request.postDataJSON();
        assert.deepEqual(Object.keys(body).sort(), ["category", "expectedCategory", "expectedUpdatedAt"]);
        state.patches.push(body);
        await new Promise(done => setTimeout(done, 250));
        if (state.denied) return await json({ error: "Synthetic authorization rejection", code: state.denied === 401 ? "AUTH_REQUIRED" : state.denied === 403 ? "FORBIDDEN" : "CONFLICT" }, state.denied);
        if (body.expectedCategory !== state.story.category || body.expectedUpdatedAt !== state.story.updatedAt) return await json({ error: "Synthetic stale category", code: "CONFLICT" }, 409);
        const changed = body.category !== state.story.category;
        if (changed) { state.story.category = body.category; state.story.updatedAt += 1; }
        if (state.holdResponse) await new Promise(done => { state.release = done; });
        if (state.loseResponse) { state.loseResponse = false; return await json({ error: "Synthetic uncertain response", code: "SERVICE_UNAVAILABLE" }, 503); }
        return await json({ postId, category: state.story.category, updatedAt: state.story.updatedAt, changed });
      }
      assert.equal(request.method(), "GET", `Unexpected mutation/provider path: ${url.pathname}`);
      if (url.pathname === "/api/moderation/news-desk/editor") {
        if (settingsCase) assert.equal(request.headers()["x-pit-expected-account"], user.id);
        return await json(newsEditorFixture());
      }
      if (url.pathname === "/api/admin/moderation") return await json({ reports: [], requests: [], recentActions: [], nextCursor: null, hasMore: false, summary: {} });
      if (url.pathname === "/api/admin/artist-requests") return await json({ requests: [] });
      return await json(fixtureApiResponse(url.pathname, { member: true, method: request.method(), resolvedPath: url.searchParams.get("path") || undefined }));
    } catch (error) {
      if (!state.closing && !/closed|disposed|handled|aborted|canceled|cancelled/iu.test(error.message)) state.errors.push(error.message);
      await route.abort().catch(() => {});
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => state.errors.push(error.message));
  try {
    const accountReady = settingsCase ? Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === "/api/me" && response.status() === 200).then(async response => {
        await response.finished();
        const body = await response.json();
        assert.equal(body.user?.id, user.id, "Confirm the exact fixture account");
        assert.equal(body.user?.role, user.role, "Confirm the fixture role before checking allowed or hidden entries");
      }),
      ...bootstrapPaths(user.role).map(path => page.waitForResponse(response => new URL(response.url()).pathname === path
        && response.status() === 200).then(response => response.finished())),
    ]) : Promise.resolve();
    await page.goto(origin + "/feed", { waitUntil: "domcontentloaded" });
    if (settingsCase) await accountReady;
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    if (settingsCase) {
      await verifySettingsEntry(page, state, user, accountReady);
      console.log(`PASS newsroom-settings ${width} ${user.role}`);
      return;
    }
    const newsroom = page.getByRole("button", { name: "Newsroom. Write stories and run live coverage", exact: true });
    if (mode === "member") {
      assert.equal(await newsroom.count(), 0);
      assert.equal(await page.getByTestId("published-news-category").count(), 0);
      assert.equal(state.patches.length, 0);
      console.log(`PASS category ${width} member hidden`);
      return;
    }
    await newsroom.click();
    const panel = page.getByTestId("published-news-category");
    await panel.getByRole("button", { name: "Correct a published category", exact: true }).click();
    await panel.getByLabel("Published story link or ID", { exact: true }).fill(`https://www.mshpit.com/post/${postId}`);
    await panel.getByRole("button", { name: "Load story", exact: true }).click();
    if (mode === "generated") {
      await panel.getByRole("alert").waitFor();
      assert.equal(await panel.getByRole("button", { name: "Save category", exact: true }).count(), 0);
      assert.equal(state.patches.length, 0);
    } else {
      const save = panel.getByRole("button", { name: "Save category", exact: true });
      const reload = panel.getByRole("button", { name: "Reload current category", exact: true });
      await save.waitFor();
      assert.equal(await panel.getByRole("radio", { name: "Charts", exact: true }).getAttribute("aria-checked"), "true");
      if (state.denied) {
        await panel.getByRole("radio", { name: "New music", exact: true }).click();
        await save.dblclick();
        await panel.getByRole("alert").waitFor();
        assert.equal(state.patches.length, 1);
        assert.equal(await save.isDisabled(), true);
        assert.deepEqual(state.story, originalStory);
      } else {
        await save.click();
        await panel.getByText("This story already has that category.", { exact: true }).waitFor();
        assert.equal(state.story.updatedAt, 1000, "same category is a server-confirmed no-op");
        await panel.getByRole("radio", { name: "New music", exact: true }).click();
        await save.dblclick();
        await panel.getByText("Category updated.", { exact: true }).waitFor();
        assert.equal(state.patches.length, 2, "duplicate clicks produce one request");
        assert.equal(state.story.category, "release");
        await panel.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(shots, `category-${width}.png`), animations: "disabled" });
        // Another editor changes the category after the displayed read.
        state.story.category = "tour"; state.story.updatedAt += 1;
        await panel.getByRole("radio", { name: "Charts", exact: true }).click();
        await save.click();
        await panel.getByRole("alert").waitFor();
        assert.equal(await save.isDisabled(), true);
        assert.equal(state.story.category, "tour", "stale choice cannot overwrite another editor");
        await reload.click();
        await panel.getByRole("radio", { name: "Tours", exact: true, checked: true }).waitFor();
        await panel.getByRole("radio", { name: "New music", exact: true }).click();
        await save.click();
        await panel.getByText("Category updated.", { exact: true }).waitFor();
        // A committed save loses its response: read before retry, then no-op.
        state.loseResponse = true;
        await panel.getByRole("radio", { name: "Awards", exact: true }).click();
        await save.click();
        await panel.getByRole("alert").waitFor();
        assert.equal(await save.isDisabled(), true);
        const committedAt = state.story.updatedAt;
        await reload.click();
        await panel.getByRole("radio", { name: "Awards", exact: true, checked: true }).waitFor();
        await save.click();
        await panel.getByText("This story already has that category.", { exact: true }).waitFor();
        assert.equal(state.story.updatedAt, committedAt);
        assert.equal(state.patches.length, 6);
        assert.equal(state.reads, 3);
        // The real visibility hook deactivates the screen while a PATCH has
        // committed but its response is withheld. Resumption must require read.
        state.holdResponse = true;
        await panel.getByRole("radio", { name: "Legal", exact: true }).click();
        await save.click();
        for (let attempts = 0; !state.release && attempts < 100; attempts += 1) await new Promise(done => setTimeout(done, 10));
        assert.ok(state.release, "the fixture withheld a committed PATCH response");
        const cancelled = page.waitForEvent("requestfailed", { predicate: request => new URL(request.url()).pathname === endpoint });
        await page.evaluate(() => { window.__categoryHidden = true; document.dispatchEvent(new Event("visibilitychange")); });
        await cancelled;
        state.release(); state.holdResponse = false;
        await page.evaluate(() => { window.__categoryHidden = false; document.dispatchEvent(new Event("visibilitychange")); });
        await panel.getByText("Reload to check what is saved, then choose the category again.", { exact: true }).waitFor();
        assert.equal(await save.isDisabled(), true);
        assert.equal(state.patches.length, 7);
        // A failed reconciliation must leave Save unavailable.
        state.readFailure = true;
        await reload.click();
        await panel.getByRole("alert").waitFor();
        assert.equal(await panel.getByRole("button", { name: "Save category", exact: true }).count(), 0);
        state.readFailure = false;
        await panel.getByRole("button", { name: "Load story", exact: true }).click();
        await panel.getByRole("radio", { name: "Legal", exact: true, checked: true }).waitFor();
        await save.click();
        await panel.getByText("This story already has that category.", { exact: true }).waitFor();
        assert.equal(state.patches.length, 8);
        const { category, updatedAt, ...untouched } = state.story;
        const { category: oldCategory, updatedAt: oldAt, ...original } = originalStory;
        assert.deepEqual(untouched, original, "only category and update time changed");
      }
    }
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.external, [], "no provider, external site or production request");
    console.log(`PASS category ${width} ${mode}`);
  } catch (error) {
    await page.screenshot({ path: join(shots, `failed-${width}-${mode}.png`), fullPage: true }).catch(() => {});
    if (settingsCase) console.error(JSON.stringify({ case: `${width} ${mode}`, phase: state.phase,
      calls: state.calls, errors: state.errors, body: (await page.locator("body").innerText().catch(() => "")).slice(0, 4000) }));
    throw new Error(`${width} ${mode}: ${error.message}; fixture errors=${state.errors.join("; ")}`, { cause: error });
  } finally { state.closing = true; state.release?.(); await context.close(); }
}

export async function main() {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
  mkdirSync(shots, { recursive: true });
  const { server, origin } = await serve();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    for (const { width, role } of newsroomSettingsCases) await scenario(browser, origin, width, `settings-${role}`);
    for (const width of [390, 1280]) for (const mode of ["success", "401", "403", "409", "generated", "member"]) await scenario(browser, origin, width, mode);
    console.log(JSON.stringify({ passed: 12 + newsroomSettingsCases.length, failed: 0, network: "isolated fixtures only", screenshots: shots }));
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
