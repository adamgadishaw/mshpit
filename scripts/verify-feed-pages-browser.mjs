#!/usr/bin/env node
// Current exported app with paginated synthetic transport. No live data writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localServer } from "./verify-artist-account-browser.mjs";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, ".tmp", "launch-acceptance", "feed-browser");
mkdirSync(output, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
const waitFor = async (check, label) => {
  const until = Date.now() + 15_000;
  while (!await check()) { assert.ok(Date.now() < until, label); await new Promise(done => setTimeout(done, 100)); }
};
const labels = { everyone: "For You", following: "Following", local: "Local" };
const results = [];
const { server, origin } = await localServer(); let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block", reducedMotion: "reduce" });
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    const reads = [], errors = [], generation = { everyone: 1, following: 1, local: 1 };
    let failHead = null, closing = false;
    await page.addInitScript(user => { localStorage.setItem("pit_theme", "stage"); localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user])); }, navigationUser);
    page.on("pageerror", error => errors.push(error.message));
    const text = (mode, index, version = generation[mode]) => `${labels[mode]} fixture ${index}, generation ${version}.`;
    const post = (mode, index) => ({ id: `p_fixture-${mode}-${index}`, version: generation[mode], userId: "feed-fixture-author", user: { id: "feed-fixture-author", name: "Synthetic Author", handle: "syntheticauthor", role: "fan" },
      kind: "status", text: text(mode, index), review: text(mode, index), at: Date.now() - index * 1000, createdAt: Date.now() - index * 1000, photos: [], likes: 0, comments: 0 });
    await context.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      try {
        if (url.origin !== origin) return await route.abort();
        if (!path.startsWith("/api/")) return await route.continue();
        if (path === "/api/me") return await json({ user: navigationUser });
        if (path === "/api/me/going") return await json({ going: [], attendance: [] });
        if (path === "/api/feed" || path.startsWith("/api/feed/for-you")) {
          const mode = url.searchParams.get("mode") || "everyone";
          const cursor = url.searchParams.get("cursor") || url.searchParams.get("before");
          const number = cursor ? Number(cursor.split(":").at(-1)) : 1;
          assert.ok([1, 2, 3].includes(number), `Unexpected cursor ${cursor}`);
          reads.push({ mode, cursor, page: number, generation: generation[mode] });
          if (!cursor && failHead === mode) return await json({ error: "Synthetic refresh outage", code: "UNAVAILABLE" }, 503);
          const start = (number - 1) * 8;
          return await json({ posts: Array.from({ length: 8 }, (_, index) => post(mode, start + index)), nextCursor: number < 3 ? `${mode}:${number + 1}` : null,
            algorithm: { id: "fixture", snapshotAt: generation[mode] }, hiddenPostIds: [] });
        }
        if (path === "/api/feed/revalidate") return await json({ invalidPostIds: [] });
        if (path === "/api/feed/news-introduction") return await json({ post: null });
        if (["/api/feed/impressions", "/api/feed/dwell"].includes(path)) return await json({ ok: true });
        if (path.endsWith("/comments")) return await json({ comments: [] });
        if (path === "/api/client-errors") throw new Error(req.postData());
        return await json(fixtureApiResponse(path, { member: true, method: req.method(), resolvedPath: url.searchParams.get("path") || undefined }));
      } catch (error) { if (!closing) errors.push(error.message); await route.abort().catch(() => {}); }
    });
    const scroll = async bottom => page.locator("body").evaluate((boundary, bottom) => {
      const target = [...boundary.querySelectorAll("div")].find(el => ["auto", "scroll"].includes(getComputedStyle(el).overflowY) && el.clientHeight > 100 && el.scrollHeight > el.clientHeight);
      if (!target) return null;
      // RN Web attaches its own scrollTo({x, y}) adapter to the DOM node.
      // The native DOM property dispatches the real scroll event without that adapter.
      target.scrollTop = bottom ? target.scrollHeight : 0;
      return target.scrollTop;
    }, bottom);
    const offset = () => page.locator("body").evaluate(boundary => Math.max(0, ...[...boundary.querySelectorAll("div")].map(el => el.scrollTop)));
    try {
      await page.goto(origin + "/feed", { waitUntil: "domcontentloaded" });
      await page.getByText(text("everyone", 0), { exact: true }).waitFor();
      for (const mode of ["everyone", "local", "following"]) {
        await scroll(false);
        await page.getByRole("tab", { name: `${labels[mode]} feed`, exact: true }).click();
        await page.getByText(text(mode, 0), { exact: true }).waitFor();
        for (let attempt = 0; attempt < 30 && !await page.getByText(text(mode, 23), { exact: true }).count(); attempt++) {
          await scroll(true); await page.waitForTimeout(180);
          // Web retains an explicit paging action as well as end-of-list reads.
          // Exercise that normal fallback when virtualization has not emitted a
          // second end event after the current request settled.
          const more = page.getByRole("button", { name: "Load older posts", exact: true });
          if (await more.isVisible() && await more.isEnabled()) await more.click();
        }
        await page.getByText(text(mode, 23), { exact: true }).waitFor();
        await page.getByText("You're caught up", { exact: true }).waitFor();
        assert.deepEqual(reads.filter(read => read.mode === mode && read.cursor).map(read => read.page), [2, 3]);
        assert.ok(await offset() > 0, "third page is reached by actual list scrolling");
        await page.screenshot({ path: join(output, `${mode}-${width}-page3.png`) });
        // Clicking the active main tab must return the existing list to its top
        // and issue a fresh head, not silently stay on the old snapshot.
        generation[mode]++;
        const tab = page.getByRole("tab", { name: "Feed", exact: true });
        await tab.click();
        await page.getByText(text(mode, 0), { exact: true }).waitFor();
        await waitFor(async () => await offset() <= 1, "active tab did not return to top");
        const heads = reads.filter(read => read.mode === mode && !read.cursor).length;
        failHead = mode;
        await page.getByRole("button", { name: "Your feed, return to top and refresh", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "The feed could not refresh." }).waitFor();
        assert.equal(await page.getByText(text(mode, 0), { exact: true }).count(), 1, "failed refresh retains accepted content");
        assert.ok(reads.filter(read => read.mode === mode && !read.cursor).length > heads);
        failHead = null; generation[mode]++;
        await page.getByRole("button", { name: "Your feed, return to top and refresh", exact: true }).click();
        await page.getByText(text(mode, 0), { exact: true }).waitFor();
        await waitFor(async () => !await page.getByRole("alert").filter({ hasText: "The feed could not refresh." }).count(), "refresh error did not clear");
        assert.ok(await offset() <= 1);
        results.push({ width, mode, passed: true, checks: ["pages 2 and 3", "exhaustion", "active tab top/refresh", "failed title refresh retains content", "title refresh recovery"] });
      }
      assert.deepEqual(errors, []);
    } catch (error) {
      await page.screenshot({ path: join(output, `failed-${width}.png`) });
      writeFileSync(join(output, `failure-${width}.json`), JSON.stringify({ error: error.message, reads, errors, body: await page.locator("body").innerText(), scrolls: await page.locator("body").evaluate(body => [body, ...body.querySelectorAll("div")].filter(el => el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 100).map(el => ({ tag: el.tagName, id: el.id, test: el.getAttribute("data-testid"), class: el.className, height: el.clientHeight, total: el.scrollHeight, offset: el.scrollTop, overflow: getComputedStyle(el).overflowY }))) }, null, 2));
      throw error;
    } finally { closing = true; await context.close(); }
  }
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.length, failed: 0, scenarios: results, transport: "local synthetic only" }));
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
