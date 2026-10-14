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
if (!['localhost', '127.0.0.1'].includes(url.hostname)
    || !['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error("Local mobile testing requires a localhost API origin. Use adb reverse for Android; Expo Go on iPhone needs a separate approved HTTPS staging API.");
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
  },
});
// Prebuild moves Expo/React to production dependencies and rewrites npm scripts.
// This repository intentionally prunes frontend tooling from its server image.
if (mode === "prebuild" || mode === "android") writeFileSync(manifestPath, manifest);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
