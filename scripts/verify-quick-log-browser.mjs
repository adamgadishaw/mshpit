#!/usr/bin/env node
// Current exported app, synthetic member, loopback-only mocked APIs. No real
// server, account, database, post, upload or provider request is used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, ".tmp", "quick-log-browser");
import { twoThousandWordReview } from "./fixtures/concert-review-text.mjs";
export const quickLogReviewText = twoThousandWordReview;
const review = quickLogReviewText;
const featuredReview = "Featured fixture copy must survive the quota fallback.";
const failureCopy = "That didn't post. Your review is still here, give it another try.";
const retryReadyCopy = "Your post is still here. You can try posting again now.";
const featuredQuotaCopy = "You've used today's two Featured posts. Turn off Featured to publish this as a regular post, or try Featured again after the daily quota resets.";
const featuredArtistUser = Object.freeze({
  ...navigationUser,
  name: "Fixture Artist",
  handle: "fixtureartist",
  initials: "FA",
  role: "artist",
  artistName: "Fixture Artist",
  verified: true,
});

export function assertQuickLogPayload(body) {
  assert.equal(body.artist, "Fixture Artist");
  assert.equal(body.venue, "");
  assert.equal(body.city, "Toronto, Ontario, Canada");
  assert.ok(body.date == null || body.date === "", "An explicitly unknown date cannot become today.");
  assert.equal(body.overall, 5);
  assert.equal(body.band, null, "Overall-only rating must not invent a band score.");
  assert.equal(body.room, null, "Overall-only rating must not invent a venue score.");
  assert.equal(body.dims.experience, 0, "Overall selection must not invent a detailed experience rating.");
  for (const key of ["performance", "setlist", "sound", "venue", "crowd"]) assert.equal(body.dims[key], 0);
  assert.equal(body.review, review);
  assert.equal(body.tour, "A remembered tour");
  assert.deepEqual(body.supportingActs, ["MUNA"], "A picked opener suggestion is saved by its catalog name.");
}

async function localServer() {
  const directory = resolve(root, process.env.PIT_QUICK_LOG_BROWSER_DIST || "dist");
  const htmlPath = join(directory, "index.html");
  assert.ok(statSync(htmlPath).isFile(), "Export current web build first.");
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ttf": "font/ttf" };
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

async function scenario(browser, origin, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  const state = { writes: [], errors: [], reports: [], calls: [], closing: false, failureMode: "rate" };
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  await page.addInitScript(user => {
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
  }, navigationUser);
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    if (message.location().url === origin + "/api/posts" && /(?:429|500)/.test(message.text())) return;
    state.errors.push(message.text());
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
    try {
      if (url.origin !== origin) return await route.abort();
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      state.calls.push({ path: url.pathname, method: request.method() });
      if (url.pathname === "/api/client-errors") { state.reports.push(request.postDataJSON()); return await json({ ok: true }); }
      if (url.pathname === "/api/feed/impressions") return await json({ ok: true });
      if (url.pathname === "/api/health") return await json({ ok: true, capabilities: { mediaPublishing: { photos: true, videos: true } } });
      // Opener search: the headliner comes back too and must not be offered.
      if (url.pathname === "/api/artists" && /^mu/i.test(url.searchParams.get("q") || "")) return await json({ artists: [
        { key: "a_fixture_muna", name: "MUNA", genre: "Pop", country: "US" },
        { key: "fixture-artist", name: "Fixture Artist" },
      ] });
      if (url.pathname === "/api/posts" && request.method() === "POST") {
        assert.equal(request.headers()["x-pit-expected-account"], navigationUser.id);
        const body = request.postDataJSON(); assertQuickLogPayload(body); state.writes.push(body);
        if (state.failureMode === "rate") return await json({
          error: "Too many requests, slow down and try again.",
          code: "RATE_LIMITED",
          status: 429,
          retryable: true,
        }, 429, { "Retry-After": "1" });
        if (state.failureMode === "internal") return await json({ error: "Simulated save failure", code: "INTERNAL_ERROR" }, 500);
        assert.ok(body.clientMutationId);
        assert.equal(body.clientMutationId, state.writes[0].clientMutationId, "Retry must preserve its idempotent submission ID.");
        return await json({ post: { ...body, id: "p_quick_log_fixture", user: navigationUser, userId: navigationUser.id, kind: "review", at: Date.now(), likes: 0, comments: 0 }, created: true });
      }
      return await json(fixtureApiResponse(url.pathname, { member: true, method: request.method(), resolvedPath: url.searchParams.get("path") || undefined }));
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message); await route.abort().catch(() => {});
    }
  });
  try {
    await page.goto(origin + "/feed", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Log a show", exact: true }).last().click();
    const artist = page.getByLabel("Artist", { exact: true });
    const city = page.getByLabel("Concert city, region and country", { exact: true });
    const tour = page.getByLabel("Tour or special event name", { exact: true });
    const post = page.getByRole("button", { name: "Post to feed", exact: true });
    const headerPost = page.getByRole("button", { name: "Post", exact: true });
    await artist.waitFor();
    // A new review goes one short step at a time; each step shows all of its
    // own fields without an expansion tap.
    const progress = () => page.getByRole("progressbar", { name: "Review progress", exact: true }).getAttribute("aria-valuetext");
    const next = (name) => page.getByRole("button", { name: `Next: ${name}`, exact: true }).click();
    const jump = (name) => page.getByRole("button", { name: `Go to ${name}`, exact: true }).click();
    const assertPlaceDetails = async () => {
      assert.equal(await tour.isVisible(), true);
      assert.equal(await city.isVisible(), true);
      assert.equal(await page.getByLabel("Public event address, optional", { exact: true }).isVisible(), true);
    };
    const assertRatings = async () => {
      const ratings = page.getByLabel(/^(Overall concert rating|Rating)$/);
      assert.equal(await ratings.count(), 6, "Overall, band, room and crowd ratings must all appear without an expansion tap.");
      for (const rating of await ratings.all()) assert.equal(await rating.isVisible(), true);
    };
    assert.equal(await progress(), "Step 1 of 4: The show");
    await artist.fill("Fixture Artist");
    await page.getByRole("tab", { name: "Online concert review", exact: true }).click();
    assert.equal(await progress(), "Step 1 of 3: The show", "an online review has three steps");
    await page.getByRole("tab", { name: "In person concert review", exact: true }).click();
    await next("Where and when");
    assert.equal(await progress(), "Step 2 of 4: Where and when");
    await assertPlaceDetails();
    await city.fill("Toronto, Ontario, Canada");
    await page.getByRole("button", { name: "I don't remember the concert date", exact: true }).click();
    await page.getByText("Date not remembered", { exact: true }).waitFor();
    await tour.fill("A remembered tour");
    await page.screenshot({ path: join(shots, `quick-log-${width}-where.png`) });
    await next("The music");
    await assertRatings();
    await page.getByLabel("Overall concert rating", { exact: true }).press("End");
    assert.equal(await headerPost.isEnabled(), true, "A city-only show with an unknown date and one rating must be publishable from any step.");
    const overall = page.getByLabel("Overall concert rating", { exact: true });
    await overall.press("ArrowLeft");
    await page.getByLabel("Rating", { exact: true }).first().press("End");
    assert.equal((await overall.locator("..").innerText()).trim(), "4.5", "Five-star performance cannot change overall.");
    await overall.press("End");
    await page.getByRole("button", { name: "Leave performance unrated", exact: true }).click();
    const opener = page.getByLabel("Add an opener", { exact: true });
    await opener.fill("Mu");
    const munaSuggestion = page.getByRole("button", { name: "Add MUNA as an opener", exact: true });
    await munaSuggestion.waitFor();
    assert.equal(await page.getByRole("button", { name: "Add Fixture Artist as an opener", exact: true }).count(), 0, "The headliner is never suggested as its own opener.");
    await opener.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, `quick-log-${width}-opener-suggestions.png`) });
    await munaSuggestion.click();
    await page.getByRole("button", { name: "Remove MUNA", exact: true }).waitFor();
    assert.equal(await opener.inputValue(), "", "Picking a suggestion clears the opener input.");
    assert.equal(await munaSuggestion.count(), 0);
    await page.getByText("BAND, ROOM & CROWD", { exact: false }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, `quick-log-${width}-ratings.png`) });
    await next("Your story");
    assert.equal(await progress(), "Step 4 of 4: Your story");
    const reviewInput = page.getByPlaceholder("What made the night? Be honest - this is what people read.", { exact: true });
    const overflow = "x".repeat(31999) + "😀";
    await reviewInput.fill(overflow);
    await page.getByText(/32,001 \/ 32,000 characters after formatting cleanup/).waitFor();
    assert.equal(await post.isDisabled(), true);
    assert.equal(await reviewInput.inputValue(), overflow, "Overflow text must remain intact.");
    await reviewInput.fill("  " + "x".repeat(31998) + "😀" + "  ");
    await page.getByText(/32,000 \/ 32,000 characters after formatting cleanup/).waitFor();
    assert.equal(await post.isEnabled(), true);
    await reviewInput.fill(review);
    await page.screenshot({ path: join(shots, `quick-log-${width}-details.png`) });
    await post.click();
    await page.getByText(/Posting is paused for \d+ second.*Your post is still here\./).waitFor();
    const rateLimitedAttempts = state.writes.length;
    assert.equal(rateLimitedAttempts, 1, "A 429 response must not be retried automatically.");
    assert.equal(await post.isDisabled(), true, "Retry-After must temporarily disable repeated publishing taps.");
    await post.dispatchEvent("click");
    await page.waitForTimeout(100);
    assert.equal(state.writes.length, rateLimitedAttempts, "A click during the cooldown must not start another request.");
    assert.equal(await artist.inputValue(), "Fixture Artist");
    assert.equal(await reviewInput.inputValue(), review);
    await page.getByText(retryReadyCopy, { exact: true }).waitFor();
    assert.equal(await post.isEnabled(), true);

    state.failureMode = "internal";
    await post.click();
    await page.getByText(failureCopy, { exact: true }).waitFor();
    const failedAttempts = state.writes.length;
    assert.ok(failedAttempts >= 1); assert.equal(await artist.inputValue(), "Fixture Artist");
    assert.equal(await city.inputValue(), "Toronto, Ontario, Canada"); assert.equal(await reviewInput.inputValue(), review);
    // Every step still holds what was entered after a failed save.
    await jump("Where and when");
    await assertPlaceDetails();
    assert.equal(await tour.inputValue(), "A remembered tour");
    await page.getByText("Date not remembered", { exact: true }).waitFor();
    await jump("The music");
    await assertRatings();
    await page.getByText("5.0", { exact: true }).waitFor();
    await jump("Your story");
    assert.equal(await reviewInput.inputValue(), review);
    assert.equal(await post.isEnabled(), true);
    await page.getByText(failureCopy, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, `quick-log-${width}-failed-save.png`) });
    state.failureMode = null;
    await post.click();
    await artist.waitFor({ state: "hidden" });
    await page.getByText("See more", { exact: true }).first().click();
    await page.getByText(review, { exact: true }).waitFor();
    await page.getByRole("button", {
      name: "Overall 5.0 out of 5. Show the rating breakdown.", exact: true,
    }).waitFor();
    const publishedText = await page.locator("body").innerText();
    assert.doesNotMatch(publishedText, /Band 0\.0|Room 0\.0|Night 2\.5/, "Unrated dimensions must not become zero scores or halve the remembered experience.");
    assert.match(publishedText, /5\.0/, "The published card must retain the member's overall experience score.");
    await page.getByText(review, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, `quick-log-${width}-published.png`) });
    assert.equal(state.writes.length, failedAttempts + 1);
    assert.ok(state.writes.every(body => body.clientMutationId === state.writes[0].clientMutationId));
    assert.deepEqual(state.calls.filter(call => call.method !== "GET" && call.path !== "/api/feed/impressions").map(call => call.path), Array(state.writes.length).fill("/api/posts"));
    assert.equal(state.calls.some(call => call.path === "/api/artists/resolve"), false, "Typing must not trigger a remote artist lookup.");
    assert.deepEqual(state.reports, []); assert.deepEqual(state.errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    console.log(JSON.stringify({ name: `quick-log-${width}`, passed: true, simulatedPosts: state.writes.length }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `quick-log-${width}-failed.png`) }).catch(() => {});
    console.error(JSON.stringify({ error: error.message, state, body: (await page.locator("body").innerText()).slice(-7000) }));
    throw error;
  } finally { state.closing = true; await context.close(); }
}

async function featuredQuotaScenario(browser, origin, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: "block" });
  const state = { writes: [], errors: [], reports: [], calls: [], closing: false };
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  await page.addInitScript(user => {
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
  }, featuredArtistUser);
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    if (message.location().url === origin + "/api/posts" && /429/.test(message.text())) return;
    state.errors.push(message.text());
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
    try {
      // Every non-loopback request is aborted before it can leave this isolated
      // browser context. The scenario never touches production or a real account.
      if (url.origin !== origin) return await route.abort();
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      state.calls.push({ path: url.pathname, method: request.method() });
      if (url.pathname === "/api/client-errors") { state.reports.push(request.postDataJSON()); return await json({ ok: true }); }
      if (url.pathname === "/api/feed/impressions") return await json({ ok: true });
      if (url.pathname === "/api/health") return await json({ ok: true, capabilities: { mediaPublishing: { photos: true, videos: true } } });
      if (url.pathname === "/api/me") return await json({ user: featuredArtistUser });
      if (url.pathname === "/api/posts" && request.method() === "POST") {
        assert.equal(request.headers()["x-pit-expected-account"], featuredArtistUser.id);
        const body = request.postDataJSON(); state.writes.push(body);
        assert.equal(body.kind, "status");
        assert.equal(body.review, featuredReview);
        assert.ok(body.clientMutationId);
        if (state.writes.length === 1) {
          assert.equal(body.campaign?.version, 1);
          assert.ok(body.campaign?.treatment, "The first attempt must remain a Featured post.");
          return await json({
            error: "Featured artist posts are limited to two per day. Turn off Featured to publish this as a regular post, or try Featured again after the daily quota resets.",
            code: "ARTIST_CAMPAIGN_LIMIT",
            status: 429,
            retryable: true,
          }, 429, { "Retry-After": "3600" });
        }
        assert.equal(state.writes.length, 2, "The quota fallback must perform exactly one regular-post write.");
        assert.equal(body.campaign, null, "Switching to Share must remove Featured presentation metadata.");
        assert.equal(body.clientMutationId, state.writes[0].clientMutationId, "The regular fallback must keep the idempotent submission ID.");
        return await json({ post: { ...body, id: "p_featured_quota_fixture", user: featuredArtistUser, userId: featuredArtistUser.id, kind: "status", at: Date.now(), likes: 0, comments: 0 }, created: true });
      }
      return await json(fixtureApiResponse(url.pathname, { member: true, method: request.method(), resolvedPath: url.searchParams.get("path") || undefined }));
    } catch (error) {
      if (state.closing || /closed|disposed|handled|aborted|cancelled/i.test(error.message)) return;
      state.errors.push(error.message); await route.abort().catch(() => {});
    }
  });
  try {
    await page.goto(origin + "/feed", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Make a post", { exact: true }).last().click();
    const composerText = page.getByPlaceholder("Write about music, a show, or what you plan to see next...", { exact: true });
    await composerText.waitFor();
    const featured = page.getByRole("switch", { name: "Make this a featured artist post", exact: true });
    await featured.click();
    await composerText.fill(featuredReview);
    const submit = page.getByRole("button", { name: "Post", exact: true }).last();
    assert.equal(await submit.isEnabled(), true);
    await submit.click();

    await page.getByText(featuredQuotaCopy, { exact: true }).waitFor();
    assert.equal(state.writes.length, 1);
    assert.equal(await submit.isDisabled(), true, "Featured must stay blocked after its daily quota is exhausted.");
    await submit.dispatchEvent("click");
    await page.waitForTimeout(100);
    assert.equal(state.writes.length, 1, "A disabled Featured submit must not repeat the rejected write.");
    assert.equal(await composerText.inputValue(), featuredReview, "The quota response must not discard draft text.");
    await page.screenshot({ path: join(shots, `quick-log-featured-${width}-quota.png`) });

    await featured.click();
    assert.equal(await composerText.inputValue(), featuredReview, "Switching to Share must retain the draft text.");
    assert.equal(await submit.isEnabled(), true, "The Featured quota must not disable an ordinary post.");
    await submit.click();
    await composerText.waitFor({ state: "hidden" });
    await page.getByText(featuredReview, { exact: true }).waitFor();

    assert.equal(state.writes.length, 2);
    assert.equal(state.writes[1].campaign, null);
    assert.deepEqual(state.calls.filter(call => call.method !== "GET" && call.path !== "/api/feed/impressions").map(call => call.path), ["/api/posts", "/api/posts"]);
    assert.deepEqual(state.reports, []);
    assert.deepEqual(state.errors, []);
    console.log(JSON.stringify({ name: `quick-log-featured-quota-${width}`, passed: true, simulatedPosts: state.writes.length }));
  } catch (error) {
    await page.screenshot({ path: join(shots, `quick-log-featured-${width}-failed.png`) }).catch(() => {});
    console.error(JSON.stringify({ error: error.message, state, body: (await page.locator("body").innerText()).slice(-7000) }));
    throw error;
  } finally { state.closing = true; await context.close(); }
}

async function restoredScoringScenario(browser, origin, width, cleared = false) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  const writes = [], errors = [];
  const draft = { id: "draft_scoring_fixture", ownerId: navigationUser.id, postType: "show", artist: "Fixture Artist", city: "Toronto", date: "", dims: { experience: 4 }, review: "Draft words survive restoration.", ...(cleared ? { overallRating: 0 } : {}) };
  await page.addInitScript(({ user, draft }) => {
    localStorage.setItem("pit_theme", "stage");
    localStorage.setItem("pit.session", JSON.stringify(user));
    localStorage.setItem("pit.users", JSON.stringify([user]));
    localStorage.setItem("pit.drafts", JSON.stringify([draft]));
  }, { user: navigationUser, draft });
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return await route.abort();
    if (!url.pathname.startsWith("/api/")) return await route.continue();
    if (url.pathname === "/api/feed/impressions") return await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    if (url.pathname === "/api/health") return await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, capabilities: { mediaPublishing: { photos: true, videos: true } } }) });
    let body;
    if (url.pathname === "/api/posts" && request.method() === "POST") {
      const posted = request.postDataJSON(); writes.push(posted);
      body = { post: { ...posted, id: "p_restored_fixture", kind: "review", userId: navigationUser.id, user: navigationUser, at: Date.now(), likes: 0, comments: 0 }, created: true };
    } else body = fixtureApiResponse(url.pathname, { member: true, method: request.method() });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  try {
    await page.goto(origin + "/feed");
    await page.getByRole("button", { name: "Log a show", exact: true }).last().click();
    await page.getByRole("button", { name: "Resume Fixture Artist", exact: true }).click();
    await page.getByRole("button", { name: "Go to The music", exact: true }).click();
    const overall = page.getByLabel("Overall concert rating", { exact: true });
    assert.equal((await overall.locator("..").innerText()).trim(), cleared ? "—" : "4.0", "Only a missing overall receives the old draft's computed score.");
    const post = page.getByRole("button", { name: "Post", exact: true });
    assert.equal(await post.isEnabled(), !cleared);
    await page.getByLabel("Rating", { exact: true }).first().press("End");
    assert.equal((await overall.locator("..").innerText()).trim(), cleared ? "—" : "4.0", "Detailed ratings stay independent after restore.");
    if (cleared) assert.equal(await post.isDisabled(), true, "Detailed scores cannot repopulate a cleared overall.");
    else {
      await page.getByRole("button", { name: "Clear overall experience rating", exact: true }).click();
      assert.equal(await post.isDisabled(), true);
    }
    await overall.press("Home");
    for (let i = 0; i < 4; i++) await overall.press("ArrowRight");
    assert.equal((await overall.locator("..").innerText()).trim(), "2.0");
    await page.getByRole("button", { name: "Go to Your story", exact: true }).click();
    assert.equal(await page.getByPlaceholder("What made the night? Be honest - this is what people read.", { exact: true }).inputValue(), draft.review);
    await post.click();
    await page.getByRole("button", { name: "Overall 2.0 out of 5. Show the rating breakdown.", exact: true }).waitFor();
    assert.equal(writes.length, 1); assert.equal(writes[0].overall, 2);
    assert.equal(writes[0].dims.performance, 5); assert.equal(writes[0].dims.experience, 4);
    assert.equal(writes[0].review, draft.review); assert.deepEqual(errors, []);
    await page.screenshot({ path: join(shots, `restored-score-${width}-${cleared}.png`) });
    console.log(JSON.stringify({ name: `restored-score-${width}-${cleared ? "cleared" : "old"}`, passed: true }));
  } finally { await context.close(); }
}

async function legacyEditScenario(browser, origin, width, online = false) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  const writes = [], errors = [];
  const legacyText = "Legacy music and memories. ".repeat(1400);
  let stored = { id: "p_legacy_edit_fixture", kind: "review", experienceType: "in_person", artist: "Fixture Artist", city: "Toronto", venue: "", date: "", overall: 4.2, band: null, room: 3.7, dims: {}, review: legacyText, userId: navigationUser.id, user: navigationUser, at: Date.now(), version: 1, likes: 0, comments: 0, photos: [] };
  if (online) stored = { ...stored, experienceType: "online", venue: "", city: "", band: null, room: null, onlineTitle: "Old online concert", youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", youtubeVideoId: "dQw4w9WgXcQ" };
  await page.addInitScript(user => {
    localStorage.setItem("pit_theme", "stage"); localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user]));
  }, navigationUser);
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return await route.abort();
    if (!url.pathname.startsWith("/api/")) return await route.continue();
    if (url.pathname === "/api/feed/impressions") return await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    if (url.pathname === "/api/health") return await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, capabilities: { mediaPublishing: { photos: true, videos: true } } }) });
    let body;
    if (url.pathname === "/api/posts/" + stored.id) {
      if (request.method() === "PATCH") { const change = request.postDataJSON(); writes.push(change); stored = { ...stored, ...change, version: stored.version + 1 }; }
      body = { post: stored };
    } else if (url.pathname.startsWith("/api/feed")) body = { posts: [stored], hasMore: false, hiddenPostIds: [] };
    else body = fixtureApiResponse(url.pathname, { member: true, method: request.method() });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  try {
    await page.goto(origin + "/feed");
    await page.getByRole("button", { name: "Edit post", exact: true }).first().click();
    const input = page.getByPlaceholder(online ? "What stood out about this concert?" : "What made the night? Be honest - this is what people read.", { exact: true });
    assert.equal(await input.inputValue(), legacyText);
    const save = page.getByRole("button", { name: "Save changes", exact: true });
    assert.equal(await save.isEnabled(), true, "An unchanged long legacy review stays editable.");
    if (online) {
      assert.equal((await page.getByLabel("Online concert rating", { exact: true }).locator("..").locator("..").innerText()).includes("4.2"), true);
      await page.getByLabel("Online concert or video title", { exact: true }).fill("Updated online concert");
    } else await page.getByLabel("Concert city, region and country", { exact: true }).fill("Ottawa");
    await save.click(); await input.waitFor({ state: "hidden" });
    assert.equal(writes.length, 1);
    for (const key of ["overall", "band", "room", "review", ...(!online ? ["dims"] : [])]) assert.equal(Object.hasOwn(writes[0], key), false, key + " must be omitted when untouched");
    assert.equal(stored.review, legacyText); assert.equal(stored.overall, 4.2);
    await page.getByRole("button", { name: "Edit post", exact: true }).first().click();
    await input.fill("Shortened legacy review; the music stays with me.");
    await save.click(); await input.waitFor({ state: "hidden" });
    assert.equal(writes.length, 2);
    for (const key of ["overall", "band", "room", ...(!online ? ["dims"] : [])]) assert.equal(Object.hasOwn(writes[1], key), false, key + " must survive a text-only edit");
    assert.equal(writes[1].review, "Shortened legacy review; the music stays with me.");
    assert.equal(stored.overall, 4.2); assert.equal(stored.room, online ? null : 3.7); assert.equal(stored.band, null); assert.deepEqual(stored.dims, {});
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(shots, `legacy-edit-${width}-${online ? "online" : "in-person"}.png`) });
    console.log(JSON.stringify({ name: `legacy-edit-${width}-${online ? "online" : "in-person"}`, passed: true }));
  } finally { await context.close(); }
}

export async function main() {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
  mkdirSync(shots, { recursive: true });
  const { server, origin } = await localServer(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    for (const width of [375, 1280]) await scenario(browser, origin, width);
    for (const width of [375, 1280]) await featuredQuotaScenario(browser, origin, width);
    for (const width of [375, 1280]) {
      await restoredScoringScenario(browser, origin, width);
      await restoredScoringScenario(browser, origin, width, true);
      await legacyEditScenario(browser, origin, width);
      await legacyEditScenario(browser, origin, width, true);
    }
    console.log(JSON.stringify({ passed: 12, failed: 0, network: "isolated fixtures only", screenshots: shots }));
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
