#!/usr/bin/env node
// Real exported UI, synthetic fixture APIs only. No account or external writes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const timeout = 15000;
const person = (id, name, verified = false) => ({ id, name, handle: id, role: "fan", verified, profileAudience: "everyone" });
const people = [person("alice", "Alice Listener", true), person("blake", "Blake Listener"), person("casey", "Casey Listener")];
async function serverForBuild() {
  const directory = resolve(root, process.env.PIT_NAVIGATION_BROWSER_DIST || "dist");
  const html = join(directory, "index.html"); assert.ok(statSync(html).isFile());
  const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    if (!["GET", "HEAD"].includes(request.method) || url.pathname.startsWith("/api/")) return void response.writeHead(405).end();
    let file; try { file = resolve(directory, "." + decodeURIComponent(url.pathname)); } catch { return void response.writeHead(400).end(); }
    if (file !== directory && !file.startsWith(directory + sep)) return void response.writeHead(400).end();
    try { if (!statSync(file).isFile()) file = html; } catch { file = html; }
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : readFileSync(file));
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  return { server, origin: "http://127.0.0.1:" + server.address().port };
}
async function scenario(browser, origin, width, member) {
  const context = await browser.newContext({ viewport: { width, height: 1100 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block", reducedMotion: "reduce" });
  const state = { favorites: [], writes: [], requests: [], errors: [], external: [], expectedFailure: 0, retries: 0, closing: false };
  const user = () => ({ ...navigationUser, favoriteArtists: state.favorites, artistFollowingCount: state.favorites.length, profileUpdatedAt: 1000 + state.writes.length });
  await context.addInitScript(({ origin, user }) => {
    if (location.origin !== origin || localStorage.getItem("connections-fixture")) return;
    localStorage.setItem("connections-fixture", "1"); localStorage.setItem("pit_theme", "stage");
    if (user) { localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user])); }
  }, { origin, user: member ? user() : null });
  const page = await context.newPage(); page.setDefaultTimeout(timeout);
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !/Failed to load resource.*503/.test(message.text())) state.errors.push(message.text()); });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    try {
      if (url.origin !== origin) { state.external.push(url.origin); return await route.abort(); }
      if (!path.startsWith("/api/")) return await route.continue();
      state.requests.push({ path, method, q: url.searchParams.get("q"), filter: url.searchParams.get("filter"), cursor: url.searchParams.get("cursor") });
      let result;
      if (method === "POST" && path === "/api/client-errors") result = { ok: true };
      else if (method === "POST" && path === "/api/feed/news-introduction") { assert.ok(member); result = { post: null }; }
      else if (method === "POST" && path === "/api/feed/revalidate") { assert.ok(member); result = { invalidPostIds: [] }; }
      else if (method === "POST" && path === "/api/feed/impressions") { assert.ok(member); result = { ok: true }; }
      else if (method === "POST" && ["/api/artists/fixture-artist/follow", "/api/artists/fixture%20artist/follow"].includes(path)) {
        assert.ok(member); assert.equal(request.headers()["x-pit-expected-account"], navigationUser.id);
        const following = request.postDataJSON().following; assert.equal(typeof following, "boolean");
        state.writes.push({ path, following }); state.favorites = following ? ["Fixture Artist"] : [];
        result = { following, favoriteArtists: state.favorites, profileUpdatedAt: user().profileUpdatedAt };
      } else {
        assert.equal(method, "GET", "Only exact fixture mutations are permitted: " + method + " " + path);
        if (path === "/api/me") result = { user: member ? user() : null };
        else if (path === "/api/artists/reviews") result = { reviews: [] };
        else if (path === "/api/artists/seen") { assert.ok(member); result = { count: 0, last: null }; }
        else if (path === "/api/me/following") { assert.ok(member); result = { following: ["alice", "blake", "casey"] }; }
        else if (path === "/api/resolve" && url.searchParams.get("path") === "/u/navigationfixture") result = { entity: { kind: "profile", id: navigationUser.id, handle: navigationUser.handle, path: "/u/navigationfixture" } };
        else if (path === "/api/users/" + navigationUser.id) result = { user: user(), followers: 3, following: 3, isFollowing: false };
        else if (path === "/api/users/" + navigationUser.id + "/artist-following") result = { artists: state.favorites.map(name => ({ id: "fixture artist", key: "fixture artist", name })), nextCursor: null };
        else if (["/api/users/" + navigationUser.id + "/following", "/api/users/" + navigationUser.id + "/followers"].includes(path)) {
          const q = url.searchParams.get("q") || "", filter = url.searchParams.get("filter") || "all", cursor = url.searchParams.get("cursor");
          if (q === "retry" && state.retries++ === 0) {
            state.expectedFailure++; return await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture retry", code: "SERVICE_UNAVAILABLE" }) });
          }
          const matches = q === "retry" ? [people[0]] : people.filter(row => (!q || row.name.toLowerCase().includes(q.toLowerCase())) && (filter !== "verified" || row.verified));
          result = { users: cursor ? matches.slice(2) : matches.slice(0, 2), nextCursor: !cursor && matches.length > 2 ? "fixture-next" : null };
        } else result = fixtureApiResponse(path, { member, method, resolvedPath: url.searchParams.get("path") || undefined });
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
    } catch (error) {
      if (state.closing && /closed|disposed|handled|aborted|canceled|cancelled/i.test(error.message)) return;
      state.errors.push(error.message); await route.abort().catch(() => { /* Fixture teardown may already have closed the route. */ });
    }
  });
  let failure;
  try {
    await page.goto(origin + "/artist/fixture-artist", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Follow Fixture Artist", exact: true }).waitFor();
    if (member) {
      await page.getByRole("button", { name: "Follow Fixture Artist", exact: true }).click();
      await page.getByRole("button", { name: "Unfollow Fixture Artist", exact: true }).waitFor();
      assert.equal(state.writes.length, 1);
      assert.deepEqual(state.favorites, ["Fixture Artist"]);
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Unfollow Fixture Artist", exact: true }).waitFor();
      assert.equal(state.writes.length, 1, "Reload reads persisted follows without another write.");
    }
    await page.goto(origin + "/u/navigationfixture", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "3 People following", exact: true }).waitFor();
    await page.getByRole("button", { name: (member ? "1" : "0") + " Artists followed", exact: true }).waitFor();
    if (member) {
      await page.getByRole("button", { name: "1 Artists followed", exact: true }).click();
      await page.getByRole("button", { name: "Open Fixture Artist", exact: true }).waitFor();
      await page.getByLabel("Search followed artists", { exact: true }).fill("Fixture");
      await page.getByRole("button", { name: "Open Fixture Artist", exact: true }).waitFor();
      await page.getByRole("tab", { name: "People following", exact: true }).click();
    } else await page.getByRole("button", { name: "3 People following", exact: true }).click();
    await page.getByRole("button", { name: "Open Alice Listener", exact: true }).waitFor();
    await page.getByRole("button", { name: "Show more", exact: true }).click();
    await page.getByRole("button", { name: "Open Casey Listener", exact: true }).waitFor();
    assert.ok(state.requests.some(call => call.cursor === "fixture-next"));
    const search = page.getByLabel("Search connections", { exact: true });
    await search.fill("Casey");
    await page.getByRole("button", { name: "Open Casey Listener", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Open Alice Listener", exact: true }).count(), 0, "Stale search rows disappear synchronously.");
    await search.fill(""); await page.getByRole("button", { name: "Verified", exact: true }).click();
    await page.getByRole("button", { name: "Open Alice Listener", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Open Blake Listener", exact: true }).count(), 0);
    await page.getByRole("button", { name: "All", exact: true }).click(); await search.fill("retry");
    await page.getByText("This list could not load. Try again.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByRole("button", { name: "Open Alice Listener", exact: true }).waitFor();
    assert.equal(state.expectedFailure, 1); assert.ok(state.retries >= 2);
    if (!member) {
      await page.getByRole("button", { name: "Follow Alice Listener", exact: true }).click();
      await page.getByRole("heading", { name: "Good to see you.", exact: true }).waitFor();
      assert.equal(state.writes.length, 0, "Guest reads never become follow mutations.");
    }
    assert.deepEqual(state.errors, []); assert.deepEqual(state.external, []);
  } catch (error) { failure = { message: error.message, errors: state.errors, external: state.external, requests: state.requests.slice(-18) }; }
  finally { state.closing = true; await context.close(); }
  if (failure) throw new Error(JSON.stringify({ width, member, ...failure }, null, 2));
  return { width, member, followWrites: state.writes.length, retryRecovered: state.expectedFailure === 1 };
}
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
const { server, origin } = await serverForBuild();
const browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
try {
  for (const width of [390, 1280]) for (const member of [true, false]) console.log(JSON.stringify(await scenario(browser, origin, width, member)));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
