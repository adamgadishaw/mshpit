// Real exported app, isolated loopback fixtures. No account, approval or post
// reaches a live service; server authorization has separate database tests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { localServer } from "./verify-artist-account-browser.mjs";
import { fixtureApiResponse, navigationUser } from "./verify-navigation-browser.mjs";
const require = createRequire(import.meta.url), { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
const shots = resolve(".tmp/event-account-browser"); mkdirSync(shots, { recursive: true });
const { server, origin } = await localServer();
const browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
const entity = { entityType: "event", entityKey: "festival:lollapalooza", name: "Lollapalooza", targetKind: "festival", targetId: "lollapalooza" };
const claim = { id: "ec_fixture", accountId: "event-team-fixture", accountName: "Festival team", entityKey: entity.entityKey, targetKind: "festival", targetId: "lollapalooza", note: "I manage this festival. Check the official event office.", currentOwnerId: null, status: "pending" };
const reason = "Checked the official festival office and this account's authority.";
try {
  for(const width of [375, 1280]) for(const mode of ["claim", "owner", "admin", "follow"]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    const user = { ...navigationUser, role: mode === "admin" ? "admin" : mode === "owner" ? "event" : "fan" };
    const state = { fail: true, pending: false, claims: [claim], writes: [], errors: [], following: false, notifyUpdates: false };
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => state.errors.push(error.message));
    await page.addInitScript(value => { localStorage.setItem("pit_theme", "stage"); localStorage.setItem("pit.session", JSON.stringify(value)); localStorage.setItem("pit.users", JSON.stringify([value])); }, user);
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
      if(url.origin !== origin) return route.abort();
      if(!url.pathname.startsWith("/api/")) return route.continue();
      if(url.pathname === "/api/health" || url.pathname === "/api/admin/health") return json({ ok: true });
      if(url.pathname === "/api/me") return json({ user });
      if(url.pathname === "/api/festivals/lollapalooza") return json({ festival: { slug: "lollapalooza", name: "Lollapalooza", city: "Chicago", country: "US", about: "An annual music festival in Grant Park." }, upcoming: [], past: [], expected: null, reviews: [], reviewStats: { reviews: 0, average: null } });
      if(url.pathname === "/api/event-accounts/target") return json({ entity, canFollow: true, canManage: mode === "owner", claimed: mode === "owner", canRequest: mode === "claim", claim: state.pending ? { id: claim.id, status: "pending" } : null, following: state.following, notifyUpdates: state.notifyUpdates });
      if(url.pathname.startsWith("/api/creators/") && url.pathname.endsWith("/follow")) {
        if(method === "PUT") {
          const body=request.postDataJSON();state.writes.push(body);assert.equal(body.notifyUpdates,false);
          if(state.fail)return json({error:"Synthetic follow failure",code:"VALIDATION_FAILED"},400);
          state.following=body.following;
        }
        return json({following:state.following,notifyUpdates:state.notifyUpdates});
      }
      if(url.pathname === "/api/event-accounts/claims") {
        const body = request.postDataJSON(); state.writes.push(body); assert.equal(request.headers()["x-pit-expected-account"], user.id);
        assert.equal(body.kind, "festival"); assert.equal(body.id, "lollapalooza");
        if(state.fail) return json({ error: "Synthetic failure", code: "PROVIDER_UNAVAILABLE" }, 503);
        state.pending = true; return json({ id: claim.id, status: "pending" });
      }
      if(url.pathname === "/api/me/creator-entities") return json({ entities: mode === "owner" ? [entity] : [] });
      if(url.pathname.startsWith("/api/creators/") && url.pathname.endsWith("/posts")) return json({ posts: [] });
      if(url.pathname === "/api/posts" && method === "POST") {
        const body = request.postDataJSON(); state.writes.push(body); assert.equal(body.creatorUpdate.entityType, "event"); assert.equal(body.creatorUpdate.entityKey, entity.entityKey);
        return json({ id: "p_event_fixture", post: { ...body, id: "p_event_fixture", userId: user.id, user, creatorUpdate: { ...body.creatorUpdate, entityName: entity.name }, media: [], photos: [] } });
      }
      if(url.pathname === "/api/admin/event-claims") return json({ claims: state.claims.filter(row => row.status === (url.searchParams.get("status") || "pending")), nextCursor: null });
        if(url.pathname === "/api/admin/venue-claims") return json({ claims: [], nextCursor: null });
      if(url.pathname === `/api/admin/event-claims/${claim.id}/approve`) {
        const body = request.postDataJSON(); state.writes.push(body);
        assert.equal(body.officialAccountConfirmed, true); assert.equal(body.ownershipConfirmed, true); assert.equal(body.expectedOwnerId, null); assert.equal(body.reason, reason);
        if(state.fail) return json({ error: "Synthetic review failure", code: "PROVIDER_UNAVAILABLE" }, 503);
        state.claims = [{ ...claim, status: "approved", currentOwnerId: claim.accountId }]; return json({ status: "approved" });
      }
      if(url.pathname === "/api/admin/artist-requests") return json({ requests: [] });
      if(url.pathname === "/api/admin/members") return json({ users: [user], total: 1, banned: 0, verified: 0, regions: [] });
      if(url.pathname === "/api/admin/moderation") return json({ reports: [], recentActions: [], summary: { open: 0, actioned: 0, dismissed: 0, totalRecent: 0, byType: {} } });
      if(url.pathname === "/api/admin/errors") return json({ groups: [], counts: {}, total: 0 });
      if(url.pathname === "/api/admin/badges") return json({ badges: [] });
      if(url.pathname === "/api/moderation/artist-death-watch") return json({ candidates: [], counts: {}, settings: {} });
      return json(fixtureApiResponse(url.pathname, { member: true, method, resolvedPath: url.searchParams.get("path") || undefined }));
    });
    try {
      if(mode === "admin") {
        await page.goto(origin + "/you", { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByRole("button", { name: /^Moderation/ }).click();
        await page.getByRole("tab", { name: /^Requests/ }).click();
        const approve = page.getByRole("button", { name: "Approve event access", exact: true }); await approve.waitFor(); assert.equal(await approve.isDisabled(), true);
        await page.getByLabel("Official evidence link reviewed", { exact: true }).fill("https://example.test/official");
        await page.getByLabel("Review reason", { exact: true }).fill(reason);
        await page.getByRole("checkbox", { name: "I checked the established official event or festival identity", exact: true }).click();
        assert.equal(await approve.isDisabled(), true);
        await page.getByRole("checkbox", { name: "I checked this account's authority to represent it", exact: true }).click();
        await page.screenshot({ path: join(shots, `${mode}-${width}.png`) });
        await approve.click(); await page.getByRole("alert").filter({ hasText: "temporarily unavailable" }).waitFor();
        assert.equal(await page.getByLabel("Review reason", { exact: true }).inputValue(), reason);
        state.fail = false; await approve.click(); await page.getByText("No pending event requests on this page.", { exact: true }).waitFor();
        await page.getByRole("tab", { name: "Approved pages", exact: true }).click(); await page.getByRole("button", { name: "Revoke event access", exact: true }).waitFor();
        assert.equal(state.writes.length, 2);
      } else {
        await page.goto(origin + "/festival/lollapalooza", { waitUntil: "domcontentloaded" });
        if(mode === "follow") {
          const follow=page.getByRole("button",{name:"Follow event updates",exact:true});await follow.click();
          await page.getByRole("alert").waitFor();assert.equal(state.following,false);state.fail=false;await follow.click();
          await page.getByRole("button",{name:"Unfollow event updates",exact:true}).waitFor();
          await page.screenshot({path:join(shots,mode+"-"+width+".png")});
          assert.equal(user.role,"fan");assert.equal(state.writes.length,2);
        } else if(mode === "claim") {
          const open = page.getByRole("button", { name: "Represent this event or festival?", exact: true }); await open.click();
          await page.getByRole("button", { name: "Cancel", exact: true }).click(); assert.equal(state.writes.length, 0); await open.click();
          const submit = page.getByRole("button", { name: "Send access request", exact: true }); assert.equal(await submit.isDisabled(), true);
          const note = page.getByLabel("Your role and official contact", { exact: true }); await note.fill(claim.note);
          await page.screenshot({ path: join(shots, `${mode}-${width}.png`) });
          await submit.click(); await page.getByRole("alert").filter({ hasText: "temporarily unavailable" }).waitFor(); assert.equal(await note.inputValue(), claim.note);
          state.fail = false; await submit.click(); await page.getByText("Your access request is awaiting staff review. It has not changed your account.", { exact: true }).waitFor();
          assert.equal(state.writes.length, 2); assert.equal(user.role, "fan");
        } else {
          await page.getByRole("button", { name: "Post to followers", exact: true }).click();
          await page.getByText("Posting as Lollapalooza", { exact: true }).waitFor();
          await page.getByLabel("Title", { exact: true }).fill("Stage times are now available");
          await page.screenshot({ path: join(shots, `${mode}-${width}.png`) });
          await page.getByRole("button", { name: "Post", exact: true }).first().click();
          await page.getByRole("heading", { name: "Post to followers", exact: true }).waitFor({ state: "hidden" }); assert.equal(state.writes.length, 1);
        }
      }
      assert.deepEqual(state.errors, []); console.log(JSON.stringify({ width, mode, passed: true, simulatedWrites: state.writes.length }));
    } catch(error) { await page.screenshot({ path: join(shots, `failed-${mode}-${width}.png`) }); console.error(JSON.stringify({ width, mode, errors: state.errors, body: (await page.locator("body").innerText()).slice(-5000) })); throw error; }
    finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
