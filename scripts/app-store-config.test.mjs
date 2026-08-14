import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(readFileSync(join(ROOT, name), "utf8"));
const app = readJson("app.json").expo;
const eas = readJson("eas.json");
const settingsSource = readFileSync(join(ROOT, "src", "screens", "SettingsScreen.jsx"), "utf8");

function pngHeader(relativePath) {
  const absolutePath = join(ROOT, relativePath.replace(/^\.\//, ""));
  assert.equal(existsSync(absolutePath), true, `${relativePath} must exist`);
  const bytes = readFileSync(absolutePath);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${relativePath} must be a PNG`);
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR", `${relativePath} must start with an IHDR chunk`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
  };
}

test("native application identifiers and versions are explicit", () => {
  assert.match(app.version, /^\d+\.\d+\.\d+$/);
  assert.equal(app.scheme, "mshpit");
  assert.equal(app.ios.bundleIdentifier, "com.mshpit.app");
  assert.match(app.ios.buildNumber, /^\d+$/);
  assert.equal(app.ios.supportsTablet, false);
  assert.equal(app.android.package, "com.mshpit.app");
  assert.equal(Number.isSafeInteger(app.android.versionCode) && app.android.versionCode > 0, true);
  assert.doesNotMatch(JSON.stringify(app), /com\.placeholder\.appid/i);
});

test("Settings uses the configured native version instead of stale alpha copy", () => {
  assert.match(settingsSource, /Constants\.expoConfig\?\.version/);
  assert.doesNotMatch(settingsSource, /Alpha build|>0\.1</i);
});

test("iOS export-compliance and required-reason declarations are explicit", () => {
  assert.equal(app.ios.config.usesNonExemptEncryption, false);
  assert.equal(app.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads, false);
  assert.equal(app.ios.infoPlist.NSAppTransportSecurity.NSExceptionDomains.localhost.NSExceptionAllowsInsecureHTTPLoads, true);
  const declarations = new Map(app.ios.privacyManifests.NSPrivacyAccessedAPITypes.map((entry) => [
    entry.NSPrivacyAccessedAPIType,
    new Set(entry.NSPrivacyAccessedAPITypeReasons),
  ]));
  for (const [category, reasons] of Object.entries({
    NSPrivacyAccessedAPICategoryUserDefaults: ["CA92.1"],
    NSPrivacyAccessedAPICategoryFileTimestamp: ["0A2A.1", "3B52.1", "C617.1"],
    NSPrivacyAccessedAPICategoryDiskSpace: ["E174.1", "85F4.1"],
    NSPrivacyAccessedAPICategorySystemBootTime: ["35F9.1"],
  })) {
    assert.equal(declarations.has(category), true, `${category} must be declared`);
    for (const reason of reasons) assert.equal(declarations.get(category).has(reason), true, `${category} must include ${reason}`);
  }
});

test("the iOS icon source is a square opaque 1024px PNG", () => {
  const icon = pngHeader(app.icon);
  assert.deepEqual([icon.width, icon.height], [1024, 1024]);
  assert.equal([4, 6].includes(icon.colorType), false, "the App Store icon must not contain an alpha channel");
});

test("media permission copy is scoped to features the app actually exposes", () => {
  const imagePicker = app.plugins.find((entry) => Array.isArray(entry) && entry[0] === "expo-image-picker");
  assert.ok(imagePicker, "expo-image-picker must have explicit permission configuration");
  assert.match(imagePicker[1].photosPermission, /concert photos, videos, and profile photos/i);
  assert.equal(imagePicker[1].cameraPermission, false);
  assert.equal(imagePicker[1].microphonePermission, false);
});

test("EAS release profiles contain no Apple credentials or placeholder account metadata", () => {
  assert.equal(eas.cli.appVersionSource, "remote");
  assert.equal(eas.cli.requireCommit, true);
  assert.equal(eas.build.preview.distribution, "internal");
  assert.equal(eas.build.production.autoIncrement, true);
  assert.deepEqual(eas.submit.production, {});
  const serialized = JSON.stringify(eas);
  assert.doesNotMatch(serialized, /appleId|appleTeamId|ascAppId|ascApiKey|your@email|placeholder/i);
});
