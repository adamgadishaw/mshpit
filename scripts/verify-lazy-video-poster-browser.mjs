#!/usr/bin/env node
// Actual exported app/decoder, locally recorded video and mock transport only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { localServer } from "./verify-discover-venues-browser.mjs";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
const output = resolve(".tmp/lazy-video-poster-browser"); mkdirSync(output, { recursive: true });
const videoUrl = "https://poster.fixture.invalid/clip.webm";
const post = { id: "poster-fixture", kind: "review", version: 2, userId: "poster-author",
  user: { id: "poster-author", name: "Poster Fixture", handle: "posterfixture", role: "fan" },
  artist: "Fixture Artist", artistKey: "fixture-artist", venue: "Fixture Venue", date: "2026-10-01", overall: 4.5,
  review: "A locally recorded video without an existing cover.", photos: [videoUrl],
  media: [{ id: "clip", uri: videoUrl, kind: "video", altText: "Fixture performance video" }], likes: 0, comments: 0 };

async function scenario(browser, origin, video, width, cancel) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
  await context.addInitScript(user => { localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user])); }, navigationUser);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const state = { chunks: [], media: [], errors: [] }; let held;
  page.on("pageerror", error => state.errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.href === videoUrl) {
        state.media.push(request.method());
        return await route.fulfill({ contentType: "video/webm", headers: { "Access-Control-Allow-Origin": "*" }, body: request.method() === "HEAD" ? Buffer.alloc(0) : video });
      }
      if (url.origin !== origin) return await route.abort();
      if (url.pathname.includes("videoPosterWebImplementation-") && url.pathname.endsWith(".js")) {
        state.chunks.push(url.pathname);
        if (cancel) { held = route; return; }
      }
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      if (url.pathname === "/api/resolve") return await json({ entity: { kind: "show", id: post.id, path: `/post/${post.id}` } });
      if (url.pathname === `/api/posts/${post.id}`) return await json({ post });
      if (url.pathname === `/api/posts/${post.id}/comments`) return await json({ comments: [] });
      if (url.pathname === "/api/media/reactions") return await json({ reactions: {} });
      return await json(fixtureApiResponse(url.pathname, { member: true, method: request.method(), resolvedPath: url.searchParams.get("path") || "/feed" }));
    } catch (error) { if (!state.closing) state.errors.push(error.message); await route.abort().catch(() => {}); }
  });
  try {
    await page.goto(origin + "/feed", { waitUntil: "networkidle" });
    await page.getByText("Your shows. Your music.", { exact: true }).waitFor();
    assert.equal(state.chunks.length, 0, "No decoder chunk for a feed without missing covers");
    await page.goto(origin + `/post/${post.id}`, { waitUntil: "domcontentloaded" });
    const close = page.getByRole("button", { name: "Close review", exact: true }); await close.waitFor();
    await page.waitForFunction(() => !!document.querySelector('[aria-label="Fixture performance video"]'));
    if (cancel) {
      const deadline = Date.now() + 12000;
      while (!held && Date.now() < deadline) await new Promise(done => setTimeout(done, 20));
      assert.ok(held, "Missing cover requested the deferred decoder");
      assert.deepEqual(state.media, [], "Loading the module has not started video decoding");
      await close.click(); await close.waitFor({ state: "detached" });
      const response = page.waitForResponse(response => response.url().includes("videoPosterWebImplementation-"));
      await held.continue(); await response;
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      await new Promise(done => setTimeout(done, 250));
      assert.deepEqual(state.media, [], "Dismissal aborts before a late decoder may probe or read media");
      assert.equal(await page.locator('img[src^="blob:"]').count(), 0);
    } else {
      await page.waitForFunction(() => [...document.images].some(image => image.src.startsWith("blob:") && image.complete && image.naturalWidth > 0), null, { timeout: 20000 });
      assert.equal(state.chunks.length, 1);
      assert.ok(state.media.includes("HEAD"), "Original CORS safety probe remains active");
      assert.ok(state.media.includes("GET"), "Actual local video was decoded");
      await page.screenshot({ path: resolve(output, `cover-${width}.png`) });
      await close.click(); await close.waitFor({ state: "detached" });
      assert.equal(await page.locator('img[src^="blob:"]').count(), 0);
    }
    assert.deepEqual(state.errors, []);
    return { width, mode: cancel ? "dismiss-during-load" : "actual-cover", ...state, passed: true };
  } catch (error) {
    await page.screenshot({ path: resolve(output, `FAILED-${width}-${cancel}.png`) }).catch(() => {});
    writeFileSync(resolve(output, `FAILED-${width}-${cancel}.json`), JSON.stringify({ ...state, error: error.message, text: await page.locator("body").innerText() }, null, 2)); throw error;
  } finally { state.closing = true; await context.close(); }
}

const { server, origin } = await localServer(); let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
  const recorder = await browser.newPage();
  const video = Buffer.from(await recorder.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext("2d"), stream = canvas.captureStream(15), chunks = [];
    const recording = new MediaRecorder(stream, { mimeType: "video/webm" });
    const result = new Promise(done => { recording.onstop = async () => done([...new Uint8Array(await new Blob(chunks).arrayBuffer())]); });
    recording.ondataavailable = event => chunks.push(event.data); recording.start();
    for (let frame = 0; frame < 24; frame++) {
      for (let y = 0; y < 180; y += 12) for (let x = 0; x < 320; x += 12) { ctx.fillStyle = `hsl(${(x * 3 + y * 5 + frame) % 360} 70% ${25 + ((x + y) % 50)}%)`; ctx.fillRect(x, y, 12, 12); }
      ctx.fillStyle = "white"; ctx.font = "bold 25px sans-serif"; ctx.fillText("LOCAL LIVE FIXTURE", 8, 95);
      await new Promise(done => setTimeout(done, 70));
    }
    recording.stop(); stream.getTracks().forEach(track => track.stop()); return await result;
  })); await recorder.close();
  const results = [];
  for (const width of [375, 1280]) for (const cancel of [false, true]) { const result = await scenario(browser, origin, video, width, cancel); results.push(result); console.log(JSON.stringify(result)); }
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2));
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
