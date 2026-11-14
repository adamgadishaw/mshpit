import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { LIMITS } from "../src/domain/validation.mjs";
import { venuePath } from "../src/domain/urls.mjs";
import { registerPitSqliteFunctions } from "./sqliteFunctions.js";

// Actual auth/venue HTTP routes, SQLite and public metadata. The established
// local preload prevents outbound connections and binds only loopback.
test("canonical and legacy venue ratings agree across authenticated HTTP, SQLite and public metadata", { timeout: 45000 }, async () => {
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
    database = new DatabaseSync(join(directory, "pit.db"));
    registerPitSqliteFunctions(database);
    database.exec('PRAGMA busy_timeout=10000; BEGIN IMMEDIATE');
    const name = "HTTP Integration Room", providerVenueId = "http-venue-score";
    const path = venuePath({ name, source: "ticketmaster", providerVenueId });
    database.prepare(`INSERT INTO tour_dates(id,artist,venue,place,date,source,updated_at,release_at,provider_active,music_qualified,
      venue_provider_id,venue_city,venue_region,venue_country_code,venue_country)
      VALUES('http-venue-show','Fixture Artist',?,'Toronto, Ontario, Canada','2099-01-01','ticketmaster',1,0,1,1,?,'Toronto','Ontario','CA','Canada')`).run(name, providerVenueId);
    const other = fixture.readers[1];
    for (const [id, author, rating] of [["vr_http_old", member.id, 4.2], ["vr_http_other", other.id, 0.5]]) {
      database.prepare("INSERT INTO venue_reviews(id,venue_key,user_id,rating,text,created_at) VALUES(?,?,?,?,?,?)").run(id, name.toLowerCase(), author, rating, "", 1);
    }
    database.prepare("INSERT INTO venue_reviews(id,venue_key,user_id,rating,text,created_at) VALUES('vr_http_precise',?,?,4.2,'Historical note',1)").run(path, member.id);
    database.exec('COMMIT');
    const precise = await request("/api/venue-community/rating", { path, rating: 4.2, text: "Only updating the note." }, "PUT");
    assert.equal(precise.status, 200, JSON.stringify(precise.data));
    assert.equal(precise.data.myReview.id, 'vr_http_precise'); assert.equal(precise.data.myReview.rating, 4.2);
    assert.equal(database.prepare("SELECT rating FROM venue_reviews WHERE id='vr_http_precise'").get().rating, 4.2);
    const saved = await request("/api/venue-community/rating", { path, rating: 0.5, text: "" }, "PUT");
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.rating, { count: 2, average: 0.5 });
    const rowId = saved.data.myReview.id;
    const created = database.prepare("SELECT created_at FROM venue_reviews WHERE id=?").get(rowId).created_at;
    const edited = await request("/api/venue-community/rating", { path, rating: 4.5, text: "" }, "PUT");
    assert.equal(edited.status, 200); assert.equal(edited.data.myReview.id, rowId);
    assert.deepEqual(edited.data.rating, { count: 2, average: 2.5 });
    const legacy = await request("/api/venues/" + encodeURIComponent(name) + "/reviews", undefined, "GET");
    assert.equal(legacy.status, 200); assert.deepEqual(legacy.data.stats, edited.data.stats);
    const guest = await fetch(origin + "/api/venue-community?path=" + encodeURIComponent(path));
    assert.equal(guest.status, 200); assert.deepEqual((await guest.json()).stats, edited.data.stats);
    const metadata = await fetch(origin + "/api/page-head?path=" + encodeURIComponent(path));
    assert.equal(metadata.status, 200); assert.match((await metadata.json()).head, /2\.5\/5 community rating from 2 ratings/);
    assert.equal(database.prepare("SELECT rating FROM venue_reviews WHERE id='vr_http_old'").get().rating, 4.2);
    assert.equal(database.prepare("SELECT created_at FROM venue_reviews WHERE id=?").get(rowId).created_at, created);
    const overflow = await request("/api/venue-community/rating", { path, rating: 5.5, text: "" }, "PUT");
    assert.equal(overflow.status, 400);
    assert.equal(database.prepare("SELECT rating FROM venue_reviews WHERE id=?").get(rowId).rating, 4.5);
  } finally {
    database?.close();
    if (child.exitCode === null) { const exited = new Promise(done => child.once("exit", done)); child.kill(); await exited; }
    rmSync(directory, { recursive: true, force: true });
  }
});
