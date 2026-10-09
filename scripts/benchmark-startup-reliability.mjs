// Compare real HTTP handlers on an isolated synthetic catalog. No credentials
// are inherited; outbound network is blocked before any application import.
// node scripts/benchmark-startup-reliability.mjs --root <checkout> --output <json>
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

const here = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
const percentile = (rows, q) => [...rows].sort((a, b) => a - b)[Math.floor((rows.length - 1) * q)];
const fixtureAt = Date.parse("2026-10-09T03:30:00Z");

if (process.env.PIT_RELIABILITY_FIXTURE === "1") {
  assert.equal(process.env.NODE_ENV, "test");
  assert.ok(resolve(process.env.PIT_DATA_DIR).startsWith(resolve(tmpdir()) + "/")
    || resolve(process.env.PIT_DATA_DIR).startsWith(resolve(tmpdir()) + "\\"));
  let outbound = 0;
  const deny = () => { outbound++; throw new Error("Benchmark outbound network disabled"); };
  globalThis.fetch = async () => deny();
  http.request = deny; http.get = deny; https.request = deny; https.get = deny;
  net.connect = deny; net.createConnection = deny; tls.connect = deny; net.Socket.prototype.connect = deny;
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (port) {
    this.once("listening", () => process.send({ kind: "listening", port: this.address().port }));
    return listen.call(this, { port, host: "127.0.0.1" });
  };
  syncBuiltinESMExports();
  Date.now = () => fixtureAt;
  const root = pathToFileURL(resolve(process.env.PIT_RELIABILITY_ROOT) + "/");
  const { db, q, artistStmts, artistRow } = await import(new URL("server/db.js", root));
  const { createSession, COOKIE } = await import(new URL("server/auth.js", root));
  // Identical input on each checkout; existing bundled catalog is also loaded.
  const zones = ["America/Toronto", "America/Los_Angeles", "Europe/London", "Asia/Tokyo", "Australia/Sydney", "UTC"];
  db.exec("BEGIN");
  for (let i = 0; i < 80; i++) artistStmts.upsert.run(artistRow(`load artist ${i}`, { name: `Load Artist ${i}`, rank_score: 1 }));
  const insert = db.prepare(`INSERT INTO tour_dates(id,artist,artist_key,venue,place,date,source,updated_at,
    venue_city,venue_country_code,venue_region,event_timezone,event_kind,event_end_date,music_evidence,billed_artists,event_status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let i = 0; i < 5000; i++) {
    const active = i % 25 === 0;
    insert.run(`load_${String(i).padStart(5, "0")}`, `Load Artist ${i % 80}`, `load artist ${i % 80}`,
      `Load Hall ${i % 120}`, i % 3 ? "Toronto, ON, CA" : "London, GB",
      active ? "2026-10-08" : `2026-10-${String(10 + i % 20).padStart(2, "0")}`,
      "ticketmaster", fixtureAt, i % 3 ? "Toronto" : "London", i % 3 ? "CA" : "GB", i % 3 ? "ON" : "",
      zones[i % zones.length], active ? "festival" : "concert", active ? "2026-10-10" : null,
      "ticketmaster:classification:music", JSON.stringify([`Load Artist ${i % 80}`]), i % 43 ? "scheduled" : "cancelled");
  }
  const readers = [];
  for (let i = 0; i < 24; i++) {
    const id = `load_reader_${i}`;
    q.insertUser.run(id, `${id}@example.test`, `Load Reader ${i}`, `loadreader${i}`, "synthetic-unusable-hash", "fan", "Toronto", 43.65, -79.38, "LR", "#654321", fixtureAt);
    readers.push({ id });
  }
  db.exec("COMMIT");
  for (const reader of readers) reader.cookie = `${COOKIE}=${createSession(reader.id).token}`;
  process.send({ kind: "fixture", readers, inventory: { events: 5000, artists: artistStmts.count.get().c, timezones: zones.length } });
  const { routes } = await import(new URL("server/api.js", root));
  const cpuMark = () => ({ cpu: process.cpuUsage(), at: performance.now() });
  let mark;
  process.on("message", async (message) => {
    if (message.kind === "mark") { mark = cpuMark(); process.send({ kind: "marked" }); }
    if (message.kind === "measure") {
      const cpu = process.cpuUsage(mark.cpu);
      process.send({ kind: "measured", cpuMs: (cpu.user + cpu.system) / 1000, wallMs: performance.now() - mark.at, outbound });
    }
    if (message.kind === "direct") {
      const user = message.member ? q.userById.get(readers[0].id) : null;
      const calls = [
        ["GET /api/discovery/sidebar", {}],
        ["GET /api/tourdates", { days: "30", limit: "500" }],
        ["GET /api/me", {}],
      ];
      const results = [];
      for (const [route, query] of calls) {
        const durations = [], start = cpuMark();
        let result;
        for (let i = 0; i < 15; i++) {
          const at = performance.now();
          result = await routes[route]({ user, query, ip: "fixture", setHeader() {} });
          durations.push(performance.now() - at);
        }
        const cpu = process.cpuUsage(start.cpu);
        results.push({ route, medianMs: percentile(durations, .5), p95Ms: percentile(durations, .95), cpuMs: (cpu.user + cpu.system) / 1000,
          outputHash: createHash("sha256").update(JSON.stringify(result)).digest("hex") });
      }
      process.send({ kind: "direct-result", member: message.member, results });
    }
    if (message.kind === "freshness") {
      const read = () => routes["GET /api/discovery/sidebar"]({ query: {}, setHeader() {} });
      const before = read(), id = before.upcomingEvents[0].id;
      const original = db.prepare("SELECT event_status,owner_id,release_at FROM tour_dates WHERE id=?").get(id);
      db.prepare("UPDATE tour_dates SET event_status='cancelled' WHERE id=?").run(id);
      const cancelled = read();
      assert.equal(cancelled.upcomingEvents.some(row => row.id === id), false);
      db.prepare("UPDATE tour_dates SET event_status=?,owner_id=?,release_at=? WHERE id=?")
        .run(original.event_status, readers[0].id, fixtureAt + 86400000, id);
      const hidden = read();
      assert.equal(hidden.upcomingEvents.some(row => row.id === id), false);
      db.prepare("UPDATE tour_dates SET owner_id=?,release_at=? WHERE id=?").run(original.owner_id, original.release_at, id);
      const restored = read();
      assert.deepEqual(restored, before, "reads return current cancellation/visibility without retaining a stale decision");
      process.send({ kind: "freshness-result", outputHashes: [before, cancelled, hidden, restored]
        .map(result => createHash("sha256").update(JSON.stringify(result)).digest("hex")) });
    }
  });
} else {
  const root = resolve(arg("root", fileURLToPath(new URL("../", import.meta.url))));
  const directory = mkdtempSync(join(tmpdir(), "pit-reliability-load-"));
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"]
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { NODE_ENV: "test", RENDER: "true", PORT: "0", PIT_DATA_DIR: directory,
    PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true", PIT_RELIABILITY_FIXTURE: "1", PIT_RELIABILITY_ROOT: root,
    PIT_TRUSTED_PROXY_CIDRS: "127.0.0.1/32", EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", BACKUP_ENABLED: "false" });
  const child = fork(join(root, "server/index.js"), [], { cwd: root, env, execArgv: ["--import", pathToFileURL(here).href],
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let output = "", fixture, port;
  child.stdout.on("data", data => { output = (output + data).slice(-12000); });
  child.stderr.on("data", data => { output = (output + data).slice(-12000); });
  const pending = new Map();
  const message = kind => new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => { pending.delete(kind); reject(new Error(`Timed out waiting for ${kind}: ${output}`)); }, 120000);
    pending.set(kind, data => { clearTimeout(timer); resolveMessage(data); });
  });
  const listening = message("listening"), seeded = message("fixture");
  child.on("message", data => { pending.get(data.kind)?.(data); pending.delete(data.kind); });
  const report = { root, inventory: null, direct: [], windows: [] };
  try {
    fixture = await seeded; port = (await listening).port; report.inventory = fixture.inventory;
    const base = `http://127.0.0.1:${port}`;
    // Warm the actual HTTP/authentication boundary, then measure guest/member reads.
    assert.equal((await fetch(base + "/api/health")).status, 200);
    for (const member of [false, true]) {
      const response = message("direct-result"); child.send({ kind: "direct", member });
      report.direct.push(await response);
    }
    const fresh = message("freshness-result"); child.send({ kind: "freshness" });
    report.freshness = await fresh;
    const paths = ["/api/me", "/api/discovery/sidebar", "/api/tourdates?days=30&limit=500",
      "/api/tourdates?days=30&limit=500&country=CA", "/api/artists?q=load&limit=8",
      "/api/artists/resolve?name=Load%20Artist%200", "/api/venues/load-hall-0/reviews"];
    for (const member of [false, true]) {
      const marked = message("marked"); child.send({ kind: "mark" }); await marked;
      const rows = [], health = [];
      await Promise.all(Array.from({ length: 12 }, async (_, worker) => {
        for (let visit = worker; visit < 48; visit += 12) {
          const visitor = fixture.readers[visit % fixture.readers.length];
          await Promise.all(paths.map(async path => {
            const at = performance.now();
            const res = await fetch(base + path, { headers: { ...(member ? { Cookie: visitor.cookie } : {}),
              "CF-Connecting-IP": `198.18.0.${visit + 1}`, "X-Forwarded-For": `198.18.0.${visit + 1}` }, signal: AbortSignal.timeout(30000) });
            await res.arrayBuffer(); rows.push({ path, status: res.status, ms: performance.now() - at });
          }));
          const at = performance.now(), res = await fetch(base + "/api/health", { signal: AbortSignal.timeout(30000) });
          await res.arrayBuffer(); health.push({ status: res.status, ms: performance.now() - at });
        }
      }));
      const measured = message("measured"); child.send({ kind: "measure" });
      const timing = await measured;
      report.windows.push({ member, ...timing, requests: rows.length, statuses: Object.fromEntries([...new Set(rows.map(row => row.status))].map(status => [status, rows.filter(row => row.status === status).length])),
        p95Ms: percentile(rows.map(row => row.ms), .95), healthP95Ms: percentile(health.map(row => row.ms), .95),
        healthStatuses: [...new Set(health.map(row => row.status))], routes: paths.map(path => ({ path, p95Ms: percentile(rows.filter(row => row.path === path).map(row => row.ms), .95) })) });
    }
    const destination = arg("output", null);
    if (destination) writeFileSync(resolve(destination), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    const exited = new Promise(done => child.once("exit", done));
    child.kill(); await exited;
    rmSync(directory, { recursive: true, force: true });
  }
}
