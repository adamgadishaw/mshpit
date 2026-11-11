#!/usr/bin/env node
// Exported composer -> real HTTP/auth/idempotency -> disposable SQLite. Only
// response delivery is interrupted; the actual create handler is never mocked.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { twoThousandWordReview } from "./fixtures/concert-review-text.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shots = join(root, ".tmp", "review-retry-browser");
const waitUntil = async (check, label, timeoutMs = 25_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!await check()) {
    assert.ok(Date.now() < deadline, typeof label === "function" ? label() : label);
    await new Promise(done => setTimeout(done, 50));
  }
};

async function main() {
  mkdirSync(shots, { recursive: true });
  const reservation = createServer();
  await new Promise(done => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const directory = mkdtempSync(join(tmpdir(), "pit-auth-real-browser-"));
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  Object.assign(env, { NODE_ENV: "test", PORT: String(port), PUBLIC_ORIGIN: origin, PIT_DATA_DIR: directory,
    PIT_AUTH_BROWSER_FIXTURE: "1", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true", ADMIN_PASSWORD: "Synthetic-local-password1", ADMIN_EMAIL: "owner@example.test",
    EMAIL_VERIFICATION_ENABLED: "true", EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", BACKUP_ENABLED: "false",
    TOURDATE_REFRESH_ENABLED: "false", TOURDATE_DEMAND_REFRESH_ENABLED: "false", ARTIST_GENRE_REFRESH_ENABLED: "false", ARTIST_PHOTO_SEED_ENABLED: "false",
    ARTIST_DEATH_WATCH_SCHEDULER_ENABLED: "false", CACHE_WARM_ENABLED: "false" });
  const child = fork(join(root, "server/index.js"), [], { cwd: root, env,
    execArgv: ["--import", pathToFileURL(join(root, "scripts/fixtures/auth-real-server-preload.mjs")).href], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let fixture, bound, output = "", browser, database;
  child.on("message", message => { if (message.kind === "fixture") fixture = message; if (message.kind === "listener-bound") bound = message.address; });
  child.stdout.on("data", bytes => { output = (output + bytes).slice(-8000); });
  child.stderr.on("data", bytes => { output = (output + bytes).slice(-8000); });
  try {
    await waitUntil(() => { assert.equal(child.exitCode, null, output); return fixture && bound; }, () => "Fixture server startup: " + output, 60_000);
    assert.equal(bound, "127.0.0.1");
    database = new DatabaseSync(join(directory, "pit.db"));
    const { chromium } = createRequire(import.meta.url)(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
    browser = await chromium.launch({ headless: true, executablePath: process.env.PIT_BROWSER_EXECUTABLE || undefined });
    let passed = 0;
    for (const width of [375, 1280]) {
      for (const mode of ["exact-long", "changed-suffix", "legacy-no-receipt"]) {
        const member = fixture.readers[passed];
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
        await context.addCookies([{ name: fixture.cookieName, value: member.cookie.slice(fixture.cookieName.length + 1), url: origin, httpOnly: true, sameSite: "Lax" }]);
        const page = await context.newPage(); page.setDefaultTimeout(20_000);
        const errors = [], writes = [];
        let loseResponses = true;
        page.on("pageerror", error => errors.push(error.message));
        await context.route("**/*", async route => {
          const request = route.request(), url = new URL(request.url());
          if (url.origin !== origin) return route.abort();
          if (url.pathname === "/api/posts" && request.method() === "POST") {
            const body = request.postDataJSON();
            const response = await route.fetch();
            writes.push({ body, status: response.status(), data: await response.json() });
            // The server commits before the response vanishes, including all
            // automatic retries. Later restore must retain the same token.
            if (loseResponses) return route.abort("failed");
            return route.fulfill({ response });
          }
          return route.continue();
        });
        try {
          await page.goto(origin + "/feed");
          await page.getByLabel("Make a post", { exact: true }).last().click();
          await page.getByRole("button", { name: "Add a show you went to", exact: true }).click();
          await page.getByLabel("Artist", { exact: true }).fill("Fixture Artist");
          await page.getByRole("button", { name: "Next: Where and when", exact: true }).click();
          await page.getByLabel("Concert city, region and country", { exact: true }).fill("Toronto");
          await page.getByRole("button", { name: "I don't remember the concert date", exact: true }).click();
          await page.getByRole("button", { name: "Next: The music", exact: true }).click();
          await page.getByLabel("Overall concert rating", { exact: true }).press("End");
          await page.getByRole("button", { name: "Next: Your story", exact: true }).click();
          const input = page.getByPlaceholder("What made the night? Be honest - this is what people read.", { exact: true });
          const initial = mode === "exact-long" ? twoThousandWordReview : "Music from the encore stayed with me. ".repeat(60).slice(0, 1999) + ".";
          await input.fill(initial);
          await page.getByRole("button", { name: "Post", exact: true }).click();
          await waitUntil(async () => writes.length === 3 && await page.getByRole("button", { name: "Post", exact: true }).isEnabled(), "Lost responses must retain the composer after bounded retries");
          assert.ok(writes.every(write => write.status === 200), JSON.stringify(writes.map(write => write.status)));
          const id = writes[0].data.id, token = writes[0].body.clientMutationId;
          assert.ok(writes.every(write => write.body.review === initial && write.body.clientMutationId === token));
          assert.equal(await input.inputValue(), initial);
          const authored = mode === "exact-long" ? initial : initial + " The final encore deserves these additional words. \u{1f3b6}";
          if (mode !== "exact-long") await input.fill(authored);
          await waitUntil(() => page.evaluate(expected => JSON.parse(localStorage.getItem("pit.drafts") || "[]").some(draft => draft.review === expected), authored), "Full draft must be durable before reload");
          if (mode === "legacy-no-receipt") {
            database.prepare("DELETE FROM post_create_receipts WHERE post_id=?").run(id);
            database.prepare("UPDATE posts SET client_mutation_hash=NULL WHERE id=?").run(id);
          }
          loseResponses = false;
          // Cold document entry also drops any transient compose query route.
          await page.goto(origin + "/feed");
          await page.getByLabel("Make a post", { exact: true }).last().click();
          await page.getByRole("button", { name: "Resume Fixture Artist", exact: true }).click();
          await page.getByRole("button", { name: "Go to Your story", exact: true }).click();
          assert.equal(await input.inputValue(), authored);
          await page.getByRole("button", { name: "Post", exact: true }).click();
          await waitUntil(() => writes.length === 4, "Restored draft must retry");
          assert.equal(writes[3].body.review, authored);
          assert.equal(writes[3].body.clientMutationId, token);
          if (mode === "exact-long") {
            assert.equal(writes[3].status, 200);
            assert.equal(writes[3].data.duplicate, true);
            await input.waitFor({ state: "hidden" });
            await waitUntil(() => page.evaluate(() => JSON.parse(localStorage.getItem("pit.drafts") || "[]").length === 0), "Confirmed full-text success clears its draft");
          } else {
            assert.equal(writes[3].status, 409);
            assert.equal(writes[3].data.code, "POST_MUTATION_CONFLICT");
            await page.getByText(/Your full draft is still here/).first().waitFor();
            assert.equal(await input.inputValue(), authored);
            assert.equal(await page.evaluate(expected => JSON.parse(localStorage.getItem("pit.drafts") || "[]").some(draft => draft.review === expected), authored), true);
          }
          const rows = database.prepare("SELECT review FROM posts WHERE user_id=?").all(member.id);
          assert.equal(rows.length, 1);
          assert.equal(rows[0].review, initial);
          assert.deepEqual(errors, []);
          await page.screenshot({ path: join(shots, `${mode}-${width}.png`) });
          passed++;
          console.log(JSON.stringify({ name: `${mode}-${width}`, passed: true, attempts: writes.length, storedUnits: rows[0].review.length, draftUnits: authored.length }));
        } catch (error) {
          await page.screenshot({ path: join(shots, `failure-${mode}-${width}.png`) });
          console.error((await page.locator("body").innerText()).slice(-5000));
          throw error;
        } finally { await context.close(); }
      }
    }
    console.log(JSON.stringify({ passed, failed: 0, network: "real loopback HTTP and disposable SQLite; outbound blocked" }));
  } finally {
    await browser?.close(); database?.close();
    if (child.exitCode === null) { const exited = new Promise(done => child.once("exit", done)); child.kill(); await exited; }
    rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
