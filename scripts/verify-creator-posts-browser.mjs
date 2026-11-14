// Real exported web app, loopback-only API/media fixtures. No real account,
// upload, provider, message or notification is created by this acceptance run.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { localServer } from "./verify-artist-account-browser.mjs";
import { fixtureApiResponse, navigationUser, navigationArtist } from "./verify-navigation-browser.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
const shots = resolve(".tmp/creator-browser"); mkdirSync(shots, { recursive: true });
const { server, origin } = await localServer();
const browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
try {
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    const actor = { ...navigationUser, role: "artist", artistName: navigationArtist.name };
    const entity = { entityType: "artist", entityKey: navigationArtist.name.toLowerCase(), name: navigationArtist.name };
    const state = { failSave: true, writes: [], posts: [], errors: [], uploads: 0 };
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    page.on("pageerror", error => state.errors.push(error.message));
    await page.addInitScript(value => {
      localStorage.setItem("pit_theme", "stage"); localStorage.setItem("pit.session", JSON.stringify(value)); localStorage.setItem("pit.users", JSON.stringify([value]));
    }, actor);
    const asset = { id: "ma_creator_fixture01", kind: "image", status: "ready", url: "https://media.example.test/creator.png", width: 1, height: 1, mimeType: "image/png" };
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url.origin === "https://media.example.test") return route.fulfill({ contentType: "image/png", body: png });
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/fixture-upload") return route.fulfill({ status: 200, body: "" });
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (url.pathname === "/api/me") return json({ user: actor });
      if (url.pathname === "/api/me/creator-entities") return json({ entities: [entity] });
      if (url.pathname.startsWith("/api/creators/") && url.pathname.endsWith("/posts")) return json({ posts: state.posts });
      if (url.pathname.endsWith("/follow") || url.pathname.endsWith("/notifications")) return json({ following: true, notifyUpdates: true, notifications: [], unread: 0 });
      if (url.pathname === "/api/artist-account") return json({ ok: true, user: actor, artist: navigationArtist, profile: { ownerId: actor.id, feedEnabled: true }, verification: { status: "not_requested" }, identityReview: { held: false, status: "clear" } });
      if (/^\/api\/artists\/[^/]+\/profile$/.test(url.pathname)) return json({ artist: navigationArtist, profile: { ownerId: actor.id, feedEnabled: true }, posts: [], legacyProfile: false });
      if (url.pathname === "/api/health") return json({ ok: true, capabilities: { mediaPublishing: { photos: true, videos: true, pipeline: "private-derivative-v1", sourceTypes: ["video/mp4"] } } });
      if (url.pathname === "/api/media/assets" && request.method() === "POST") {
        state.uploads++;
        return json({ asset: { id: asset.id, status: "upload_pending" }, upload: { method: "PUT", uploadUrl: `${origin}/fixture-upload`, storageScope: "private", storageLocator: `pit-private:users/${actor.id}/post/creator.png`, requiredHeaders: { "Content-Type": "image/png", "If-None-Match": "*" } } });
      }
      if (url.pathname.startsWith(`/api/media/assets/${asset.id}`)) return json({ asset, finalize: { state: "ready" } });
      if (url.pathname === "/api/posts" && request.method() === "POST") {
        const body = request.postDataJSON(); state.writes.push(body);
        assert.equal(request.headers()["x-pit-expected-account"], actor.id);
        if (state.failSave) return json({ error: "Fixture connection failed. Your draft is safe.", code: "VALIDATION_FAILED" }, 400);
        const post = { ...body, id: "p_creator_fixture", userId: actor.id, user: actor, artist: actor.artistName, artistKey: entity.entityKey,
          creatorUpdate: { ...body.creatorUpdate, entityName: entity.name }, media: [asset], photos: [asset.url], createdAt: Date.now(), timeAgo: "now", likes: 0, comments: 0 };
        state.posts = [post]; return json({ id: post.id, post });
      }
      return json(fixtureApiResponse(url.pathname, { member: true, method: request.method(), resolvedPath: url.searchParams.get("path") || undefined }));
    });
    try {
      await page.goto(origin + "/you", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Manage profile", exact: true }).last().click();
      await page.getByRole("button", { name: "Post to followers", exact: true }).first().click();
      const postButton = page.getByRole("button", { name: "Post", exact: true }).first();
      await page.getByLabel("Title", { exact: true }).waitFor();
      assert.equal(await postButton.isDisabled(), true);
      await page.getByLabel("Title", { exact: true }).fill("New dates for the autumn tour");
      await page.getByRole("button", { name: "Show dates", exact: true }).click();
      assert.equal(await postButton.isDisabled(), true);
      await page.getByRole("radio", { name: "Day 20", exact: true }).first().click();
      await page.getByLabel("Venue", { exact: true }).fill("The Phoenix");
      await page.getByLabel("City and country", { exact: true }).fill("Toronto, Canada");
      await page.getByLabel("Ticket link (optional)", { exact: true }).fill("javascript:alert(1)");
      assert.equal(await postButton.isDisabled(), true);
      await page.getByLabel("Ticket link (optional)", { exact: true }).fill("https://example.test/tour");
      await page.getByLabel("Title", { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(shots, `show-${width}.png`) });
      page.once("dialog", dialog => dialog.dismiss());
      await page.getByRole("button", { name: "Close", exact: true }).first().click();
      assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "New dates for the autumn tour");
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: "Close", exact: true }).first().click();
      await page.getByRole("heading", { name: "Post to followers", exact: true }).waitFor({ state: "hidden" });
      assert.equal(state.writes.length, 0);
      await page.getByRole("button", { name: "Post to followers", exact: true }).first().click();
      await page.getByRole("button", { name: "Resume New dates for the autumn tour", exact: true }).click();
      assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "New dates for the autumn tour");
      assert.equal(await page.getByLabel("Venue", { exact: true }).inputValue(), "The Phoenix");
      await page.getByRole("button", { name: "Photo / video", exact: true }).click();
      const choosing = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Add media", exact: true }).click();
      await (await choosing).setFiles({ name: "creator.png", mimeType: "image/png", buffer: png });
      await page.getByRole("button", { name: "Remove media 1", exact: true }).waitFor();
      assert.equal(state.uploads, 1);
      await postButton.click();
      await page.getByRole("alert").filter({ hasText: "Your update is still here" }).waitFor();
      assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "New dates for the autumn tour");
      assert.equal(state.writes.length, 1);
      await page.screenshot({ path: join(shots, `retry-${width}.png`) });
      state.failSave = false;
      await postButton.click();
      await page.getByRole("heading", { name: "Post to followers", exact: true }).waitFor({ state: "hidden" });
      assert.equal(state.writes.length, 2);
      assert.equal(state.writes[0].clientMutationId, state.writes[1].clientMutationId);
      assert.deepEqual(state.writes[0].creatorUpdate, state.writes[1].creatorUpdate);
      assert.deepEqual(state.writes[1].mediaAssetIds, [asset.id]);
      assert.equal(state.uploads, 1);
      assert.deepEqual(state.errors, []);
      console.log(JSON.stringify({ width, passed: true, uploads: state.uploads, attempts: state.writes.length, sameMutation: true, cancelKeptDraft: true, closeResumed: true }));
    } catch (error) {
      await page.screenshot({ path: join(shots, `failed-${width}.png`) });
      console.error(JSON.stringify({ width, errors: state.errors, body: (await page.locator("body").innerText()).slice(-5000) }));
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
