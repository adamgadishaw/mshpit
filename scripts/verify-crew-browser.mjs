#!/usr/bin/env node
// Crew, end to end in the exported app: swipe shows, say going, look for a
// crew, crew up with someone and see the match. Synthetic member, loopback
// only, every API mocked. No real server, account or database is touched.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "crew-browser");
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const skipShow = Object.freeze({
  id: "tm_crew_fixture_skip", tourDateId: "tm_crew_fixture_skip", artist: "Skipped Fixture Band", venue: "Fixture Hall",
  place: "Toronto, Ontario", venueCity: "Toronto", date: day(12), eventImage: null, counts: { going: 0, lookingForCrew: 0 },
});
const goShow = Object.freeze({
  id: "tm_crew_fixture_go", tourDateId: "tm_crew_fixture_go", artist: "Fixture Artist", venue: "Fixture Venue",
  place: "Toronto, Ontario", venueCity: "Toronto", date: day(20), eventImage: null, counts: { going: 14, lookingForCrew: 3 },
});
const person = Object.freeze({
  id: "u_crew_fixture", name: "Riley Fixture", handle: "rileyfixture", initials: "RF", avatarUri: null, avatarColor: "#4FB3BF",
  city: "Hamilton", bio: "", favoriteArtists: [], going: true, purposes: ["ride", "meet_before"],
  note: "Driving in from Hamilton, room for two.", sharedArtists: ["Fixture Artist"], sharedShows: 2,
});
const note = "First time seeing them live";

async function localServer() {
  const directory = resolve(root, process.env.PIT_CREW_BROWSER_DIST || "dist");
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
  const state = { writes: [], errors: [], reports: [], calls: [], closing: false, seeking: false, matched: false };
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  await page.addInitScript(user => {
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
  }, navigationUser);
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") state.errors.push(message.text()); });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.origin !== origin) return await route.abort();
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      state.calls.push({ path: url.pathname, method });
      if (url.pathname === "/api/client-errors") { state.reports.push(request.postDataJSON()); return await json({ ok: true }); }
      if (method !== "GET") state.writes.push({ method, path: url.pathname, body: request.postDataJSON() });
      if (url.pathname === "/api/crew/me") return await json({
        eligible: true, ageBand: "18_plus", emailConfirmed: true,
        shows: state.seeking ? [{ tourDateId: goShow.tourDateId, artist: goShow.artist, venue: goShow.venue, city: "Toronto", date: goShow.date, purposes: ["ride"], note, others: 1 }] : [],
        matches: state.matched ? [{ person, matchedAt: Date.now(), show: { artist: goShow.artist, venue: goShow.venue, city: "Toronto", date: goShow.date, tourDateId: goShow.tourDateId } }] : [],
      });
      if (url.pathname === "/api/crew/shows" && method === "GET") return await json({ city: "Toronto", shows: [skipShow, goShow] });
      if (url.pathname === `/api/crew/shows/${skipShow.tourDateId}/pass` && method === "POST") return await json({ ok: true });
      if (url.pathname === "/api/going" && method === "POST") {
        assert.deepEqual(request.postDataJSON(), { tourDateId: goShow.tourDateId, state: "going" });
        return await json({ ok: true });
      }
      if (url.pathname === `/api/crew/shows/${goShow.tourDateId}/seeking` && method === "PUT") {
        assert.deepEqual(request.postDataJSON(), { purposes: ["ride"], note });
        state.seeking = true;
        return await json({ seeking: true, purposes: ["ride"], note, counts: { going: 15, lookingForCrew: 4 } });
      }
      if (url.pathname === `/api/crew/shows/${goShow.tourDateId}/people` && method === "GET") return await json({ people: state.matched ? [] : [person] });
      if (url.pathname === `/api/crew/shows/${goShow.tourDateId}/people/${person.id}` && method === "POST") {
        assert.deepEqual(request.postDataJSON(), { decision: "like" });
        state.matched = true;
        return await json({ matched: true, person });
      }
      return await json(fixtureApiResponse(url.pathname, { member: true, method, resolvedPath: url.searchParams.get("path") || undefined }));
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message); await route.abort().catch(() => {});
    }
  });
  try {
    await page.goto(origin + "/crew", { waitUntil: "domcontentloaded" });
    await page.getByText("Shows in Toronto", { exact: true }).waitFor();
    await page.getByText(skipShow.artist, { exact: true }).first().waitFor();
    await page.screenshot({ path: join(shots, `crew-${width}-shows.png`) });

    // Drag the first card away, the way people will actually use it: a finger
    // on phones, a mouse on desktop. Letting go must not also open the show.
    const card = page.getByRole("button", { name: new RegExp(`^${skipShow.artist} at `) });
    const box = await card.boundingBox();
    assert.ok(box, "The top show card must be on screen.");
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (width < 620) {
      const cdp = await context.newCDPSession(page);
      const touch = (type, dx) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: x + dx, y: y + Math.abs(dx) / 20 }] });
      await touch("touchStart", 0);
      for (let step = 1; step <= 12; step += 1) await touch("touchMove", -step * 25);
      await touch("touchEnd", -300);
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let step = 1; step <= 12; step += 1) await page.mouse.move(x - step * 25, y + step);
      await page.mouse.up();
    }
    await page.getByRole("button", { name: new RegExp(`^${goShow.artist} at `) }).waitFor();
    assert.equal(await page.getByText(skipShow.artist, { exact: true }).count(), 0, "A skipped show leaves the deck.");
    assert.deepEqual(state.writes.map(write => write.path), [`/api/crew/shows/${skipShow.tourDateId}/pass`]);

    await page.getByRole("button", { name: "I'm going", exact: true }).click();
    await page.getByText(`Looking for a crew for ${goShow.artist}?`, { exact: true }).waitFor();
    await page.getByRole("checkbox", { name: "Share a ride", exact: true }).click();
    await page.getByLabel("A short note for your crew", { exact: true }).fill(note);
    await page.screenshot({ path: join(shots, `crew-${width}-setup.png`) });
    await page.getByRole("button", { name: "Find my crew", exact: true }).click();

    await page.getByText(person.name, { exact: true }).first().waitFor();
    await page.getByText(`"${person.note}"`, { exact: true }).waitFor();
    await page.getByText("You both love Fixture Artist", { exact: true }).waitFor();
    await page.screenshot({ path: join(shots, `crew-${width}-people.png`) });

    await page.getByRole("button", { name: "Crew up", exact: true }).click();
    await page.getByText(`You and ${person.name} are going to ${goShow.artist} together.`, { exact: true }).waitFor();
    await page.screenshot({ path: join(shots, `crew-${width}-match.png`) });
    await page.getByRole("button", { name: "Keep swiping", exact: true }).click();
    await page.getByRole("button", { name: "All your crews", exact: true }).click();
    await page.getByRole("button", { name: "Message", exact: true }).waitFor();
    await page.getByText(`${goShow.artist} · `, { exact: false }).first().waitFor();
    await page.screenshot({ path: join(shots, `crew-${width}-crews.png`) });

    assert.deepEqual(state.writes.map(write => `${write.method} ${write.path}`), [
      `POST /api/crew/shows/${skipShow.tourDateId}/pass`,
      "POST /api/going",
      `PUT /api/crew/shows/${goShow.tourDateId}/seeking`,
      `POST /api/crew/shows/${goShow.tourDateId}/people/${person.id}`,
    ]);
    assert.deepEqual(state.reports, []); assert.deepEqual(state.errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "No sideways scrolling.");
    console.log(JSON.stringify({ name: `crew-${width}`, passed: true, writes: state.writes.length }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `crew-${width}-failed.png`) }).catch(() => {});
    console.error(JSON.stringify({ error: error.message, state, body: (await page.locator("body").innerText()).slice(-5000) }));
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
