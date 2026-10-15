#!/usr/bin/env node
// Isolated rendered-layout checks. Every API is synthetic; no production/session access.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, statSync, mkdirSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const before = process.argv.includes("--before");
const directory = resolve(root, process.env.PIT_LAYOUT_BROWSER_DIST || "dist");
const evidence = resolve(root, process.env.PIT_LAYOUT_BROWSER_EVIDENCE || "../layout-handoff");
mkdirSync(evidence, { recursive: true });
const actor = { ...navigationUser, role: "admin" };
const postId = "p_navigation_fixture";
const article = { id: "layout_story", postId, headline: "Synthetic layout article", summary: "A local layout fixture.", body: "Synthetic complete article body.\n\n" + Array.from({ length: 20 }, (_, i) => `Local fixture paragraph ${i + 1}. This longer article checks the readable column and scrolling while the reply composer remains available.`).join("\n\n"), artists: [], sources: [], category: "tour", origin: "self_written", author: actor, publishedAt: Date.now(), updatedAt: Date.now(), commentCount: 0 };
const artist = { key: "fixture artist", name: "Fixture Artist", ownerId: "layout_artist", updatedAt: 1, retainedReviews: 0, owner: { id: "layout_artist", name: "Fixture Artist", handle: "layoutartist", role: "artist", active: true, matchesArtist: true, verified: false }, identityReview: { held: false } };
const errors = [], external = [], mutations = [], measurements = [];
function api(url, method) {
  const path = url.pathname;
  if (["/api/client-errors", "/api/analytics/events"].includes(path)) return { ok: true };
  if (method !== "GET") { mutations.push(`${method} ${path}`); throw Error("Unexpected fixture mutation"); }
  if (path === "/api/me") return { user: actor };
  if (path === "/api/admin/jobs") return { jobs: [], cursor: null };
  if (path === "/api/admin/artist-access") return { artists: [artist], hasMore: false };
  if (path.endsWith("/access-preview")) return { ownerId: artist.ownerId, updatedAt: 1, contentHash: "synthetic-layout-preview", contentCount: 0, profileItems: [], items: [], cursor: null };
  if (path === "/api/admin/moderation") return { reports: [], requests: [], recentActions: [], nextCursor: null, hasMore: false, summary: { open: 0, total: 0, byType: {} } };
  if (path === "/api/admin/artist-requests") return { requests: [] };
  if (path === "/api/admin/users") return { users: [actor], nextCursor: null, hasMore: false, stats: {}, summary: {} };
  if (path === "/api/admin/members") return { users: [actor], nextCursor: null, hasMore: false, stats: {}, summary: {} };
  if (path === "/api/moderation/artist-death-watch") return { candidates: [], audit: [], summary: {} };
  if (path === "/api/admin/errors") return { groups: [], recent: [], alerts: {}, counts: {} };
  if (path === "/api/admin/health") return { ok: true, availability: { status: "available" } };
  if (path === "/api/me/news-region") return { choice: "everywhere", region: null, label: "Everywhere", city: "Toronto", options: [] };
  if (path === "/api/admin/badges") return { badges: [], users: [] };
  if (path === "/api/news-desk/stories") return { stories: [article], nextCursor: null };
  if (path.startsWith("/api/news-desk/stories/")) return path.endsWith("/post") ? { post: { ...fixtureApiResponse(`/api/posts/${postId}`, { member: true }).post, news: article } } : { story: article };
  if (path === `/api/posts/${postId}`) return { post: { ...fixtureApiResponse(path, { member: true }).post, news: article } };
  return fixtureApiResponse(path, { member: true, method, resolvedPath: url.searchParams.get("path") || undefined });
}
const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://fixture.invalid");
  let file = resolve(directory, `.${decodeURIComponent(url.pathname)}`);
  try { if (!file.startsWith(directory + sep) || !statSync(file).isFile()) file = resolve(directory, "index.html"); } catch { file = resolve(directory, "index.html"); }
  response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" }).end(readFileSync(file));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1676, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 945 } });
    await context.addInitScript(user => { localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user])); localStorage.setItem("pit_theme", "stage"); }, actor);
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.hostname); return route.abort(); }
      if (!url.pathname.startsWith("/api/")) return route.continue();
      try { return route.fulfill({ contentType: "application/json", body: JSON.stringify(api(url, route.request().method())) }); }
      catch (error) { errors.push(`${url.pathname}: ${error.message}`); return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: error.message }) }); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on("pageerror", error => errors.push(error.message));
    const settle = () => page.evaluate(async () => {
      const animations = document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.all(animations.map(a => a.finished.catch(() => {})));
    });
    const capture = async name => {
      await settle();
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
      await page.screenshot({ path: resolve(evidence, `${before ? "before" : "after"}-${name}-${width}.png`) });
    };
    const bound = async (id, action) => {
      if (before) return;
      await settle();
      const shell = await page.getByTestId(id).boundingBox(); assert.ok(shell && shell.width <= 901);
      if (action) { const b = await page.getByRole("button", { name: action, exact: true }).boundingBox(); assert.ok(b.width < shell.width * .7 && b.height >= 43, `${action} should fit its label and retain a touch target`); }
      measurements.push({ width, shell: id, x: shell.x, contentWidth: shell.width });
    };
    await page.goto(origin + "/feed"); await page.getByText("Your life's musical journey", { exact: true }).waitFor();
    const ads = page.getByRole("link", { name: "Your ad here. Contact mshpit about advertising.", exact: true });
    if (width === 1676) await ads.nth(1).waitFor();
    assert.equal(await ads.count(), width === 1676 ? 2 : 0);
    await capture("feed");
    if (!before && width === 1676) {
      assert.equal(await page.getByTestId("desktop-sponsor-rail").evaluate(el => getComputedStyle(el).borderRightWidth), "1px");
      assert.equal(await page.getByTestId("desktop-content-column").evaluate(el => getComputedStyle(el).borderRightWidth), "1px");
    }
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Settings. Appearance, privacy, data, and account controls", exact: true }).click();
    await page.getByRole("button", { name: /^Administration/ }).click();
    await page.getByRole("textbox", { name: "Job title", exact: true }).waitFor();
    await bound("administration-shell", "New job draft"); await capture("jobs");
    if (!before) { assert.equal(await page.getByTestId("job-openings").count(), 1); assert.equal(await page.getByTestId("job-editor").count(), 1); }
    await page.getByRole("textbox", { name: "Job title", exact: true }).fill("Synthetic unsaved draft");
    await page.getByRole("button", { name: "Save draft", exact: true }).scrollIntoViewIfNeeded();
    await bound("administration-shell", "Save draft"); await capture("jobs-actions");
    await page.getByRole("button", { name: "Artist access", exact: true }).click();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Job title", exact: true }).inputValue(), "Synthetic unsaved draft");
    await page.getByRole("button", { name: "Artist access", exact: true }).click(); await page.getByRole("button", { name: "Discard and leave", exact: true }).click();
    const search = page.getByRole("textbox", { name: "Artist access search", exact: true }); await search.fill("Fixture"); await search.press("Enter");
    await page.getByRole("button", { name: "Review access for Fixture Artist", exact: true }).click();
    await bound("administration-shell", "Back to jobs"); await capture("artist-access");
    await page.getByRole("textbox", { name: "Artist access revocation reason", exact: true }).fill("Synthetic review reason, no mutation.");
    await page.getByRole("button", { name: "Review revocation", exact: true }).click();
    await page.getByRole("button", { name: "Cancel revocation", exact: true }).click();
    await page.getByRole("button", { name: "Back to jobs", exact: true }).click(); await page.getByRole("textbox", { name: "Job title", exact: true }).waitFor();
    await page.goto(origin + "/feed"); await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Moderation. Reports, members, and content", exact: true }).click();
    await page.getByText("Moderation console", { exact: true }).waitFor(); await bound("moderation-shell"); await capture("moderation");
    assert.equal(await page.getByRole("tablist", { name: "Moderation sections", exact: true }).getByRole("tab").count(), 14, "Grouping must preserve every admin destination");
    if (!before) for (const label of ["Review", "Publishing", "Operations"]) await page.getByText(label, { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Reports", exact: true }).click(); await capture("moderation-reports");
    await page.getByRole("tab", { name: "Members", exact: true }).click(); await capture("moderation-members");
    await page.goto(origin + "/news"); await page.getByRole("heading", { name: "Music news", exact: true }).waitFor(); await page.getByText(article.headline, { exact: true }).first().waitFor(); await bound("news-content-shell"); await capture("news");
    await page.getByRole("button", { name: "Synthetic layout article. Read the full story and comments.", exact: true }).click();
    for (let visit = 0; visit < 2; visit += 1) {
      await page.getByText("Synthetic complete article body.", { exact: true }).waitFor();
      const input = page.getByPlaceholder("Reply to this post...", { exact: true }); await input.fill("Synthetic local reply draft; never submitted.");
      if (!before) {
        await bound("post-content-shell");
        const sizes = await page.getByTestId("post-content-shell").evaluate(el => ({ shell: el.getBoundingClientRect().width, header: el.firstElementChild.getBoundingClientRect().width, footer: el.lastElementChild.getBoundingClientRect().width }));
        assert.ok(Math.abs(sizes.shell - sizes.header) < 2 && Math.abs(sizes.shell - sizes.footer) < 2, "Reader header and fixed composer must share its width boundary");
        const draft = await input.boundingBox(); const shell = await page.getByTestId("post-content-shell").boundingBox(); assert.ok(draft.x >= shell.x && draft.x + draft.width <= shell.x + shell.width + 1);
      }
      if (!visit) await capture("article");
      const comments = page.getByText("No comments yet. Start the conversation.", { exact: true });
      await comments.scrollIntoViewIfNeeded();
      assert.ok(await comments.evaluate(el => { for (let p = el.parentElement; p; p = p.parentElement) if (p.scrollTop > 0) return true; return false; }), "A long article must scroll to its comments");
      assert.equal(await input.inputValue(), "Synthetic local reply draft; never submitted.");
      if (!visit) await capture("article-scrolled");
      if (!visit) {
        await page.getByRole("button", { name: "Leave the story", exact: true }).click();
        await page.getByRole("heading", { name: "Music news", exact: true }).waitFor();
        await page.getByRole("button", { name: "Synthetic layout article. Read the full story and comments.", exact: true }).click();
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(mutations, []);
  console.log(JSON.stringify({ passed: true, mode: before ? "baseline" : "candidate", widths: [1676, 768, 390], measurements, errors, externalRequests: external, mutationRequests: mutations }));
} catch (error) { console.log(JSON.stringify({ errors, externalRequests: external, mutationRequests: mutations, measurements })); throw error; }
finally { await browser?.close(); await new Promise(done => server.close(done)); }
