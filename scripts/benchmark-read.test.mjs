import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

async function fixture(t, { member = false } = {}) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, cookie: request.headers.cookie });
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(request.url === "/api/me" ? { user: member ? { id: "local-member" } : null } : { ok: true }));
    }, 15);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: "http://127.0.0.1:" + server.address().port, requests };
}

async function run(url, args = [], env = {}) {
  const processEnv = { ...process.env, ...env };
  if (!Object.hasOwn(env, "PIT_BENCHMARK_SESSION_COOKIE")) delete processEnv.PIT_BENCHMARK_SESSION_COOKIE;
  const child = spawn(process.execPath, ["scripts/benchmark-read.mjs", "--url", url,
    "--seconds", "2", "--requests", "100", "--warmup", "0", "--concurrency", "1", ...args], {
    cwd: new URL("..", import.meta.url), env: processEnv, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const [code] = await once(child, "close");
  return { code, output };
}

test("read benchmark defaults to guest snapshots and never sends inherited session cookies", async (t) => {
  const { url, requests } = await fixture(t);
  const result = await run(url, [], { PIT_BENCHMARK_SESSION_COOKIE: "pit_session=should-not-be-sent" });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /guest public snapshot/);
  assert.equal(requests.filter((request) => request.path !== "/api/health").length, 100,
    "the route-mix assertion must not depend on how much traffic fits in a wall-clock interval");
  assert.ok(requests.some((request) => request.path === "/api/landing/media"));
  assert.equal(requests.some((request) => request.path.startsWith("/api/feed")), false);
  assert.equal(requests.some((request) => request.cookie), false);
});

test("member benchmark profiles refuse missing or expired authorization before feed load", async (t) => {
  const { url, requests } = await fixture(t);
  const missing = await run(url, ["--profile", "personalized"]);
  assert.equal(missing.code, 2, missing.output);
  assert.match(missing.output, /require PIT_BENCHMARK_SESSION_COOKIE/);
  assert.equal(requests.length, 0);
  const expired = await run(url, ["--profile", "personalized"], { PIT_BENCHMARK_SESSION_COOKIE: "pit_session=expired" });
  assert.equal(expired.code, 2, expired.output);
  assert.match(expired.output, /No feed load was started/);
  assert.equal(requests.some((request) => request.path.startsWith("/api/feed")), false);
});

test("explicit member benchmark validates the session and authenticates each feed request", async (t) => {
  const { url, requests } = await fixture(t, { member: true });
  const cookie = "pit_session=local-fixture";
  const result = await run(url, ["--profile", "personalized"], { PIT_BENCHMARK_SESSION_COOKIE: cookie });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /personalized authenticated feed/);
  const feedReads = requests.filter((request) => request.path.startsWith("/api/feed"));
  assert.ok(feedReads.length > 0);
  assert.ok(feedReads.every((request) => request.cookie === cookie));
  assert.equal(result.output.includes(cookie), false, "credentials must not enter benchmark reports");
});
