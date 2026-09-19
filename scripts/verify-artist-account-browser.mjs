#!/usr/bin/env node
// Current exported app; synthetic accounts and loopback-only mocked APIs.
// Never creates a real account, artist, upload, mail delivery or provider request.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureApiResponse, navigationArtist, navigationUser } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "artist-account-browser");
const bio = "Toronto live music, shared by the people who make it. Synthetic artist fixture.";
const saveFailure = "This page could not be saved right now. Your artist details are unchanged.";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
const mediaId = "ma_artist_fixture01";
const mediaUrl = "https://media.example.test/artist-live.png";

export async function localServer() {
  const directory = resolve(root, process.env.PIT_ARTIST_ACCOUNT_BROWSER_DIST || "dist");
  const htmlPath = join(directory, "index.html");
  assert.ok(statSync(htmlPath).isFile(), "Export the current web build before running this script.");
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf" };
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

async function scenario(browser, origin, width, kind) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  const initial = kind === "email" ? null : { ...navigationUser, verified: false,
    ...(["pending", "story", "expired"].includes(kind) ? { role: "artist", artistName: navigationArtist.name } : {}) };
  const storyCode = "MSHPIT-ABCD-EF01-2345-6789";
  const storyChallenge = { id: "av_fixture", method: "instagram_story", artistName: navigationArtist.name, instagramHandle: "fixture.artist", code: storyCode, status: "active", expiresAt: Date.now() + 86_400_000 };
  const state = { user: initial, owns: ["pending", "story", "expired"].includes(kind), verification: ["pending", "expired"].includes(kind) ? "pending" : "not_requested", challenge: kind === "expired" ? { ...storyChallenge, status: "expired", expiresAt: Date.now() - 5000 } : null,
    failChallenge: kind === "story", failSubmission: kind === "story", failSaves: kind === "create", failAccount: kind === "create", writes: [], errors: [], reports: [], calls: [], closing: false, mailChecks: 0 };
  const accountPayload = () => ({ ok: true, user: state.user, artist: state.owns ? navigationArtist : null,
    profile: state.owns ? { ownerId: state.user.id, bio, feedEnabled: true, verified: false } : null,
    verification: { status: state.verification, requestId: state.verification === "pending" ? "ar_fixture" : null },
    verificationChallenge: state.challenge,
    identityReview: { held: kind === "story", status: kind === "story" ? "pending" : "clear", reasons: [], matches: [] },
    pendingArtistIntent: state.user?.pendingArtistIntent || null });
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  await page.addInitScript(user => {
    localStorage.setItem("pit_theme", "stage");
    if (user) { localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user])); }
  }, initial);
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    if (["/api/artist-pages", "/api/artist-account", "/api/artist-verification-challenges", "/api/artist-requests"].map(path => origin + path).includes(message.location().url) && /409|503/.test(message.text())) return;
    state.errors.push(message.text());
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      if (url.origin === "https://media.example.test") return await route.fulfill({ status: 200, contentType: "image/png", body: png });
      if (url.origin !== origin) return await route.abort();
      if (url.pathname === "/fixture-put/artist-live") {
        assert.equal(request.method(), "PUT");
        assert.equal(request.headers()["if-none-match"], "*");
        return await route.fulfill({ status: 200, body: "" });
      }
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      const method = request.method(), body = method === "GET" ? null : request.postDataJSON();
      state.calls.push({ path: url.pathname, method });
      if (url.pathname === "/api/client-errors") { state.reports.push(body); return await json({ ok: true }); }
      if (url.pathname === "/api/me") return await json({ user: state.user });
      if (url.pathname === "/api/health") return await json({ ok: true, capabilities: { mediaPublishing: { photos: true, videos: true, pipeline: "private-derivative-v1", sourceTypes: ["video/mp4", "video/quicktime"] } } });
      if (url.pathname === "/api/signup/handle-availability") return await json({ handle: url.searchParams.get("handle"), available: true });
      if (url.pathname === "/api/signup") {
        assert.equal(kind, "email"); assert.equal(body.artistIntent?.artistName, navigationArtist.name);
        state.user = { ...navigationUser, emailVerified: false, verified: false, pendingArtistIntent: body.artistIntent };
        state.writes.push({ path: url.pathname, body });
        return await json({ created: true, user: state.user });
      }
      if (url.pathname === "/api/verify-email/resend") {
        assert.equal(kind, "email"); state.mailChecks++;
        state.writes.push({ path: url.pathname, body });
        if (state.mailChecks === 1) return await json({ sent: true });
        state.user = { ...state.user, emailVerified: true };
        return await json({ verified: true, sent: false, reason: "already-verified", user: state.user });
      }
      if (url.pathname === "/api/artist-account") { assert.equal(method, "GET"); return await json(state.failAccount ? { error: "Artist account check is temporarily unavailable.", code: "PROVIDER_UNAVAILABLE" } : accountPayload(), state.failAccount ? 503 : 200); }
      if (url.pathname === "/api/artist-pages") {
        assert.equal(method, "POST"); assert.equal(state.user?.emailVerified, true);
        assert.equal(request.headers()["x-pit-expected-account"], navigationUser.id);
        assert.deepEqual(Object.keys(body).sort(), ["artistName", "bio"]);
        assert.equal(body.artistName, navigationArtist.name); assert.equal(body.bio, bio);
        state.writes.push({ path: url.pathname, body });
        if (kind === "duplicate") return await json({ error: "This artist already has a page. Submit a reviewed claim instead.", code: "ARTIST_PAGE_EXISTS" }, 409);
        if (state.failSaves) return await json({ error: saveFailure, code: "PROVIDER_UNAVAILABLE" }, 503);
        state.owns = true; state.user = { ...state.user, role: "artist", artistName: navigationArtist.name, verified: false, pendingArtistIntent: null };
        return await json(accountPayload());
      }
      if (url.pathname === "/api/artist-requests") {
        assert.equal(method, "POST"); assert.ok(["duplicate", "story", "expired"].includes(kind));
        assert.equal(body.artistName, navigationArtist.name);
        if (kind === "duplicate") assert.match(body.note, /official artist website/);
        else { assert.equal(body.challengeId, storyChallenge.id); assert.equal(body.storyUrl, "https://www.instagram.com/stories/fixture.artist/123456/"); assert.ok(body.note.length >= 8); }
        assert.equal(request.headers()["x-pit-expected-account"], navigationUser.id);
        state.writes.push({ path: url.pathname, body });
        if (state.failSubmission) return await json({ error: "The review request could not be saved. Please retry.", code: "PROVIDER_UNAVAILABLE" }, 503);
        state.verification = "pending";
        return await json({ ok: true, id: "ar_fixture" });
      }
      if (url.pathname === "/api/artist-verification-challenges") {
        assert.equal(method, "POST"); assert.equal(body.artistName, navigationArtist.name);
        assert.equal(body.instagramHandle, "fixture.artist"); assert.equal(body.method, "instagram_story");
        state.writes.push({ path: url.pathname, body });
        if (state.failChallenge) return await json({ error: "The verification code is temporarily unavailable. Please retry.", code: "PROVIDER_UNAVAILABLE" }, 503);
        state.challenge = storyChallenge; return await json({ ok: true, challenge: storyChallenge });
      }
      if (url.pathname === "/api/media/assets" && method === "POST") {
        assert.equal(kind, "create"); assert.equal(body.contentType, "image/png");
        assert.equal(body.fileSize, png.length);
        assert.equal(request.headers()["x-pit-expected-account"], navigationUser.id);
        return await json({ asset: { id: mediaId, status: "upload_pending" }, upload: {
          method: "PUT", uploadUrl: `${origin}/fixture-put/artist-live`, storageScope: "private",
          storageLocator: `pit-private:users/${navigationUser.id}/post/${mediaId}.png`,
          requiredHeaders: { "Content-Type": "image/png", "If-None-Match": "*" },
        } });
      }
      if (url.pathname === `/api/media/assets/${mediaId}/finalize`) {
        assert.equal(method, "POST"); assert.equal(body.editRecipe.filter, "original");
        return await json({ asset: { id: mediaId, status: "ready", kind: "image", url: mediaUrl, width: 1, height: 1, mimeType: "image/png" }, finalize: { state: "ready" } });
      }
      if (url.pathname === "/api/posts" && method === "POST") {
        assert.equal(kind, "create"); assert.equal(body.kind, "status");
        assert.equal(body.campaign, null, "Ordinary artist media must not consume the featured promotion allowance.");
        assert.equal(body.photosPublic, 1, "The artist's explicit gallery consent must reach the server.");
        assert.deepEqual(body.photos, [mediaUrl]); assert.deepEqual(body.mediaAssetIds, [mediaId]);
        assert.equal(body.artist, undefined, "Artist attribution remains server-owned, not supplied by this form.");
        state.writes.push({ path: url.pathname, body });
        return await json({ id: "p_artist_fixture" });
      }
      if (/^\/api\/artists\/[^/]+\/profile$/.test(url.pathname)) return await json({ artist: navigationArtist, profile: accountPayload().profile, posts: [], legacyProfile: false });
      if (/^\/api\/artists\/[^/]+\/memorial$/.test(url.pathname)) return await json({ memorial: null });
      return await json(fixtureApiResponse(url.pathname, { member: !!state.user, method, resolvedPath: url.searchParams.get("path") || undefined }));
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message); await route.abort().catch(() => {});
    }
  });
  const screenshot = suffix => page.screenshot({ path: join(shots, `${kind}-${width}-${suffix}.png`) });
  const createButton = () => page.getByRole("button", { name: "CREATE FREE ARTIST PAGE", exact: true });
  try {
    if (kind === "email") {
      await page.goto(origin + "/signup", { waitUntil: "domcontentloaded" });
      await page.getByRole("radio", { name: "Artist or band", exact: true }).click();
      await page.getByLabel("Artist or band name", { exact: true }).fill(navigationArtist.name);
      await page.getByLabel("Name", { exact: true }).fill(navigationUser.name);
      await page.getByLabel("Username", { exact: true }).fill(navigationUser.handle);
      await page.getByLabel("Email", { exact: true }).fill(navigationUser.email);
      await page.getByLabel("Password", { exact: true }).fill("fixture-password1");
      await page.getByRole("button", { name: "Continue to music", exact: true }).click();
      await page.getByRole("checkbox", { name: "Rock", exact: true }).click();
      await page.getByRole("radio", { name: "18+", exact: true }).click();
      await page.getByRole("checkbox", { name: "I agree to the Terms and Privacy policy", exact: true }).click();
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page.getByText("Confirm your email to publish", { exact: true }).waitFor();
      assert.equal(await createButton().isDisabled(), true);
      assert.equal(await page.getByLabel("Artist or band name", { exact: true }).inputValue(), navigationArtist.name);
      await page.getByLabel("Artist biography, optional", { exact: true }).fill(bio);
      await screenshot("email-confirmation");
      await page.getByRole("button", { name: "Send or check confirmation email", exact: true }).click();
      await page.getByText(/Check your inbox for the confirmation link, then return here/).waitFor();
      assert.equal(await createButton().isDisabled(), true);
      assert.equal(state.writes.filter(write => write.path === "/api/artist-pages").length, 0);
      await page.getByRole("button", { name: "Send or check confirmation email", exact: true }).click();
      await page.getByText("Email confirmed. Your artist page details are ready to save.", { exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="button"]')].some(node => node.textContent === "CREATE FREE ARTIST PAGE" && node.getAttribute("aria-disabled") !== "true"));
      assert.equal(await page.getByLabel("Artist biography, optional", { exact: true }).inputValue(), bio);
      await createButton().click();
      await page.getByText("Your artist page is ready", { exact: true }).waitFor();
    } else {
      await page.goto(origin + "/you", { waitUntil: "domcontentloaded" });
      if (["story", "expired"].includes(kind)) {
        await page.getByRole("button", { name: "Manage profile", exact: true }).last().click();
        if (kind === "story") await page.getByText("Your artist page is on identity-review hold", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Request or check verification", exact: true }).click();
        await page.getByRole("radio", { name: "Instagram Story code", exact: true }).click();
        const handle = page.getByLabel("Official artist Instagram handle", { exact: true });
        await handle.fill("@fixture.artist");
        const generate = () => page.getByRole("button", { name: kind === "expired" ? "Generate a fresh Story code" : "Create my Story code", exact: true });
        await generate().click();
        if (kind === "story") {
          await page.getByText("A music or ticket provider is temporarily unavailable.", { exact: true }).waitFor();
          assert.equal(await handle.inputValue(), "@fixture.artist");
          state.failChallenge = false; await generate().click();
        }
        await page.getByText(storyCode, { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Current Story code ready", exact: true }).isDisabled(), true);
        const url = page.getByLabel("Instagram Story URL", { exact: true });
        const send = () => page.getByRole("button", { name: "SEND FOR REVIEW", exact: true });
        await url.fill("https://instagram.com/fixture.artist/");
        assert.equal(await send().isDisabled(), true);
        await url.fill("https://www.instagram.com/stories/fixture.artist/123456/");
        await page.getByText(storyCode, { exact: true }).scrollIntoViewIfNeeded();
        await screenshot("story-proof");
        await send().click();
        if (kind === "story") {
          await page.getByText("A music or ticket provider is temporarily unavailable.", { exact: true }).waitFor();
          assert.equal(await url.inputValue(), "https://www.instagram.com/stories/fixture.artist/123456/");
          assert.equal(await page.getByText(storyCode, { exact: true }).count(), 1);
          state.failSubmission = false; await send().click();
        }
        await page.getByText("Request sent for review", { exact: true }).waitFor();
        assert.equal(state.user.verified, false);
      } else if (kind === "pending") {
        await page.getByRole("button", { name: "Manage profile", exact: true }).last().click();
        await page.getByRole("button", { name: "Live photos & videos", exact: true }).waitFor();
        assert.equal(await page.getByText("VERIFIED ARTIST", { exact: true }).count(), 0);
        await page.getByRole("button", { name: "Request or check verification", exact: true }).click();
        await page.getByRole("button", { name: "REVIEW PENDING", exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "REVIEW PENDING", exact: true }).isDisabled(), true);
        assert.equal(await page.getByLabel("Artist or band name", { exact: true }).isEditable(), false);
        await screenshot("verification-pending");
        assert.equal(state.writes.length, 0);
      } else {
        await page.getByRole("button", { name: "Create or claim artist page", exact: true }).click();
        const name = page.getByLabel("Artist or band name", { exact: true });
        await name.fill(navigationArtist.name);
        await page.getByLabel("Artist biography, optional", { exact: true }).fill(bio);
        if (kind === "create") {
          await page.getByRole("alert").waitFor();
          assert.equal(await createButton().isDisabled(), true);
          assert.equal(state.writes.length, 0);
          state.failAccount = false;
          await page.getByRole("button", { name: "Try again", exact: true }).click();
          await page.waitForFunction(() => [...document.querySelectorAll('[role="button"]')].some(node => node.textContent === "CREATE FREE ARTIST PAGE" && node.getAttribute("aria-disabled") !== "true"));
          assert.equal(await name.inputValue(), navigationArtist.name);
          assert.equal(await page.getByLabel("Artist biography, optional", { exact: true }).inputValue(), bio);
        }
        assert.equal(await page.getByRole("radio", { name: "Create a new artist page", exact: true }).getAttribute("aria-checked"), "true");
        await screenshot("setup");
        await createButton().click();
        if (kind === "duplicate") {
          await page.getByRole("button", { name: "Claim this existing page instead", exact: true }).click();
          assert.equal(await name.inputValue(), navigationArtist.name);
          assert.equal(await page.getByRole("radio", { name: "Claim an existing page", exact: true }).getAttribute("aria-checked"), "true");
          await page.getByLabel("Artist verification details", { exact: true }).fill("My official artist website can confirm ownership. Fixture evidence only.");
          await screenshot("claim");
          await page.getByRole("button", { name: "SEND FOR REVIEW", exact: true }).click();
          await page.getByText("Request sent for review", { exact: true }).waitFor();
          assert.equal(state.owns, false); assert.equal(state.user.role, "fan");
        } else {
          await page.getByRole("alert").waitFor();
          assert.equal(await name.inputValue(), navigationArtist.name);
          assert.equal(await page.getByLabel("Artist biography, optional", { exact: true }).inputValue(), bio);
          state.failSaves = false;
          await createButton().click();
          await page.getByText("Your artist page is ready", { exact: true }).waitFor();
          await page.getByRole("button", { name: "OPEN ARTIST HQ", exact: true }).click();
          await page.getByRole("button", { name: "Live photos & videos", exact: true }).waitFor();
          await page.getByRole("button", { name: "Edit artist page", exact: true }).waitFor();
          assert.equal(await page.getByText("VERIFIED ARTIST", { exact: true }).count(), 0);
          await page.getByRole("button", { name: "Live photos & videos", exact: true }).scrollIntoViewIfNeeded();
          await screenshot("artist-hq");
          await page.getByRole("button", { name: "Live photos & videos", exact: true }).click();
          await page.getByRole("heading", { name: "New post", exact: true }).waitFor();
          assert.equal(await page.getByText("Choose a background for this post", { exact: true }).count(), 0);
          await page.getByRole("button", { name: /Photo \/ video/ }).waitFor();
          await page.getByRole("button", { name: "Photo / video", exact: true }).click();
          const choosing = page.waitForEvent("filechooser");
          await page.getByRole("button", { name: "Add media", exact: true }).click();
          await (await choosing).setFiles({ name: "artist-live.png", mimeType: "image/png", buffer: png });
          await page.getByRole("button", { name: "Remove media 1", exact: true }).waitFor();
          const consent = page.getByRole("checkbox", { name: `Share my photos and videos on ${navigationArtist.name}'s public page`, exact: true });
          await consent.waitFor();
          assert.equal(await consent.getAttribute("aria-checked"), "false", "Gallery permission must start off even for an artist account.");
          await consent.click();
          assert.equal(await consent.getAttribute("aria-checked"), "true");
          await consent.click();
          assert.equal(await consent.getAttribute("aria-checked"), "false", "Artists must be able to keep their post out of page galleries.");
          await consent.click();
          await screenshot("live-media-composer");
          await page.getByRole("button", { name: "Post", exact: true }).last().click();
          await page.waitForURL("**/feed");
          assert.equal(state.writes.filter(write => write.path === "/api/posts").length, 1);
          await page.goto(origin + "/you", { waitUntil: "domcontentloaded" });
          await page.getByRole("button", { name: "Manage profile", exact: true }).last().click();
          await page.getByRole("button", { name: "Promote a concert or release", exact: true }).click();
          await page.getByText("Choose a background for this post", { exact: true }).waitFor();
          await page.getByRole("button", { name: /Photo \/ video/ }).waitFor();
          await screenshot("promo-composer");
          assert.equal(state.user.verified, false);
        }
      }
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(state.reports, []); assert.deepEqual(state.errors, []);
    console.log(JSON.stringify({ name: `artist-${kind}-${width}`, passed: true, simulatedWrites: state.writes.length }));
  } catch (error) {
    await screenshot("failed").catch(() => {});
    console.error(JSON.stringify({ name: `artist-${kind}-${width}`, error: error.message, errors: state.errors, reports: state.reports, calls: state.calls, body: (await page.locator("body").innerText()).slice(-7000) }));
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
    for (const width of [375, 1280]) for (const kind of ["create", "duplicate", "email", "pending", "story", "expired"]) await scenario(browser, origin, width, kind);
    console.log(JSON.stringify({ passed: 12, failed: 0, network: "isolated fixtures only", screenshots: shots }));
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
