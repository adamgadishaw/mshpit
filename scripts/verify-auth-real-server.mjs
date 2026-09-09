#!/usr/bin/env node
// Actual server/index.js + exported app + real HttpOnly cookies. All accounts
// and sessions live in a fresh temporary DB. No production/provider requests.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const chromium = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright").chromium;
const timeoutMs = 20_000;
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function availablePort() {
  const reservation = createServer();
  await new Promise((done, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", done); });
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  return port;
}
async function waitUntil(check, label) {
  const deadline = Date.now() + timeoutMs;
  while (!await check()) { assert.ok(Date.now() < deadline, label); await sleep(50); }
}
const percentile = (values, quantile) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * quantile))];

async function main() {
  const port = await availablePort(), origin = `http://127.0.0.1:${port}`;
  const directory = mkdtempSync(join(tmpdir(), "pit-auth-real-browser-"));
  const environment = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"]
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(environment, { NODE_ENV: "test", PORT: String(port), PUBLIC_ORIGIN: origin,
    PIT_DATA_DIR: directory, PIT_AUTH_BROWSER_FIXTURE: "1", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true",
    ADMIN_PASSWORD: "Synthetic-owner-password-for-local-test1", ADMIN_EMAIL: "owner@example.test",
    EMAIL_VERIFICATION_ENABLED: "true", EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", BACKUP_ENABLED: "false",
    TOURDATE_REFRESH_ENABLED: "false", TOURDATE_DEMAND_REFRESH_ENABLED: "false", ARTIST_GENRE_REFRESH_ENABLED: "false",
    ARTIST_PHOTO_SEED_ENABLED: "false", ARTIST_DEATH_WATCH_SCHEDULER_ENABLED: "false", CACHE_WARM_ENABLED: "false" });
  let fixture, listenerAddress, outboundBlocked = 0, browser, serverOutput = "", failure = null;
  const child = fork(join(root, "server/index.js"), [], {
    cwd: root, env: environment, execArgv: ["--import", pathToFileURL(join(root, "scripts/fixtures/auth-real-server-preload.mjs")).href],
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
  });
  child.on("message", message => {
    if (message?.kind === "fixture") fixture = message;
    if (message?.kind === "listener-bound") listenerAddress = message.address;
    if (message?.kind === "outbound-blocked") outboundBlocked++;
  });
  child.stdout.on("data", chunk => { serverOutput = (serverOutput + chunk).slice(-16_000); });
  child.stderr.on("data", chunk => { serverOutput = (serverOutput + chunk).slice(-16_000); });
  let exited = false;
  child.once("exit", () => { exited = true; });
  const checks = [];
  const check = async (name, work) => { await work(); checks.push(name); console.log(JSON.stringify({ name, passed: true })); };
  const request = async (path, { cookie, expected, method = "GET", body } = {}) => {
    const response = await fetch(origin + path, { method, redirect: "error", headers: {
      ...(cookie ? { Cookie: cookie } : {}), ...(expected ? { "X-Pit-Expected-Account": expected } : {}),
      ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs) });
    const serialized = response.headers.getSetCookie().find(value => value.startsWith(`${fixture.cookieName}=`));
    return { status: response.status, data: await response.json(), headers: response.headers, cookie: serialized?.split(";", 1)[0] };
  };
  try {
    await waitUntil(async () => {
      assert.equal(exited, false, "Isolated full server exited during startup.");
      if (!fixture || !listenerAddress) return false;
      try { return (await fetch(origin + "/api/health", { redirect: "error", signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
    }, "Actual server did not start.");
    assert.equal(listenerAddress, "127.0.0.1", "Synthetic fixture listener must bind only loopback.");
    const html = await (await fetch(origin, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) })).text();
    const build = html.match(/index-[a-f0-9]+\.js/)?.[0];
    assert.ok(build);
    assert.ok(readFileSync(join(root, "dist/index.html"), "utf8").includes(build));
    console.log(JSON.stringify({ build, listener: "server/index.js", database: "fresh isolated synthetic fixture", network: "loopback only; child outbound blocked" }));
    browser = await chromium.launch({ executablePath: process.env.PIT_BROWSER_EXECUTABLE || undefined, headless: true, args: ["--disable-dev-shm-usage"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 844 }, serviceWorkers: "block" });
    const page = await context.newPage(); page.setDefaultTimeout(timeoutMs);
    const pageErrors = [], consoleErrors = [], receipts = [], urlLeaks = [];
    let browserLoginRequests = 0;
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/api/login") browserLoginRequests++;
      if (url.pathname === "/api/client-errors") receipts.push(true);
      if (decodeURIComponent(url.href).includes(fixture.password)) urlLeaks.push(true);
      return route.continue();
    });
    const browserCookie = async () => {
      const entry = (await context.cookies()).find(value => value.name === fixture.cookieName);
      assert.ok(entry?.httpOnly, "Authentication cookie must be HttpOnly.");
      assert.equal(entry.sameSite, "Lax");
      return `${entry.name}=${entry.value}`;
    };
    const feed = () => page.getByText("Your life's musical journey", { exact: true }).waitFor();
    const you = async user => { await page.getByRole("tab", { name: "You", exact: true }).click(); await page.getByText(user.name, { exact: true }).first().waitFor(); };
    let loginCookie, switchCookie;
    await check("real-browser-login-choice-and-reload", async () => {
      await page.goto(origin, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Log in", exact: true }).last().click();
      await page.getByRole("textbox", { name: "Email", exact: true }).fill(fixture.alice.email);
      await page.getByLabel("Password", { exact: true }).fill(fixture.password);
      await page.getByLabel("Password", { exact: true }).press("Enter");
      await page.getByRole("button", { name: `${fixture.alice.name} · @${fixture.alice.handle}`, exact: true }).click();
      await feed(); loginCookie = await browserCookie();
      assert.equal((await request("/api/me", { cookie: loginCookie })).data.user.id, fixture.alice.id);
      await page.reload({ waitUntil: "networkidle" }); await feed(); await you(fixture.alice);
    });
    await check("real-browser-linked-switch-rotates-cookie-and-reloads", async () => {
      await page.getByText("Settings", { exact: true }).click();
      await page.getByText("Switch account", { exact: true }).click();
      await page.getByRole("button", { name: `${fixture.bob.name}, @${fixture.bob.handle}, switch account`, exact: true }).click();
      await feed(); switchCookie = await browserCookie(); assert.ok(switchCookie !== loginCookie, "Switch must rotate the cookie.");
      assert.equal((await request("/api/me", { cookie: loginCookie })).data.user, null);
      await page.reload({ waitUntil: "networkidle" }); await feed(); await you(fixture.bob);
      const mismatch = await request("/api/me/threads", { cookie: switchCookie, expected: fixture.alice.id });
      assert.equal(mismatch.status, 409); assert.equal(mismatch.data.code, "IDENTITY_CHANGED");
    });
    await check("real-browser-logout-reload-and-old-cookie-replay", async () => {
      await page.getByText("Log out", { exact: true }).click();
      await page.getByRole("link", { name: "Find concerts", exact: true }).waitFor();
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("link", { name: "Find concerts", exact: true }).waitFor();
      assert.equal((await request("/api/me", { cookie: switchCookie })).data.user, null);
      assert.equal((await request("/api/me/threads", { cookie: switchCookie })).status, 401);
      assert.equal((await page.locator("body").innerText()).includes(fixture.bob.name), false);
    });
    await check("real-reset-single-use-and-prior-session-revocation", async () => {
      const old = fixture.reset.oldCookies;
      assert.equal((await request("/api/me", { cookie: old[1] })).data.user.id, fixture.reset.id);
      const reset = await request("/api/reset", { method: "POST", body: { token: fixture.reset.token, password: "Reset-password2" } });
      assert.equal(reset.status, 200); assert.equal(reset.data.user.id, fixture.reset.id); assert.ok(reset.cookie);
      for (const cookie of old) assert.equal((await request("/api/me", { cookie })).data.user, null);
      assert.equal((await request("/api/me", { cookie: reset.cookie })).data.user.id, fixture.reset.id);
      assert.equal((await request("/api/reset", { method: "POST", body: { token: fixture.reset.token, password: "Reset-password3" } })).status, 400);
    });
    await check("real-password-change-rotates-and-revokes-prior-sessions", async () => {
      const old = fixture.change.oldCookies;
      const changed = await request("/api/me/password", { method: "POST", cookie: old[0], expected: fixture.change.id,
        body: { currentPassword: fixture.password, password: "Changed-password2" } });
      assert.equal(changed.status, 200); assert.ok(changed.cookie); assert.ok(changed.cookie !== old[0], "Password change must rotate the cookie.");
      for (const cookie of old) assert.equal((await request("/api/me", { cookie })).data.user, null);
      assert.equal((await request("/api/me", { cookie: changed.cookie })).data.user.id, fixture.change.id);
    });
    const concurrency = [];
    for (const count of [5, 10, 50, 100]) await check(`real-authenticated-me-parallel-${count}`, async () => {
      const started = performance.now();
      const durations = await Promise.all(fixture.readers.slice(0, count).map(async reader => {
        const at = performance.now();
        const result = await request("/api/me", { cookie: reader.cookie, expected: reader.id });
        assert.equal(result.status, 200); assert.equal(result.data.user.id, reader.id);
        assert.equal(result.headers.get("cache-control"), "no-store");
        return performance.now() - at;
      }));
      const result = { count, wallMs: Math.round(performance.now() - started), p50Ms: Math.round(percentile(durations, .5)), p95Ms: Math.round(percentile(durations, .95)), maxMs: Math.round(Math.max(...durations)) };
      concurrency.push(result); console.log(JSON.stringify({ authenticatedReads: result, interpretation: "localhost fixture correctness, not production capacity" }));
    });
    assert.deepEqual(pageErrors, []); assert.deepEqual(receipts, []); assert.deepEqual(urlLeaks, []);
    assert.equal(consoleErrors.some(message => /TypeError|ReferenceError|Minified React error/.test(message)), false, "Runtime console exception.");
    assert.equal((await page.locator("body").innerText()).includes("Something crashed on our end"), false);
    assert.equal(browserLoginRequests, 2, "Credential and profile-choice actions each submit exactly once.");
    console.log(JSON.stringify({ passed: checks.length, failed: 0, build, outboundBlocked, concurrency, loginRequests: browserLoginRequests }));
  } catch (error) {
    failure = error;
    // Never print raw fixture credentials; startup debugging is opt-in/redacted.
    const redact = value => String(value).replace(/(?:pit_session|__Host-pit_session)=[^\s;"']+/g, "[session redacted]")
      .replace(/(?:Fixture|Reset|Changed)-password\d+/g, "[fixture password redacted]").replace(/[A-Za-z0-9_-]{43}/g, "[fixture token redacted]");
    console.error(JSON.stringify({ passed: checks.length, failed: 1, failure: redact(error.message).slice(0, 600), serverExited: exited,
      ...(process.env.PIT_AUTH_FIXTURE_DEBUG === "1" ? { fixtureStartup: redact(serverOutput).slice(-3000) } : {}),
      serverErrorClasses: [...new Set(serverOutput.match(/(?:TypeError|ReferenceError|SyntaxError|SQLITE_[A-Z_]+)/g) || [])] }));
  } finally {
    await browser?.close();
    if (!exited) child.kill("SIGTERM");
    await waitUntil(() => exited, "Isolated server did not exit.");
    const target = realpathSync(directory);
    assert.equal(dirname(target).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
    assert.ok(basename(target).startsWith("pit-auth-real-browser-"));
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (failure) process.exitCode = 1;
}
await main();
