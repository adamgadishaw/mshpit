#!/usr/bin/env node
// Actual exported app + real server/routes + disposable synthetic data.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCatalogPilotClient } from "./catalog-api-pilot.mjs";

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const pause = ms => new Promise(done => setTimeout(done, ms));
const timeout = 25_000;
let stage = "startup";
const checks = [];
const check = name => { checks.push(name); console.log(JSON.stringify({ check: name, passed: true })); };
async function start() {
  assert.ok(statSync(join(root, "dist/index.html")).isFile(), "Build the app first");
  const listener = createServer(); await new Promise(done => listener.listen(0, "127.0.0.1", done));
  const port = listener.address().port; await new Promise(done => listener.close(done));
  const origin = `http://127.0.0.1:${port}`, parent = realpathSync(tmpdir());
  const directory = realpathSync(mkdtempSync(join(parent, "pit-catalog-browser-")));
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { NODE_ENV: "test", PIT_ENV: "production", RENDER: "true", PORT: String(port), PUBLIC_ORIGIN: origin,
    TEMP: directory, TMP: directory, PIT_DATA_DIR: directory, PIT_CATALOG_TEMP_PARENT: parent,
    PIT_CATALOG_BROWSER_FIXTURE: "1", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true", MEDIA_PUBLIC_BASE_URL: "https://images.example.test",
    EMAIL_VERIFICATION_ENABLED: "true", EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", BACKUP_ENABLED: "false",
    TOURDATE_REFRESH_ENABLED: "false", TOURDATE_DEMAND_REFRESH_ENABLED: "false", ARTIST_GENRE_REFRESH_ENABLED: "false",
    ARTIST_PHOTO_SEED_ENABLED: "false", ARTIST_DEATH_WATCH_SCHEDULER_ENABLED: "false", CACHE_WARM_ENABLED: "false",
    PIT_CATALOG_API_ENABLED: "true", PIT_CATALOG_API_COMMIT_ENABLED: "true" });
  const child = fork(join(root, "server/index.js"), [], { cwd: root, env, windowsHide: true,
    execArgv: ["--import", pathToFileURL(join(root, "scripts/fixtures/catalog-live-pilot-server-preload.mjs")).href],
    stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let fixture, bound, exited = false, output = "", outbound = 0, helpers = 0;
  const closed = new Promise(done => child.once("exit", () => { exited = true; done(); }));
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-3000); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-3000); });
  child.on("message", message => {
    if (message.kind === "fixture") fixture = message;
    if (message.kind === "listener-bound") bound = message.address;
    if (message.kind === "outbound-blocked") { outbound++; console.log(JSON.stringify({ outboundBlockedAt: message.stack })); }
    if (message.kind === "helper-blocked") helpers++;
  });
  async function stop() {
    if (!exited) { child.kill(); await Promise.race([closed, pause(5000)]); }
    assert.ok(exited, "Owned process still running; preserve its scratch directory");
    assert.equal(realpathSync(directory), directory); assert.equal(dirname(directory).toLowerCase(), parent.toLowerCase());
    assert.ok(basename(directory).startsWith("pit-catalog-browser-"));
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    console.log(JSON.stringify({ cleanup: true, outboundBlocked: outbound, helpersBlocked: helpers }));
  }
  try {
    const deadline = Date.now() + timeout;
    while (!fixture || !bound) {
      assert.ok(!exited && Date.now() < deadline, `Fixture startup failed: ${output}`); await pause(25);
    }
    assert.equal(bound, "127.0.0.1");
  } catch (error) { await stop(); throw error; }
  async function request(path, { method = "GET", body, owner = true } = {}) {
    const response = await fetch(origin + path, { method, redirect: "error", signal: AbortSignal.timeout(timeout), headers: {
      ...(owner ? { Cookie: fixture.cookie, "X-Pit-Expected-Account": fixture.ownerId } : {}),
      ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    return { status: response.status, text, data: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : null };
  }
  const inspect = () => new Promise((resolveInspection, reject) => {
    const timer = setTimeout(() => reject(new Error("Inspection timed out")), timeout);
    const read = message => { if (message.kind !== "inspection") return; clearTimeout(timer); child.off("message", read); resolveInspection(message); };
    child.on("message", read); child.send({ kind: "inspect" });
  });
  return { origin, fixture, request, inspect, stop, outbound: () => outbound };
}

async function main() {
  const server = await start(); let browser, client;
  const { fixture, origin } = server, records = [fixture.artist, fixture.venue, fixture.event];
  try {
    const { chromium } = createRequire(import.meta.url)(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
    browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    const errors = [], reports = [], requests = [];
    await context.addCookies([{ name: fixture.cookieName, value: fixture.cookie.slice(fixture.cookie.indexOf("=") + 1), url: origin, httpOnly: true, sameSite: "Lax" }]);
    const routeLocally = async route => {
      const url = new URL(route.request().url());
      if (url.href === fixture.photo.uri) return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=", "base64") });
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/api/client-errors") reports.push(route.request().postData());
      requests.push({ method: route.request().method(), path: url.pathname });
      return route.continue(); // No API fixtures or response interception.
    };
    await context.route("**/*", routeLocally);
    const page = await context.newPage(); page.setDefaultTimeout(timeout);
    page.on("pageerror", error => errors.push(error.message));
    stage = "owner-navigation";
    await page.goto(origin + "/feed", { waitUntil: "domcontentloaded" });
    try { await page.getByRole("button", { name: "Menu", exact: true }).click(); }
    catch (error) { console.error(JSON.stringify({ body: (await page.locator("body").innerText()).slice(0, 2500), errors, requests: requests.slice(-12), me: await server.request("/api/me") })); throw error; }
    await page.getByRole("button", { name: "Moderation. Reports, members, and content", exact: true }).click();
    await page.getByRole("tab", { name: "Catalog", exact: true }).click();
    await page.getByText("Supervised catalog pilot", { exact: true }).waitFor();
    stage = "owner-selection-and-pairing";
    for (const record of records) {
      await page.getByRole("button", { name: `Browse ${record.type} records`, exact: true }).click();
      await page.getByRole("button", { name: `Select ${record.name}`, exact: true }).click();
    }
    const pairResponse = page.waitForResponse(response => response.url().endsWith("/api/moderation/catalog-grants/pairing") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Create temporary pilot pairing", exact: true }).click();
    const pairing = await (await pairResponse).json(); assert.ok(pairing.pairingCode);
    await page.getByText(pairing.pairingCode, { exact: true }).waitFor();
    client = createCatalogPilotClient({ baseUrl: origin, allowLoopback: true });
    const grant = await client.pair(pairing.pairingCode); assert.equal(grant.commitLimit, 3);
    await page.getByRole("button", { name: "Dismiss pairing code", exact: true }).click();
    assert.equal(await page.getByText(pairing.pairingCode, { exact: true }).count(), 0);
    check(stage);
    for (const [index, record] of records.entries()) {
      stage = `review-and-commit-${record.type}`;
      const command = (operation, body) => client.execute({ operation, type: record.type, key: record.key,
        ...(body ? { body, idempotencyKey: `browser-${operation}-${index}-0001`, confirmWrite: true } : {}) });
      const current = await command("read");
      const lease = await command("claim", { revision: current.revision, valueHash: current.valueHash, identityHash: current.identityHash });
      const source = "https://example.test/synthetic-pilot-source";
      record.summary = `${record.name} has this synthetic sourced context, written only for an isolated local browser verification.`;
      const evidence = [{ url: source, title: "Synthetic source", accessedAt: Date.now(), evidenceHash: "b".repeat(64) }];
      const patch = { summary: record.summary, summarySources: [source], facts: [], images: [] };
      if (record.type === "venue") {
        assert.equal(current.photoOptions.length, 1);
        const { sourcePage, assetHash } = current.photoOptions[0]; patch.attachments = [{ sourcePage, assetHash }];
        evidence.push({ url: sourcePage, title: "Synthetic photo provenance", accessedAt: Date.now(), evidenceHash: "c".repeat(64) });
      }
      const proposal = await command("propose", { nonce: lease.nonce, patch, evidence }); record.proposal = proposal.id;
      await page.getByLabel("Catalog proposal ID", { exact: true }).fill(proposal.id);
      await page.getByRole("button", { name: "Load proposed change", exact: true }).click();
      await page.getByText(`Proposed: ${record.summary}`, { exact: true }).waitFor();
      if (record.type === "venue") await page.getByText(/Synthetic Fixture Creator.*CC-BY-4.0/u).waitFor();
      await page.getByRole("button", { name: "Approve this proposal", exact: true }).click();
      await page.getByText("Status: approved", { exact: true }).waitFor();
      const committed = await command("commit", { nonce: lease.nonce, proposalId: proposal.id, payloadHash: proposal.payloadHash });
      assert.equal(committed.revision, 1); check(stage);
    }
    assert.equal(server.outbound(), 0, "Catalog pairing/review/commit must not attempt provider calls");
    stage = "public-app-and-html";
    const publicContext = await browser.newContext({ serviceWorkers: "block" });
    await publicContext.route("**/*", routeLocally);
    const publicPage = await publicContext.newPage(); publicPage.setDefaultTimeout(timeout);
    publicPage.on("pageerror", error => errors.push(error.message));
    for (const width of [390, 1280]) for (const record of records) {
      await publicPage.setViewportSize({ width, height: 900 });
      const html = await server.request(record.path, { owner: false });
      assert.equal(html.status, 200); assert.ok(html.text.includes("data-catalog-research")); assert.ok(html.text.includes(record.summary));
      await publicPage.goto(origin + record.path, { waitUntil: "domcontentloaded" });
      if (record.type === "artist") await publicPage.getByRole("tab", { name: "About artist page section", exact: true }).click();
      try { await publicPage.locator("#root").getByText(record.summary, { exact: true }).waitFor(); }
      catch (error) { console.error(JSON.stringify({ record: record.type, body: (await publicPage.locator("body").innerText()).slice(-4500), requests: requests.slice(-15), errors })); throw error; }
      if (record.type === "venue") {
        await publicPage.locator("#root").getByText(/Synthetic Fixture Creator.*CC-BY-4.0/u).waitFor();
        assert.ok(html.text.includes(fixture.photo.sourcePage)); assert.ok(html.text.includes(fixture.photo.modificationNotice));
      }
    }
    check(stage);
    stage = "owner-hide-and-restore";
    await page.getByRole("button", { name: "Browse venue records", exact: true }).click();
    await page.getByRole("button", { name: `Inspect ${fixture.venue.name}`, exact: true }).click();
    await page.getByRole("button", { name: "Hide researched content", exact: true }).click();
    await page.getByText("No visible research", { exact: true }).waitFor();
    assert.ok(!(await server.request(fixture.venue.path, { owner: false })).text.includes(fixture.venue.summary));
    await publicPage.goto(origin + fixture.venue.path, { waitUntil: "domcontentloaded" });
    await publicPage.locator("#root").getByText(fixture.venue.name, { exact: true }).first().waitFor();
    assert.equal(await publicPage.locator("#root").getByText(fixture.venue.summary, { exact: true }).count(), 0);
    const restored = page.waitForResponse(response => response.url().endsWith("/correct") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Restore content before latest pilot change", exact: true }).click();
    assert.equal((await restored).status(), 200);
    await page.getByLabel("Catalog grant ID", { exact: true }).fill(grant.grantId);
    await page.getByRole("button", { name: "Revoke pilot access", exact: true }).click();
    await page.getByText("Pilot access revoked.", { exact: true }).waitFor();
    await assert.rejects(() => client.execute({ operation: "read", type: "artist", key: fixture.artist.key }), { status: 401 });
    check(stage);
    const state = await server.inspect(); assert.equal(state.integrity, "ok"); assert.equal(state.foreignKeyViolations, 0);
    assert.equal(state.commits, 3); assert.equal(state.preservedBiography, "Synthetic existing biography must remain unchanged.");
    // Existing About tabs may attempt music-provider reads; the preload blocks
    // every socket/fetch. None can leave this disposable local fixture.
    assert.deepEqual(errors, []); assert.deepEqual(reports, []);
    console.log(JSON.stringify({ passed: checks.length, failed: 0, actualApiRequests: requests.filter(row => row.path.startsWith("/api/")).length,
      network: "loopback only; existing image bytes replaced with a synthetic pixel", state }));
  } finally { client?.close(); await browser?.close(); await server.stop(); }
}
main().catch(error => { console.error(JSON.stringify({ stage, error: error.message })); process.exitCode = 1; });
