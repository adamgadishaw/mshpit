#!/usr/bin/env node
// Exported app, synthetic local accounts and transport only. No live writes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureApiResponse, navigationUser as baseUser } from "./verify-navigation-browser.mjs";

const navigationUser = { ...baseUser, favoriteArtists: ["Fixture Artist"] };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, process.env.PIT_NAVIGATION_BROWSER_DIST || "dist");
const output = resolve(root, process.env.PIT_POST_TILE_EVIDENCE || ".tmp/post-tiles");
mkdirSync(output, { recursive: true });
const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ttf": "font/ttf" };
const server = createServer((req, res) => {
  if (!["GET", "HEAD"].includes(req.method) || req.url.startsWith("/api/")) return void res.writeHead(405).end();
  let file = resolve(dist, "." + new URL(req.url, "http://fixture.invalid").pathname);
  if (!file.startsWith(dist + sep)) file = join(dist, "index.html");
  try { if (!statSync(file).isFile()) file = join(dist, "index.html"); } catch { file = join(dist, "index.html"); }
  res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" }); res.end(readFileSync(file));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
const results = [];
const kinds = ["status", "concert", "online", "campaign", "news", "attendance", "creator"];
function fixture(kind) {
  const review = `Fixture ${kind} post. A full night of music, shared with friends. ` + "The room sounded wonderful and the encore was worth the wait. ".repeat(kind === "concert" ? 10 : 1);
  const post = { id: "p_tile_fixture", userId: navigationUser.id, user: navigationUser, kind: ["concert", "online"].includes(kind) ? "review" : "status",
    review, text: review, createdAt: Date.now() - 2 * 3600_000, at: Date.now() - 2 * 3600_000, timeAgo: "2h", viewCount: 937,
    artist: "Fixture Artist", artistKey: "fixture-artist", venue: "Fixture Venue", city: "Toronto", date: "2026-09-01", overall: 4.5, band: 4, room: 5,
    likes: 3, comments: 0, photos: ["concert", "campaign"].includes(kind) ? [origin + "/images/cities/ca-toronto.webp"] : [], editedAt: 123 };
  if (kind === "online") Object.assign(post, { experienceType: "online", youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk" });
  if (kind === "campaign") post.campaign = { version: 1, treatment: "after-dark" };
  if (kind === "news") post.news = { id: "tile-news", postId: post.id, headline: "Fixture news headline", summary: review, body: review,
    category: "music", publishedAt: post.createdAt, author: navigationUser, sources: [], artists: [{ key: "fixture-artist", name: "Fixture Artist" }] };
  if (kind === "attendance") post.attendanceTicket = { artist: post.artist, venue: post.venue, city: post.city, date: "2027-09-01", tour: "Fixture Tour" };
  if (kind === "creator") post.creatorUpdate = { entityName: "Fixture Artist", kind: "show", title: "Local tour announcement", date: "2027-09-01", location: "Toronto" };
  return post;
}

async function scenario(kind, width, theme) {
  const post = fixture(kind), errors = [], requests = [];
  const context = await browser.newContext({ viewport: { width, height: 1100 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addInitScript(({ user, theme }) => {
    localStorage.setItem("pit_theme", theme); localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user]));
  }, { user: navigationUser, theme });
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message));
  const delayedNews = kind === "news" && width === 320;
  let releaseNews;
  const chunkGate = new Promise(done => { releaseNews = done; });
  let closing = false;
  await context.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    try {
      if (url.origin !== origin) return await route.abort();
      if (!path.startsWith("/api/")) {
        if (delayedNews && path.includes("/NewsStoryCard-")) await chunkGate;
        return await route.continue();
      }
      requests.push({ path, method: req.method() });
      let data;
      if (req.method() === "POST" && path === "/api/feed/news-introduction") data = { post: null };
      else if (req.method() === "POST" && path === "/api/feed/revalidate") data = { invalidPostIds: [] };
      else if (req.method() === "POST" && ["/api/feed/impressions", "/api/feed/dwell"].includes(path)) data = { ok: true };
      else if (req.method() === "POST" && path === "/api/client-errors") throw new Error(JSON.stringify(req.postDataJSON()));
      else {
        assert.equal(req.method(), "GET", `Unexpected mutation: ${req.method()} ${path}`);
        if (path === "/api/me") data = { user: navigationUser };
        else if (path === `/api/users/${navigationUser.id}`) data = { user: navigationUser, followers: 0, following: 0, isFollowing: false };
        else if (path === "/api/feed" || path.startsWith("/api/feed/for-you") || path === "/api/feed/recommended") data = { posts: delayedNews ? [{ ...fixture("status"), id: "ordinary", review: "Ordinary post remains interactive." }, post] : [post], hasMore: false, nextCursor: null, hiddenPostIds: [] };
        else if (path === `/api/users/${navigationUser.id}/posts`) data = { posts: [post], hasMore: false, nextCursor: null };
        else if (path === `/api/posts/${post.id}`) data = { post };
        else if (path === `/api/posts/${post.id}/comments`) data = { comments: [] };
        else if (path === "/api/resolve" && url.searchParams.get("path") === `/post/${post.id}`) data = { entity: { kind: "show", id: post.id, path: `/post/${post.id}` } };
        else data = fixtureApiResponse(path, { member: true, method: req.method(), resolvedPath: url.searchParams.get("path") || undefined });
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    } catch (error) { if (!closing) errors.push(error.message); await route.abort().catch(() => {}); }
  });
  const name = `${kind}-${width}-${theme}`;
  try {
    await page.goto(origin + "/feed", { waitUntil: delayedNews ? "domcontentloaded" : "networkidle" });
    if (delayedNews) {
      await page.getByText("Loading story…", { exact: true }).waitFor();
      await page.getByText("Ordinary post remains interactive.", { exact: true }).waitFor();
      assert.ok(await page.getByRole("button", { name: "Like, 3 likes", exact: true }).isEnabled());
      releaseNews();
    }
    const brand = page.getByTestId("post-brand").last(); await brand.waitFor();
    const card = brand.locator("..");
    assert.ok(!(await card.innerText()).includes("2h"));
    assert.equal(await card.getByLabel("937 member views", { exact: true }).count(), 0);
    assert.equal(await brand.getByText("MSHPIT", { exact: true }).count(), 1);
    await brand.scrollIntoViewIfNeeded();
    await page.waitForFunction(element => {
      const images = [...element.querySelectorAll("img")]; return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0);
    }, await brand.elementHandle());
    const geometry = await brand.evaluate(element => {
      const b = element.getBoundingClientRect(), p = element.parentElement.getBoundingClientRect();
      const text = element.textContent, style = getComputedStyle(element);
      return { right: b.right, bottom: b.bottom, left: b.left, top: b.top, parentRight: p.right, parentBottom: p.bottom, text, pointerEvents: style.pointerEvents, width: innerWidth };
    });
    assert.ok(geometry.right <= geometry.parentRight + 1 && geometry.right <= width);
    assert.ok(geometry.parentRight - geometry.right < 24, "signature belongs at bottom right");
    assert.ok(geometry.bottom <= geometry.parentBottom + 1);
    assert.equal(geometry.pointerEvents, "none");
    const overlaps = await card.locator('[role="button"], a').evaluateAll((controls, b) => controls.filter(el => {
      const r = el.getBoundingClientRect(); return r.width && r.height && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
    }).map(el => el.getAttribute("aria-label") || el.textContent), geometry);
    assert.deepEqual(overlaps, [], "watermark never covers an action");
    await page.screenshot({ path: join(output, `feed-${name}.png`), fullPage: false });
    if (kind === "attendance" || kind === "creator") assert.ok((await card.innerText()).includes("2027"), "event date remains visible");
    if (kind !== "news") {
      assert.ok(await card.getByRole("button", { name: /^Like, 3 likes$/ }).count());
      await card.getByRole("link", { name: "Comments, 0", exact: true }).click();
      if (kind === "concert" || kind === "online") {
        await page.getByRole("dialog", { name: "Concert review" }).waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await page.getByRole("dialog", { name: "Concert review" }).count(), 0);
      } else {
        await page.waitForURL("**/post/" + post.id);
        await page.goBack();
        await page.getByTestId("post-brand").last().waitFor();
      }
    }
    await page.goto(origin + "/you", { waitUntil: "networkidle" });
    const profileBrand = page.getByTestId("post-brand").last(); await profileBrand.waitFor();
    const profileCard = profileBrand.locator("..");
    assert.ok((await profileCard.innerText()).includes("2h"), "profile retains posted age");
    if (kind !== "news") assert.equal(await profileCard.getByLabel("937 member views", { exact: true }).count(), 1);
    await profileBrand.scrollIntoViewIfNeeded();
    await page.waitForFunction(element => {
      const images = [...element.querySelectorAll("img")]; return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0);
    }, await profileBrand.elementHandle());
    assert.equal(await page.getByRole("button", { name: "Retry loading profile posts", exact: true }).count(), 0);
    await page.screenshot({ path: join(output, `profile-${name}.png`) });
    await page.goBack();
    const returned = page.getByTestId("post-brand").last(); await returned.waitFor();
    assert.ok(!(await returned.locator("..").innerText()).includes("2h"));
    assert.equal(await returned.locator("..").getByLabel("937 member views", { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    return { kind, width, theme, geometry, profileMetadata: true, requests: requests.length };
  } catch (error) {
    await page.screenshot({ path: join(output, `failure-${name}.png`) });
    throw new Error(JSON.stringify({ name, error: error.message, errors, requests: requests.slice(-12) }, null, 2));
  } finally { closing = true; releaseNews(); await context.close(); }
}
try {
  for (const width of [320, 375, 1280]) for (const kind of kinds) {
    if (process.argv[2] && !`${kind}-${width}`.includes(process.argv[2])) continue;
    const theme = width === 375 ? "daylight" : "stage";
    const result = await scenario(kind, width, theme); results.push(result); console.log(JSON.stringify(result));
  }
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
} finally { await browser.close(); await new Promise(done => server.close(done)); }
