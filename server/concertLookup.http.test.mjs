import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

// Actual index.js HTTP/body/auth routes and SQLite, with the established local
// preload preventing every outbound connection and binding only loopback.
test("concert lookup crosses real HTTP authentication, selected-show posting and SQLite without provider writes", { timeout: 45000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
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
  let fixture, bound, output = "";
  child.on("message", message => { if (message.kind === "fixture") fixture = message; if (message.kind === "listener-bound") bound = message.address; });
  child.stdout.on("data", bytes => { output = (output + bytes).slice(-4000); });
  child.stderr.on("data", bytes => { output = (output + bytes).slice(-4000); });
  let database;
  try {
    const deadline = Date.now() + 20000;
    while (!fixture || !bound) { assert.equal(child.exitCode, null, output); assert.ok(Date.now() < deadline, output); await new Promise(done => setTimeout(done, 40)); }
    assert.equal(bound, "127.0.0.1");
    const member = fixture.readers[0];
    const request = async (path, body, method = "POST", serialized = JSON.stringify(body)) => {
      const response = await fetch(origin + path, { method, headers: { Cookie: member.cookie, "X-Pit-Expected-Account": member.id, Origin: origin, "Content-Type": "application/json" }, body: serialized, signal: AbortSignal.timeout(10000) });
      return { status: response.status, data: await response.json() };
    };
    const base = { artist: "Fixture Artist", artistKey: null, city: "Toronto, Ontario, Canada", venue: "Historical Hall", date: "2018-04-20",
      overall: 4.5, clientMutationId: "http_lookup_original_001", review: "Original local fixture." };
    const created = await request("/api/posts", base);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const params = new URLSearchParams({ artist: base.artist, city: "Toronto", date: base.date });
    const path = `/api/concerts/lookup?${params}`;
    const anonymous = await fetch(origin + path);
    assert.equal(anonymous.status, 401);
    const found = await request(path, undefined, "GET");
    assert.equal(found.status, 200, JSON.stringify(found.data));
    assert.equal(found.data.matches.length, 1);
    const match = found.data.matches[0];
    assert.equal(match.venue, base.venue); assert.equal(match.date, base.date);
    assert.equal(match.archiveShowKey, created.data.post.archiveShowKey);
    const provider = await request(path + "&source=ticketmaster", undefined, "GET");
    assert.equal(provider.status, 200); assert.equal(provider.data.status, "unavailable");
    const picked = { ...base, city: match.city, venue: match.venue, date: match.date, clientMutationId: "http_lookup_selected_001" };
    const posted = await request("/api/posts", picked);
    assert.equal(posted.status, 200); assert.equal(posted.data.post.archiveShowKey, match.archiveShowKey);
    assert.equal((await request("/api/posts", picked)).data.id, posted.data.id);
    const edited = await request(`/api/posts/${posted.data.id}`, { review: "Edited without relocating the concert" }, "PATCH");
    assert.equal(edited.status, 200); assert.equal(edited.data.post.archiveShowKey, match.archiveShowKey);
    database = new DatabaseSync(join(directory, "pit.db"), { readOnly: true });
    assert.equal(database.prepare("SELECT date FROM posts WHERE id=?").get(posted.data.id).date, base.date);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM tour_dates").get().n, 0, "Search must not manufacture calendar records");
    assert.equal(database.prepare("SELECT COUNT(*) n FROM posts WHERE user_id=?").get(member.id).n, 2);
  } finally {
    database?.close();
    if (child.exitCode === null) { const exited = new Promise(done => child.once("exit", done)); child.kill(); await exited; }
    rmSync(directory, { recursive: true, force: true });
  }
});
