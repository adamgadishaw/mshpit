#!/usr/bin/env node
// Real exported UI and isolated browser contexts. Every API response is a
// synthetic fixture; outbound requests are blocked before reaching the wire.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const timeout = 15_000;
const feedPaths = ["/api/feed", "/api/feed/recommended", "/api/feed/for-you"];
const reader = { ...navigationUser, favoriteArtists: ["Fixture Artist"] };
const author = { id: "news-fixture-author", name: "Fixture News Desk", handle: "fixturenews", role: "fan", initials: "FN", avatarUri: null };
const latestTitle = "Fixture Artist announces the North tour";
const earlierTitle = "Fixture Artist announces the South residency";
const now = Date.now();
function story(id, headline, age) {
  return { id, postId: `news_${id}`, headline, summary: "Independent fixture publishers report the announcement.",
    body: "This complete synthetic news article is used only in the isolated browser test.\n\nThe fixture publishers report the same announcement.",
    category: "tour", artists: [{ key: "fixture-artist", name: "Fixture Artist", publicSlug: "fixture-artist", photo: null }],
    sources: [{ name: "Fixture Press One", url: "https://press-one.fixture.invalid/article" }, { name: "Fixture Press Two", url: "https://press-two.fixture.invalid/article" }, { name: "Fixture Press Three", url: "https://press-three.fixture.invalid/article" }],
    author, likes: 0, likedByMe: false, commentCount: 0, viewCount: 1, confirmedBy: 3, publishedAt: now - age, updatedAt: now - age };
}
const latest = story("browser-latest", latestTitle, 60_000);
const earlier = story("browser-earlier", earlierTitle, 3_600_000);
const toPost = (news) => ({ id: news.postId, userId: author.id, user: author, kind: "status", artist: "Fixture Artist", artistKey: "fixture-artist",
  venue: "", city: "Toronto", date: "", at: news.publishedAt, createdAt: news.publishedAt, review: news.summary, text: news.summary,
  likes: news.likes, likedByMe: news.likedByMe, comments: 0, photos: [], news });
const stories = [latest, earlier];
const newsByPost = new Map(stories.map(item => [item.postId, item]));
const deepLink = `/post/${latest.postId}`;
export const newsBrowserCases = [390, 1280].flatMap(width => [
  { name: `news-feed-${width}`, width, kind: "feed" },
  { name: `news-hidden-deep-link-${width}`, width, kind: "deep-link" },
  { name: `news-region-${width}`, width, kind: "region" },
]);
const REGION_OPTIONS = [{ id: "us-canada", label: "US and Canada" }, { id: "uk-ireland", label: "UK and Ireland" }, { id: "europe", label: "Europe" }];
const regionView = (choice) => ({ choice, region: choice === "everywhere" ? null : choice === "auto" ? "us-canada" : choice,
  label: choice === "everywhere" ? "Everywhere" : REGION_OPTIONS.find((option) => option.id === (choice === "auto" ? "us-canada" : choice))?.label,
  city: "Toronto", home: "us-canada", homeLabel: "US and Canada", options: REGION_OPTIONS });

async function localServer() {
  const directory = resolve(root, process.env.PIT_NEWS_BROWSER_DIST || process.env.PIT_NAVIGATION_BROWSER_DIST || "dist");
  const htmlPath = join(directory, "index.html");
  assert.ok(statSync(htmlPath).isFile(), "Export the current web build before verifying news.");
  const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    if (!["GET", "HEAD"].includes(request.method) || url.pathname.startsWith("/api/")) return void response.writeHead(405).end();
    let file;
    try { file = resolve(directory, `.${decodeURIComponent(url.pathname)}`); } catch { return void response.writeHead(400).end(); }
    if (file !== directory && !file.startsWith(directory + sep)) return void response.writeHead(400).end();
    try { if (!statSync(file).isFile()) file = htmlPath; } catch { file = htmlPath; }
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : readFileSync(file));
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function until(check, message) {
  const deadline = Date.now() + timeout;
  while (!(await check())) { assert.ok(Date.now() < deadline, message); await new Promise(done => setTimeout(done, 25)); }
}

async function order(page, first, second) {
  await page.getByText(first, { exact: true }).first().waitFor();
  await page.getByText(second, { exact: true }).first().waitFor();
  const firstBox = await page.getByText(first, { exact: true }).first().boundingBox();
  const secondBox = await page.getByText(second, { exact: true }).first().boundingBox();
  assert.ok(firstBox && secondBox && firstBox.y < secondBox.y, `${first} must precede ${second} in the real rendered feed.`);
}

async function pullToRefresh(page, context) {
  const owner = page.locator('[data-pit-refresh-scroll-owner="true"]').first();
  await owner.evaluate(element => { element.scrollTop = 0; });
  const box = await owner.boundingBox();
  assert.ok(box, "The visible feed must expose its real refresh scroll owner.");
  const x = Math.round(box.x + box.width / 2), startY = Math.round(Math.max(120, box.y + 65));
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
    for (const distance of [15, 40, 80, 120, 165]) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: startY + distance }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await cdp.detach(); }
}

async function scenario(browser, origin, item) {
  const context = await browser.newContext({ viewport: { width: item.width, height: 1100 }, screen: { width: item.width, height: 1100 },
    isMobile: item.width < 620, hasTouch: item.width < 620, reducedMotion: "reduce", serviceWorkers: "block" });
  const state = { calls: [], errors: [], diagnostics: [], external: [], introductions: 0, receipts: new Map(), liked: false, closing: false,
    regionChoice: "auto", regionWrites: [] };
  await context.addInitScript(({ user, origin }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
  }, { user: reader, origin });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout); page.setDefaultNavigationTimeout(timeout);
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") state.errors.push(`${message.text()} (${message.location().url})`); });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    try {
      if (url.origin !== origin) { state.external.push(url.origin); return await route.abort(); }
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      const method = request.method(), path = url.pathname;
      state.calls.push({ path, method });
      if (path === "/api/share-cards/render") {
        assert.equal(method, "POST");
        assert.equal(request.headers()["x-pit-expected-account"], reader.id);
        assert.equal(request.postDataJSON()?.postId, latest.postId);
        return await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64") });
      }
      let result;
      if (path === "/api/client-errors") { state.diagnostics.push(request.postDataJSON()); result = { ok: true }; }
      else if (path === "/api/me") result = { user: reader };
      else if (path === "/api/me/following") result = { following: [author.id] };
      else if (path === "/api/me/fanclubs") result = { artists: [] };
      else if (path === "/api/news-desk/stories") result = { stories: stories.map(news => news.id === latest.id ? { ...news, likes: state.liked ? 1 : 0, likedByMe: state.liked,
        // The server marks a story naming the reader's city while their news follows their region.
        ...(item.kind === "region" && state.regionChoice === "auto" ? { localTo: "Toronto" } : {}) } : news), nextCursor: null };
      else if (path === "/api/me/news-region" && method === "GET") result = { newsRegion: regionView(state.regionChoice) };
      else if (path === "/api/me/news-region" && method === "PUT") {
        assert.equal(request.headers()["x-pit-expected-account"], reader.id);
        state.regionChoice = request.postDataJSON()?.choice;
        state.regionWrites.push(state.regionChoice);
        result = { newsRegion: regionView(state.regionChoice) };
      }
      else if (path === "/api/news-desk/live") result = { events: [liveEvent()] };
      else if (path === "/api/news-desk/live/2026-mtv-vmas") result = { event: liveEvent() };
      else if (path === "/api/feed/news-introduction") {
        assert.equal(method, "POST");
        assert.equal(request.headers()["x-pit-expected-account"], reader.id);
        const command = request.postDataJSON()?.requestId;
        assert.match(command || "", /^[A-Za-z0-9_-]{8,100}$/u);
        if (!state.receipts.has(command)) {
          // The earlier story was already viewed. Only the latest qualifies
          // for one introduction, mirroring the server's durable receipt.
          state.receipts.set(command, state.introductions ? null : toPost(latest));
          if (!state.introductions) state.introductions += 1;
        }
        result = { post: state.receipts.get(command) };
      } else if (feedPaths.includes(path)) {
        assert.equal(method, "GET");
        result = { posts: [toPost(earlier), toPost(latest)], nextCursor: null, hasMore: false,
          algorithm: { id: "fixture", version: 1, personalized: true }, hiddenPostIds: [] };
      } else if (path === "/api/feed/impressions") { assert.equal(method, "POST"); result = { ok: true }; }
      else if (path === "/api/feed/revalidate") result = { invalidPostIds: [] };
      else if (path === "/api/resolve" && url.searchParams.get("path") === deepLink) result = { entity: { kind: "show", id: latest.postId, path: deepLink } };
      else if (path.startsWith("/api/posts/") && path.endsWith("/comments")) result = { comments: [] };
      else if (path === `/api/posts/${latest.postId}/like`) {
        assert.equal(method, "POST"); state.liked = request.postDataJSON()?.liked === true; result = { ok: true, liked: state.liked };
      } else if (path.startsWith("/api/posts/") && newsByPost.has(path.slice("/api/posts/".length))) result = { post: toPost(newsByPost.get(path.slice("/api/posts/".length))) };
      else if (path === `/api/users/${author.id}`) result = { user: author, followers: 1, following: 0, isFollowing: true };
      else if (path === `/api/users/${author.id}/posts`) result = { posts: stories.map(toPost), nextCursor: null, hasMore: false };
      else if (path === `/api/users/${author.id}/rewards`) result = { points: 0, earnedIds: [] };
      else if (path === `/api/users/${author.id}/playlists`) result = { playlists: [] };
      else if (path === `/api/users/${author.id}/concert-history`) result = { concerts: [], nextCursor: null, hasMore: false, complete: true, mapVisible: false };
      else result = fixtureApiResponse(path, { member: true, method, resolvedPath: url.searchParams.get("path") || undefined });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
    } catch (error) {
      if (state.closing && /closed|disposed|handled|aborted|canceled|cancelled/iu.test(error.message)) return;
      state.errors.push(error.message); await route.abort().catch(() => {});
    }
  });
  let failure = null;
  try {
    await page.goto(origin + (item.kind === "deep-link" ? deepLink : item.kind === "region" ? "/news" : "/feed"), { waitUntil: "networkidle" });
    if (item.kind === "region") {
      // Where the news comes from: the member's home city picks the region.
      await page.getByText("News for US and Canada", { exact: true }).waitFor();
      await page.getByText("Picked from your city, Toronto.", { exact: true }).waitFor();
      await page.getByText("In Toronto", { exact: true }).first().waitFor();
      await page.getByRole("button", { name: "Change where your news comes from", exact: true }).click();
      mkdirSync(join(root, ".tmp", "news-browser"), { recursive: true });
      await page.screenshot({ path: join(root, ".tmp", "news-browser", `news-region-${item.width}.png`) });
      const reads = state.calls.filter(call => call.path === "/api/news-desk/stories").length;
      await page.getByRole("radio", { name: "Everywhere", exact: true }).click();
      await page.getByText("News from everywhere", { exact: true }).waitFor();
      assert.deepEqual(state.regionWrites, ["everywhere"]);
      await until(() => state.calls.filter(call => call.path === "/api/news-desk/stories").length > reads, "Changing the region did not reload the stories.");
      await until(async () => await page.getByText("In Toronto", { exact: true }).count() === 0, "The local marker follows the new region.");
      assert.equal(await page.getByRole("radio", { name: "Everywhere", exact: true }).count(), 0, "the picker closes after a choice");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    } else if (item.kind === "deep-link") {
      await page.getByText(latestTitle, { exact: true }).last().waitFor();
      assert.equal(state.calls.filter(call => call.path === "/api/feed/news-introduction").length, 0,
        "A For You screen mounted underneath a deep-link overlay must not consume an introduction.");
    } else {
      await until(() => state.introductions === 1, "Visible For You did not introduce its eligible headline.");
      await order(page, latestTitle, earlierTitle);
      assert.equal(await page.getByText(latestTitle, { exact: true }).count(), 1, "Introduction and ranked feed must deduplicate the headline.");
      if (item.width < 620) {
        const reads = state.calls.filter(call => feedPaths.includes(call.path)).length;
        const commands = state.calls.filter(call => call.path === "/api/feed/news-introduction").length;
        await pullToRefresh(page, context);
        await until(() => state.calls.filter(call => feedPaths.includes(call.path)).length > reads, "Touch refresh did not refresh the feed.");
        await order(page, earlierTitle, latestTitle);
        assert.equal(state.calls.filter(call => call.path === "/api/feed/news-introduction").length, commands, "Refresh must dismiss placement without allocating another introduction.");
      }
      await page.reload({ waitUntil: "networkidle" });
      await order(page, earlierTitle, latestTitle);
      assert.equal(state.introductions, 1, "Reload cannot introduce the same story twice.");
      await page.getByRole("tab", { name: "Following feed", exact: true }).click();
      assert.equal(await page.getByText(latestTitle, { exact: true }).count(), 0, "Following the author is not consent to put news in Following.");
      assert.equal(await page.getByText(earlierTitle, { exact: true }).count(), 0);
      await page.getByRole("tab", { name: "News feed", exact: true }).click();
      await page.getByText("2026 MTV VMAs", { exact: true }).first().waitFor();
      await page.getByText("Sabrina Carpenter wins Video of the Year", { exact: true }).first().waitFor();
      await page.getByText(/Live now · 2 updates · latest 2 min ago/u).first().waitFor();
      await page.getByText("WINNERS · 1 OF 2 CATEGORIES ANNOUNCED", { exact: true }).first().waitFor();
      assert.equal(await page.getByRole("button", { name: "Open full coverage of 2026 MTV VMAs", exact: true }).first().isVisible(), true,
        "The card links to the full winners list.");
      assert.equal(await page.getByRole("link", { name: "2026 MTV VMAs Winners List (Updating Live), Billboard", exact: true }).first().isVisible(), true,
        "Outlet headlines in live coverage link to the outlet.");
      mkdirSync(join(root, ".tmp", "news-browser"), { recursive: true });
      await page.screenshot({ path: join(root, ".tmp", "news-browser", `news-live-${item.width}.png`) });
      const fullCard = page.getByRole("article").filter({ has: page.getByText(latestTitle, { exact: true }) }).last();
      await fullCard.waitFor();
      await fullCard.getByRole("button", { name: "0 likes", exact: true }).click();
      await until(() => state.liked, "The news Like control did not use the normal post mutation.");
      await fullCard.getByRole("button", { name: "1 like", exact: true }).waitFor();
      assert.equal(await fullCard.getByRole("button", { name: "Report", exact: true }).isVisible(), true);
      assert.equal(await fullCard.getByRole("link", { name: `Open ${author.name} profile`, exact: true }).isVisible(), true);
      // The share dialog is loaded on demand; the full controls must still work
      // on the first open and reopen without replacing or navigating the feed.
      for (let open = 0; open < 2; open += 1) {
        await fullCard.getByRole("button", { name: "Share this story", exact: true }).click();
        await page.getByText("Share this story", { exact: true }).waitFor();
        const download = page.getByRole("button", { name: "Download card", exact: true });
        await download.waitFor();
        await until(async () => !await download.isDisabled(), "The deferred share editor did not prepare its image.");
        assert.equal(await page.getByRole("button", { name: "Copy link", exact: true }).isVisible(), true);
        await page.getByRole("button", { name: "Close share preview", exact: true }).last().click();
        await download.waitFor({ state: "hidden" });
        assert.equal(new URL(page.url()).pathname, "/feed");
      }
      await fullCard.getByRole("button", { name: `${latestTitle}. Read the full story and comments.`, exact: true }).click();
      await page.waitForURL(url => url.pathname === deepLink);
      await page.getByText("This complete synthetic news article is used only in the isolated browser test.", { exact: true }).waitFor();
      // The event page: category, winner and nominees for every award.
      await page.goto(origin + "/news/live/2026-mtv-vmas", { waitUntil: "networkidle" });
      const winners = page.getByLabel("Winners", { exact: true });
      await winners.getByText("Video of the Year", { exact: true }).waitFor();
      await winners.getByText("To be announced", { exact: true }).waitFor();
      assert.ok(await winners.getByText("Sabrina Carpenter - Manchild", { exact: true }).count() >= 2, "the winner shows as winner and among the nominees");
      assert.equal(new URL(page.url()).pathname, "/news/live/2026-mtv-vmas", "the page keeps its own address");
    }
    assert.deepEqual(state.errors, [], "Browser/API fixture errors must not be ignored.");
    assert.deepEqual(state.diagnostics, [], "No client-error report may be emitted.");
    assert.deepEqual(state.external, [], "News browsing must not try contacting a real external service.");
  } catch (error) {
    failure = error.message;
    state.visibleText = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
  } finally { state.closing = true; await context.close(); }
  return { name: item.name, passed: !failure, ...(failure ? { failure, calls: state.calls, errors: state.errors, diagnostics: state.diagnostics, external: state.external, visibleText: state.visibleText } : {}) };
}

// A live award show with one winner marked, one category still open.
function liveEvent() {
  return { id: "live-vmas", slug: "2026-mtv-vmas", title: "2026 MTV VMAs", live: true,
    startsAt: Date.now() - 3_600_000, endsAt: Date.now() + 3_600_000, updatedAt: Date.now() - 120_000, count: 2, items: [
      { kind: "note", id: "note-1", at: Date.now() - 120_000, text: "Sabrina Carpenter wins Video of the Year", source: "Mshpit", url: null },
      { kind: "report", id: "https://www.billboard.com/vmas-winners", at: Date.now() - 900_000, title: "2026 MTV VMAs Winners List (Updating Live)", source: "Billboard", url: "https://www.billboard.com/vmas-winners" },
    ],
    winners: { total: 2, announced: 1, categories: [
      { id: "c1", name: "Video of the Year", nominees: ["Sabrina Carpenter - Manchild", "Taylor Swift - Fortnight"], winner: "Sabrina Carpenter - Manchild", announcedAt: Date.now() - 120_000 },
      { id: "c2", name: "Best New Artist", nominees: ["Lola Young", "Alex Warren"], winner: null, announcedAt: null },
    ] } };
}

export async function main() {
  if (process.argv.includes("--list")) { console.log(newsBrowserCases.map(item => item.name).join("\n")); return; }
  const selected = newsBrowserCases.filter(item => item.name.includes(process.argv[2] || ""));
  assert.ok(selected.length, "No news browser cases match the requested filter.");
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
  const { server, origin } = await localServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    console.log(JSON.stringify({ cases: selected.length, network: "loopback build only, synthetic API responses, external network blocked" }));
    let failed = 0;
    for (const item of selected) {
      const result = await scenario(browser, origin, item); console.log(JSON.stringify(result)); if (!result.passed) failed += 1;
    }
    console.log(JSON.stringify({ total: selected.length, passed: selected.length - failed, failed }));
    if (failed) process.exitCode = 1;
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
