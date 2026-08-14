#!/usr/bin/env node
// Read-only capacity probe for an isolated/local Pit server.
//
//   node scripts/benchmark-read.mjs --url http://127.0.0.1:3130 --concurrency 12 --seconds 20
//
// This intentionally refuses production and never calls a mutating endpoint.
// X-Forwarded-For rotates across virtual visitors so the benchmark measures the
// application instead of one guest tripping the legitimate 300/min flood guard.

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const baseUrl = String(arg("url", "http://127.0.0.1:3000")).replace(/\/+$/, "");
const concurrency = Math.max(1, Math.min(200, Math.floor(Number(arg("concurrency", 12)) || 12)));
const seconds = Math.max(2, Math.min(300, Number(arg("seconds", 20)) || 20));
const warmupSeconds = Math.max(0, Math.min(30, Number(arg("warmup", 2)) || 0));
const timeoutMs = Math.max(1000, Math.min(30000, Number(arg("timeout", 10000)) || 10000));
const profileName = String(arg("profile", "personalized")).toLowerCase();

let target;
try { target = new URL(baseUrl); } catch { target = null; }
if (!target || !["localhost", "127.0.0.1", "::1"].includes(target.hostname)) {
  console.error("Refusing to benchmark a non-local server. Run this only against an isolated local database.");
  process.exit(2);
}

// Weight endpoints by ordinary browse behavior. Media bytes do not pass
// through this Node service in production; they are served by R2 instead.
// `personalized` is the current default product path. `legacy` remains useful
// for measuring the simpler chronological baseline during capacity reviews.
const profiles = {
  personalized: [
    ["/api/feed/for-you?limit=30", 40],
    ["/api/discovery/sidebar", 20],
    ["/api/discover/overview?by=popularity&country=Worldwide", 15],
    ["/api/artists?q=cole&limit=12", 15],
    ["/api/tourdates", 10],
  ],
  legacy: [
    ["/api/feed?limit=30", 40],
    ["/api/discovery/sidebar", 20],
    ["/api/discover/overview?by=popularity&country=Worldwide", 15],
    ["/api/artists?q=cole&limit=12", 15],
    ["/api/tourdates", 10],
  ],
};
const profile = profiles[profileName];
if (!profile) {
  console.error(`Unknown profile '${profileName}'. Choose personalized or legacy.`);
  process.exit(2);
}
const schedule = profile.flatMap(([path, weight]) => Array.from({ length: weight }, () => path));
const VISITOR_POOL = 60000;
const percentile = (sorted, value) => sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))]
  : 0;

async function runWindow(durationMs, record) {
  const deadline = performance.now() + durationMs;
  let sequence = 0;
  const workers = Array.from({ length: concurrency }, (_, worker) => (async () => {
    while (performance.now() < deadline) {
      const requestNumber = sequence++;
      const path = schedule[requestNumber % schedule.length];
      const started = performance.now();
      let status = 0;
      let bytes = 0;
      try {
        // Include the worker so every concurrent connection owns a disjoint
        // guest bucket instead of resetting requestNumber to zero per worker.
        const visitor = ((requestNumber * concurrency + worker) % VISITOR_POOL) + 1;
        const response = await fetch(`${baseUrl}${path}`, {
          headers: {
            Accept: "application/json",
            "X-Forwarded-For": `198.18.${Math.floor(visitor / 250)}.${(visitor % 250) + 1}`,
            "User-Agent": `pit-capacity-probe/${worker}`,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        status = response.status;
        bytes = (await response.arrayBuffer()).byteLength;
      } catch {}
      if (record) record({ path, status, bytes, latency: performance.now() - started });
    }
  })());
  await Promise.all(workers);
}

const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
if (!health?.ok) {
  console.error(`The isolated server is not healthy (${health?.status || "network failure"}).`);
  process.exit(2);
}

if (warmupSeconds) await runWindow(warmupSeconds * 1000, null);

const rows = [];
const startedAt = performance.now();
await runWindow(seconds * 1000, (row) => rows.push(row));
const elapsedSeconds = (performance.now() - startedAt) / 1000;
const latencies = rows.map((row) => row.latency).sort((a, b) => a - b);
const successes = rows.filter((row) => row.status >= 200 && row.status < 300).length;
const rateLimited = rows.filter((row) => row.status === 429).length;
const serverErrors = rows.filter((row) => row.status >= 500).length;
const networkErrors = rows.filter((row) => row.status === 0).length;
const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);

console.log(`target       ${baseUrl}`);
console.log(`profile      ${profileName} API browse mix (feed 40%, sidebar 20%, overview 15%, artists 15%, tour dates 10%)`);
console.log(`load         ${concurrency} concurrent for ${elapsedSeconds.toFixed(1)}s (${rows.length} requests)`);
console.log(`throughput   ${(rows.length / elapsedSeconds).toFixed(1)} req/s, ${(totalBytes / elapsedSeconds / 1024 / 1024).toFixed(1)} MiB/s JSON`);
console.log(`latency      p50 ${percentile(latencies, 0.50).toFixed(1)}ms  p95 ${percentile(latencies, 0.95).toFixed(1)}ms  p99 ${percentile(latencies, 0.99).toFixed(1)}ms  max ${(latencies.at(-1) || 0).toFixed(1)}ms`);
console.log(`outcomes     2xx ${successes}  429 ${rateLimited}  5xx ${serverErrors}  network ${networkErrors}`);

for (const [path] of profile) {
  const subset = rows.filter((row) => row.path === path).map((row) => row.latency).sort((a, b) => a - b);
  console.log(`route p95    ${percentile(subset, 0.95).toFixed(1).padStart(7)}ms  ${path}`);
}

if (successes !== rows.length) process.exitCode = 1;
