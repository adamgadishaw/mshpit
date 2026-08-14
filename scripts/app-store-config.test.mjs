import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(readFileSync(join(ROOT, name), "utf8"));
const app = readJson("app.json").expo;
const eas = readJson("eas.json");
const pkg = readJson("package.json");
const settingsSource = readFileSync(join(ROOT, "src", "screens", "SettingsScreen.jsx"), "utf8");
const playerSource = readFileSync(join(ROOT, "src", "components", "PlayerBar.jsx"), "utf8");
const nativeAudioSource = readFileSync(join(ROOT, "src", "lib", "audioPreview.native.js"), "utf8");
const webAudioSource = readFileSync(join(ROOT, "src", "lib", "audioPreview.js"), "utf8");

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
  assert.match(settingsSource, /https:\/\/www\.mshpit\.com\/support/);
  assert.match(settingsSource, /Help & support/);
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

test("the signed app uses owned Pit artwork instead of the Expo starter assets", () => {
  assert.match(app.icon, /pit-icon-v\d+\.png$/);
  assert.match(app.web.favicon, /pit-favicon-v\d+\.png$/);
  assert.doesNotMatch(JSON.stringify({ icon: app.icon, android: app.android.adaptiveIcon, web: app.web }), /(?:^|\/)icon\.png|android-icon-|favicon\.png/);

  const icon = pngHeader(app.icon);
  assert.deepEqual([icon.width, icon.height], [1024, 1024]);
  assert.equal([4, 6].includes(icon.colorType), false, "the App Store icon must not contain an alpha channel");

  const adaptive = app.android.adaptiveIcon;
  assert.equal(adaptive.backgroundColor.toLowerCase(), "#0d0b09");
  assert.deepEqual([pngHeader(adaptive.foregroundImage).width, pngHeader(adaptive.foregroundImage).height], [512, 512]);
  assert.deepEqual([pngHeader(adaptive.backgroundImage).width, pngHeader(adaptive.backgroundImage).height], [512, 512]);
  assert.deepEqual([pngHeader(adaptive.monochromeImage).width, pngHeader(adaptive.monochromeImage).height], [432, 432]);
  assert.deepEqual([pngHeader(app.web.favicon).width, pngHeader(app.web.favicon).height], [48, 48]);
});

test("the forced-dark SDK 56 splash and native root are explicitly branded", () => {
  assert.match(pkg.dependencies["expo-splash-screen"], /^~56\.0\./);
  assert.match(pkg.dependencies["expo-system-ui"], /^~56\.0\./);
  assert.equal(app.plugins.includes("expo-system-ui"), true,
    "expo-system-ui must run as a config plugin so introspection writes the requested native appearance");
  assert.equal(app.userInterfaceStyle, "dark");
  assert.equal(app.backgroundColor.toLowerCase(), "#0d0b09");
  const splash = app.plugins.find((entry) => Array.isArray(entry) && entry[0] === "expo-splash-screen");
  assert.ok(splash, "expo-splash-screen must be configured through its config plugin");
  assert.equal(splash[1].backgroundColor.toLowerCase(), "#0d0b09");
  assert.equal(splash[1].dark, undefined, "a forced-dark app must not configure an unreachable alternate splash");
  assert.equal(splash[1].resizeMode, "contain");
  assert.equal(splash[1].imageWidth, 220);
  const image = pngHeader(splash[1].image);
  assert.deepEqual([image.width, image.height], [1024, 1024]);
  assert.equal([4, 6].includes(image.colorType), true, "the splash foreground should preserve transparency");
});

test("media permission copy is scoped to features the app actually exposes", () => {
  const imagePicker = app.plugins.find((entry) => Array.isArray(entry) && entry[0] === "expo-image-picker");
  assert.ok(imagePicker, "expo-image-picker must have explicit permission configuration");
  assert.match(imagePicker[1].photosPermission, /concert photos, videos, and profile photos/i);
  assert.equal(imagePicker[1].cameraPermission, false);
  assert.equal(imagePicker[1].microphonePermission, false);

  const audio = app.plugins.find((entry) => Array.isArray(entry) && entry[0] === "expo-audio");
  assert.match(pkg.dependencies["expo-audio"], /^~56\.0\./);
  assert.ok(audio, "expo-audio must have explicit playback-only configuration");
  assert.equal(audio[1].microphonePermission, false);
  assert.equal(audio[1].recordAudioAndroid, false);
  assert.equal(audio[1].enableBackgroundRecording, false);
  assert.equal(audio[1].enableBackgroundPlayback, false);
});

test("native playback uses Expo audio without waiting for the web-only YouTube engine", () => {
  assert.match(nativeAudioSource, /from "expo-audio"/);
  assert.doesNotMatch(nativeAudioSource, /from [^\n]*(?:youtube|react-native-webview)|useYouTube/i);
  assert.match(webAudioSource, /new window\.Audio\(\)/);
  assert.match(playerSource, /web\s*\?\s*\(directVideoId[\s\S]{0,220}: Promise\.resolve\(null\)/);
  assert.match(playerSource, /const hasVideo = web &&/);
});

test("EAS release profiles contain no Apple credentials or placeholder account metadata", () => {
  assert.equal(eas.cli.appVersionSource, "remote");
  assert.equal(eas.cli.requireCommit, true);
  assert.match(pkg.engines.node, /^>=24(?:\.|$)/);
  assert.equal(eas.build.base.node, "24.16.0");
  assert.equal(eas.build.preview.extends, "base");
  assert.equal(eas.build.production.extends, "base");
  assert.equal(eas.build.preview.distribution, "internal");
  assert.equal(eas.build.production.autoIncrement, true);
  assert.deepEqual(eas.submit.production, {});
  const serialized = JSON.stringify(eas);
  assert.doesNotMatch(serialized, /appleId|appleTeamId|ascAppId|ascApiKey|your@email|placeholder/i);
});
