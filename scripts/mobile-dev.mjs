import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

const commands = {
  android: ["run:android"],
  prebuild: ["prebuild", "--platform", "android", "--no-install"],
  start: ["start", "--dev-client", "--localhost"],
  go: ["start", "--go", "--lan"],
};
const [mode, ...args] = process.argv.slice(2);
if (!commands[mode]) throw new Error("Use android, prebuild, start, or go.");

// Never silently fall back to the live API for local device testing.
const apiOrigin = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const url = new URL(apiOrigin);
const approvedLive = process.env.MSHPIT_APPROVED_LIVE_API === '1' && url.origin === 'https://www.mshpit.com';
if ((!['localhost', '127.0.0.1'].includes(url.hostname) && !approvedLive)
    || !['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error("Use localhost by default. The owner-approved live review requires MSHPIT_APPROVED_LIVE_API=1 and https://www.mshpit.com.");
}
console.log(`Local mobile ${mode}: API ${url.origin}; app com.mshpit.app.dev`);
const cli = fileURLToPath(new URL("../node_modules/expo/bin/cli", import.meta.url));
const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url));
const manifest = readFileSync(manifestPath, "utf8");
// Prefer IPv4 loopback on Windows so adb reverse can reach localhost Metro.
const result = spawnSync(process.execPath, ["--dns-result-order=ipv4first", cli, ...commands[mode], ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    MSHPIT_LOCAL_DEV: "1",
    EXPO_PUBLIC_API_URL: url.origin,
    EXPO_NO_TELEMETRY: "1",
    EXPO_PUBLIC_NATIVE_READ_ONLY_REVIEW: approvedLive ? "1" : "0",
  },
});
// Prebuild moves Expo/React to production dependencies and rewrites npm scripts.
// This repository intentionally prunes frontend tooling from its server image.
if (mode === "prebuild" || mode === "android") writeFileSync(manifestPath, manifest);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
