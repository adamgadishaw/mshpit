import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-public-read-http-"));
const distDir = mkdtempSync(join(tmpdir(), "pit-public-read-dist-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.NODE_ENV = "test";
process.env.ADMIN_PASSWORD = "Synthetic-test-only-Password1";
process.env.ADMIN_EMAIL = "owner@example.test";
const html = '<!doctype html><html><head><title>Fixture</title></head><body><div id="root"></div></body></html>';
writeFileSync(join(distDir, "index.html"), html);
writeFileSync(join(distDir, "fixture.html"), html);
writeFileSync(join(distDir, "fixture.js"), "/* local static fixture */");

// Exercise the production listener and route handler without starting its
// provider/background runtime. Only the dist directory, clock, and observation
// wrappers differ; the real SEO/API/session/SQLite implementations run here.
const indexUrl = new URL("./index.js", import.meta.url);
let source = readFileSync(indexUrl, "utf8");
const end = source.indexOf("applyHttpServerLimits(server);");
assert.ok(end > 0);
source = source.slice(0, end + "applyHttpServerLimits(server);".length)
  .replace(/^#![^\n]*\n/, "")
  .replace(/from (["'])(\.{1,2}\/[^"']+)\1/g, (_, quote, path) => `from ${JSON.stringify(new URL(path, indexUrl).href)}`)
  .replaceAll("import.meta.url", JSON.stringify(indexUrl.href))
  .replace('const DIST = join(HERE, "..", "dist");', `const DIST = ${JSON.stringify(distDir)};`)
  .replace("createPublicReadAdmission();", "createPublicReadAdmission({ clock: () => fixtureTime });")
  .replace("  injectHead,", "  injectHead as actualInjectHead,")
  .replace("  seoHttpPlan,", "  seoHttpPlan as actualSeoHttpPlan,");
source = `let fixtureTime=0; const projections={head:0,plan:0};
  const injectHead=(...args)=>{projections.head++;return actualInjectHead(...args)};
  const seoHttpPlan=(...args)=>{projections.plan++;return actualSeoHttpPlan(...args)};
  ${source}
  function scheduleAlert() {}
  const setTime=value=>{fixtureTime=value};
  export {server,db,projections,setTime};`;
const { server, db, projections, setTime } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const { rateLimit, createSession, COOKIE, resetRateLimitsForTests } = await import("./auth.js");
const { q } = await import("./db.js");
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(distDir, { recursive: true, force: true });
});
const request = async (path, options) => {
  const response = await fetch(`${origin}${path}`, { redirect: "manual", ...options });
  const body = await response.text();
  return { status: response.status, headers: response.headers, body };
};

test("health and readiness retain admission when the application identity map is full", async () => {
  resetRateLimitsForTests();
  try {
    for (let i = 0; i < 50_000; i += 1) assert.equal(rateLimit(`saturated:${i}`, 1, 3_600_000), true);
    assert.equal((await request("/api/time")).status, 429);
    assert.equal((await request("/api/health")).status, 200);
    assert.equal((await request("/api/readiness")).status, 200);
    assert.equal(rateLimit("saturated:0", 1, 3_600_000), false, "health requests must not clear application counters");
  } finally { resetRateLimitsForTests(); }
});

test("HTML GET/HEAD and selected APIs reject before projection, without charging legacy-denied API reads", async () => {
  assert.equal((await request("/artists")).status, 200);
  const head = await request("/artists", { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(head.body, "");
  assert.equal((await request("/fixture.html")).status, 200);
  assert.equal((await request("/api/artists?limit=1")).status, 200);
  assert.equal((await request("/api/time")).status, 200);
  assert.ok(projections.plan >= 2); assert.ok(projections.head >= 3);

  // Exhaust only the legacy API identity allowance. Rejected expensive API
  // requests must leave every new shared slot available to real HTML work.
  for (let i = 0; i < 300; i++) rateLimit("global:ip:127.0.0.1", 300, 60_000);
  setTime(60_000);
  for (let i = 0; i < 35; i++) assert.equal((await request("/api/artists?limit=1")).status, 429);
  for (let i = 0; i < 30; i++) {
    const result = await request(i === 0 ? "/fixture.html" : `/artists?utm_source=fixture${i}`, i === 1 ? { method: "HEAD" } : {});
    assert.equal(result.status, 200, `admitted burst request ${i}`);
  }
  const before = { ...projections };
  for (const [path, options] of [["/artists", {}], ["/artists?page=1000", { method: "HEAD" }],
    ["/fixture.html", {}], ["/discover", { headers: { "User-Agent": "Googlebot" } }],
    ["/api/page-head?path=/artists", {}]]) {
    const result = await request(path, options);
    assert.equal(result.status, 429, path);
    assert.equal(result.headers.get("retry-after"), "1");
    assert.equal(result.headers.get("cache-control"), "no-store");
    if (options.method === "HEAD") assert.equal(result.body, "");
  }
  assert.deepEqual(projections, before, "rejection must happen before SEO SQL/head generation");
  for (const path of ["/api/health", "/api/readiness", "/robots.txt", "/.well-known/security.txt", "/fixture.js", "/privacy"]) {
    assert.equal((await request(path)).status, 200, path);
  }
  setTime(61_000);
  assert.equal((await request("/artists", { method: "HEAD" })).status, 200);
  // Real signed-in sessions on the same socket address retain their account
  // identities even though the guest address's legacy API allowance is full.
  for (const id of ["availability_alice", "availability_bob"]) {
    q.insertUser.run(id, `${id}@example.test`, id, id, "unused", "fan", "", 0, 0, "AV", "#123456", Date.now());
    const cookie = `${COOKIE}=${createSession(id).token}`;
    assert.equal((await request("/api/artists?limit=1", { headers: { Cookie: cookie } })).status, 200);
  }
});
