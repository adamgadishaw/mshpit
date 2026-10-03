#!/usr/bin/env node
// Loopback-only synthetic Newsroom flow. It exercises the editor UI and the
// existing authenticated media transport with fake local responses; it never
// reaches Mshpit, Anthropic, storage, or a real account.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureApiResponse } from "./verify-navigation-browser.mjs";
import { newsEditorFixture, upkeepAdmin } from "./verify-catalog-maintenance-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = resolve(root, process.env.PIT_NEWSROOM_BROWSER_ARTIFACTS || join(".tmp", "newsroom-composer-browser"));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");

async function localServer() {
  const directory = resolve(root, process.env.PIT_NEWSROOM_BROWSER_DIST || "dist");
  const htmlPath = join(directory, "index.html");
  assert.ok(statSync(htmlPath).isFile(), "Export the current web build first.");
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };
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

function selfWrittenDraft(body, status = "draft") {
  return {
    id: "self-written-fixture", status, expired: false, origin: "self_written", headline: body.headline,
    summary: body.summary, body: body.body, category: body.category, wordCount: body.body.trim().split(/\s+/u).length,
    costUsd: 0, revision: status === "published" ? 1 : 0, postId: status === "published" ? "news-self-fixture" : null,
    sources: [...body.sources, { kind: "photo", name: body.photo.name, url: body.photo.url, credit: body.photo.credit }],
    photo: { assetId: "ma_fixture_photo", url: "https://media.example.test/fixture-photo.jpg", status: "ready",
      source: { kind: "photo", name: body.photo.name, url: body.photo.url, credit: body.photo.credit } },
    writer: { actorType: "human", actorLabel: "Synthetic editor", grantId: null }, createdAt: 1789488000000,
  };
}

async function scenario(browser, origin, width, mode = "same") {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  const state = { draft: null, saveAttempts: 0, saveKeys: [], creates: [], puts: [], finalizes: [], reports: [], errors: [], closing: false,
    publishRevisions: [], publications: 0 };
  const receipts = new Map();
  await context.addInitScript(({ origin, user }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
  }, { origin, user: upkeepAdmin });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => state.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") state.errors.push(message.text());
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.origin === "https://media.example.test") return await route.fulfill({ status: 200, contentType: "image/png", body: png });
      if (url.origin !== origin) return await route.abort();
      if (url.pathname === "/fixture-put/fixture-photo") {
        assert.equal(request.method(), "PUT");
        state.puts.push(url.pathname);
        return await route.fulfill({ status: 200, body: "" });
      }
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      if (url.pathname === "/api/client-errors") { state.reports.push(request.postDataJSON()); return await json({ ok: true }); }
      if (url.pathname === "/api/me") return await json({ user: upkeepAdmin });
      if (url.pathname === "/api/admin/moderation") return await json({ reports: [], requests: [], recentActions: [], nextCursor: null, hasMore: false, summary: {} });
      if (url.pathname === "/api/admin/artist-requests") return await json({ requests: [] });
      if (url.pathname === "/api/moderation/news-desk/editor" && request.method() === "GET") {
        return await json(newsEditorFixture(state.draft ? [state.draft] : []));
      }
      if (url.pathname === "/api/moderation/news-desk/editor/drafts/self-written" && request.method() === "POST") {
        const body = request.postDataJSON();
        assert.equal(body.category, "release", "New music must be sent despite chart, tour and award background");
        assert.match(body.idempotencyKey, /^self-written-/u);
        state.saveKeys.push(body.idempotencyKey);
        const { idempotencyKey, ...payload } = body;
        const snapshot = JSON.stringify(payload);
        const previous = receipts.get(idempotencyKey);
        if (previous && previous.payload !== snapshot) return await json({ error: "Conflicting save payload", code: "CONFLICT" }, 409);
        if (!previous) receipts.set(idempotencyKey, { payload: snapshot, draft: selfWrittenDraft(body) });
        state.draft = receipts.get(idempotencyKey).draft;
        state.saveAttempts += 1;
        if (state.saveAttempts === 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          return await json({ error: "Synthetic lost response", code: "SERVICE_UNAVAILABLE" }, 503);
        }
        return await json({ draft: state.draft });
      }
      if (url.pathname === "/api/moderation/news-desk/editor/drafts/self-written-fixture/publish" && request.method() === "POST") {
        const body = request.postDataJSON();
        assert.deepEqual(Object.keys(body), ["expectedRevision"]);
        state.publishRevisions.push(body.expectedRevision);
        if (state.draft.status !== "draft" || body.expectedRevision !== state.draft.revision)
          return await json({ error: "Synthetic concurrent edit", code: "CONFLICT" }, 409);
        state.draft = { ...selfWrittenDraft({ ...state.draft, photo: state.draft.photo.source }, "published"), revision: state.draft.revision + 1 };
        state.publications++;
        if (mode === "edited") return await json({ error: "Synthetic lost publish response", code: "SERVICE_UNAVAILABLE" }, 503);
        return await json({ draft: state.draft, postId: "news-self-fixture" });
      }
      if (url.pathname === "/api/media/assets" && request.method() === "POST") {
        assert.equal(request.headers()["x-pit-expected-account"], upkeepAdmin.id);
        const body = request.postDataJSON();
        assert.equal(body.purpose, "post");
        state.creates.push(body);
        return await json({ asset: { id: "ma_fixture_photo", status: "upload_pending" }, upload: {
          method: "PUT", uploadUrl: `${origin}/fixture-put/fixture-photo`, storageScope: "private",
          storageLocator: "pit-private:users/navigation-fixture-user/post/fixture-photo.png",
          requiredHeaders: { "Content-Type": body.contentType, "If-None-Match": "*" },
        } });
      }
      if (url.pathname === "/api/media/assets/ma_fixture_photo" && request.method() === "GET") {
        assert.equal(request.headers()["x-pit-expected-account"], upkeepAdmin.id);
        return await json({ asset: { id: "ma_fixture_photo", kind: "image", status: "ready", url: "https://media.example.test/fixture-photo.jpg" } });
      }
      if (url.pathname === "/api/media/assets/ma_fixture_photo/finalize" && request.method() === "POST") {
        state.finalizes.push(request.postDataJSON());
        return await json({ asset: { id: "ma_fixture_photo", kind: "image", status: "ready", url: "https://media.example.test/fixture-photo.jpg", width: 1, height: 1, mimeType: "image/png" }, finalize: { state: "ready" } });
      }
      return await json(fixtureApiResponse(url.pathname, { member: true, method: request.method(), resolvedPath: url.searchParams.get("path") || undefined }));
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message);
      await route.abort().catch(() => {});
    }
  });
  const dialog = (event) => event.dismiss().catch(() => {});
  page.on("dialog", dialog);
  try {
    await page.goto(origin + "/feed", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Newsroom. Write stories and run live coverage", exact: true }).click();
    const composer = page.getByTestId("self-written-news-composer");
    await composer.waitFor();
    await composer.getByLabel("Self-written news headline", { exact: true }).fill("Synthetic band release their new album");
    await composer.getByLabel("Self-written news summary", { exact: true }).fill("A synthetic but engaging hook for the local editor flow.");
    await composer.getByLabel("Self-written news article", { exact: true }).fill("Their earlier single topped the chart, won a Grammy award and featured on their world tour. "
      + Array.from({ length: 1_020 }, (_, index) => `Reported music news word ${index + 1}`).join(" "));
    const newMusic = composer.getByRole("radio", { name: "New music", exact: true });
    const tours = composer.getByRole("radio", { name: "Tours", exact: true });
    const selectedFill = await tours.evaluate(element => getComputedStyle(element).backgroundColor);
    await newMusic.click();
    assert.equal(await newMusic.evaluate(element => getComputedStyle(element).backgroundColor), selectedFill);
    assert.notEqual(await tours.evaluate(element => getComputedStyle(element).backgroundColor), selectedFill);
    for (let index = 1; index <= 3; index += 1) {
      await composer.getByLabel(`Self-written article source ${index} name`, { exact: true }).fill(["NME", "Stereogum", "Pitchfork"][index - 1]);
      await composer.getByLabel(`Self-written article source ${index} URL`, { exact: true }).fill(["https://www.nme.com/news/synthetic", "https://www.stereogum.com/synthetic", "https://pitchfork.com/news/synthetic"][index - 1]);
    }
    await composer.getByRole("button", { name: "Add another article source", exact: true }).click();
    await composer.getByRole("button", { name: "Add another article source", exact: true }).click();
    await composer.getByLabel("Self-written article source 4 name", { exact: true }).fill("Yonhap");
    await composer.getByLabel("Self-written article source 4 URL", { exact: true }).fill("https://en.yna.co.kr/view/synthetic");
    assert.equal(await composer.getByLabel("Self-written article source 5 name", { exact: true }).inputValue(), "", "an empty optional source row is retained without blocking save");
    const choosing = page.waitForEvent("filechooser");
    await composer.getByRole("button", { name: "Choose and upload an article photo", exact: true }).click();
    await (await choosing).setFiles([{ name: "synthetic.png", mimeType: "image/png", buffer: png }]);
    await page.getByRole("button", { name: "Choose and upload an article photo", exact: true }).waitFor();
    await composer.getByLabel("Photo source name", { exact: true }).fill("Synthetic photographer");
    await composer.getByLabel("Photo source URL", { exact: true }).fill("https://example.com/synthetic-photo-rights");
    await composer.getByLabel("Photo credit", { exact: true }).fill("CC0 synthetic fixture");
    const save = composer.getByRole("button", { name: "Save self-written news draft", exact: true });
    await save.dblclick();
    await page.getByRole("alert").waitFor();
    assert.equal(state.saveAttempts, 1, "Duplicate save clicks are fenced while the first request is in flight");
    const originalBody = await composer.getByLabel("Self-written news article", { exact: true }).inputValue();
    await page.goBack();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    assert.equal(await composer.getByLabel("Self-written news article", { exact: true }).inputValue(), originalBody);
    assert.equal(await newMusic.evaluate(element => getComputedStyle(element).backgroundColor), selectedFill);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Leave", exact: true }).click();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Newsroom. Write stories and run live coverage", exact: true }).click();
    await composer.waitFor();
    assert.equal(await composer.getByLabel("Self-written news article", { exact: true }).inputValue(), originalBody);
    assert.equal(await composer.getByLabel("Self-written article source 4 name", { exact: true }).inputValue(), "Yonhap");
    assert.equal(await composer.getByLabel("Self-written article source 5 name", { exact: true }).inputValue(), "");
    assert.equal(await newMusic.evaluate(element => getComputedStyle(element).backgroundColor), selectedFill);
    if (mode === "edited") await composer.getByLabel("Self-written news summary", { exact: true }).fill("A revised hook after an uncertain save response.");
    await save.click();
    await page.getByText("SELF-WRITTEN DRAFT", { exact: true }).waitFor();
    const draft = page.getByTestId("news-draft-self-written-fixture");
    await draft.locator("img").waitFor({ state: "attached" });
    assert.equal(await draft.locator("a").count(), 5);
    assert.equal(await draft.getByRole("link", { name: "Synthetic photographer", exact: true }).getAttribute("href"), "https://example.com/synthetic-photo-rights");
    assert.equal(state.saveAttempts, 2, "The uncertain save is retried once after the duplicate-click fence");
    assert.equal(new Set(state.saveKeys).size, mode === "edited" ? 2 : 1, "Identical retry preserves the key; edited intent rotates it");
    assert.equal(state.creates.length, 1);
    assert.equal(state.finalizes.length, 1);
    assert.equal(state.puts.length, 1);
    await newMusic.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, `composer-${width}-${mode}.png`), fullPage: false, animations: "disabled" });
    await composer.getByLabel("Self-written news summary", { exact: true }).fill("Unsaved local adjustment before testing the close guard.");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    assert.equal(await page.getByTestId("self-written-news-composer").count(), 1, "Back must not discard an unsaved composer without confirmation");
    // The displayed revision must not publish another writer's unseen update.
    state.draft = { ...state.draft, revision: 1, summary: "Another editor's current reviewed hook." };
    const publish = page.getByRole("button", { name: `Publish ${state.draft.headline}`, exact: true });
    await publish.click();
    const refresh = page.getByRole("button", { name: "Refresh latest draft", exact: true });
    await refresh.waitFor();
    assert.equal(await publish.isDisabled(), true);
    assert.equal(state.publications, 0);
    assert.equal(await composer.getByLabel("Self-written news summary", { exact: true }).inputValue(), "Unsaved local adjustment before testing the close guard.");
    await refresh.click();
    await draft.getByText("Another editor's current reviewed hook.", { exact: true }).waitFor();
    await publish.click();
    if (mode === "edited") {
      await refresh.waitFor();
      assert.equal(await publish.isDisabled(), true, "uncertain publishing must reconcile before a second attempt");
      await refresh.click();
    }
    await page.getByText("PUBLISHED", { exact: true }).waitFor();
    assert.deepEqual(state.publishRevisions, [0, 1]);
    assert.equal(state.publications, 1);
    assert.equal(state.draft.category, "release");
    assert.deepEqual(state.reports, []);
    const expectedLostResponseError = "Failed to load resource: the server responded with a status of 503 (Service Unavailable)";
    const expectedConflictError = "Failed to load resource: the server responded with a status of 409 (Conflict)";
    assert.equal(state.errors.filter((message) => message === expectedLostResponseError).length, mode === "edited" ? 2 : 1);
    assert.equal(state.errors.filter((message) => message === expectedConflictError).length, 1);
    assert.deepEqual(state.errors.filter((message) => message !== expectedLostResponseError && message !== expectedConflictError), []);
    console.log(JSON.stringify({ name: `newsroom-composer-${width}-${mode}`, passed: true, saveRetries: state.saveAttempts, distinctKeys: new Set(state.saveKeys).size, retainedAfterNavigation: true, draftPhoto: true, provenanceLinks: 4, wordCount: state.draft.wordCount }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `composer-${width}-failed.png`), fullPage: false }).catch(() => {});
    console.error(JSON.stringify({ name: `newsroom-composer-${width}`, error: error.message, state, body: (await page.locator("body").innerText()).slice(-6000) }));
    throw error;
  } finally {
    state.closing = true;
    await context.close();
  }
}

export async function main() {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
  mkdirSync(shots, { recursive: true });
  const { server, origin } = await localServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    for (const width of [390, 1280]) for (const mode of ["same", "edited"]) await scenario(browser, origin, width, mode);
    console.log(JSON.stringify({ passed: 4, failed: 0, network: "isolated fixtures only", screenshots: shots }));
  } finally { await browser?.close(); await new Promise((done) => server.close(done)); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
