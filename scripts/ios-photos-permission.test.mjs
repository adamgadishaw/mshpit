import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const EXPO_CLI = require.resolve("expo/bin/cli");
const PHOTO_COPY = "Allow MSHPIT to choose concert photos, videos, and profile photos you want to share.";

function introspectNativeConfig(localDevelopment) {
  const env = { ...process.env, EXPO_NO_TELEMETRY: "1" };
  if (localDevelopment) env.MSHPIT_LOCAL_DEV = "1";
  else delete env.MSHPIT_LOCAL_DEV;

  // Expo evaluates the installed config plugins in memory. This does not
  // prebuild/write native projects, install an app, or request OS permission.
  const result = spawnSync(process.execPath, [
    EXPO_CLI, "config", "--type", "introspect", "--json",
  ], { cwd: ROOT, env, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

for (const localDevelopment of [false, true]) {
  const variant = localDevelopment ? "local development" : "production";
  test(`generated ${variant} native configuration uses MSHPIT Photos copy without camera or microphone access`, () => {
    const config = introspectNativeConfig(localDevelopment);
    const native = config._internal.modResults;
    const plist = native.ios.infoPlist;
    const bundleIdentifier = localDevelopment ? "com.mshpit.app.dev" : "com.mshpit.app";

    assert.equal(plist.NSPhotoLibraryUsageDescription, PHOTO_COPY);
    assert.equal(Object.hasOwn(plist, "NSCameraUsageDescription"), false);
    assert.equal(Object.hasOwn(plist, "NSMicrophoneUsageDescription"), false);
    assert.equal(Object.hasOwn(plist, "NSPhotoLibraryAddUsageDescription"), false);
    assert.equal(plist.CFBundleDisplayName, localDevelopment ? "Mshpit Dev" : "Mshpit");
    assert.equal(config.ios.bundleIdentifier, bundleIdentifier);
    assert.equal(config.android.package, bundleIdentifier);

    const picker = config.plugins.find((entry) => Array.isArray(entry) && entry[0] === "expo-image-picker");
    assert.equal(picker[1].cameraPermission, false);
    assert.equal(picker[1].microphonePermission, false);

    // The iOS-only wording option must not enable Android capture permissions.
    const permissions = native.android.manifest.manifest["uses-permission"];
    for (const permission of ["android.permission.CAMERA", "android.permission.RECORD_AUDIO"]) {
      const entries = permissions.filter((entry) => entry.$["android:name"] === permission);
      assert.equal(entries.length, 1, `${permission} should have one explicit removal`);
      assert.equal(entries[0].$["tools:node"], "remove", `${permission} must remain blocked`);
    }
  });
}
