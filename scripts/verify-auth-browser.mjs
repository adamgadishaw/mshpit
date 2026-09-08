#!/usr/bin/env node

// Full exported-app regression tests. No application server, database, real
// credentials, or production traffic: every API request is a local fixture.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const timeoutMs = 12_000;
const alice = Object.freeze({
  id: "auth-fixture-a", name: "Fixture Alice", handle: "fixturealice",
  email: "fixture@example.test", role: "fan", emailVerified: true,
  onboardingVersion: 1, avatarUri: null, banner: null,
  home: { city: "Toronto, Ontario, Canada", lat: 43.6532, lng: -79.3832 },
  genres: ["Rock"], favoriteArtists: [], initials: "FA",
  profileAudience: "everyone", analyticsOptOut: true, ageBand: "18_plus",
  termsVersion: "2026-09-02",
});
const bob = Object.freeze({ ...alice, id: "auth-fixture-b", name: "Fixture Bob", handle: "fixturebob", initials: "FB" });

const cases = [
  { name: "login-mobile", kind: "login", width: 390 },
  { name: "login-desktop", kind: "login", width: 1280 },
  { name: "login-wrong-password-retry", kind: "login-retry", width: 390 },
  { name: "login-two-profile-choice", kind: "login-choice", width: 390 },
  { name: "login-canceled-browser-back-mobile", kind: "login-canceled", width: 390 },
  { name: "login-canceled-browser-back-desktop", kind: "login-canceled", width: 1280 },
  { name: "logout-reload-mobile", kind: "logout", width: 390 },
  { name: "logout-reload-desktop", kind: "logout", width: 1280 },
  { name: "logout-network-failure-reload", kind: "logout-failed", width: 390 },
  { name: "logout-server-500-reload", kind: "logout-failed", width: 1280, failureStatus: 500 },
  { name: "logout-unavailable-storage-cookie-fallback", kind: "logout-failed", width: 390, failureStatus: 500, storageUnavailable: true },
  { name: "linked-switch-mobile", kind: "switch", width: 390 },
  { name: "linked-switch-desktop", kind: "switch", width: 1280 },
  { name: "external-account-switch", kind: "external-switch", width: 390 },
  { name: "expired-session-mobile", kind: "expired", width: 390 },
  { name: "expired-session-desktop", kind: "expired", width: 1280 },
  { name: "startup-401-stale-cache", kind: "startup-401", width: 390 },
  { name: "startup-offline-recovery-mobile", kind: "startup-offline", width: 390 },
  { name: "startup-offline-recovery-desktop", kind: "startup-offline", width: 1280 },
];

function loadChromium() {
  if (process.env.PIT_PLAYWRIGHT_MODULE) return require(process.env.PIT_PLAYWRIGHT_MODULE).chromium;
  for (const name of ["playwright", "playwright-core"]) {
    try { return require(name).chromium; } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error("Install Playwright separately or set PIT_PLAYWRIGHT_MODULE to its module path; see docs/auth-browser-regressions.md.");
}

function snapshotBuild(directory) {
  const files = new Map();
  function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.set(file, readFileSync(file));
    }
  }
  visit(directory);
  assert.ok(files.has(join(directory, "index.html")), "Run npm run build:web first; exported dist/index.html is missing.");
  return files;
}

async function localBuildServer() {
  const directory = resolve(root, process.env.PIT_AUTH_BROWSER_DIST || "dist");
  const files = snapshotBuild(directory);
  const mime = {
    ".js": "text/javascript", ".html": "text/html", ".css": "text/css",
    ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
    ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf",
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    // A missed browser interception must never reach a real application API.
    if (!["GET", "HEAD"].includes(request.method) || url.pathname.startsWith("/api/")) {
      response.writeHead(405).end();
      return;
    }
    let file = resolve(directory, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(directory + sep) || !files.has(file)) file = join(directory, "index.html");
    response.setHeader("content-type", mime[extname(file)] || "application/octet-stream");
    response.setHeader("cache-control", "no-store");
    response.end(request.method === "HEAD" ? undefined : files.get(file));
  });
  await new Promise((fulfill, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", fulfill); });
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
    entry: files.get(join(directory, "index.html")).toString().match(/index-[a-f0-9]+\.js/)?.[0] || "unknown",
  };
}

async function waitFor(check, message, duration = timeoutMs) {
  const deadline = Date.now() + duration;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(fulfill => setTimeout(fulfill, 25));
  }
}

function initialBrowserState({ cachedUser, storageUnavailable }) {
  // Seed once, not on reload: the test must preserve the application's actual
  // durable logout barrier and cache removals between documents.
  if (!localStorage.getItem("fixture.initialized")) {
    localStorage.setItem("fixture.initialized", "true");
    localStorage.setItem("pit_theme", "stage");
    if (cachedUser) {
      localStorage.setItem("pit.session", JSON.stringify(cachedUser));
      localStorage.setItem("pit.users", JSON.stringify([cachedUser]));
    }
  }
  if (storageUnavailable) {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Fixture localStorage unavailable", "SecurityError"); },
    });
  }
  window.fixtureObserveGuest = () => {
    if (window.fixtureGuestObserver) return;
    const check = () => {
      if (sessionStorage.getItem("fixture.guest-guard") !== "true") return;
      const text = document.body?.innerText || "";
      if (text.includes("Fixture Alice") || text.includes("Fixture Bob")) {
        sessionStorage.setItem("fixture.private-flash", "true");
      }
    };
    window.fixtureGuestObserver = new MutationObserver(check);
    window.fixtureGuestObserver.observe(document, { childList: true, subtree: true, characterData: true });
    check();
  };
  window.fixtureObserveGuest();
}

async function runCase(browser, origin, item) {
  const context = await browser.newContext({
    viewport: { width: item.width, height: 844 },
    isMobile: item.width < 620, hasTouch: item.width < 620, serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  const state = {
    user: item.kind.startsWith("login") || item.kind === "startup-401" ? null : alice,
    offline: item.kind === "startup-offline", badPassword: item.kind === "login-retry",
    logoutUnavailable: item.kind === "logout-failed", phase: "start",
    calls: [], pageErrors: [], consoleErrors: [], reports: [], routeErrors: [],
    releaseLogin: null, loginCompleted: false,
  };
  page.on("pageerror", error => state.pageErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") state.consoleErrors.push(message.text()); });
  await page.addInitScript(initialBrowserState, {
    cachedUser: item.kind.startsWith("login") ? null : alice,
    storageUnavailable: item.storageUnavailable === true,
  });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (!url.pathname.startsWith("/api/")) {
        if (url.origin === origin) return await route.continue();
        return await route.abort();
      }
      const body = request.postData() ? request.postDataJSON() : null;
      const account = request.headers()["x-pit-expected-account"] || null;
      state.calls.push({ path: url.pathname, method: request.method(), account, phase: state.phase });
      if (url.pathname === "/api/client-errors") { state.reports.push(body); return await json({ ok: true }); }
      if (url.pathname === "/api/me") {
        if (state.offline) return await route.abort("internetdisconnected");
        if (item.kind === "startup-401") return await json({ error: "Session expired", code: "UNAUTHORIZED" }, 401);
        return await json({ user: state.user });
      }
      if (url.pathname === "/api/login") {
        if (item.kind === "login-canceled") await new Promise(fulfill => { state.releaseLogin = fulfill; });
        if (state.badPassword) return await json({ error: "Wrong email or password.", code: "INVALID_CREDENTIALS" }, 401);
        if (item.kind === "login-choice" && !body.accountId) return await json({ chooseAccount: true, accounts: [alice, bob] });
        // Model server-side success even when a browser aborts or discards the
        // response. Cancellation must compensate, not merely hide the result.
        state.user = body.accountId === bob.id ? bob : alice;
        state.phase = "signed-in";
        await json({ user: state.user });
        state.loginCompleted = true;
        return;
      }
      if (url.pathname === "/api/logout") {
        if (state.logoutUnavailable) {
          if (item.failureStatus) return await json({ error: "Fixture logout unavailable", code: "INTERNAL_ERROR" }, item.failureStatus);
          return await route.abort("internetdisconnected");
        }
        state.user = null;
        state.phase = "signed-out";
        return await json({ ok: true });
      }
      if (url.pathname === "/api/me/accounts") {
        return await json({ accounts: [alice, bob].map(user => ({ ...user, isCurrent: user.id === state.user?.id })), connected: true, canConnect: false });
      }
      if (url.pathname === "/api/me/accounts/switch") {
        assert.equal(account, alice.id, "Account switch must bind to the currently displayed account.");
        assert.equal(body.accountId, bob.id);
        state.user = bob;
        state.phase = "switched";
        return await json({ ok: true, user: bob });
      }
      if (url.pathname.startsWith("/api/feed")) return await json({ posts: [], hasMore: false, hiddenPostIds: [] });
      if (url.pathname === "/api/tourdates") return await json({ tourDates: [] });
      if (url.pathname === "/api/discovery/sidebar") return await json({ upcomingEvents: [], suggestedUsers: [], topArtists: [], trendingVenues: [], popularLounges: [], landingMedia: [], catalogTotals: { artists: 40, venues: 80 } });
      if (["/api/me/blocked", "/api/me/muted"].includes(url.pathname)) return await json({ users: [] });
      if (url.pathname === "/api/me/notifications") return await json({ notifications: [] });
      if (url.pathname === "/api/me/threads") return await json({ threads: [] });
      if (url.pathname === "/api/me/following") return await json({ following: [] });
      if (url.pathname === "/api/me/fanclubs") return await json({ fanClubs: [] });
      if (url.pathname === "/api/me/going") return await json({ going: [] });
      if (url.pathname.endsWith("/posts")) return await json({ posts: [], hasMore: false });
      if (url.pathname === "/api/me/artist-recommendations") return await json({ artists: [] });
      if (url.pathname === "/api/discover/overview") return await json({ artists: [], venues: [], events: [], genres: [], countries: [] });
      throw new Error(`Missing fixture for ${request.method()} ${url.pathname}`);
    } catch (error) {
      // A canceled request may no longer accept its simulated response; this
      // does not undo the modeled server session and must not break cleanup.
      if (item.kind === "login-canceled" && url.pathname === "/api/login" && /closed|disposed|handled|aborted|canceled|cancelled/i.test(error.message)) {
        state.loginCompleted = true;
        return;
      }
      state.routeErrors.push(error.message);
      await route.abort().catch(() => {});
    }
  });
  const landing = () => page.getByRole("link", { name: "Find concerts", exact: true }).waitFor();
  const feed = () => page.getByText("Your life's musical journey", { exact: true }).waitFor();
  const you = async user => {
    await page.getByRole("tab", { name: "You", exact: true }).click();
    await page.getByText(user.name, { exact: true }).first().waitFor();
  };
  const forceIdentity = () => page.evaluate(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "pit.auth.epoch.v1", newValue: JSON.stringify({ at: Date.now() }) }));
  });
  const startGuestGuard = async () => {
    await page.evaluate(() => { sessionStorage.setItem("fixture.guest-guard", "true"); });
    return state.calls.length;
  };
  const assertGuestPrivacy = async after => {
    const privateVisible = await page.evaluate(() => ({
      flashed: sessionStorage.getItem("fixture.private-flash") === "true",
      present: /Fixture Alice|Fixture Bob/.test(document.body?.innerText || ""),
    }));
    assert.deepEqual(privateVisible, { flashed: false, present: false }, "Private account UI reappeared after the guest boundary.");
    const privateReads = state.calls.slice(after).filter(call =>
      /\/api\/me\/(following|blocked|muted|threads|fanclubs|going|notifications|artist-recommendations)$/.test(call.path)
      || /^\/api\/users\/auth-fixture-[ab]\/posts$/.test(call.path));
    assert.deepEqual(privateReads, [], "Canceled/cleared identity caused private account reads.");
  };
  let failure = null;
  try {
    await page.goto(origin, { waitUntil: "networkidle", timeout: timeoutMs });
    if (item.kind.startsWith("login")) {
      await landing();
      await page.getByRole("button", { name: "Log in", exact: true }).last().click();
      await page.getByRole("textbox", { name: "Email", exact: true }).fill(alice.email);
      await page.getByLabel("Password", { exact: true }).fill("fixture-password1");
      await page.getByRole("button", { name: "Log in", exact: true }).last().click();
      if (item.kind === "login-retry") {
        await page.getByRole("alert").filter({ hasText: "Wrong email or password." }).waitFor();
        assert.equal(state.user, null);
        state.badPassword = false;
        await page.getByRole("button", { name: "Log in", exact: true }).last().click();
      }
      if (item.kind === "login-canceled") {
        await waitFor(() => typeof state.releaseLogin === "function", "Login request was not held by the fixture.");
        await page.goBack();
        await page.getByRole("heading", { name: "Good to see you.", exact: true }).waitFor({ state: "hidden" });
        const after = await startGuestGuard();
        state.releaseLogin();
        state.releaseLogin = null;
        await waitFor(() => state.loginCompleted, "Held login response was not released.");
        await waitFor(() => state.user === null, "Canceled login left the server session authenticated; compensating logout was missing.");
        await page.waitForTimeout(250);
        await assertGuestPrivacy(after);
        await page.reload({ waitUntil: "networkidle" });
        await landing();
        await forceIdentity();
        await page.waitForTimeout(250);
        await assertGuestPrivacy(after);
        assert.ok(state.calls.some(call => call.path === "/api/logout"), "Canceled successful login must revoke its server session.");
      } else {
        if (item.kind === "login-choice") {
          await page.getByRole("heading", { name: "Choose your account.", exact: true }).waitFor();
          assert.equal(state.user, null);
          await page.getByRole("button", { name: "Fixture Bob · @fixturebob", exact: true }).click();
        }
        await feed();
        await you(item.kind === "login-choice" ? bob : alice);
      }
    } else if (item.kind === "logout" || item.kind === "logout-failed") {
      await feed();
      await you(alice);
      await page.getByText("Log out", { exact: true }).click();
      await landing();
      const after = await startGuestGuard();
      if (item.kind === "logout-failed") assert.equal(state.user?.id, alice.id, "Failure fixture must preserve the original server session.");
      await page.reload({ waitUntil: "networkidle" });
      await landing();
      await forceIdentity();
      await page.waitForTimeout(400);
      await assertGuestPrivacy(after);
      if (item.kind === "logout-failed") {
        // The user regains connectivity. A revalidation must retry revocation
        // without ever adopting the stale session, then make logout durable.
        state.logoutUnavailable = false;
        if (item.failureStatus) await forceIdentity();
        else await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await waitFor(() => state.user === null, "Pending logout was not retried after recovery.");
        await page.reload({ waitUntil: "networkidle" });
        await landing();
        await assertGuestPrivacy(after);
      } else assert.equal(state.user, null);
    } else if (item.kind === "switch") {
      await feed();
      await you(alice);
      await page.getByText("Settings", { exact: true }).click();
      await page.getByText("Switch account", { exact: true }).click();
      await page.getByRole("button", { name: "Fixture Bob, @fixturebob, switch account", exact: true }).click();
      await feed();
      await you(bob);
      assert.ok(state.calls.some(call => call.phase === "switched" && call.account === bob.id));
      assert.equal(state.calls.some(call => call.phase === "switched" && call.account === alice.id), false, "Switch reused the old account header.");
    } else if (item.kind === "external-switch" || item.kind === "expired") {
      await feed();
      await you(alice);
      state.user = item.kind === "expired" ? null : bob;
      state.phase = "revalidated";
      await forceIdentity();
      if (item.kind === "expired") {
        await landing();
        assert.equal((await page.locator("body").innerText()).includes(alice.name), false);
      } else { await feed(); await you(bob); }
      assert.ok(state.calls.filter(call => call.path === "/api/me").length >= 2);
    } else if (item.kind === "startup-401") {
      await landing();
      assert.equal((await page.locator("body").innerText()).includes(alice.name), false);
    } else if (item.kind === "startup-offline") {
      assert.equal((await page.locator("body").innerText()).includes(alice.name), false);
      assert.equal(state.calls.some(call => call.path === "/api/feed/for-you"), false);
      state.offline = false;
      await feed();
      await you(alice);
      assert.ok(state.calls.filter(call => call.path === "/api/me").length >= 2);
    }
    await page.waitForTimeout(250);
    assert.deepEqual(state.routeErrors, [], "Fixture/interception failure.");
    assert.deepEqual(state.pageErrors, [], "Uncaught browser error.");
    assert.deepEqual(state.reports, [], "The app sent a crash receipt.");
    assert.equal(state.consoleErrors.some(message => /TypeError|ReferenceError|Minified React error/.test(message)), false, "Runtime console exception.");
    assert.equal((await page.locator("body").innerText()).includes("Something crashed on our end"), false);
  } catch (error) { failure = error.message; }
  finally {
    state.releaseLogin?.();
    await context.close();
  }
  return {
    name: item.name, passed: !failure,
    ...(failure ? { failure, calls: state.calls, pageErrors: state.pageErrors, consoleErrors: state.consoleErrors, routeErrors: state.routeErrors, reports: state.reports } : {}),
  };
}

async function main() {
  if (process.argv.includes("--list")) { console.log(cases.map(item => item.name).join("\n")); return; }
  const filter = process.argv[2] || "";
  const selected = cases.filter(item => item.name.includes(filter));
  assert.ok(selected.length, `No auth browser cases match ${JSON.stringify(filter)}.`);
  const { server, origin, entry } = await localBuildServer();
  let browser;
  try {
    browser = await loadChromium().launch({
      headless: true,
      ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}),
    });
    console.log(JSON.stringify({ build: entry, cases: selected.length, network: "localhost static only; every API request mocked" }));
    const results = [];
    for (const item of selected) {
      const result = await runCase(browser, origin, item);
      results.push(result);
      console.log(JSON.stringify(result));
    }
    console.log(JSON.stringify({ total: results.length, passed: results.filter(item => item.passed).length, failed: results.filter(item => !item.passed).length }));
    if (results.some(item => !item.passed)) process.exitCode = 1;
  } finally {
    await browser?.close();
    await new Promise(fulfill => server.close(fulfill));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
