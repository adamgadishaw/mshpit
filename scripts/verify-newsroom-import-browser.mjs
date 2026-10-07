// Exported app, real parsing worker, synthetic documents/media, loopback only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, statSync, mkdirSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { fixtureApiResponse } from "./verify-navigation-browser.mjs";
import { newsEditorFixture, upkeepAdmin } from "./verify-catalog-maintenance-browser.mjs";
import { textPdf } from "./newsroomImportFixtures.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "newsroom-import-browser");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
const mov = Buffer.from("0000001466747970717420200000000071742020", "hex");
const article = { id: "fixture", headline: "Fixture band announces a new tour", summary: "The official announcement confirms a new run of tour dates.",
  body: "Synthetic fixture reporting. This is never sent to production.", category: "tour",
  sources: [{ kind: "article", name: "Fixture Band", url: "https://artist.example.com/tour" }],
  photo: { file: "cover.png", name: "Fixture Photographer", url: "https://example.com/photo-rights" },
  video: { file: "clip.mov", name: "Fixture Filmmaker", url: "https://example.com/video-rights" } };
const pack = Buffer.from(zipSync({ "manifest.json": strToU8(JSON.stringify({ format: "mshpit-newsroom", version: 1, articles: [article] })), "cover.png": png, "clip.mov": mov }));
async function localServer() {
  const directory = join(root, "dist"), html = join(directory, "index.html");
  assert.ok(statSync(html).isFile());
  const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url.startsWith("/api/")) return void response.writeHead(405).end();
    let file;
    try { file = resolve(directory, `.${decodeURIComponent(new URL(request.url, "http://fixture.invalid").pathname)}`); }
    catch { return void response.writeHead(400).end(); }
    if (!file.startsWith(directory + sep)) return void response.writeHead(400).end();
    try { if (!statSync(file).isFile()) file = html; } catch { file = html; }
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }); response.end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
async function syntheticVideo(browser) {
  const page = await browser.newPage();
  try {
    return Buffer.from(await page.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
      const paint = canvas.getContext("2d"), stream = canvas.captureStream(12), chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise((done) => { recorder.onstop = done; });
      const timer = setInterval(() => { paint.fillStyle = "#ef9634"; paint.fillRect(0, 0, 160, 90); }, 80);
      recorder.start(100); await new Promise((done) => setTimeout(done, 1200)); recorder.stop(); await stopped;
      clearInterval(timer); stream.getTracks().forEach((track) => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    }));
  } finally { await page.close(); }
}
async function scenario(browser, origin, width, clip) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  const state = { user: upkeepAdmin, creates: [], puts: [], finalizes: [], publishes: 0, saves: 0, imageReady: false, videoReady: false, errors: [], drafts: [] };
  await context.addInitScript((user) => { if (!localStorage.getItem("pit.session")) { localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user])); } }, upkeepAdmin);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("dialog", (dialog) => { void (dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss()); });
  page.on("pageerror", (error) => state.errors.push(error.message));
  const ready = (kind) => ({ id: `ma_import_${kind}`, kind, status: "ready", url: `https://media.example.test/${kind === "video" ? "clip.webm" : "photo.png"}`,
    ...(kind === "video" ? { posterUrl: "https://media.example.test/poster.png", durationMs: 1200 } : {}), width: 160, height: 90 });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    const json = (body) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.origin === "https://media.example.test") return route.fulfill({ contentType: url.pathname.endsWith("webm") ? "video/webm" : "image/png", body: url.pathname.endsWith("webm") ? clip : png });
    if (url.origin !== origin) { state.errors.push("Unexpected network destination"); return route.abort(); }
    if (url.pathname.startsWith("/fixture-put/")) { state.puts.push(url.pathname); return route.fulfill({ status: 200, body: "" }); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/me") return json({ user: state.user });
    if (url.pathname === "/api/moderation/news-desk/editor") return json(newsEditorFixture(state.drafts));
    if (url.pathname === "/api/media/assets") {
      assert.equal(request.headers()["x-pit-expected-account"], state.user.id);
      const body = request.postDataJSON(), kind = body.contentType.startsWith("video/") ? "video" : "image";
      state.creates.push(kind);
      return json({ asset: { id: `ma_import_${kind}`, kind, status: "upload_pending" }, upload: { method: "PUT", storageScope: "private",
        storageLocator: `pit-private:users/${state.user.id}/post/${kind}`, uploadUrl: `${origin}/fixture-put/${kind}`, requiredHeaders: { "Content-Type": body.contentType, "If-None-Match": "*" } } });
    }
    if (url.pathname.startsWith("/api/media/assets/ma_import_")) {
      assert.equal(request.headers()["x-pit-expected-account"], state.user.id);
      const kind = url.pathname.includes("video") ? "video" : "image";
      if (request.method() === "POST") state.finalizes.push(kind);
      return json(!state[`${kind}Ready`] ? { asset: { id: `ma_import_${kind}`, kind, status: "upload_pending" }, finalize: { state: "processing" } }
        : { asset: ready(kind), finalize: { state: "completed" } });
    }
    if (url.pathname.endsWith("/publish")) { state.publishes++; return json({}); }
    if (url.pathname.endsWith("/drafts/self-written")) {
      state.saves++;
      const body = request.postDataJSON();
      const draft = { ...body, id: "import-fixture-draft", status: "draft", origin: "self_written", expired: false,
        photo: { assetId: body.photo.assetId, ...ready("image"), source: body.photo }, video: { assetId: body.video.assetId, ...ready("video"), source: body.video },
        sources: [...body.sources, { ...body.photo, kind: "photo" }, { ...body.video, kind: "video" }], createdAt: Date.now(), costUsd: 0 };
      state.drafts = [draft]; return json({ draft });
    }
    return json(fixtureApiResponse(url.pathname, { member: true, method: request.method(), resolvedPath: url.searchParams.get("path") || undefined }));
  });
  const open = async () => {
    await page.goto(origin + "/feed", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Newsroom. Write stories and run live coverage", exact: true }).click();
    await page.getByTestId("self-written-news-composer").waitFor();
  };
  try {
    await open();
    const composer = page.getByTestId("self-written-news-composer"), field = composer.getByLabel("Self-written news article", { exact: true });
    await field.fill("Keep my original unsaved reporting.");
    const pick = composer.locator('input[type="file"][aria-label="Choose article files"]');
    await pick.setInputFiles({ name: "bad.zip", mimeType: "application/zip", buffer: Buffer.from("not a zip") });
    await composer.getByRole("alert").waitFor(); assert.equal(await field.inputValue(), "Keep my original unsaved reporting.");
    await pick.setInputFiles({ name: "article.pdf", mimeType: "application/pdf", buffer: Buffer.from(textPdf("Synthetic PDF reporting stays unpublished.")) });
    await composer.getByTestId("newsroom-import-preview").waitFor();
    assert.match(await composer.getByTestId("newsroom-import-preview").innerText(), /Synthetic PDF reporting/u);
    await composer.getByRole("button", { name: "Close import preview", exact: true }).click();
    await pick.setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(textPdf("")) });
    await composer.getByRole("alert").waitFor();
    assert.match(await composer.getByRole("alert").innerText(), /text|scan/iu);
    assert.equal(await field.inputValue(), "Keep my original unsaved reporting.");
    await pick.setInputFiles({ name: "article.zip", mimeType: "application/zip", buffer: pack });
    await composer.getByTestId("newsroom-import-preview").waitFor();
    assert.equal(state.creates.length, 0); assert.equal(state.saves, 0); assert.equal(state.publishes, 0);
    await composer.getByRole("button", { name: "Use this article", exact: true }).click();
    await composer.getByRole("button", { name: "Keep my current draft", exact: true }).click();
    assert.equal(await field.inputValue(), "Keep my original unsaved reporting.");
    await composer.getByRole("button", { name: "Use this article", exact: true }).click();
    const photoFinalizing = page.waitForResponse((response) => response.url().endsWith("/ma_import_image/finalize"));
    await composer.getByRole("button", { name: "Replace unsaved work", exact: true }).dblclick();
    await photoFinalizing;
    await composer.getByRole("button", { name: "Pause upload", exact: true }).click();
    await composer.getByRole("button", { name: "Retry video verification", exact: true }).click({ trial: true });
    assert.deepEqual(state.creates, ["image"]);
    const retained = await page.evaluate((id) => JSON.parse(localStorage.getItem(`pit.newsroom.draft.v1.${encodeURIComponent(id)}`)), state.user.id);
    assert.deepEqual(retained.form.video, { pending: true }, "queued video must survive before its upload starts");
    state.imageReady = true;
    await open();
    await composer.getByRole("button", { name: "Choose video", exact: true }).click({ trial: true });
    assert.equal(await composer.getByRole("button", { name: "Retry video verification", exact: true }).count(), 0);
    await composer.getByText("Choose the original file again to finish this upload. Your article text is kept.", { exact: true }).waitFor();
    assert.equal(await composer.getByRole("button", { name: "Save self-written news draft", exact: true }).isDisabled(), true);
    assert.equal(await field.inputValue(), article.body);
    await pick.setInputFiles({ name: "clip.mov", mimeType: "video/quicktime", buffer: mov });
    await composer.getByTestId("newsroom-import-preview").waitFor();
    await composer.getByRole("button", { name: "Use this media", exact: true }).click();
    const finalizing = page.waitForResponse((response) => response.url().endsWith("/ma_import_video/finalize"));
    await composer.getByRole("button", { name: "Replace unsaved work", exact: true }).click();
    await finalizing;
    await composer.getByRole("button", { name: "Pause upload", exact: true }).click();
    assert.equal(await field.inputValue(), article.body);
    assert.deepEqual(state.creates, ["image", "video"]); assert.equal(state.puts.length, 2);
    assert.equal(state.saves, 0); assert.equal(state.publishes, 0);
    state.videoReady = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    if (!await composer.count()) await open();
    const save = composer.getByRole("button", { name: "Save self-written news draft", exact: true });
    await save.click({ trial: true });
    assert.equal(await field.inputValue(), article.body); assert.equal(state.creates.length, 2); assert.equal(state.puts.length, 2);
    await composer.locator("video").waitFor({ state: "attached" });
    await save.dblclick();
    await page.getByTestId("news-draft-import-fixture-draft").waitFor();
    assert.equal(state.saves, 1); assert.equal(state.publishes, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: join(shots, `import-${width}.png`) });
    // A different account cannot restore this editor's retained article/media.
    state.user = { ...upkeepAdmin, id: "different-import-editor" };
    await page.evaluate((user) => { localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user])); }, state.user);
    await open(); assert.equal(await field.inputValue(), "");
    assert.equal(state.publishes, 0); assert.deepEqual(state.errors, []);
    console.log(JSON.stringify({ width, passed: true, noAutomaticPublish: true, mediaCreates: state.creates.length, saves: state.saves }));
  } finally { await context.close(); }
}
export async function main() {
  const { chromium } = createRequire(import.meta.url)(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
  mkdirSync(shots, { recursive: true }); const { server, origin } = await localServer(); let browser;
  try {
    browser = await chromium.launch({ headless: true }); const clip = await syntheticVideo(browser);
    for (const width of [390, 1280]) await scenario(browser, origin, width, clip);
  } finally { await browser?.close(); await new Promise((done) => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch((error) => { console.error(error); process.exitCode = 1; });
