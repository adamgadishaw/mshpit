#!/usr/bin/env node

// Full exported-app regression tests. No application server, database, real
// credentials, or production traffic: every API request is a local fixture.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
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
const fixturePassword = "fixture-password1";
const replacementPassword = "fixture-password2";
const fixtureResetToken = "fixture-reset-token-0123456789";
const fixtureOwnerToken = "fixture-owner-token-0123456789";

const cases = [
  ...[390, 1280].flatMap(width => [
    ...["concert", "status", "online", "going"].map(postKind => ({ name: `guest-like-${postKind}-${width}`, kind: "guest-like", postKind, width })),
    { name: `guest-comments-${width}`, kind: "guest-comments", width },
    { name: `guest-photo-like-${width}`, kind: "guest-photo", width },
    { name: `guest-report-${width}`, kind: "guest-report", width },
    { name: `guest-like-sign-in-no-replay-${width}`, kind: "guest-like-login", width },
  ]),
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
  { name: "linked-switch-canceled-browser-back-mobile", kind: "switch-canceled", width: 390 },
  { name: "linked-switch-canceled-browser-back-desktop", kind: "switch-canceled", width: 1280 },
  { name: "external-account-switch", kind: "external-switch", width: 390 },
  { name: "expired-session-mobile", kind: "expired", width: 390 },
  { name: "expired-session-desktop", kind: "expired", width: 1280 },
  { name: "startup-401-stale-cache", kind: "startup-401", width: 390 },
  { name: "startup-offline-recovery-mobile", kind: "startup-offline", width: 390 },
  { name: "startup-offline-recovery-desktop", kind: "startup-offline", width: 1280 },
  { name: "forms-login-mobile", kind: "forms-login", width: 390 },
  { name: "forms-login-desktop", kind: "forms-login", width: 1280 },
  { name: "forms-signup-mobile", kind: "forms-signup", width: 390 },
  { name: "forms-signup-desktop", kind: "forms-signup", width: 1280 },
  { name: "forms-reset-password", kind: "forms-reset", width: 390 },
  { name: "forms-change-password", kind: "forms-change", width: 1280 },
  { name: "forms-connect-accounts", kind: "forms-connect", width: 390 },
  { name: "forms-settings-export", kind: "forms-settings", width: 1280 },
  { name: "forms-owner-explicit-decision", kind: "forms-owner", width: 390 },
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

async function credentialFields(page, specifications, { submitButtons = 1 } = {}) {
  const fields = [];
  for (const [label, autocomplete] of specifications) {
    const locator = page.getByLabel(label, { exact: true });
    await locator.waitFor({ state: "attached" });
    const field = await locator.evaluate(input => ({
      tag: input.tagName, id: input.id, name: input.name, autocomplete: input.autocomplete,
      uniqueId: !!input.id && [...document.querySelectorAll("[id]")].filter(node => node.id === input.id).length === 1,
      labelConnected: [...(input.labels || [])].some(label => label.isConnected && label.control === input && label.textContent.trim()),
      form: input.form ? [...document.forms].indexOf(input.form) : -1,
      formConnected: input.form?.isConnected === true,
      method: input.form?.method, noValidate: input.form?.noValidate,
      nested: !!input.form?.querySelector("form"),
    }));
    assert.equal(field.tag, "INPUT", `${label} must be a real input.`);
    assert.ok(field.name, `${label} must have a stable name.`);
    assert.ok(field.uniqueId, `${label} must have a unique, nonempty id.`);
    assert.ok(field.labelConnected, `${label} must have a real connected HTML label.`);
    assert.ok(field.form >= 0 && field.formConnected, `${label} must belong to a connected form.`);
    assert.equal(field.method, "post", `${label}'s form must never default to credential-bearing GET navigation.`);
    assert.equal(field.noValidate, true, "Custom validation requires noValidate on the form.");
    assert.equal(field.nested, false, "Credential forms must not be nested.");
    assert.equal(field.autocomplete, autocomplete, `${label} has the wrong password-manager hint.`);
    fields.push(field);
  }
  assert.equal(new Set(fields.map(field => field.form)).size, 1, "Related credentials must have one form owner.");
  assert.equal(new Set(fields.map(field => field.name)).size, fields.length, "Credential field names must be distinct.");
  const form = page.locator("form").nth(fields[0].form);
  assert.equal(await form.locator('button[type="submit"]').count(), submitButtons, "The credential form has the wrong number of real submit buttons.");
  const counter = await form.evaluate(form => {
    window.fixtureSubmitCounts ||= {};
    if (!form.fixtureSubmitCounter) {
      form.fixtureSubmitCounter = `form-${Object.keys(window.fixtureSubmitCounts).length}`;
      window.fixtureSubmitCounts[form.fixtureSubmitCounter] = 0;
      form.addEventListener("submit", () => { window.fixtureSubmitCounts[form.fixtureSubmitCounter]++; }, true);
    }
    return form.fixtureSubmitCounter;
  });
  return { form, fields, submissions: () => page.evaluate(key => window.fixtureSubmitCounts[key], counter) };
}

async function semanticFormCase(page, origin, item, state, { landing, feed, you }) {
  const screenshot = async (suffix = "") => {
    if (process.env.PIT_AUTH_BROWSER_SCREENSHOTS !== "1") return;
    mkdirSync(join(root, ".tmp"), { recursive: true });
    await page.screenshot({ path: join(root, ".tmp", `credential-${item.name}${suffix}.png`), fullPage: true });
  };
  const count = path => state.calls.filter(call => call.path === path && call.method === "POST").length;
  const openLogin = async () => {
    const button = page.getByRole("button", { name: "Log in", exact: true }).last();
    if (await button.isVisible()) await button.click();
    else {
      await page.getByRole("tab", { name: "You", exact: true }).click();
      await page.getByText("LOG IN / SIGN UP", { exact: true }).click();
    }
    await page.getByRole("heading", { name: "Good to see you.", exact: true }).waitFor();
  };
  const settings = async () => { await feed(); await you(alice); await page.getByText("Settings", { exact: true }).click(); };
  if (item.kind === "forms-login") {
    await landing();
    await openLogin();
    await credentialFields(page, [["Email", "username"], ["Password", "current-password"]]);
    await screenshot();
    await page.getByLabel("Email", { exact: true }).fill(alice.email);
    await page.getByLabel("Password", { exact: true }).fill(fixturePassword);
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    assert.equal(await page.getByLabel("Password", { exact: true }).getAttribute("type"), "text");
    assert.equal(await page.getByLabel("Password", { exact: true }).getAttribute("autocomplete"), "current-password");
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
    await page.getByRole("heading", { name: "Back to your account.", exact: true }).waitFor();
    assert.equal(count("/api/login"), 0, "Password visibility/forgot-password controls submitted login.");
    assert.equal(count("/api/forgot"), 0, "Opening forgot-password must not send a reset email.");
    await page.getByRole("button", { name: "Back to log in", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("heading", { name: "Good to see you.", exact: true }).waitFor({ state: "hidden" });
    assert.equal(count("/api/login"), 0, "Closing the form submitted login.");
    await openLogin();
    const { form, submissions } = await credentialFields(page, [["Email", "username"], ["Password", "current-password"]]);
    await page.getByLabel("Email", { exact: true }).fill(alice.email);
    await page.getByLabel("Password", { exact: true }).fill(fixturePassword);
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await waitFor(() => typeof state.releaseLogin === "function", "Enter did not submit the login form.");
    assert.equal(count("/api/login"), 1);
    assert.equal(await submissions(), 1, "Enter must emit a real form submit event, not bypass the form.");
    const submit = form.locator('button[type="submit"]');
    const box = await submit.boundingBox();
    assert.ok(box, "The busy submit button disappeared.");
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    assert.equal(count("/api/login"), 1, "Rapid clicks/Enter duplicated the pending login request.");
    state.releaseLogin(); state.releaseLogin = null;
    await page.getByRole("heading", { name: "Good to see you.", exact: true }).waitFor({ state: "hidden" });
    await you(alice);
    assert.equal(count("/api/login"), 1);
  } else if (item.kind === "forms-signup") {
    await landing();
    await openLogin();
    await page.getByRole("button", { name: "No account? Sign up", exact: true }).click();
    await page.getByRole("heading", { name: "Make it your night.", exact: true }).waitFor();
    const before = await credentialFields(page, [["Name", "name"], ["Username", "off"], ["Email", "username"], ["Password", "new-password"]]);
    await screenshot();
    await page.getByLabel("Name", { exact: true }).fill(alice.name);
    await page.getByLabel("Username", { exact: true }).fill(alice.handle);
    await page.getByLabel("Email", { exact: true }).fill(alice.email);
    await page.getByLabel("Password", { exact: true }).fill(fixturePassword);
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await page.getByRole("heading", { name: "Find your kind of show.", exact: true }).waitFor();
    assert.equal(count("/api/signup"), 0, "Step one created an account instead of advancing.");
    assert.equal(await before.submissions(), 1, "Step-one Enter must submit the existing form exactly once.");
    const after = await credentialFields(page, [["Name", "name"], ["Username", "off"], ["Email", "username"], ["Password", "new-password"]]);
    await screenshot("-music");
    assert.deepEqual(after.fields.map(field => [field.id, field.form]), before.fields.map(field => [field.id, field.form]), "Signup lost its credential inputs/form between steps.");
    assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), fixturePassword);
    await page.getByRole("button", { name: "Back to account details", exact: true }).click();
    await page.getByRole("heading", { name: "Make it your night.", exact: true }).waitFor();
    assert.equal(count("/api/signup"), 0, "Signup Back submitted the account.");
    assert.equal(await before.submissions(), 1, "Signup Back emitted a submit event.");
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await page.getByRole("heading", { name: "Find your kind of show.", exact: true }).waitFor();
    await page.getByRole("checkbox", { name: "Rock", exact: true }).click();
    await page.getByRole("radio", { name: "18+", exact: true }).click();
    await page.getByRole("checkbox", { name: "I agree to the Terms and Privacy policy", exact: true }).click();
    assert.equal(count("/api/signup"), 0, "Signup choices submitted before the user confirmed.");
    await page.getByRole("button", { name: "Create account", exact: true }).press("Enter");
    await waitFor(() => count("/api/signup") > 0, "Final signup submission was not sent.");
    await feed();
    assert.equal(count("/api/signup"), 1, "Signup was submitted more than once.");
    assert.equal(await before.submissions(), 3, "Two step-one advances and final confirmation must use exactly three native form submissions.");
  } else if (item.kind === "forms-reset") {
    await credentialFields(page, [["New password", "new-password"], ["Confirm new password", "new-password"]]);
    await page.getByLabel("New password", { exact: true }).fill(replacementPassword);
    await page.getByLabel("Confirm new password", { exact: true }).fill(replacementPassword);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(count("/api/reset"), 0, "Reset Cancel submitted the password.");
    await page.goto(`${origin}/#reset=${fixtureResetToken}`, { waitUntil: "networkidle" });
    // Adding a fragment to the current page is same-document navigation; load
    // the fixture link as a new document so the root consumes its token again.
    await page.reload({ waitUntil: "networkidle" });
    await credentialFields(page, [["New password", "new-password"], ["Confirm new password", "new-password"]]);
    await page.getByLabel("New password", { exact: true }).fill(replacementPassword);
    await page.getByLabel("Confirm new password", { exact: true }).fill(replacementPassword);
    await page.getByLabel("Confirm new password", { exact: true }).press("Enter");
    await feed();
    assert.equal(count("/api/reset"), 1, "Reset Enter must submit exactly once.");
  } else if (item.kind === "forms-change") {
    await settings();
    await page.getByText("Change password", { exact: true }).click();
    await credentialFields(page, [["Current password", "current-password"], ["New password", "new-password"], ["Confirm new password", "new-password"]]);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(count("/api/me/password"), 0, "Change-password Cancel submitted the form.");
    await page.getByText("Change password", { exact: true }).click();
    await page.getByLabel("Current password", { exact: true }).fill(fixturePassword);
    await page.getByLabel("New password", { exact: true }).fill(replacementPassword);
    await page.getByLabel("Confirm new password", { exact: true }).fill(replacementPassword);
    await page.getByLabel("Confirm new password", { exact: true }).press("Enter");
    await page.getByRole("alert").filter({ hasText: "Password changed for this account." }).waitFor();
    assert.equal(count("/api/me/password"), 1, "Change-password Enter must submit exactly once.");
  } else if (item.kind === "forms-connect") {
    await settings();
    await page.getByText("Switch account", { exact: true }).click();
    await page.getByRole("button", { name: "Connect an existing account", exact: true }).click();
    await credentialFields(page, [["Password to connect accounts", "current-password"]]);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(count("/api/me/accounts/connect"), 0, "Connect Cancel submitted the form.");
    await page.getByRole("button", { name: "Connect an existing account", exact: true }).click();
    await page.getByLabel("Password to connect accounts", { exact: true }).fill(fixturePassword);
    await page.getByLabel("Password to connect accounts", { exact: true }).press("Enter");
    await page.getByLabel("Password to connect accounts", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(count("/api/me/accounts/connect"), 1, "Connect Enter must submit exactly once.");
  } else if (item.kind === "forms-settings") {
    await settings();
    await credentialFields(page, [["Current password for data export", "current-password"]]);
    await page.getByLabel("Current password for data export", { exact: true }).fill(fixturePassword);
    const before = state.calls.filter(call => call.method === "POST").length;
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByText(alice.name, { exact: true }).first().waitFor();
    assert.equal(state.calls.filter(call => call.method === "POST").length, before, "Closing Settings submitted the export password.");
  } else if (item.kind === "forms-owner") {
    await page.getByRole("heading", { name: "Approve this security audit stamp?", exact: true }).waitFor();
    const { submissions } = await credentialFields(page, [["Owner password", "current-password"]], { submitButtons: 2 });
    await page.getByLabel("Owner password", { exact: true }).fill(fixturePassword);
    await page.getByLabel("Owner password", { exact: true }).press("Enter");
    await page.getByRole("alert").filter({ hasText: "Choose an approval or rejection button below to record your decision." }).waitFor();
    await page.waitForTimeout(150);
    assert.equal(count("/api/owner-approvals/decide"), 0, "Password Enter must never choose an Owner decision.");
    assert.equal(await submissions(), 0, "Ambiguous Owner Enter must not trigger an implicit native submitter.");
    await page.getByRole("button", { name: "APPROVE SECURITY STAMP", exact: true }).click();
    await page.getByRole("heading", { name: "Approved and recorded", exact: true }).waitFor();
    assert.equal(count("/api/owner-approvals/decide"), 1, "Explicit Owner decision must send exactly once.");
    assert.equal(await submissions(), 1, "Explicit Owner decision must use its native form submitter.");
  }
}

async function runCase(browser, origin, item) {
  const context = await browser.newContext({
    viewport: { width: item.width, height: 844 },
    isMobile: item.width < 620, hasTouch: item.width < 620, serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  const guestCase = item.kind.startsWith("guest-");
  const guestStart = guestCase || item.kind.startsWith("login") || ["startup-401", "forms-login", "forms-signup", "forms-reset"].includes(item.kind);
  const publicPost = {
    id: "p_guest_browser", userId: "public-author", user: { id: "public-author", name: "Public Author", handle: "public-author", role: "fan" },
    kind: ["status", "going"].includes(item.postKind) ? "status" : "concert",
    experienceType: item.postKind === "online" ? "online" : "live",
    artist: "Fixture Artist", venue: "Fixture Venue", city: "Toronto", date: "2026-09-01",
    review: "A public concert memory worth sharing.", text: "A public concert memory worth sharing.",
    at: Date.now() - 60_000, likes: 3, comments: 1, overall: 4, band: 4, room: 4,
    photos: item.kind === "guest-photo" ? [`${origin}/fixture-photo.png?first`, `${origin}/fixture-photo.png?second`] : [`${origin}/fixture-photo.png`],
    ...(item.postKind === "going" ? { attendanceTicket: { artist: "Fixture Artist", venue: "Fixture Venue", city: "Toronto", date: "2026-10-01", tour: "Fixture Tour" } } : {}),
  };
  const state = {
    user: guestStart ? null : item.kind === "forms-owner" ? { ...alice, role: "admin", owner: true } : alice,
    offline: item.kind === "startup-offline", badPassword: item.kind === "login-retry",
    logoutUnavailable: item.kind === "logout-failed", phase: "start",
    calls: [], pageErrors: [], consoleErrors: [], reports: [], routeErrors: [],
    releaseLogin: null, releaseSwitch: null, loginCompleted: false, connected: item.kind !== "forms-connect", credentialUrlLeaks: [],
  };
  page.on("pageerror", error => state.pageErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") state.consoleErrors.push(message.text()); });
  await page.addInitScript(initialBrowserState, {
    cachedUser: guestStart && item.kind !== "startup-401" ? null : alice,
    storageUnavailable: item.storageUnavailable === true,
  });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      if ([fixturePassword, replacementPassword].some(password => decodeURIComponent(url.href).includes(password))
        || [...url.searchParams.keys()].some(key => /password/i.test(key))) {
        state.credentialUrlLeaks.push("A request URL contained password data.");
        return await route.abort();
      }
      if (!url.pathname.startsWith("/api/")) {
        if (url.origin === origin && url.pathname === "/fixture-photo.png") return await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64") });
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
        if (["login-canceled", "forms-login"].includes(item.kind)) await new Promise(fulfill => { state.releaseLogin = fulfill; });
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
        if (!state.connected) return await json({ accounts: [{ ...alice, isCurrent: true }], connected: false, canConnect: true });
        return await json({ accounts: [alice, bob].map(user => ({ ...user, isCurrent: user.id === state.user?.id })), connected: true, canConnect: false });
      }
      if (url.pathname === "/api/me/accounts/connect") {
        assert.equal(request.method(), "POST"); assert.equal(account, alice.id); assert.equal(body.password, fixturePassword);
        state.connected = true;
        return await json({ accounts: [alice, bob].map(user => ({ ...user, isCurrent: user.id === alice.id })), connected: true, canConnect: false });
      }
      if (url.pathname === "/api/me/password") {
        assert.equal(request.method(), "POST"); assert.equal(account, alice.id);
        assert.equal(body.currentPassword, fixturePassword); assert.equal(body.password, replacementPassword);
        return await json({ ok: true, accountId: alice.id });
      }
      if (url.pathname === "/api/admin/moderation") return await json({ reports: [], recentActions: [], nextCursor: null });
      if (url.pathname === "/api/admin/artist-requests") return await json({ requests: [] });
      if (url.pathname === "/api/owner-approvals/review") {
        assert.equal(request.method(), "POST"); assert.equal(body.token, fixtureOwnerToken);
        return await json({ review: {
          request: { id: "fixture-owner-review", kind: "security_release", expiresAt: Date.now() + 3_600_000 },
          payload: { category: "security_audit", checks: ["tests", "architecture"], commit: "fixture-only" },
        } });
      }
      if (url.pathname === "/api/owner-approvals/decide") {
        assert.equal(request.method(), "POST"); assert.equal(body.token, fixtureOwnerToken);
        assert.equal(body.password, fixturePassword); assert.equal(body.decision, "approved");
        return await json({ ok: true, decision: "approved", receipt: { id: "fixture-owner-receipt", stamp: "fixture-not-a-real-receipt" }, emailSent: false });
      }
      if (url.pathname === "/api/reset") {
        assert.equal(request.method(), "POST"); assert.equal(body.password, replacementPassword); assert.equal(body.token, fixtureResetToken);
        state.user = alice;
        return await json({ user: alice });
      }
      if (url.pathname === "/api/signup/handle-availability") return await json({ handle: url.searchParams.get("handle"), available: true });
      if (url.pathname === "/api/signup") {
        assert.equal(request.method(), "POST"); assert.equal(body.password, fixturePassword); assert.equal(body.email, alice.email);
        state.user = alice;
        return await json({ created: true, user: alice });
      }
      if (url.pathname === "/api/me/accounts/switch") {
        assert.equal(account, alice.id, "Account switch must bind to the currently displayed account.");
        assert.equal(body.accountId, bob.id);
        if (item.kind === "switch-canceled") await new Promise(fulfill => { state.releaseSwitch = fulfill; });
        state.user = bob;
        state.phase = "switched";
        return await json({ ok: true, user: bob });
      }
      if (url.pathname.startsWith("/api/feed")) return await json({ posts: guestCase ? [publicPost] : [], hasMore: false, hiddenPostIds: [] });
      if (guestCase && url.pathname === `/api/posts/${publicPost.id}/comments` && request.method() === "GET") return await json({ comments: [{ id: "c_guest_fixture", postId: publicPost.id, userId: "public-reader", name: "Public Reader", text: "A public comment to read.", at: Date.now() - 30_000 }] });
      if (guestCase && url.pathname === `/api/posts/${publicPost.id}` && request.method() === "GET") return await json({ post: publicPost });
      if (guestCase && url.pathname === "/api/media/reactions") return await json({ reactions: {} });
      if (guestCase && url.pathname === `/api/posts/${publicPost.id}/like`) {
        assert.equal(request.method(), "POST");
        assert.equal(state.user?.id, alice.id);
        assert.equal(account, alice.id);
        assert.equal(body.liked, true);
        return await json({ liked: true });
      }
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
    const entry = item.kind === "forms-reset" ? `${origin}/#reset=${fixtureResetToken}`
      : item.kind === "forms-owner" ? `${origin}/#ownerApproval=${fixtureOwnerToken}` : origin;
    await page.goto(entry, { waitUntil: "networkidle", timeout: timeoutMs });
    if (guestCase) {
      await landing();
      await page.getByRole("button", { name: "Log in", exact: true }).last().click();
      await page.getByRole("heading", { name: "Good to see you.", exact: true }).waitFor();
      await page.goBack();
      await feed();
      const like = () => page.getByRole("button", { name: "Like, 3 likes", exact: true }).last();
      await like().waitFor();
      const after = state.calls.length;
      const promptAndReturn = async action => {
        const before = page.url();
        await action();
        await page.getByRole("heading", { name: "Good to see you.", exact: true }).waitFor();
        assert.equal(state.user, null, "A guest action must not create a session.");
        await page.goBack();
        await page.getByRole("heading", { name: "Good to see you.", exact: true }).waitFor({ state: "hidden" });
        assert.equal(page.url(), before, "Closing sign-in must return to the original public destination.");
      };
      if (item.kind === "guest-like-login") {
        await like().click();
        await page.getByRole("heading", { name: "Good to see you.", exact: true }).waitFor();
        await page.getByRole("textbox", { name: "Email", exact: true }).fill(alice.email);
        await page.getByLabel("Password", { exact: true }).fill(fixturePassword);
        await page.getByRole("button", { name: "Log in", exact: true }).last().click();
        await feed();
        await like().waitFor();
        await page.waitForTimeout(250);
        assert.equal(state.calls.some(call => call.path.endsWith("/like")), false, "Signing in must not replay the guest Like.");
        await like().click();
        await page.getByRole("button", { name: "Unlike, 4 likes", exact: true }).waitFor();
        await waitFor(() => state.calls.some(call => call.path.endsWith("/like")), "The deliberate signed-in Like was not sent.");
      } else if (item.kind === "guest-like") {
        await promptAndReturn(() => like().click());
        await like().waitFor();
      } else if (item.kind === "guest-comments") {
        await page.getByRole("link", { name: "Comments, 1", exact: true }).last().click();
        await page.getByRole("button", { name: "Sign in to comment", exact: true }).waitFor();
        await page.getByText("A public comment to read.", { exact: true }).last().waitFor();
        await promptAndReturn(() => page.getByRole("button", { name: "Reply to comment", exact: true }).last().click());
        await promptAndReturn(() => page.getByRole("button", { name: "Sign in to comment", exact: true }).click());
        await promptAndReturn(() => like().click());
        const destination = page.url();
        await page.getByRole("link", { name: "Comments, 1", exact: true }).last().click();
        assert.equal(page.url(), destination, "The post footer must stay in its own comment thread.");
      } else if (item.kind === "guest-photo") {
        await page.getByRole("button", { name: "Concert photo", exact: true }).first().click();
        await page.getByRole("button", { name: "Next media", exact: true }).click();
        await page.getByText("2 / 2", { exact: true }).waitFor();
        await promptAndReturn(() => page.getByRole("button", { name: "Like this photo, 0 likes", exact: true }).click());
        await page.getByRole("button", { name: "Like this photo, 0 likes", exact: true }).waitFor();
        await page.getByText("2 / 2", { exact: true }).waitFor();
      } else if (item.kind === "guest-report") {
        await promptAndReturn(() => page.getByRole("button", { name: "Report post", exact: true }).last().click());
        await like().waitFor();
      }
      const guestCalls = state.calls.slice(after);
      const beforeSignIn = item.kind === "guest-like-login" ? guestCalls.filter(call => call.phase === "start" && call.path !== "/api/login") : guestCalls;
      assert.deepEqual(beforeSignIn.filter(call => call.method !== "GET" && call.path !== "/api/media/reactions"), [], "Guest controls must not send mutations, authentication attempts, or crash reports.");
      assert.deepEqual(guestCalls.filter(call => /\/api\/artists\//.test(call.path)), [], "Social controls must not navigate to or load the post's artist.");
    } else if (item.kind.startsWith("forms-")) {
      await semanticFormCase(page, origin, item, state, { landing, feed, you });
    } else if (item.kind.startsWith("login")) {
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
    } else if (item.kind === "switch" || item.kind === "switch-canceled") {
      await feed();
      await you(alice);
      await page.getByText("Settings", { exact: true }).click();
      await page.getByText("Switch account", { exact: true }).click();
      await page.getByRole("button", { name: "Fixture Bob, @fixturebob, switch account", exact: true }).click();
      if (item.kind === "switch-canceled") {
        await waitFor(() => typeof state.releaseSwitch === "function", "Switch was not held by the fixture.");
        await page.goBack();
        await page.getByRole("heading", { name: "Your profiles", exact: true }).waitFor({ state: "hidden" });
        const after = await startGuestGuard();
        state.releaseSwitch(); state.releaseSwitch = null;
        await waitFor(() => state.user === null, "Canceled switch left the selected server account active.");
        await page.waitForTimeout(250);
        await assertGuestPrivacy(after);
        await page.reload({ waitUntil: "networkidle" });
        await landing();
        await forceIdentity();
        await page.waitForTimeout(250);
        await assertGuestPrivacy(after);
        assert.equal(state.calls.filter(call => call.path === "/api/me/accounts/switch").length, 1);
        assert.ok(state.calls.some(call => call.path === "/api/logout"));
      } else {
        await feed();
        await you(bob);
        assert.ok(state.calls.some(call => call.phase === "switched" && call.account === bob.id));
        assert.equal(state.calls.some(call => call.phase === "switched" && call.account === alice.id), false, "Switch reused the old account header.");
      }
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
    assert.deepEqual(state.credentialUrlLeaks, [], "Password data entered a request URL.");
    assert.equal([fixturePassword, replacementPassword].some(password => decodeURIComponent(page.url()).includes(password)), false, "Password data entered the browser address.");
    assert.equal(state.consoleErrors.some(message => /TypeError|ReferenceError|Minified React error/.test(message)), false, "Runtime console exception.");
    assert.equal((await page.locator("body").innerText()).includes("Something crashed on our end"), false);
  } catch (error) { failure = error.message; }
  finally {
    state.releaseLogin?.();
    state.releaseSwitch?.();
    await context.close();
  }
  return {
    name: item.name, passed: !failure,
    ...(failure ? { failure, calls: state.calls, pageErrors: state.pageErrors, consoleErrors: state.consoleErrors, routeErrors: state.routeErrors, reports: state.reports, credentialUrlLeaks: state.credentialUrlLeaks } : {}),
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
