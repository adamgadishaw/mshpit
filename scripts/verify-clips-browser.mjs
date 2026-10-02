#!/usr/bin/env node
// Actual exported App + actual HTTP server. Shipping Clips remains disabled.
// A separately bound scratch export enables only its existing feature gate.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const require = createRequire(import.meta.url);
const timeoutMs = 25_000;
const pause = ms => new Promise(done => setTimeout(done, ms));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fileHash = path => hash(readFileSync(path));
const checks = [];
let stage = "validate-build-binding";
async function check(name, work) { stage = name; await work(); checks.push(name); console.log(JSON.stringify({ check: name, passed: true })); }
const contained = (parent, child) => child.toLowerCase().startsWith(parent.toLowerCase() + sep);

function validateBuild() {
  assert.ok(process.env.PIT_CLIPS_TEST_DIST, "A separately authorized test export is required");
  const testDist = realpathSync(process.env.PIT_CLIPS_TEST_DIST);
  const manifest = JSON.parse(readFileSync(join(testDist, "clips-test-build.json"), "utf8"));
  assert.equal(manifest.version, 1); assert.equal(manifest.testOnly, true);
  assert.equal(realpathSync(manifest.sourceRoot), root);
  const scratch = realpathSync(manifest.scratchRoot);
  assert.notEqual(scratch.toLowerCase(), root.toLowerCase());
  assert.ok(basename(scratch).startsWith("pit-clips-test-"));
  assert.equal(dirname(scratch).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
  assert.equal(testDist, realpathSync(join(scratch, "dist")));
  const override = { path: "src/config/runtime.mjs", from: "export const ENABLE_CLIPS = false;", to: "export const ENABLE_CLIPS = true;" };
  assert.deepEqual(manifest.override, override);
  const original = readFileSync(join(root, override.path), "utf8");
  assert.equal(original.split(override.from).length, 2);
  const changedHash = hash(original.replace(override.from, override.to));
  assert.equal(manifest.overriddenRuntimeSha256, changedHash);
  assert.ok(manifest.sourceHashes && Object.keys(manifest.sourceHashes).length > 10);
  function verifyCoverage(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (prefix === "server" && entry.name === "data") continue;
      assert.equal(entry.isSymbolicLink(), false);
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) verifyCoverage(join(directory, entry.name), path);
      else assert.ok(Object.hasOwn(manifest.sourceHashes, path), "Manifest must cover the complete source tree");
    }
  }
  verifyCoverage(join(root, "src"), "src"); verifyCoverage(join(root, "server"), "server");
  for (const directory of ["assets", "public"]) {
    if (existsSync(join(root, directory))) verifyCoverage(join(root, directory), directory);
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:js|jsx|mjs|cjs|json|ts)$/.test(entry.name)) {
      assert.ok(Object.hasOwn(manifest.sourceHashes, entry.name), "Manifest must cover top-level build configuration");
    }
  }
  for (const path of ["App.js", "package.json", "package-lock.json"]) assert.ok(Object.hasOwn(manifest.sourceHashes, path));
  for (const [path, digest] of Object.entries(manifest.sourceHashes)) {
    assert.ok(path && !path.includes("\\") && !path.split("/").some(part => !part || part === "." || part === ".."));
    assert.match(digest, /^[a-f0-9]{64}$/);
    const source = realpathSync(join(root, path)), copy = realpathSync(join(scratch, path));
    assert.ok(contained(root, source) && contained(scratch, copy));
    assert.equal(fileHash(source), digest, "Original source changed after fixture export");
    assert.equal(fileHash(copy), path === override.path ? changedHash : digest, "Scratch may change only the Clips flag");
  }
  assert.equal(fileHash(join(testDist, "index.html")), manifest.distIndexSha256);
  assert.ok(manifest.distHashes && Object.keys(manifest.distHashes).length > 1);
  const artifacts = [];
  function verifyArtifacts(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (path === "clips-test-build.json") continue;
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) verifyArtifacts(join(directory, entry.name), path + "/");
      else {
        assert.ok(entry.isFile()); assert.match(manifest.distHashes[path] || "", /^[a-f0-9]{64}$/);
        assert.equal(fileHash(join(directory, entry.name)), manifest.distHashes[path], "Export artifact changed after build binding");
        artifacts.push(path);
      }
    }
  }
  verifyArtifacts(testDist);
  assert.equal(artifacts.length, Object.keys(manifest.distHashes).length);
  assert.equal(manifest.distHashes["index.html"], manifest.distIndexSha256);
  assert.ok(artifacts.some(path => path.endsWith(".js")));
  readFileSync(join(root, "dist/index.html"));
  console.log(JSON.stringify({ buildBinding: "all declared source hashes verified; complete src/server coverage",
    shippingClipsEnabled: false, scratchClipsEnabled: true, copiedFiles: Object.keys(manifest.sourceHashes).length,
    shippingIndexSha256: fileHash(join(root, "dist/index.html")), testIndexSha256: manifest.distIndexSha256,
    testArtifacts: artifacts.length, testJavaScriptFiles: artifacts.filter(path => path.endsWith(".js")).length,
    testBuildManifestSha256: fileHash(join(testDist, "clips-test-build.json")) }));
  return { scratch, sourceGateHash: fileHash(join(root, override.path)) };
}

async function startServer(serverRoot) {
  const socket = createServer();
  await new Promise((done, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", done); });
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const temporaryParent = realpathSync(tmpdir());
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "pit-clips-browser-")));
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { NODE_ENV: "test", PIT_ENV: "production", RENDER: "true", PORT: String(port), PUBLIC_ORIGIN: origin,
    TEMP: directory, TMP: directory, PIT_DATA_DIR: directory, PIT_CLIPS_TEMP_PARENT: temporaryParent,
    PIT_CLIPS_SERVER_ROOT: serverRoot, PIT_CLIPS_BROWSER_FIXTURE: "1", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true",
    ADMIN_PASSWORD: "Synthetic-clips-owner-password1", ADMIN_EMAIL: "owner@example.test", EMAIL_VERIFICATION_ENABLED: "true",
    EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", BACKUP_ENABLED: "false", TOURDATE_REFRESH_ENABLED: "false",
    TOURDATE_DEMAND_REFRESH_ENABLED: "false", ARTIST_GENRE_REFRESH_ENABLED: "false", ARTIST_PHOTO_SEED_ENABLED: "false",
    ARTIST_DEATH_WATCH_SCHEDULER_ENABLED: "false", CACHE_WARM_ENABLED: "false" });
  const child = fork(join(serverRoot, "server/index.js"), [], { cwd: serverRoot, env,
    execArgv: ["--import", pathToFileURL(join(root, "scripts/fixtures/clips-browser-server-preload.mjs")).href],
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let fixture, bound, exited = false, spawnFailed = false, nextId = 0, outputBytes = 0, preloadLine = null;
  const counters = { outboundBlocked: 0, helpersBlocked: 0, held: 0, aborted: 0 };
  const replies = new Map(), errorClasses = new Set();
  const closed = new Promise(done => child.once("exit", () => { exited = true; done(); }));
  child.on("error", () => { spawnFailed = true; });
  const observe = chunk => {
    outputBytes += chunk.length;
    preloadLine ||= Number(String(chunk).match(/clips-browser-server-preload\.mjs:(\d+):/)?.[1]) || null;
    for (const value of String(chunk).match(/\b(?:AssertionError|TypeError|ReferenceError|SyntaxError|SQLITE_[A-Z_]+)\b/g) || []) errorClasses.add(value);
  };
  child.stdout.on("data", observe); child.stderr.on("data", observe);
  child.on("message", message => {
    if (message?.kind === "fixture") fixture = message;
    if (message?.kind === "listener-bound") bound = message.address;
    if (message?.kind === "outbound-blocked") counters.outboundBlocked++;
    if (message?.kind === "helper-blocked") counters.helpersBlocked++;
    if (message?.kind === "clips-response-held") counters.held++;
    if (message?.kind === "clips-response-aborted") counters.aborted++;
    if (message?.kind === "reply") {
      const pending = replies.get(message.id);
      if (pending) { replies.delete(message.id); clearTimeout(pending.timer);
        message.failed ? pending.reject(new Error("Private fixture command failed")) : pending.resolve(message.value); }
    }
  });
  async function until(predicate, label) {
    const deadline = Date.now() + timeoutMs;
    while (!await predicate()) {
      assert.ok(!exited && !spawnFailed, "Owned server stopped");
      if (Date.now() >= deadline) console.log(JSON.stringify({ fixtureWaitTimeout: label }));
      assert.ok(Date.now() < deadline, label); await pause(25);
    }
  }
  const command = action => new Promise((resolveReply, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { replies.delete(id); reject(new Error("Fixture command timeout")); }, timeoutMs);
    replies.set(id, { resolve: resolveReply, reject, timer }); child.send({ kind: "command", id, action });
  });
  async function request(path, { member = fixture?.members[0], method = "GET", body } = {}) {
    assert.ok(path.startsWith("/") && !path.startsWith("//")); await pause(100);
    const response = await fetch(origin + path, { method, redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: {
      ...(member ? { Cookie: member.cookie, "X-Pit-Expected-Account": member.id } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, data: text && response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : null,
      text, headers: response.headers };
  }
  async function stop() {
    for (const pending of replies.values()) clearTimeout(pending.timer);
    if (!exited && child.pid) {
      child.kill("SIGTERM"); await Promise.race([closed, pause(5000)]);
      if (!exited) { child.kill("SIGKILL"); await Promise.race([closed, pause(5000)]); }
    }
    assert.ok(exited || !child.pid, "Preserving temp directory because owned process remains active");
    assert.equal(realpathSync(directory), directory); assert.equal(dirname(directory).toLowerCase(), temporaryParent.toLowerCase());
    assert.ok(basename(directory).startsWith("pit-clips-browser-"));
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    console.log(JSON.stringify({ server: serverRoot === root ? "shipping" : "scratch-gate-enabled", ...counters,
      fixtureReady: Boolean(fixture), loopbackBound: bound === "127.0.0.1", discardedOutputBytes: outputBytes,
      errorClasses: [...errorClasses], preloadLine, cleanedUp: true }));
  }
  try {
    await until(() => fixture && bound, "Fixture startup timeout"); assert.equal(bound, "127.0.0.1");
    assert.equal((await request("/api/health")).status, 200);
    return { origin, fixture, counters, until, command, request, stop };
  } catch (error) { await stop(); throw error; }
}

async function syntheticVideo(browser) {
  const page = await browser.newPage();
  try {
    const encoded = await page.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
      const paint = canvas.getContext("2d"), stream = canvas.captureStream(12);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" }), chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise(done => { recorder.onstop = done; });
      let frame = 0;
      const draw = () => { paint.fillStyle = frame++ % 2 ? "#ff963b" : "#132c51"; paint.fillRect(0, 0, 320, 180);
        paint.fillStyle = "white"; paint.font = "20px sans-serif"; paint.fillText("SYNTHETIC CLIP", 60, 90); };
      draw(); const timer = setInterval(draw, 80); recorder.start(100);
      await new Promise(done => setTimeout(done, 2000)); recorder.stop(); await stopped;
      clearInterval(timer); stream.getTracks().forEach(track => track.stop());
      const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
      let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary);
    });
    const video = Buffer.from(encoded, "base64"); assert.ok(video.length > 1000); return video;
  } finally { await page.close(); }
}
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=", "base64");
async function browserContext(browser, server, video, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: "block" });
  const state = { errors: 0, mediaRequests: 0, clips: [], failedClips: 0, blockedExternal: 0, reports: 0 };
  const cookie = server.fixture.members[0].cookie;
  await context.addCookies([{ name: server.fixture.cookieName, value: cookie.slice(cookie.indexOf("=") + 1), url: server.origin,
    httpOnly: true, sameSite: "Lax", secure: false }]);
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === server.fixture.mediaOrigin && /^\/clip_\d{3}\.(webm|png)$/.test(url.pathname)) {
      state.mediaRequests++;
      return route.fulfill({ status: 200, contentType: url.pathname.endsWith(".webm") ? "video/webm" : "image/png",
        headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }, body: url.pathname.endsWith(".webm") ? video : pixel });
    }
    if (url.origin !== server.origin) { state.blockedExternal++; return route.abort(); }
    if (url.pathname === "/api/client-errors") state.reports++;
    return route.continue(); // Every API and static response comes from the actual server.
  });
  const page = await context.newPage(); page.setDefaultTimeout(timeoutMs);
  page.on("pageerror", () => { state.errors++; });
  page.on("requestfailed", req => { if (new URL(req.url()).pathname === "/api/clips") state.failedClips++; });
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.pathname !== "/api/clips") return;
    const record = { status: response.status(), continuation: url.searchParams.has("before"), body: null, settled: false };
    state.clips.push(record);
    response.json().then(body => { record.body = body; record.settled = true; }, () => { record.settled = true; });
  });
  const feed = () => page.getByText("Your life's musical journey", { exact: true }).waitFor();
  await page.goto(server.origin, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Open your feed", exact: true }).click(); await feed();
  return { context, page, state, feed };
}
async function legacyPages(server) {
  const ids = [], cursors = new Set(); let before;
  for (let page = 0; page < 5; page++) {
    const response = await server.request("/api/clips?limit=12" + (before ? "&before=" + encodeURIComponent(before) : ""));
    assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
    const { clips, nextCursor } = response.data; // Deliberately only the older-client contract.
    assert.ok(Array.isArray(clips)); assert.ok(nextCursor === null || typeof nextCursor === "string");
    assert.ok(clips.length <= 12); if (nextCursor) assert.equal(clips.length, 12);
    for (const clip of clips) { assert.ok(clip.clips.length > 0); ids.push(clip.id); }
    if (!nextCursor) { assert.equal(new Set(ids).size, ids.length); return ids; }
    assert.ok(!cursors.has(nextCursor)); cursors.add(nextCursor); before = nextCursor;
  }
  assert.fail("Bounded synthetic pagination did not terminate");
}
async function openClips(ui) {
  await ui.page.getByRole("button", { name: "Clips", exact: true }).first().click();
  await ui.page.getByRole("button", { name: "Back to feed", exact: true }).waitFor();
}
async function decoded(ui) {
  await ui.page.waitForFunction(() => [...(document.querySelector('[data-pit-reel="1"]')?.querySelectorAll("video") || [])].some(video =>
    video.readyState >= 2 && video.videoWidth === 320 && video.currentTime > 0));
}
async function reelDiagnostic(ui, label) {
  const geometry = await ui.page.evaluate(() => {
    const reel = document.querySelector('[data-pit-reel="1"]');
    if (!reel) return { mounted: false };
    return { mounted: true, scrollTop: reel.scrollTop, scrollHeight: reel.scrollHeight, clientHeight: reel.clientHeight,
      overflowY: getComputedStyle(reel).overflowY, scrollSnapType: getComputedStyle(reel).scrollSnapType,
      videos: [...reel.querySelectorAll("video")].slice(0, 3).map(video => ({ readyState: video.readyState,
        networkState: video.networkState, width: video.videoWidth, paused: video.paused, time: Math.round(video.currentTime * 10) / 10,
        mediaError: video.error?.code || null })) };
  });
  console.log(JSON.stringify({ reelDiagnostic: label, geometry, errors: ui.state.errors, reports: ui.state.reports,
    failedClips: ui.state.failedClips, mediaRequests: ui.state.mediaRequests,
    responses: ui.state.clips.slice(-8).map(record => ({ status: record.status, continuation: record.continuation,
      settled: record.settled, clips: record.body?.clips?.length ?? null, hasCursor: Boolean(record.body?.nextCursor) })) }));
}
async function scrollToLoadedEnd(ui, minimumPages = 12) {
  const reel = ui.page.locator('[data-pit-reel="1"]'); await reel.waitFor();
  await ui.page.waitForFunction(count => {
    const element = document.querySelector('[data-pit-reel="1"]');
    return element && element.clientHeight > 0 && element.scrollHeight >= element.clientHeight * (count - 0.5);
  }, minimumPages);
  // ScrollView replaces the DOM scrollTo method with its x/y ref API. Exercise
  // the existing keyboard handler one clip at a time so snap/virtualization
  // sees the same adjacent pages as ordinary browsing.
  await ui.page.evaluate(() => document.activeElement?.blur());
  const initialIndex = await reel.evaluate(element => Math.round(element.scrollTop / element.clientHeight));
  for (let targetIndex = initialIndex + 1; targetIndex < minimumPages; targetIndex++) {
    await ui.page.keyboard.press("ArrowDown");
    await ui.page.waitForFunction(target => {
      const element = document.querySelector('[data-pit-reel="1"]');
      return element && Math.abs(element.scrollTop / element.clientHeight - target) < 0.05;
    }, targetIndex);
    await pause(100);
  }
}

async function main() {
  const binding = validateBuild();
  const chromium = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright").chromium;
  const browser = await chromium.launch({ executablePath: process.env.PIT_BROWSER_EXECUTABLE || undefined, headless: true,
    args: ["--disable-background-networking", "--disable-component-update", "--disable-dev-shm-usage"] });
  let server;
  try {
    const video = await syntheticVideo(browser);
    stage = "shipping-startup"; server = await startServer(root);
    await check("shipping-export-keeps-clips-disabled-and-navigation-working", async () => {
      for (const width of [1280, 390]) {
        const ui = await browserContext(browser, server, video, width);
        try {
          assert.equal(await ui.page.getByRole("button", { name: "Clips", exact: true }).count(), 0);
          await ui.page.getByRole("tab", { name: "You", exact: true }).click();
          await ui.page.getByText("Synthetic clipsviewer", { exact: true }).first().waitFor();
          await ui.page.reload({ waitUntil: "domcontentloaded" });
          await ui.page.getByText("Synthetic clipsviewer", { exact: true }).first().waitFor();
          assert.equal(await ui.page.getByRole("button", { name: "Clips", exact: true }).count(), 0);
          assert.equal(ui.state.clips.length, 0); assert.equal(ui.state.errors, 0);
          assert.equal((await server.request("/api/me")).data.user.id, server.fixture.members[0].id);
        } finally { await ui.context.close(); }
      }
    });
    await check("shipping-real-api-preserves-older-client-pages-and-sparse-eligibility", async () => {
      assert.deepEqual(await legacyPages(server), server.fixture.expected);
    });
    await server.stop(); server = null;
    stage = "scratch-startup"; server = await startServer(binding.scratch);
    await check("scratch-existing-clips-screen-pages-and-decodes-synthetic-video", async () => {
      const ui = await browserContext(browser, server, video, 1280);
      try {
        await openClips(ui); await decoded(ui);
        await server.until(() => ui.state.clips.filter(record => record.body).length >= 1, "Initial real clips response missing");
        for (const count of [2, 3]) {
          await scrollToLoadedEnd(ui, (count - 1) * 12);
          await reelDiagnostic(ui, `after-scroll-for-page-${count}`);
          await server.until(() => ui.state.clips.filter(record => record.body).length >= count, "Successive real clips page missing");
        }
        const responses = ui.state.clips.filter(record => record.body);
        assert.deepEqual(responses.map(record => record.body.clips.length), [12, 12, 2]);
        assert.deepEqual(responses.flatMap(record => record.body.clips.map(clip => clip.id)), server.fixture.expected);
        assert.equal(responses.at(-1).body.nextCursor, null);
        await scrollToLoadedEnd(ui, 26); await pause(300);
        assert.equal(ui.state.clips.length, 3, "Terminal page must stop pagination");
        await decoded(ui);
        const activeVideo = ui.page.locator('[data-pit-reel="1"] video:visible');
        assert.ok(await activeVideo.count() <= 2, "The existing reel must not mount every video");
        await ui.page.getByRole("button", { name: "Back to feed", exact: true }).click(); await ui.feed();
        assert.equal(await ui.page.locator('[data-pit-reel="1"]').count(), 0);
        await openClips(ui); await decoded(ui);
        assert.equal(ui.state.errors, 0); assert.equal(ui.state.reports, 0); assert.ok(ui.state.mediaRequests > 0);
        console.log(JSON.stringify({ scratchScreen: true, pages: [12, 12, 2], decodedVideo: true, shippingGateChanged: false }));
      } catch (error) { await reelDiagnostic(ui, "pagination-failure"); throw error; }
      finally { await ui.context.close(); }
    });
    await check("real-api-privacy-block-and-media-changes-revalidate", async () => {
      const owner = server.fixture.members[1], viewer = server.fixture.members[0];
      const target = "clip_000";
      const ui = await browserContext(browser, server, video, 1280);
      const verifyScreenHead = async expectedIds => {
        const before = ui.state.clips.length; await openClips(ui);
        await server.until(() => ui.state.clips.slice(before).some(record => record.body), "Fresh screen projection missing");
        const latest = ui.state.clips.slice(before).find(record => record.body);
        assert.equal(latest.status, 200); assert.deepEqual(latest.body.clips.map(clip => clip.id), expectedIds.slice(0, 12));
        await ui.page.getByRole("button", { name: "Back to feed", exact: true }).click(); await ui.feed();
      };
      try {
      assert.equal((await server.request(`/api/posts/${target}`, { member: owner, method: "PATCH", body: { photosPublic: false } })).status, 200);
      assert.deepEqual(await legacyPages(server), server.fixture.expected.filter(id => id !== target));
      await verifyScreenHead(server.fixture.expected.filter(id => id !== target));
      assert.equal((await server.request(`/api/posts/${target}`, { member: owner, method: "PATCH", body: { photosPublic: true } })).status, 200);
      await server.command("media-unavailable");
      assert.deepEqual(await legacyPages(server), server.fixture.expected.filter(id => id !== "clip_002"));
      await verifyScreenHead(server.fixture.expected.filter(id => id !== "clip_002"));
      await server.command("media-ready");
      assert.deepEqual(await legacyPages(server), server.fixture.expected);
      await verifyScreenHead(server.fixture.expected);
      assert.equal((await server.request(`/api/users/${owner.id}/block`, { member: viewer, method: "POST", body: { blocked: true } })).status, 200);
      assert.deepEqual(await legacyPages(server), []);
      assert.equal((await server.request(`/api/users/${owner.id}/block`, { member: viewer, method: "POST", body: { blocked: false } })).status, 200);
      assert.deepEqual(await legacyPages(server), server.fixture.expected);
      assert.equal(ui.state.errors, 0); assert.equal(ui.state.reports, 0);
      } finally { await ui.context.close(); }
    });
    await check("scratch-mobile-navigation-cancels-pending-real-clips-response", async () => {
      const ui = await browserContext(browser, server, video, 390);
      try {
        const heldBefore = server.counters.held, abortedBefore = server.counters.aborted;
        await server.command("hold-next-clips"); await openClips(ui);
        await server.until(() => server.counters.held > heldBefore, "Actual response did not reach private barrier");
        await ui.page.getByRole("button", { name: "Back to feed", exact: true }).click(); await ui.feed();
        await server.until(() => server.counters.aborted > abortedBefore, "Existing screen did not abort pending request");
        await server.command("release-clips");
        assert.equal(await ui.page.locator('[data-pit-reel="1"]').count(), 0);
        await openClips(ui); await decoded(ui);
        await server.until(() => ui.state.clips.some(record => record.body?.clips?.length === 12), "Reopened reel did not reload");
        const heldMoreBefore = server.counters.held, abortedMoreBefore = server.counters.aborted;
        await server.command("hold-next-clips"); await scrollToLoadedEnd(ui);
        await server.until(() => server.counters.held > heldMoreBefore, "Load-more response did not reach private barrier");
        await ui.page.getByRole("button", { name: "Back to feed", exact: true }).click(); await ui.feed();
        await server.until(() => server.counters.aborted > abortedMoreBefore, "Existing load-more controller did not abort");
        await server.command("release-clips"); await openClips(ui); await decoded(ui);
        assert.ok(ui.state.failedClips >= 1); assert.equal(ui.state.errors, 0); assert.equal(ui.state.reports, 0);
      } finally { await server.command("release-clips"); await ui.context.close(); }
    });
    await check("scratch-existing-retry-recovers-real-transport-interruption", async () => {
      const ui = await browserContext(browser, server, video, 1280);
      try {
        await openClips(ui); await decoded(ui);
        const heldBefore = server.counters.held;
        await server.command("hold-next-clips"); await scrollToLoadedEnd(ui);
        await server.until(() => server.counters.held > heldBefore, "Continuation response did not reach barrier");
        assert.ok(await ui.page.locator('[data-pit-reel="1"]').evaluate(element => new Promise(resolve => {
          const started = performance.now(); let lastOffset = element.scrollTop, stableSince = started;
          const sample = () => {
            const now = performance.now();
            if (element.scrollTop !== lastOffset) { lastOffset = element.scrollTop; stableSince = now; }
            if (now - stableSince >= 200) return resolve(true);
            if (now - started >= 3000) return resolve(false);
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        })), "Reel must settle before transport interruption");
        await server.command("disconnect-clips");
        await ui.page.getByRole("button", { name: "Retry loading more clips", exact: true }).waitFor();
        const completedBefore = ui.state.clips.filter(record => record.body).length;
        await ui.page.getByRole("button", { name: "Retry loading more clips", exact: true }).click();
        await server.until(() => ui.state.clips.filter(record => record.body).length > completedBefore, "Existing retry did not receive a real page");
        const completed = ui.state.clips.filter(record => record.body);
        assert.deepEqual(completed.flatMap(record => record.body.clips.map(clip => clip.id)), server.fixture.expected.slice(0, 24));
        assert.equal(ui.state.errors, 0); assert.ok(ui.state.failedClips >= 1);
      } catch (error) {
        await reelDiagnostic(ui, "transport-retry-failure");
        const snapshot = await server.command("inspect");
        console.log(JSON.stringify({ transportDiagnostic: { clipRequests: snapshot.clipRequests, held: snapshot.held,
          abortedHeld: snapshot.abortedHeld, retryButtonCount: await ui.page.getByRole("button", { name: "Retry loading more clips", exact: true }).count() } }));
        throw error;
      } finally { await server.command("release-clips"); await ui.context.close(); }
    });
    await check("fixture-integrity-and-account-scope-survive", async () => {
      const snapshot = await server.command("inspect");
      assert.equal(snapshot.integrity, "ok"); assert.equal(snapshot.foreignKeyViolations, 0); assert.equal(snapshot.held, false);
      assert.equal((await server.request("/api/me")).data.user.id, server.fixture.members[0].id);
      assert.equal((await server.request("/api/health")).status, 200);
      assert.equal(fileHash(join(root, "src/config/runtime.mjs")), binding.sourceGateHash);
    });
  } finally {
    try { await browser.close(); }
    finally { if (server) await server.stop(); }
  }
  console.log(JSON.stringify({ passed: checks.length, shippingClipsEnabled: false,
    testOverride: "scratch-only ENABLE_CLIPS=true; unchanged App/store/ClipsScreen; actual server APIs",
    limitation: "Synthetic local correctness and compatibility checks, not production capacity or shipping feature activation." }));
}
try { await main(); }
catch (error) {
  console.error(JSON.stringify({ passed: checks.length, failedStage: stage,
    errorClass: error?.name === "AssertionError" ? "AssertionError" : "HarnessError",
    harnessLine: Number(String(error?.stack || "").match(/verify-clips-browser\.mjs:(\d+):/)?.[1]) || null }));
  process.exitCode = 1;
}
