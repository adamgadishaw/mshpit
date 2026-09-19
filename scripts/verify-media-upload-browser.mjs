#!/usr/bin/env node
// Real exported app; loopback-only synthetic account/files/storage responses.
// No real server, member media, database, post, or external provider is used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "media-upload-browser");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
// Valid sniffable MP4 signature, intentionally no decodable video metadata.
// A picker that waits for metadata would never reach our mocked verifier.
const clip = Buffer.from("00000018667479706d7034320000000069736f6d6d703432", "hex");

async function localServer() {
  const directory = resolve(root, process.env.PIT_MEDIA_BROWSER_DIST || "dist");
  const htmlPath = join(directory, "index.html");
  assert.ok(statSync(htmlPath).isFile(), "Export the current web build first.");
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
  const state = { creates: [], puts: [], finalizes: [], reads: [], reports: [], errors: [], closing: false, clipReady: false };
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  await page.addInitScript(user => {
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    window.__pickerHandles = { allocated: [], revoked: [] };
    URL.createObjectURL = file => { const url = create(file); window.__pickerHandles.allocated.push(url); return url; };
    URL.revokeObjectURL = url => { window.__pickerHandles.revoked.push(url); revoke(url); };
    // Simulate an older Safari dialog that supplies neither change nor cancel.
    window.__holdPicker = true;
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === "file" && window.__holdPicker) return;
      return click.call(this);
    };
  }, navigationUser);
  page.on("pageerror", error => state.errors.push(error.message));
  const ready = id => ({ id, status: "ready", kind: id === "fixture_clip" ? "video" : "image",
    url: `https://media.example.test/${id}.png`, width: 1, height: 1,
    ...(id === "fixture_clip" ? { posterUrl: "https://media.example.test/poster.png", durationMs: 42_000, mimeType: "video/mp4" } : { mimeType: "image/png" }) });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.origin === "https://media.example.test") return await route.fulfill({ status: 200, contentType: "image/png", body: png });
      if (url.origin !== origin) return await route.abort();
      if (url.pathname.startsWith("/fixture-put/")) {
        assert.equal(request.method(), "PUT");
        assert.equal(request.headers()["if-none-match"], "*");
        state.puts.push(url.pathname.split("/").at(-1));
        return await route.fulfill({ status: 200, body: "" });
      }
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      if (url.pathname === "/api/client-errors") { state.reports.push(request.postDataJSON()); return await json({ ok: true }); }
      if (url.pathname === "/api/health") return await json({ ok: true, capabilities: { mediaPublishing: { photos: true, videos: true, pipeline: "private-derivative-v1", sourceTypes: ["video/mp4", "video/quicktime"] } } });
      if (url.pathname === "/api/media/assets" && request.method() === "POST") {
        assert.equal(request.headers()["x-pit-expected-account"], navigationUser.id);
        const body = request.postDataJSON(); state.creates.push(body);
        const id = body.contentType.startsWith("video/") ? "fixture_clip" : "fixture_photo";
        assert.equal(body.fileSize, id === "fixture_clip" ? clip.length : png.length);
        return await json({ asset: { id, status: "upload_pending" }, upload: {
          method: "PUT", uploadUrl: `${origin}/fixture-put/${id}`, storageScope: "private",
          storageLocator: `pit-private:users/${navigationUser.id}/post/${id}.${id === "fixture_clip" ? "mp4" : "png"}`,
          requiredHeaders: { "Content-Type": body.contentType, "If-None-Match": "*" },
        } });
      }
      const asset = url.pathname.match(/^\/api\/media\/assets\/(fixture_photo|fixture_clip)(\/finalize)?$/);
      if (asset) {
        assert.equal(request.headers()["x-pit-expected-account"], navigationUser.id);
        const id = asset[1];
        if (asset[2]) {
          assert.equal(request.method(), "POST");
          const body = request.postDataJSON(); state.finalizes.push({ id, body });
          assert.equal(body.editRecipe.filter, "original");
          if (id === "fixture_clip") {
            assert.equal(body.deliveryMode, undefined, "Unknown picker MIME must not finalize sniffed video as an image.");
            assert.equal(body.durationMs, undefined, "The picker must not invent a clip duration.");
          }
        } else { assert.equal(request.method(), "GET"); state.reads.push(id); }
        return await json(id === "fixture_photo" || state.clipReady ? { asset: ready(id), finalize: { state: "ready" } }
          : { asset: { id, status: "upload_pending" }, finalize: { state: "processing" } });
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
    const review = page.getByPlaceholder("What made the night? Be honest - this is what people read.", { exact: true });
    await review.fill("Keep this concert memory during interrupted uploads.");
    await page.getByRole("button", { name: "Photo / video", exact: true }).click();
    const add = page.getByRole("button", { name: "Add media", exact: true });
    // Explicit escape hatch for older Safari versions that emit no cancel event.
    await add.click();
    await page.getByRole("button", { name: "Cancel media selection", exact: true }).click();
    assert.equal(await page.locator('[data-testid="composer-file-input"]').count(), 0);
    assert.equal(state.creates.length, 0);
    await page.evaluate(() => { window.__holdPicker = false; });
    const choosing = page.waitForEvent("filechooser");
    await add.click();
    await (await choosing).setFiles([
      { name: "camera.png", mimeType: "image/png", buffer: png },
      { name: "icloud-original", mimeType: "", buffer: clip },
    ]);
    await page.getByRole("button", { name: "Remove media 1", exact: true }).waitFor();
    await page.waitForFunction(() => window.__pickerHandles.revoked.length >= 1);
    await page.getByRole("progressbar", { name: /Processing original/ }).waitFor();
    assert.equal(state.finalizes.length, 2, "A selected video must reach verification without any browser metadata decode.");
    await page.getByRole("button", { name: "Cancel media upload", exact: true }).click();
    const retry = page.getByRole("button", { name: "Retry uploading selected photos and videos", exact: true });
    await retry.waitFor();
    await page.getByRole("button", { name: "Remove selected media 2", exact: true }).waitFor();
    assert.equal(await review.inputValue(), "Keep this concert memory during interrupted uploads.");
    assert.equal(await page.getByRole("button", { name: "Remove media 1", exact: true }).isEnabled(), true);
    await page.screenshot({ path: join(shots, `media-${width}-paused.png`) });
    state.clipReady = true;
    await retry.click();
    await page.getByRole("button", { name: "Remove media 2", exact: true }).waitFor();
    await page.waitForFunction(() => window.__pickerHandles.revoked.length === 2);
    assert.deepEqual(state.puts, ["fixture_photo", "fixture_clip"], "Retry must not re-upload completed source bytes.");
    assert.equal(state.creates.length, 2, "Retry must use the owner-scoped remote identity.");
    assert.equal(state.finalizes.length, 2);
    assert.ok(state.reads.includes("fixture_clip"));
    assert.equal(await retry.count(), 0);
    assert.equal(await page.locator('[data-testid="composer-file-input"]').count(), 0);
    assert.equal(await review.inputValue(), "Keep this concert memory during interrupted uploads.");
    assert.deepEqual(state.reports, []); assert.deepEqual(state.errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: join(shots, `media-${width}-complete.png`) });
    console.log(JSON.stringify({ name: `media-upload-${width}`, passed: true, sourceTransfers: state.puts.length, sourceReuploads: 0 }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `media-${width}-failed.png`) }).catch(() => {});
    console.error(JSON.stringify({ error: error.message, state, body: (await page.locator("body").innerText()).slice(-6000) }));
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
