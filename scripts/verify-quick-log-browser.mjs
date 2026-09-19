#!/usr/bin/env node
// Current exported app, synthetic member, loopback-only mocked APIs. No real
// server, account, database, post, upload or provider request is used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "quick-log-browser");
const review = "I remember the music, not the exact date. Fixture only.";
const failureCopy = "That didn't post. Your review is still here, give it another try.";

export function assertQuickLogPayload(body) {
  assert.equal(body.artist, "Fixture Artist");
  assert.equal(body.venue, "");
  assert.equal(body.city, "Toronto, Ontario, Canada");
  assert.ok(body.date == null || body.date === "", "An explicitly unknown date cannot become today.");
  assert.equal(body.overall, 5);
  assert.equal(body.band, null, "Overall-only rating must not invent a band score.");
  assert.equal(body.room, null, "Overall-only rating must not invent a venue score.");
  assert.equal(body.dims.experience, 5);
  for (const key of ["performance", "setlist", "sound", "venue", "crowd"]) assert.equal(body.dims[key], 0);
  assert.equal(body.review, review);
  assert.equal(body.tour, "A remembered tour");
}

async function localServer() {
  const directory = resolve(root, process.env.PIT_QUICK_LOG_BROWSER_DIST || "dist");
  const htmlPath = join(directory, "index.html");
  assert.ok(statSync(htmlPath).isFile(), "Export current web build first.");
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ttf": "font/ttf" };
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url.startsWith("/api/")) return void response.writeHead(405).end();
    let file;
    try { file = resolve(directory, `.${decodeURIComponent(new URL(request.url, "http://fixture.invalid").pathname)}`); }
    catch { return void response.writeHead(400).end(); }
    if (!file.startsWith(directory + sep)) return void response.writeHead(400).end();
    try { if (!statSync(file).isFile()) file = htmlPath; } catch { file = htmlPath; }
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(readFileSync(file));
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function scenario(browser, origin, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  const state = { writes: [], errors: [], reports: [], calls: [], closing: false, failSaves: true };
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  await page.addInitScript(user => {
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
  }, navigationUser);
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    if (message.location().url === origin + "/api/posts" && /500/.test(message.text())) return;
    state.errors.push(message.text());
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.origin !== origin) return await route.abort();
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      state.calls.push({ path: url.pathname, method: request.method() });
      if (url.pathname === "/api/client-errors") { state.reports.push(request.postDataJSON()); return await json({ ok: true }); }
      if (url.pathname === "/api/health") return await json({ ok: true, capabilities: { mediaPublishing: { photos: true, videos: true } } });
      if (url.pathname === "/api/posts" && request.method() === "POST") {
        assert.equal(request.headers()["x-pit-expected-account"], navigationUser.id);
        const body = request.postDataJSON(); assertQuickLogPayload(body); state.writes.push(body);
        if (state.failSaves) return await json({ error: "Simulated save failure", code: "INTERNAL_ERROR" }, 500);
        assert.ok(body.clientMutationId);
        assert.equal(body.clientMutationId, state.writes[0].clientMutationId, "Retry must preserve its idempotent submission ID.");
        return await json({ post: { ...body, id: "p_quick_log_fixture", user: navigationUser, userId: navigationUser.id, kind: "review", at: Date.now(), likes: 0, comments: 0 }, created: true });
      }
      return await json(fixtureApiResponse(url.pathname, { member: true, method: request.method(), resolvedPath: url.searchParams.get("path") || undefined }));
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message); await route.abort().catch(() => {});
    }
  });
  try {
    await page.goto(origin + "/feed", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Log a show", exact: true }).last().click();
    const artist = page.getByLabel("Artist", { exact: true });
    const city = page.getByLabel("Concert city, region and country", { exact: true });
    const tour = page.getByLabel("Tour or special event name", { exact: true });
    const post = page.getByRole("button", { name: "Post to feed", exact: true });
    await artist.waitFor();
    const assertVisibleDetails = async () => {
      const ratings = page.getByLabel("Rating", { exact: true });
      assert.equal(await ratings.count(), 6, "Overall, band, room and crowd ratings must all appear without an expansion tap.");
      for (const rating of await ratings.all()) assert.equal(await rating.isVisible(), true);
      assert.equal(await tour.isVisible(), true);
      assert.equal(await page.getByLabel("Public event address, optional", { exact: true }).isVisible(), true);
    };
    await assertVisibleDetails();
    await artist.fill("Fixture Artist"); await city.fill("Toronto, Ontario, Canada");
    await page.getByRole("button", { name: "I don't remember the concert date", exact: true }).click();
    await page.getByText("Date not remembered", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Online concert review", exact: true }).click();
    await page.getByRole("tab", { name: "In person concert review", exact: true }).click();
    await page.getByText("Date not remembered", { exact: true }).waitFor();
    await assertVisibleDetails();
    await page.getByLabel("Rating", { exact: true }).first().press("End");
    assert.equal(await post.isEnabled(), true, "A city-only show with an unknown date and one rating must be publishable.");
    await page.getByLabel("Rating", { exact: true }).nth(1).press("End");
    await page.getByRole("button", { name: "Leave performance unrated", exact: true }).click();
    await tour.fill("A remembered tour");
    await tour.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, `quick-log-${width}-details.png`) });
    const reviewInput = page.getByPlaceholder("What made the night? Be honest - this is what people read.", { exact: true });
    await reviewInput.fill(review);
    await page.getByText("BAND, ROOM & CROWD", { exact: false }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, `quick-log-${width}-ratings.png`) });
    await post.click();
    await page.getByText(failureCopy, { exact: true }).waitFor();
    const failedAttempts = state.writes.length;
    assert.ok(failedAttempts >= 1); assert.equal(await artist.inputValue(), "Fixture Artist");
    assert.equal(await city.inputValue(), "Toronto, Ontario, Canada"); assert.equal(await reviewInput.inputValue(), review);
    await assertVisibleDetails();
    assert.equal(await tour.inputValue(), "A remembered tour");
    await page.getByText("5.0", { exact: true }).waitFor();
    await page.getByText("Date not remembered", { exact: true }).waitFor();
    assert.equal(await post.isEnabled(), true);
    await page.getByText(failureCopy, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, `quick-log-${width}-failed-save.png`) });
    state.failSaves = false;
    await post.click();
    await artist.waitFor({ state: "hidden" });
    await page.getByText(review, { exact: true }).waitFor();
    const publishedText = await page.locator("body").innerText();
    assert.doesNotMatch(publishedText, /Band 0\.0|Room 0\.0|Night 2\.5/, "Unrated dimensions must not become zero scores or halve the remembered experience.");
    assert.match(publishedText, /5\.0/, "The published card must retain the member's overall experience score.");
    await page.getByText(review, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, `quick-log-${width}-published.png`) });
    assert.equal(state.writes.length, failedAttempts + 1);
    assert.ok(state.writes.every(body => body.clientMutationId === state.writes[0].clientMutationId));
    assert.deepEqual(state.calls.filter(call => call.method !== "GET").map(call => call.path), Array(state.writes.length).fill("/api/posts"));
    assert.equal(state.calls.some(call => call.path === "/api/artists/resolve"), false, "Typing must not trigger a remote artist lookup.");
    assert.deepEqual(state.reports, []); assert.deepEqual(state.errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    console.log(JSON.stringify({ name: `quick-log-${width}`, passed: true, simulatedPosts: state.writes.length }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `quick-log-${width}-failed.png`) }).catch(() => {});
    console.error(JSON.stringify({ error: error.message, state, body: (await page.locator("body").innerText()).slice(-7000) }));
    throw error;
  } finally { state.closing = true; await context.close(); }
}

export async function main() {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
  mkdirSync(shots, { recursive: true });
  const { server, origin } = await localServer(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    for (const width of [375, 1280]) await scenario(browser, origin, width);
    console.log(JSON.stringify({ passed: 2, failed: 0, network: "isolated fixtures only", screenshots: shots }));
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
