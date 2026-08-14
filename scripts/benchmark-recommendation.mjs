#!/usr/bin/env node
// Service-level cold/warm recommendation probe. Run only with PIT_DATA_DIR set
// to an isolated `.tmp/capacity-*` fixture seeded by benchmark:seed.

import { resolve, sep } from "node:path";

const dataDirectory = resolve(process.env.PIT_DATA_DIR || "");
if (!dataDirectory.toLowerCase().includes(`${sep}.tmp${sep}capacity-`)) {
  console.error("Refusing to benchmark recommendations outside an isolated .tmp/capacity-* data directory.");
  process.exit(2);
}

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const iterations = Math.max(5, Math.min(200, Math.floor(Number(arg("iterations", 40)) || 40)));
const { clearRecommendationSnapshotsForTests, recommendedFeedPage } = await import("../server/recommendationService.js");

const percentile = (sorted, fraction) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] || 0;
const measure = (run) => {
  const start = performance.now();
  const result = run();
  return { latency: performance.now() - start, posts: result.rows.length };
};

const cold = [];
for (let index = 0; index < iterations; index++) {
  clearRecommendationSnapshotsForTests();
  cold.push(measure(() => recommendedFeedPage({
    viewer: { id: `bench_viewer_${index}`, favorite_artists: "[]", genres: "[]", home_city: "Toronto" },
    limit: 30,
    at: Date.now(),
  })));
}

clearRecommendationSnapshotsForTests();
recommendedFeedPage({ viewer: null, limit: 30, at: Date.now() });
const warm = Array.from({ length: iterations }, () => measure(() => recommendedFeedPage({ viewer: null, limit: 30, at: Date.now() })));

for (const [label, rows] of [["cold signed-in", cold], ["warm shared guest", warm]]) {
  const values = rows.map((row) => row.latency).sort((a, b) => a - b);
  console.log(`${label.padEnd(17)} p50 ${percentile(values, 0.5).toFixed(1)}ms  p95 ${percentile(values, 0.95).toFixed(1)}ms  max ${values.at(-1).toFixed(1)}ms  posts ${rows[0].posts}`);
}

clearRecommendationSnapshotsForTests();
