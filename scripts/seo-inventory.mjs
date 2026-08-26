#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  SITEMAP_MAX_BYTES,
  SITEMAP_MAX_URLS,
  createSitemapSnapshot,
} from "../server/features/seo/sitemapService.js";

function shardDataset(pathname) {
  const match = /^\/sitemaps\/([a-z0-9-]+?)(?:-[2-9][0-9]*)?\.xml$/.exec(String(pathname || ""));
  return match?.[1] || "unknown";
}

function primaryLocations(xml) {
  return [...String(xml || "").matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

function routeFamily(value) {
  const pathname = new URL(value).pathname;
  if (pathname === "/") return "home";
  if (/^\/(venues|concerts)\/[a-z]{2}\/[^/]+(?:\/|$)/.test(pathname)) return "city-directories";
  if (/^\/(artists|events|venues|concerts)(?:\/|$)/.test(pathname)) return "directories";
  if (/^\/artist\/[^/]+\/concerts(?:\/|$)/.test(pathname)) return "artist-archives";
  if (pathname.startsWith("/artist/")) return "artists";
  if (pathname.startsWith("/event/")) return "events";
  if (pathname.startsWith("/venue/")) return "venues";
  if (pathname.startsWith("/concert/")) return "concerts";
  if (pathname.startsWith("/post/")) return "posts";
  if (pathname.startsWith("/u/")) return "profiles";
  return "pages";
}

export function inventoryFromSitemapSnapshot(snapshot, {
  durationMs = 0,
  rssDeltaBytes = 0,
} = {}) {
  if (!snapshot?.xmlFor || !Array.isArray(snapshot.paths)) throw new TypeError("SEO inventory requires a sitemap snapshot");
  const seen = new Set();
  const datasetCounts = {};
  const routeCounts = {};
  const problems = [];
  const shards = [];
  let totalUrls = 0;
  let duplicateUrls = 0;
  for (const path of snapshot.paths) {
    const xml = snapshot.xmlFor(path);
    const bytes = Buffer.byteLength(String(xml || ""), "utf8");
    const locations = primaryLocations(xml);
    const dataset = shardDataset(path);
    datasetCounts[dataset] = (datasetCounts[dataset] || 0) + locations.length;
    if (locations.length > SITEMAP_MAX_URLS) problems.push("SHARD_URL_LIMIT");
    if (bytes > SITEMAP_MAX_BYTES) problems.push("SHARD_BYTE_LIMIT");
    for (const location of locations) {
      if (seen.has(location)) duplicateUrls += 1;
      else seen.add(location);
      const family = routeFamily(location);
      routeCounts[family] = (routeCounts[family] || 0) + 1;
    }
    totalUrls += locations.length;
    shards.push(Object.freeze({ dataset, urls: locations.length, bytes }));
  }
  if (duplicateUrls) problems.push("DUPLICATE_CANONICAL_URL");
  if (Number(snapshot.stats?.totalUrls) !== totalUrls) problems.push("SNAPSHOT_COUNT_MISMATCH");
  return Object.freeze({
    ok: problems.length === 0,
    generatedAt: snapshot.generatedAt,
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
    rssDeltaBytes: Math.trunc(Number(rssDeltaBytes) || 0),
    totalUrls,
    uniqueUrls: seen.size,
    duplicateUrls,
    shardCount: shards.length,
    largestShardUrls: Math.max(0, ...shards.map((row) => row.urls)),
    largestShardBytes: Math.max(0, ...shards.map((row) => row.bytes)),
    datasetCounts: Object.freeze(datasetCounts),
    routeCounts: Object.freeze(routeCounts),
    sourceCounts: Object.freeze({ ...(snapshot.stats?.sourceCounts || {}) }),
    shards: Object.freeze(shards),
    problems: Object.freeze([...new Set(problems)]),
  });
}

export function createSeoInventory({
  database,
  env = process.env,
  now = Date.now(),
  memoryUsage = () => process.memoryUsage(),
  clock = () => performance.now(),
} = {}) {
  if (!database?.prepare) throw new TypeError("SEO inventory requires a database");
  const beforeMemory = Number(memoryUsage()?.rss) || 0;
  const startedAt = Number(clock()) || 0;
  const snapshot = createSitemapSnapshot({ database, env, now });
  const durationMs = Math.max(0, (Number(clock()) || 0) - startedAt);
  const rssDeltaBytes = (Number(memoryUsage()?.rss) || 0) - beforeMemory;
  return inventoryFromSitemapSnapshot(snapshot, { durationMs, rssDeltaBytes });
}

export function formatSeoInventory(inventory) {
  const lines = [
    `SEO inventory: ${inventory.ok ? "PASS" : "FAIL"}`,
    `Generated: ${new Date(inventory.generatedAt).toISOString()}`,
    `URLs: ${inventory.totalUrls} total / ${inventory.uniqueUrls} unique / ${inventory.duplicateUrls} duplicate`,
    `Shards: ${inventory.shardCount}; largest ${inventory.largestShardUrls} URLs / ${inventory.largestShardBytes} bytes`,
    `Build: ${inventory.durationMs} ms; RSS delta ${inventory.rssDeltaBytes} bytes`,
    `Datasets: ${JSON.stringify(inventory.datasetCounts)}`,
    `Routes: ${JSON.stringify(inventory.routeCounts)}`,
    `Sources: ${JSON.stringify(inventory.sourceCounts)}`,
  ];
  if (inventory.problems.length) lines.push(`Problems: ${inventory.problems.join(", ")}`);
  return lines.join("\n");
}

export async function runCli(argv = process.argv.slice(2)) {
  const json = argv.includes("--json");
  if (argv.some((argument) => argument !== "--json")) {
    console.error("Usage: npm run inventory:seo -- [--json]");
    return 2;
  }
  const { db } = await import("../server/db.js");
  try {
    const inventory = createSeoInventory({ database: db });
    console.log(json ? JSON.stringify(inventory, null, 2) : formatSeoInventory(inventory));
    return inventory.ok ? 0 : 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli();
}
