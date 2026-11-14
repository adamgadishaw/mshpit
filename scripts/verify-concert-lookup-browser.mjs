#!/usr/bin/env node
// Exported app + synthetic account and transports. No external request or write.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "concert-lookup-browser");
async function localServer() {
  const directory = resolve(root, process.env.PIT_CONCERT_LOOKUP_BROWSER_DIST || "dist");
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
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", timezoneId: "Pacific/Honolulu" });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const calls = [], writes = [], errors = []; let slow, rejectPost = true;
  await page.addInitScript(user => {
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
    localStorage.setItem("pit_theme", "stage");
  }, navigationUser);
  page.on("pageerror", error => errors.push(error.message));
  const match = (venue, city, date, id = venue) => ({ id, eventId: id, artist: "Fixture Artist", artistKey: "fixture-artist", venue, city, date, source: "catalog", tour: "Remembered Tour" });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/artists") return json({ artists: [{ key: "fixture-artist", name: "Fixture Artist", genre: "Rock", country: "Canada" }] });
    if (url.pathname === "/api/concerts/lookup") {
      const query = Object.fromEntries(url.searchParams); calls.push(query);
      assert.equal(request.headers()["x-pit-expected-account"], navigationUser.id);
      if (query.city === "Old City") {
        await new Promise(done => { slow = done; });
        return json({ matches: [match("Stale Room", query.city, query.date)] }).catch(() => {});
      }
      if (query.source === "ticketmaster") return json({ matches: [], status: "unavailable", complete: false });
      return json({ matches: query.city.startsWith("Toronto") && query.date === "2018-04-20"
        ? [match("First Hall", "Toronto, Ontario, Canada", query.date), match("Second Hall", "Toronto, Ontario, Canada", query.date)] : [], complete: true });
    }
    if (url.pathname === "/api/posts" && request.method() === "POST") {
      const body = request.postDataJSON(); writes.push(body);
      if (rejectPost) return json({ error: "Simulated save failure", code: "INTERNAL_ERROR" }, 500);
      return json({ post: { ...body, id: "selected-concert-review", kind: "review", user: navigationUser, userId: navigationUser.id, at: Date.now() }, created: true });
    }
    if (url.pathname === "/api/client-errors" || url.pathname === "/api/feed/impressions") return json({ ok: true });
    if (url.pathname === "/api/health") return json({ ok: true, capabilities: { mediaPublishing: { photos: true, videos: true } } });
    return json(fixtureApiResponse(url.pathname, { member: true, method: request.method(), resolvedPath: url.searchParams.get("path") || undefined }));
  });
  try {
    await page.goto(origin + "/feed", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Log a show", exact: true }).last().click();
    await page.getByLabel("Artist", { exact: true }).fill("Fix");
    await page.getByText("Fixture Artist", { exact: true }).last().click();
    await page.getByRole("button", { name: "Next: Where and when", exact: true }).click();
    const city = page.getByLabel("Concert city, region and country", { exact: true });
    const venue = page.getByLabel("Concert venue, optional with a city", { exact: true });
    await page.getByRole("button", { name: "Choose concert date", exact: true }).click();
    await page.getByRole("radio", { name: "Year 2018", exact: true }).click();
    await page.getByRole("radio", { name: "April", exact: true }).click();
    await page.getByRole("radio", { name: "Day 20", exact: true }).click();
    await page.getByRole("button", { name: "Choose concert date", exact: true }).click();
    await city.fill("Old City");
    await page.waitForFunction(() => true);
    await page.waitForTimeout(800);
    assert.ok(calls.some(call => call.city === "Old City"));
    await city.fill("Toronto");
    const chosen = page.getByRole("button", { name: /^Use concert: Fixture Artist, Second Hall/ });
    await chosen.waitFor();
    slow?.(); await page.waitForTimeout(100);
    assert.equal(await page.getByText("Stale Room", { exact: false }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /^Use concert:/ }).count(), 2);
    assert.ok(calls.every(call => call.date === "2018-04-20"), "The Honolulu viewer must send the selected event-local date unchanged");
    await chosen.click();
    assert.equal(await venue.inputValue(), "Second Hall");
    assert.equal(await city.inputValue(), "Toronto, Ontario, Canada");
    await page.getByText(/Some sources could not refresh/).waitFor();
    await page.screenshot({ path: join(shots, `concert-lookup-${width}-selected.png`) });
    await page.getByRole("button", { name: "Next: The music", exact: true }).click();
    await page.getByLabel("Overall concert rating", { exact: true }).press("End");
    await page.getByRole("button", { name: "Next: Your story", exact: true }).click();
    const review = page.getByPlaceholder("What made the night? Be honest - this is what people read.", { exact: true });
    await review.fill("My complete authored memory survives lookup and retry.");
    await page.getByRole("button", { name: "Post to feed", exact: true }).click();
    await page.getByText("That didn't post. Your review is still here, give it another try.", { exact: true }).waitFor();
    assert.equal(await review.inputValue(), "My complete authored memory survives lookup and retry.");
    assert.ok(writes.length); assert.equal(writes[0].artistKey, "fixture-artist");
    assert.equal(writes[0].venue, "Second Hall"); assert.equal(writes[0].date, "2018-04-20");
    await page.getByText(/^(Save draft & close|Save as draft)$/, { exact: true }).click();
    await review.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Log a show", exact: true }).last().click();
    await page.getByRole("button", { name: /^Resume Fixture Artist.*Second Hall/ }).click();
    await page.getByRole("button", { name: "Go to Where and when", exact: true }).click();
    assert.equal(await venue.inputValue(), "Second Hall");
    assert.equal(await city.inputValue(), "Toronto, Ontario, Canada");
    await page.getByRole("button", { name: "Go to Your story", exact: true }).click();
    assert.equal(await review.inputValue(), "My complete authored memory survives lookup and retry.");
    rejectPost = false;
    await page.getByRole("button", { name: "Post to feed", exact: true }).click();
    await review.waitFor({ state: "hidden" });
    assert.equal(writes.at(-1).clientMutationId, writes[0].clientMutationId);
    await page.getByRole("button", { name: "Log a show", exact: true }).last().click();
    await page.getByLabel("Artist", { exact: true }).fill("Fixture Artist");
    await page.getByText("Fixture Artist", { exact: true }).last().click();
    await page.getByRole("button", { name: "Next: Where and when", exact: true }).click();
    await city.fill("No Match City");
    await page.getByText(/No matching concerts found/).waitFor();
    await venue.fill("Remembered Room");
    await page.getByRole("button", { name: "Next: The music", exact: true }).click();
    await page.getByLabel("Overall concert rating", { exact: true }).press("End");
    await page.getByRole("button", { name: "Post", exact: true }).click();
    await venue.waitFor({ state: "hidden" });
    assert.equal(writes.at(-1).venue, "Remembered Room");
    assert.equal(writes.at(-1).city, "No Match City");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ name: `concert-lookup-${width}`, passed: true, checks: ["canonical artist", "local date", "two venues", "late response", "partial outage", "selected payload", "failed draft", "close/restore", "exact retry", "no-match manual post"] }));
  } finally { slow?.(); await context.close(); }
}
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
mkdirSync(shots, { recursive: true });
const { server, origin } = await localServer(); let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
  for (const width of [375, 1280]) await scenario(browser, origin, width);
  console.log(JSON.stringify({ passed: 2, failed: 0, network: "loopback fixtures only", screenshots: shots }));
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
