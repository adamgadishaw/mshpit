#!/usr/bin/env node
// Real exported website, synthetic account/photos and intercepted loopback API.
// No production account, storage, database, or external request is used.
import assert from "node:assert/strict";
import sharp from "sharp";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { localServer } from "./verify-artist-account-browser.mjs";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = join(root, ".tmp", "profile-edit-browser");
const png = await sharp({ create: { width: 640, height: 640, channels: 3, background: "#c66d34" } }).png().toBuffer();
const oldPhoto = "https://media.example.test/profile-old.png";
const newPhoto = "https://media.example.test/profile-new.png";

async function scenario(browser, origin, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const state = { user: { ...navigationUser, role: "admin", genres: [], name: "Profile Fixture", bio: "Existing bio", home: null, avatarUri: oldPhoto },
    patches: [], rejectedPatches: [], presigns: [], transfers: 0, finalizes: 0, errors: [], diagnostics: [], closing: false };
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  await page.addInitScript(user => {
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
  }, state.user);
  page.on("pageerror", error => state.errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.origin === "https://media.example.test") return await route.fulfill({ contentType: "image/png", body: png });
      if (url.origin !== origin) return await route.abort();
      if (url.pathname === "/fixture-profile-put") {
        assert.equal(method, "PUT"); assert.equal(request.headers()["if-none-match"], "*");
        assert.ok(request.postDataBuffer().length > 0); state.transfers++;
        return await route.fulfill({ status: 200, body: "" });
      }
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      if (url.pathname === "/api/client-errors") { state.diagnostics.push(request.postDataJSON()); return await json({ ok: true }); }
      if (url.pathname === "/api/admin/moderation") return await json({ reports: [], posts: [], users: [] });
      if (url.pathname === "/api/admin/artist-requests") return await json({ requests: [] });
      if (url.pathname === "/api/me") {
        if (method === "PATCH") {
          assert.equal(request.headers()["x-pit-expected-account"], state.user.id);
          const patch = request.postDataJSON();
          assert.equal(Object.hasOwn(patch, "genres"), false, "untouched empty genres must not accompany another edit");
          if (patch.handle === "taken_fixture") {
            state.rejectedPatches.push(patch);
            return await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "That username is taken. Choose another one.", code: "CONFLICT" }) });
          }
          state.patches.push(patch);
          state.user = { ...state.user, ...patch, profileUpdatedAt: Date.now() };
        } else assert.equal(method, "GET");
        return await json({ user: state.user });
      }
      if (url.pathname === `/api/users/${state.user.id}`) return await json({ user: state.user, followers: 0, following: 0, isFollowing: false });
      if (url.pathname === "/api/media/presign") {
        assert.equal(method, "POST"); assert.equal(request.headers()["x-pit-expected-account"], state.user.id);
        const body = request.postDataJSON(); assert.equal(body.purpose, "avatar"); assert.ok(body.fileSize > 0);
        state.presigns.push(body);
        return await json({ method: "PUT", uploadUrl: `${origin}/fixture-profile-put`, storageScope: "private", publicUrl: null,
          storageLocator: `pit-private:users/${state.user.id}/avatar/profile-fixture.jpg`, descriptorId: "profile-fixture", finalizeToken: "fixture-token",
          requiredHeaders: { "Content-Type": body.contentType, "If-None-Match": "*" } });
      }
      if (url.pathname === "/api/media/finalize") {
        assert.equal(method, "POST"); assert.equal(request.headers()["x-pit-expected-account"], state.user.id);
        assert.deepEqual(request.postDataJSON(), { finalizeToken: "fixture-token" }); state.finalizes++;
        return await json({ descriptorId: "profile-fixture", publicUrl: newPhoto });
      }
      assert.equal(method, "GET", `Unexpected fixture write: ${method} ${url.pathname}`);
      return await json(fixtureApiResponse(url.pathname, { member: true, method, resolvedPath: url.searchParams.get("path") || undefined }));
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message); await route.abort().catch(() => {});
    }
  });
  const openEditor = async () => {
    await page.getByRole("button", { name: "Manage profile", exact: true }).click();
    await page.getByRole("heading", { name: "Edit your profile", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "Save profile", exact: true }).isEnabled(), true);
  };
  try {
    await page.goto(origin + "/you", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Personalize your profile", exact: true }).waitFor();
    await page.getByText("Optional: add your city. These details appear on your public profile.", { exact: true }).waitFor();
    await page.screenshot({ path: join(evidence, `profile-${width}-guidance.png`), fullPage: true });
    await page.getByRole("button", { name: "Dismiss profile suggestions" }).click();
    assert.equal(await page.getByRole("heading", { name: "Personalize your profile", exact: true }).count(), 0);
    assert.deepEqual(state.patches, [], "Dismissing suggestions must never write a profile.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Review profile details", exact: true }).click();
    await page.getByRole("heading", { name: "Edit your profile", exact: true }).waitFor();
    await page.getByText("No music choices yet. You can add them now or save your other changes first.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isEnabled(), true);
    await page.getByPlaceholder("Your name", { exact: true }).fill("Bad_Name");
    await page.getByRole("alert").filter({ hasText: "no underscores or emoji" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isEnabled(), false);
    await page.getByPlaceholder("Your name", { exact: true }).fill("Profile Fixture");
    const choosing = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Change profile photo", exact: true }).first().click();
    await (await choosing).setFiles({ name: "synthetic-profile.png", mimeType: "image/png", buffer: png });
    await page.getByRole("dialog", { name: "Adjust profile photo" }).waitFor();
    await page.getByRole("button", { name: "Use photo", exact: true }).click();
    await page.getByRole("dialog", { name: "Adjust profile photo" }).waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isEnabled(), true);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("heading", { name: "Edit your profile", exact: true }).waitFor({ state: "hidden" });
    assert.deepEqual(state.patches, [{ avatarUri: newPhoto }]);
    assert.equal(state.transfers, 1); assert.equal(state.finalizes, 1);
    await page.reload({ waitUntil: "domcontentloaded" }); await openEditor();
    await page.locator('img[src*="profile-new.png"]').first().waitFor();
    await page.getByPlaceholder("Your name", { exact: true }).fill("Saved Fixture");
    await page.getByPlaceholder("Tell people about yourself", { exact: true }).fill("Saved profile text");
    await page.getByPlaceholder("username", { exact: true }).fill("taken_fixture");
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "That username is taken. Choose another one." }).first().waitFor();
    assert.equal(await page.getByPlaceholder("Your name", { exact: true }).inputValue(), "Saved Fixture");
    assert.equal(state.rejectedPatches.length, 1);
    await page.getByPlaceholder("username", { exact: true }).fill(state.user.handle);
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    await page.getByRole("heading", { name: "Edit your profile", exact: true }).waitFor({ state: "hidden" });
    assert.deepEqual(state.patches[1], { name: "Saved Fixture", bio: "Saved profile text" });
    await page.reload({ waitUntil: "domcontentloaded" }); await openEditor();
    assert.equal(await page.getByPlaceholder("Your name", { exact: true }).inputValue(), "Saved Fixture");
    assert.equal(await page.getByPlaceholder("Tell people about yourself", { exact: true }).inputValue(), "Saved profile text");
    assert.deepEqual(state.user.genres, []); assert.equal(state.user.avatarUri, newPhoto);
    assert.deepEqual(state.errors, []);
    await page.screenshot({ path: join(evidence, `profile-${width}-saved.png`), fullPage: true });
    state.user = { ...state.user, genres: ["Rock"], home: { city: "Toronto", lat: 43.65, lng: -79.38 } };
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Manage profile", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Personalize your profile", exact: true }).count(), 0, "A profile with all suggested details needs no nudge.");
    return { width, passed: true, patches: state.patches, unrelatedSavesKeptGenresEmpty: true, sourceTransfers: state.transfers, persistedAcrossReload: true, actionableConflictRetainedDraft: state.rejectedPatches.length === 1 };
  } catch (error) {
    await page.screenshot({ path: join(evidence, `profile-${width}-failed.png`) }).catch(() => {});
    console.error(JSON.stringify({ width, error: error.message, errors: state.errors, diagnostics: state.diagnostics, presigns: state.presigns, transfers: state.transfers, finalizes: state.finalizes, body: (await page.locator("body").innerText()).slice(-5000) }));
    throw error;
  } finally { state.closing = true; await context.close(); }
}

export async function main() {
  const require = createRequire(import.meta.url), { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
  mkdirSync(evidence, { recursive: true });
  const { server, origin } = await localServer(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    const results = [];
    for (const width of [375, 1280]) results.push(await scenario(browser, origin, width));
    const receipt = { passed: results.length, failed: 0, network: "isolated fixtures only", results };
    writeFileSync(join(evidence, "results.json"), JSON.stringify(receipt, null, 2) + "\n");
    console.log(JSON.stringify(receipt));
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
