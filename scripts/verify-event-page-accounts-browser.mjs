// Actual App -> ShowScreen -> lazy event-account wrapper, isolated API fixtures.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { localServer } from "./verify-artist-account-browser.mjs";
import { fixtureApiResponse, navigationUser, eventPath, postPath, archiveReviewFixture } from "./verify-navigation-browser.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
const shots = resolve(".tmp/event-page-accounts-browser"); mkdirSync(shots, { recursive: true });
const { server, origin } = await localServer();
const browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
const title = "Event updates & page access", firstId = eventPath.split("/").at(-1), secondId = "tm_event_account_second";
const noteText = "I manage this event. Contact the official event office to verify my role.";
const userA = { ...navigationUser, role: "event" }, userB = { ...navigationUser, id: "event-page-second-account", name: "Second account", role: "fan" };
const event = (id, pending = false) => ({ kind: "event", publicEventSnapshot: true, id, path: `/event/${id}`,
  name: id === firstId ? "Fixture Artist Live" : "Second Event", artist: "Fixture Artist", artistKey: pending ? null : "fixture-artist",
  artistIdentityPending: pending, venue: "Fixture Venue", city: "Toronto", date: "2099-10-01", ticketUrl: "https://www.ticketmaster.com/event/fixture" });
const entity = id => ({ entityType: "event", entityKey: `event:${id}`, name: id === firstId ? "Official Event Office" : "Second Event Office", targetKind: "event", targetId: id });
const update = { id: "event-update-fixture", kind: "status", userId: "event-team", user: { name: "Event team", handle: "eventteam" },
  review: "The doors will open at seven.", media: [], photos: [], creatorUpdate: { version: 1, entityType: "event", entityKey: `event:${firstId}`, entityName: "Official Event Office", kind: "update", title: "Doors information" } };
const persistedReview = { ...archiveReviewFixture, artist: "Fixture Artist", artistKey: "fixture-artist", venue: "Fixture Venue", archiveShowKey: "fixture-archive", overall: 4.7 };
const waitFor = async (condition, message) => { const end = Date.now() + 15000; while (!await condition()) { assert.ok(Date.now() < end, message); await new Promise(done => setTimeout(done, 30)); } };
const navigate = (page, path) => page.evaluate(path => { history.pushState({}, "", path); dispatchEvent(new PopStateEvent("popstate")); }, path);

try {
  const filter = process.argv[2] || "";
  for (const width of [390, 1280]) for (const mode of ["claim", "fallback", "excluded", "guest", "event-switch", "account-switch", "owner", "restricted"]) {
    const name = `${mode}-${width}`; if (!name.includes(filter)) continue;
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    const state = { user: mode === "guest" ? null : ["owner", "event-switch", "account-switch", "restricted"].includes(mode) ? userA : { ...navigationUser },
      reads: [], meReads: [], writes: [], errors: [], external: [], pending: false, failClaim: true, held: false, releaseRead: null, releaseClaim: null, closing: false };
    await context.addInitScript(user => { localStorage.setItem("pit_theme", "stage"); if (user) { localStorage.setItem("pit.session", JSON.stringify(user)); localStorage.setItem("pit.users", JSON.stringify([user])); } }, state.user);
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => state.errors.push(error.message));
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
      try {
        if (url.origin !== origin) { state.external.push(url.origin); return await route.abort(); }
        if (!url.pathname.startsWith("/api/")) return await route.continue();
        if (url.pathname === "/api/health") return await json({ ok: true });
        if (url.pathname === "/api/me") { state.meReads.push(state.user?.id || null); return await json({ user: state.user }); }
        if (url.pathname === "/api/login") { state.user = { ...navigationUser }; return await json({ user: state.user }); }
        if (url.pathname === "/api/resolve") {
          const path = url.searchParams.get("path");
          if (path.startsWith("/event/")) return await json({ entity: event(path.split("/").at(-1), mode === "fallback") });
          if (path === "/concert/fixture-archive") return await json({ entity: { ...event(firstId), kind: "concert", path, archiveShowKey: "fixture-archive", overall: 4.3, ratingCount: 17 } });
          if (path === `/post/${update.id}`) return await json({ entity: { kind: "show", id: update.id, path } });
        }
        if (url.pathname === `/api/posts/${update.id}`) return await json({ post: update });
        if (mode === "excluded" && url.pathname === `/api/posts/${persistedReview.id}`) return await json({ post: persistedReview });
        if (url.pathname === `/api/posts/${update.id}/comments`) return await json({ comments: [] });
        if (url.pathname === "/api/artists/archive/reviews") return await json({ reviews: [], total: 0, nextCursor: null });
        if (url.pathname === "/api/event-accounts/target") {
          const id = url.searchParams.get("id"), accountId = state.user?.id || null;
          assert.equal(url.searchParams.get("kind"), "event"); assert.ok([firstId, secondId].includes(id), "Only canonical tour-date IDs can reach the access endpoint");
          const response = { entity: entity(id), claimed: ["owner", "event-switch", "account-switch"].includes(mode), canManage: mode === "owner" || (["event-switch", "account-switch"].includes(mode) && id === firstId && accountId === userA.id),
            canRequest: !!accountId && mode !== "restricted", following: false, notifyUpdates: true, claim: state.pending ? { status: "pending" } : null };
          state.reads.push({ id, accountId, expected: request.headers()["x-pit-expected-account"] });
          assert.equal(request.headers()["x-pit-expected-account"], accountId || "guest");
          if (["event-switch", "account-switch"].includes(mode) && state.reads.length === 1) await new Promise(done => { state.releaseRead = done; });
          if (state.held) return await json({ error: "Page unavailable", code: "NOT_FOUND" }, 404);
          return await json(response);
        }
        if (url.pathname === "/api/event-accounts/claims") {
          const body = request.postDataJSON(); state.writes.push(body);
          assert.equal(request.headers()["x-pit-expected-account"], state.user.id); assert.deepEqual(body, { kind: "event", id: firstId, note: noteText });
          if (state.writes.length === 1) await new Promise(done => { state.releaseClaim = done; });
          if (state.failClaim) return await json({ error: "Synthetic interruption", code: "PROVIDER_UNAVAILABLE" }, 503);
          state.pending = true; return await json({ id: "claim-fixture", status: "pending" });
        }
        if (url.pathname === "/api/me/creator-entities") return await json({ entities: mode === "owner" ? [entity(firstId)] : [] });
        if (url.pathname.startsWith("/api/creators/") && url.pathname.endsWith("/posts")) return await json({ posts: mode === "owner" ? [update] : [] });
        if (url.pathname.startsWith("/api/creators/") && url.pathname.endsWith("/follow")) return await json({ following: false, notifyUpdates: true });
        if (url.pathname === "/api/posts" && method === "POST") {
          const body = request.postDataJSON(); state.writes.push(body); assert.equal(body.creatorUpdate.entityKey, entity(firstId).entityKey);
          return await json({ id: "created-event-update", post: { ...body, id: "created-event-update", userId: state.user.id, user: state.user, media: [], photos: [] } });
        }
        if (/^\/api\/users\/event-page-second-account\//.test(url.pathname)) return await json({ posts: [], hasMore: false });
        return await json(fixtureApiResponse(url.pathname, { member: !!state.user, method, resolvedPath: url.searchParams.get("path") || undefined, archiveReview: mode === "excluded" }));
      } catch (error) {
        if (state.closing || /closed|disposed|handled|aborted|cancelled|canceled/i.test(error.message)) return;
        state.errors.push(error.message); await route.abort().catch(() => {});
      }
    });
    const section = () => page.getByRole("button", { name: title, exact: true });
    const expand = async () => { await section().waitFor(); assert.equal(await section().count(), 1); if (await section().getAttribute("aria-expanded") === "false") await section().click(); };
    try {
      if (mode === "excluded") {
        await page.goto(origin + "/concert/fixture-archive"); await page.getByRole("button", { name: "Reviews", exact: true }).waitFor();
        assert.equal(await section().count(), 0);
        await page.goto(origin + postPath); await page.getByText(archiveReviewFixture.review, { exact: true }).last().waitFor();
        await page.getByRole("link", { name: /View .* show/ }).click();
        await page.getByRole("button", { name: "Reviews", exact: true }).waitFor(); assert.equal(await section().count(), 0); assert.equal(state.reads.length, 0);
      } else {
        await page.goto(origin + eventPath); await section().waitFor();
        assert.equal(await section().getAttribute("aria-expanded"), "false"); assert.equal(state.reads.length, 0, "Access requests and lazy controls start only after expansion");
        await expand();
        if (["event-switch", "account-switch"].includes(mode)) {
          await waitFor(() => state.releaseRead, "First access read should be pending");
          if (mode === "event-switch") await navigate(page, `/event/${secondId}`);
          else {
            state.user = userB;
            await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "pit.auth.epoch.v1", newValue: JSON.stringify({ at: Date.now() }) })));
            await waitFor(() => state.meReads.includes(userB.id), "Account boundary should confirm the new user");
            await page.getByText("Your life's musical journey", { exact: true }).waitFor();
            await navigate(page, eventPath);
          }
          await expand(); await page.getByText("No updates from this page yet.", { exact: true }).waitFor();
          state.releaseRead(); await page.waitForLoadState("networkidle");
          assert.equal(await page.getByRole("button", { name: "Post to followers", exact: true }).count(), 0);
          assert.ok(state.reads.some(read => mode === "event-switch" ? read.id === secondId : read.accountId === userB.id && read.expected === userB.id));
          assert.equal(await section().count(), 1);
        } else if (mode === "owner") {
          const row = page.getByRole("button", { name: "Open update: Doors information", exact: true }); await row.waitFor();
          assert.equal(await page.getByText("Latest updates", { exact: true }).count(), 1);
          await row.click(); await page.waitForURL(`**/post/${update.id}`); await page.getByText("No comments yet. Start the conversation.", { exact: true }).waitFor();
          await page.goBack(); await expand(); await page.getByRole("button", { name: "Post to followers", exact: true }).click();
          await page.getByText("Posting as Official Event Office", { exact: true }).waitFor();
          await page.getByLabel("Title", { exact: true }).fill("Tomorrow's doors information");
          await page.getByRole("button", { name: "Post", exact: true }).first().click();
          await page.getByRole("heading", { name: "Post to followers", exact: true }).waitFor({ state: "hidden" });
          assert.equal(state.writes.length, 1);
        } else if (mode === "restricted") {
          await page.getByRole("button", { name: "Represent this event or festival?", exact: true }).click();
          await page.getByText("Use a separate account dedicated to this event or festival. This account cannot request access.", { exact: true }).waitFor();
          assert.equal(await page.getByRole("button", { name: "Post to followers", exact: true }).count(), 0);
          state.held = true; await page.reload(); await expand(); await page.getByText("Event page access could not load.", { exact: true }).waitFor();
          assert.equal(await page.getByRole("button", { name: "Post to followers", exact: true }).count(), 0); assert.equal(state.writes.length, 0);
        } else {
          if (mode === "fallback") {
            await page.getByText("Artist profile not linked yet", { exact: true }).waitFor();
            assert.equal(await page.getByRole("button", { name: "Reviews", exact: true }).count(), 0);
            assert.equal(await page.getByRole("button", { name: /^Log or review / }).count(), 0);
          }
          await page.getByRole("button", { name: "Represent this event or festival?", exact: true }).click();
          if (mode === "guest") {
            await page.getByLabel("Email", { exact: true }).fill(navigationUser.email);
            await page.getByLabel("Password", { exact: true }).fill("fixture-password1");
            await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
            await page.waitForURL(`**${eventPath}`); await expand();
            await page.getByRole("button", { name: "Represent this event or festival?", exact: true }).click();
          }
          const note = page.getByLabel("Your role and official contact", { exact: true }); await note.fill(noteText);
          const count = state.reads.length;
          await section().click(); assert.equal(await note.isVisible(), false); await section().click(); assert.equal(await note.inputValue(), noteText); assert.equal(state.reads.length, count);
          const submit = page.getByRole("button", { name: "Send access request", exact: true }); await submit.click();
          await waitFor(() => state.releaseClaim, "Access submission should be pending"); assert.equal(await submit.isDisabled(), true);
          await section().click(); await section().click(); assert.equal(await note.inputValue(), noteText); assert.equal(state.writes.length, 1);
          state.releaseClaim(); await page.getByRole("alert").filter({ hasText: "temporarily unavailable" }).waitFor(); assert.equal(await note.inputValue(), noteText);
          state.failClaim = false; await submit.click(); await page.getByText("Your access request is awaiting staff review. It has not changed your account.", { exact: true }).waitFor();
          assert.equal(state.writes.length, 2); assert.equal(await page.getByRole("button", { name: "Post to followers", exact: true }).count(), 0);
          assert.equal(state.user.role, "fan");
        }
      }
      assert.deepEqual(state.errors, []); assert.deepEqual(state.external, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: join(shots, `${name}.png`) });
      console.log(JSON.stringify({ name, passed: true, accessReads: state.reads.length, simulatedWrites: state.writes.length }));
    } catch (error) {
      await page.screenshot({ path: join(shots, `failed-${name}.png`) });
      console.error(JSON.stringify({ name, errors: state.errors, reads: state.reads, body: (await page.locator("body").innerText()).slice(-5000) })); throw error;
    } finally { state.closing = true; state.releaseRead?.(); state.releaseClaim?.(); await context.close(); }
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
