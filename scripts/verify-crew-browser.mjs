#!/usr/bin/env node
// Show swipe and Lounge plans, end to end in the exported app. Synthetic
// members, loopback only, every API mocked. No real server, account or
// database is touched.
// This is switched off (src/domain/crewAvailability.mjs), so the suite is out
// of CI until it is switched back on. To run it now, export a build with the
// switch on and point PIT_CREW_BROWSER_DIST at it.
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
  place: "Toronto, Ontario", venueCity: "Toronto", date: day(12), eventImage: null, going: 0,
});
const goShow = Object.freeze({
  id: "tm_crew_fixture_go", tourDateId: "tm_crew_fixture_go", artist: "Fixture Artist", venue: "Fixture Venue",
  place: "Toronto, Ontario", venueCity: "Toronto", date: day(20), eventImage: null, going: 14,
});
const loungeKey = `fixture artist|fixture venue|${goShow.date}`;
const riley = Object.freeze({ id: "u_plan_host", name: "Riley Fixture", handle: "rileyfixture", initials: "RF", avatarUri: null, avatarColor: "#4FB3BF" });
const me = Object.freeze({ id: navigationUser.id, name: navigationUser.name, handle: navigationUser.handle, initials: navigationUser.initials, avatarUri: null });
const teen = Object.freeze({ ...navigationUser, id: "u_teen_fixture", name: "Teen Fixture", handle: "teenfixture", ageBand: "13_17" });

async function localServer() {
  const directory = resolve(root, process.env.PIT_CREW_BROWSER_DIST || "dist");
  const htmlPath = join(directory, "index.html");
  assert.ok(statSync(htmlPath).isFile(), "Export a web build first.");
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

function planView(plan, viewerId) {
  const members = plan.members.filter((id) => id !== viewerId);
  const inside = plan.host.id === viewerId || plan.members.includes(viewerId);
  return {
    id: plan.id, kind: plan.kind, kindLabel: plan.kindLabel, text: plan.text, spots: plan.spots,
    joinedCount: plan.members.length, full: plan.members.length >= plan.spots,
    isHost: plan.host.id === viewerId, joined: plan.members.includes(viewerId), host: plan.host,
    members: inside ? members.map((id) => (id === me.id ? me : riley)) : [],
    show: { artist: goShow.artist, venue: goShow.venue, date: goShow.date, loungeKey }, createdAt: 1,
  };
}

async function scenario(browser, origin, width, user) {
  const adult = user.ageBand === "18_plus";
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  const state = { writes: [], errors: [], reports: [], closing: false, messages: [],
    plans: [{ id: "plan_riley", kind: "ride", kindLabel: "Share a ride", text: "Carpool from Hamilton, leaving at 5", spots: 3, host: riley, members: [] }] };
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  await page.addInitScript(account => {
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(account));
    localStorage.setItem("pit.users", JSON.stringify([account]));
  }, user);
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") state.errors.push(message.text()); });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const path = url.pathname;
    try {
      if (url.origin !== origin) return await route.abort();
      if (!path.startsWith("/api/")) return await route.continue();
      if (path === "/api/client-errors") { state.reports.push(request.postDataJSON()); return await json({ ok: true }); }
      if (method !== "GET") state.writes.push(`${method} ${path}`);
      const plansBody = () => ({ plans: state.plans.map((plan) => planView(plan, user.id)) });
      assert.ok(adult || !/\/plans/u.test(path), `A member under 18 must never call ${path}`);
      if (path === "/api/me") return await json({ user });
      if (path === "/api/crew/shows" && method === "GET") return await json({ city: "Toronto", shows: [skipShow, goShow] });
      if (path === `/api/crew/shows/${skipShow.tourDateId}/pass`) return await json({ ok: true });
      if (path === "/api/going" && method === "POST") return await json({ going: true, ok: true });
      if (path === "/api/me/plans") return await json({ plans: state.plans.filter((plan) => plan.host.id === user.id || plan.members.includes(user.id)).map((plan) => planView(plan, user.id)) });
      if (path === `/api/lounges/${encodeURIComponent(loungeKey)}/meta`) return await json({ attendeeCount: 15, messageCount: 0, status: "open", timingKnown: true, cutoffAt: Date.now() + 30 * 86_400_000, cutoffSource: "show_start", fanClubArtist: null });
      if (path === `/api/lounges/${encodeURIComponent(loungeKey)}/messages`) return await json({ messages: [], nextCursor: null, syncCursor: null, hasMore: false, removedIds: [] });
      if (path === `/api/lounges/${encodeURIComponent(loungeKey)}/plans` && method === "GET") return await json(plansBody());
      if (path === `/api/lounges/${encodeURIComponent(loungeKey)}/plans` && method === "POST") {
        const body = request.postDataJSON();
        assert.deepEqual(body, { kind: "meet_before", text: "Drinks next door before doors", spots: 4 });
        state.plans.unshift({ id: "plan_mine", kind: body.kind, kindLabel: "Meet before doors", text: body.text, spots: body.spots, host: me, members: [] });
        return await json(plansBody());
      }
      if (path === "/api/plans/plan_riley/join") { state.plans.find((plan) => plan.id === "plan_riley").members.push(user.id); return await json(plansBody()); }
      if (path === "/api/plans/plan_riley/messages" && method === "GET") return await json({ messages: state.messages, closed: false });
      if (path === "/api/plans/plan_riley/messages" && method === "POST") {
        const body = request.postDataJSON();
        state.messages.push({ id: `pm_${state.messages.length}`, userId: user.id, name: user.name, initials: "NF", text: body.text, createdAt: Date.now() });
        return await json({ id: "pm", createdAt: Date.now() });
      }
      if (path.startsWith("/api/going/") && path.endsWith("/attendees")) return await json({ attendees: [], total: 0, scope: "everyone" });
      return await json(fixtureApiResponse(path, { member: true, method, resolvedPath: url.searchParams.get("path") || undefined }));
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message); await route.abort().catch(() => {});
    }
  });
  const name = `crew-${adult ? "adult" : "teen"}-${width}`;
  try {
    await page.goto(origin + "/crew", { waitUntil: "domcontentloaded" });
    await page.getByText("Shows in Toronto", { exact: true }).waitFor();
    assert.equal(await page.getByRole("tab", { name: "Your plans", exact: true }).count(), adult ? 1 : 0, "Your plans is for adults only");
    await page.screenshot({ path: join(shots, `${name}-shows.png`) });

    // Drag the first card away: a finger on phones, a mouse on desktop.
    const card = page.getByRole("button", { name: new RegExp(`^${skipShow.artist} at `) });
    const box = await card.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (width < 620) {
      const cdp = await context.newCDPSession(page);
      const touch = (type, dx) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: x + dx, y: y + Math.abs(dx) / 20 }] });
      await touch("touchStart", 0);
      for (let step = 1; step <= 12; step += 1) await touch("touchMove", -step * 25);
      await touch("touchEnd", -300);
    } else {
      await page.mouse.move(x, y); await page.mouse.down();
      for (let step = 1; step <= 12; step += 1) await page.mouse.move(x - step * 25, y + step);
      await page.mouse.up();
    }
    await page.getByRole("button", { name: new RegExp(`^${goShow.artist} at `) }).waitFor();
    assert.equal(await page.getByText(skipShow.artist, { exact: true }).count(), 0, "A skipped show leaves the deck and letting go does not open it.");

    await page.getByRole("button", { name: "I'm going", exact: true }).click();
    await page.getByText(`You're going to ${goShow.artist}.`, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Open the Lounge", exact: true }).click();
    await page.getByRole("button", { name: /enter this show's Lounge/u }).click();
    await page.getByPlaceholder("Message the lounge…").waitFor();

    if (!adult) {
      await page.waitForTimeout(300);
      assert.equal(await page.getByText("Plans", { exact: false }).count(), 0, "No plans anywhere for a member under 18.");
      await page.screenshot({ path: join(shots, `${name}-lounge.png`) });
    } else {
      await page.getByRole("button", { name: "Plans for this show, 1 open", exact: true }).click();
      await page.getByText("Carpool from Hamilton, leaving at 5", { exact: true }).waitFor();
      await page.screenshot({ path: join(shots, `${name}-plans.png`) });
      await page.getByRole("button", { name: "I'm in", exact: true }).click();
      await page.getByText("WHO'S IN", { exact: true }).waitFor();
      await page.getByText("Riley Fixture · host", { exact: true }).waitFor();
      await page.getByText("You", { exact: true }).waitFor();
      await page.getByLabel("Message the plan", { exact: true }).fill("Count me in");
      await page.getByRole("button", { name: "Send to the plan", exact: true }).click();
      await page.getByText("Count me in", { exact: true }).waitFor();
      await page.screenshot({ path: join(shots, `${name}-plan-detail.png`) });

      await page.getByRole("button", { name: "All plans", exact: true }).click();
      await page.getByRole("button", { name: "Start a plan", exact: true }).click();
      await page.getByRole("radio", { name: "Meet before doors", exact: true }).click();
      await page.getByLabel("What's the plan?", { exact: true }).fill("Drinks next door before doors");
      await page.getByRole("button", { name: "More spots", exact: true }).click();
      await page.screenshot({ path: join(shots, `${name}-start-plan.png`) });
      await page.getByRole("button", { name: "Post plan", exact: true }).click();
      await page.getByText("You're hosting", { exact: true }).waitFor();
      await page.screenshot({ path: join(shots, `${name}-plans-after.png`) });
    }

    const expected = [
      `POST /api/crew/shows/${skipShow.tourDateId}/pass`, "POST /api/going", "POST /api/going",
      ...(adult ? ["POST /api/plans/plan_riley/join", "POST /api/plans/plan_riley/messages", `POST /api/lounges/${encodeURIComponent(loungeKey)}/plans`] : []),
    ];
    assert.deepEqual(state.writes.filter((write) => !write.startsWith("POST /api/analytics")), expected);
    assert.deepEqual(state.reports, []); assert.deepEqual(state.errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "No sideways scrolling.");
    console.log(JSON.stringify({ name, passed: true }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `${name}-failed.png`) }).catch(() => {});
    console.error(JSON.stringify({ error: error.message, state: { ...state, plans: undefined }, body: (await page.locator("body").innerText()).slice(-4000) }));
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
    for (const width of [375, 1280]) await scenario(browser, origin, width, navigationUser);
    await scenario(browser, origin, 375, teen);
    console.log(JSON.stringify({ passed: 3, failed: 0, network: "isolated fixtures only", screenshots: shots }));
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
