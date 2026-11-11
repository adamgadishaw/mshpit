// Exported app, disposable browser contexts, synthetic API only. No real sessions.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { navigationUser, fixtureApiResponse } from "./verify-navigation-browser.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
const directory = resolve("dist"), evidence = resolve(process.env.PIT_THEME_EVIDENCE || "../evidence/browser");
mkdirSync(evidence, { recursive: true });
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://fixture.invalid");
  let file = resolve(directory, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(directory + sep) || !existsSync(file) || !extname(file)) file = resolve(directory, "index.html");
  res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml" })[extname(file)] || "application/octet-stream");
  res.end(readFileSync(file));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
const results = [];
async function run(role, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  let member = { ...navigationUser, role, theme: "daylight" }, writes = 0, holdWrite = false, releaseWrite, offlineWrite = false;
  const errors = [];
  await context.addInitScript(({ origin, member }) => {
    if (location.origin !== origin || localStorage.getItem("theme.fixture")) return;
    localStorage.setItem("theme.fixture", "1");
    localStorage.setItem("pit_theme", "forest");
    localStorage.setItem("pit_theme_owner", member.id);
    localStorage.setItem("pit.session", JSON.stringify({ ...member, role: "admin" }));
  }, { origin, member });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let data;
    if (url.pathname === "/api/me") {
      if (request.method() === "PATCH") {
        writes++;
        if (offlineWrite) return route.abort();
        if (holdWrite) await new Promise(done => { releaseWrite = done; });
        member = { ...member, theme: request.postDataJSON().theme };
      }
      data = { user: member };
    } else if (url.pathname === "/api/logout") { member = null; data = { ok: true }; }
    else if (url.pathname.startsWith("/api/admin/") || url.pathname.startsWith("/api/moderation/")) {
      data = { reports: [], requests: [], users: [], members: [], items: [], summary: {} };
    } else {
      try { data = fixtureApiResponse(url.pathname, { member: !!member, method: request.method(), resolvedPath: url.searchParams.get("path") || "/feed" }); }
      catch (error) { errors.push(error.message); return route.fulfill({ status: 500, json: { error: "Missing fixture" } }); }
    }
    return route.fulfill({ json: data });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  const settings = async () => {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByText("Settings", { exact: true }).click();
    await page.getByRole("radiogroup", { name: "Appearance theme" }).waitFor();
  };
  try {
    await page.goto(origin + "/feed");
    await settings();
    if (role === "admin") {
      await page.getByRole("radio", { name: "Forest theme, dark, selected", exact: true }).waitFor();
      await page.getByRole("button", { name: "Show more themes", exact: true }).click();
      assert.equal(await page.getByRole("radiogroup", { name: "Appearance theme" }).getByRole("radio").count(), 12);
      await page.getByRole("radiogroup", { name: "Appearance theme" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(evidence, `team-${width}.png`) });
      // An observed live role loss must hide team themes, including across reload.
      member = { ...member, role: "fan", theme: "stage" };
      const revoked = page.waitForEvent("load");
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await revoked;
      await settings();
      assert.equal(await page.getByRole("radiogroup", { name: "Appearance theme" }).getByRole("radio").count(), 2);
      assert.equal(await page.getByRole("button", { name: "Show more themes" }).count(), 0);
      assert.equal(await page.evaluate(() => localStorage.getItem("pit_theme")), "forest", "role loss retains the dormant choice");
      member = { ...member, role: "admin", theme: "forest" };
      const restored = page.waitForEvent("load");
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await restored; await settings();
      await page.getByRole("radio", { name: "Forest theme, dark, selected", exact: true }).waitFor();
      // Cross-tab logout retires the themed account without carrying its
      // appearance into the guest session or causing a reload loop.
      member = null;
      const signedOut = page.waitForEvent("load");
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await signedOut;
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("radio", { name: /Stage theme/ }).waitFor();
      assert.equal(await page.getByRole("radio", { name: /theme,/ }).count(), 2);
      assert.equal(await page.getByRole("radio", { name: /Forest theme/ }).count(), 0);
    } else {
      assert.equal(await page.getByRole("radiogroup", { name: "Appearance theme" }).getByRole("radio").count(), 2);
      await page.getByRole("radio", { name: "Daylight theme, light, selected", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Show more themes" }).count(), 0);
      await page.screenshot({ path: resolve(evidence, `${role}-${width}.png`) });
      holdWrite = true;
      await page.getByRole("radio", { name: "Stage theme, dark", exact: true }).evaluate(element => { element.click(); element.click(); });
      await page.waitForFunction(() => document.querySelector('[role="radiogroup"]'));
      const deadline = Date.now() + 5000;
      while (!releaseWrite && Date.now() < deadline) await new Promise(done => setTimeout(done, 20));
      assert.equal(writes, 1, "repeated taps share one pending write");
      assert.ok(releaseWrite); holdWrite = false; releaseWrite();
      await page.waitForEvent("load");
      await settings();
      await page.getByRole("radio", { name: "Stage theme, dark, selected", exact: true }).waitFor();
      offlineWrite = true;
      const failed = page.waitForEvent("requestfailed", request => request.url() === origin + "/api/me");
      await page.getByRole("radio", { name: "Daylight theme, light", exact: true }).click();
      await failed;
      assert.equal(await page.evaluate(() => localStorage.getItem("pit_theme")), "stage", "failed writes cannot change the saved choice");
      assert.equal(member.theme, "stage");
    }
    assert.deepEqual(errors, []);
    return { role, width, passed: true, writes };
  } catch (error) {
    await page.screenshot({ path: resolve(evidence, `failure-${role}-${width}.png`) });
    return { role, width, passed: false, error: error.message, errors, text: (await page.locator("body").innerText()).slice(0, 1200) };
  } finally { await context.close(); }
}
try {
  for (const [role, width] of [["fan", 1280], ["moderator", 390], ["admin", 1280]]) {
    const result = await run(role, width); results.push(result); console.log(JSON.stringify(result));
  }
  if (results.some(result => !result.passed)) process.exitCode = 1;
} finally { await browser.close(); await new Promise(done => server.close(done)); }
