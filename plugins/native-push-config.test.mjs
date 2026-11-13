import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import configure from "../app.config.js";
import withLocalPushOff from "./with-local-push-off.cjs";

const require = createRequire(import.meta.url);
const { getPrebuildConfigAsync } = require("@expo/prebuild-config");
const { compileModsAsync, withPlugins } = require("expo/config-plugins");
const root = fileURLToPath(new URL("../", import.meta.url));
const projectId = "11111111-1111-1111-1111-111111111111"; // Local fixture only.
const keys = ["MSHPIT_LOCAL_DEV", "MSHPIT_NATIVE_PUSH_ENABLED", "MSHPIT_EAS_PROJECT_ID", "MSHPIT_GOOGLE_SERVICES_FILE", "EXPO_NO_DOTENV"];

async function environment(values, run) {
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, { EXPO_NO_DOTENV: "1" }, values);
    return await run();
  } finally {
    for (const key of keys) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
  }
}

async function introspect(values, seedEntitlements) {
  return environment(values, async () => {
    const { exp } = await getPrebuildConfigAsync(root, { platforms: ["ios", "android"] });
    if (seedEntitlements) exp.ios.entitlements = structuredClone(seedEntitlements);
    const result = await compileModsAsync(exp, { projectRoot: root, platforms: ["ios", "android"], introspect: true, ignoreExistingNativeFiles: true });
    return { config: result, mods: result._internal.modResults };
  });
}

for (const value of [undefined, "0"]) {
  test(`real Expo prebuild omits APNs for local development with push ${value ?? "unset"}`, async () => {
    const result = await introspect({ MSHPIT_LOCAL_DEV: "1", ...(value ? { MSHPIT_NATIVE_PUSH_ENABLED: value } : {}) });
    assert.equal(result.config.ios.bundleIdentifier, "com.mshpit.app.dev");
    assert.equal(result.config.extra.nativePushEnabled, false);
    assert.equal(Object.hasOwn(result.mods.ios.entitlements, "aps-environment"), false);
    assert.equal(result.mods.ios.infoPlist.UIBackgroundModes?.includes("remote-notification") ?? false, false);
    assert.equal(result.config.ios.supportsTablet, true);
    assert.ok(result.mods.ios.infoPlist.UIApplicationSceneManifest, "existing scene lifecycle is retained");
  });
}

test("repeated push on/off prebuild preserves unrelated entitlements and restores enabled APNs", async () => {
  const unrelated = { "get-task-allow": true, "keychain-access-groups": ["$(AppIdentifierPrefix)com.mshpit.app.dev"], "com.apple.developer.custom-fixture": "preserved" };
  const enabled = { MSHPIT_LOCAL_DEV: "1", MSHPIT_NATIVE_PUSH_ENABLED: "1", MSHPIT_EAS_PROJECT_ID: projectId };
  const on = await introspect(enabled, unrelated);
  assert.deepEqual(on.mods.ios.entitlements, { ...unrelated, "aps-environment": "development" });
  const off = await introspect({ MSHPIT_LOCAL_DEV: "1" }, on.mods.ios.entitlements);
  assert.deepEqual(off.mods.ios.entitlements, unrelated);
  const again = await introspect({ MSHPIT_LOCAL_DEV: "1", MSHPIT_NATIVE_PUSH_ENABLED: "0" }, off.mods.ios.entitlements);
  assert.deepEqual(again.mods.ios.entitlements, unrelated);
  const restored = await introspect(enabled, again.mods.ios.entitlements);
  assert.deepEqual(restored.mods.ios.entitlements, on.mods.ios.entitlements);
  assert.deepEqual(off.mods.android, on.mods.android, "Android plugin effects must not change with the iOS exception");
  assert.deepEqual(off.mods.ios.infoPlist, on.mods.ios.infoPlist, "local notifications/scene/privacy configuration remains unchanged");
});

test("production identity keeps APNs even when runtime push is off and retains explicit distribution entitlement", async () => {
  const normal = await introspect({});
  assert.equal(normal.config.ios.bundleIdentifier, "com.mshpit.app");
  assert.equal(normal.mods.ios.entitlements["aps-environment"], "development");
  const enabled = await introspect({ MSHPIT_NATIVE_PUSH_ENABLED: "1", MSHPIT_EAS_PROJECT_ID: projectId }, { "aps-environment": "production" });
  assert.equal(enabled.config.extra.nativePushEnabled, true);
  assert.equal(enabled.mods.ios.entitlements["aps-environment"], "production");
  assert.equal(enabled.config.plugins.includes("./plugins/with-local-push-off.cjs"), false);
});

test("push-enabled variants retain fail-closed project validation and configured credentials", async () => {
  for (const local of ["0", "1"]) {
    await environment({ MSHPIT_LOCAL_DEV: local, MSHPIT_NATIVE_PUSH_ENABLED: "1" }, async () => {
      assert.throws(() => configure({ config: {} }), /project ID/);
      process.env.MSHPIT_EAS_PROJECT_ID = "invalid";
      assert.throws(() => configure({ config: {} }), /project ID/);
      process.env.MSHPIT_GOOGLE_SERVICES_FILE = "fixture-google-services.json";
      delete process.env.MSHPIT_EAS_PROJECT_ID;
      const config = configure({ config: { extra: { eas: { projectId } } } });
      assert.equal(config.extra.eas.projectId, projectId);
      assert.equal(config.android.googleServicesFile, "fixture-google-services.json");
      assert.equal(config.plugins.includes("./plugins/with-local-push-off.cjs"), false);
    });
  }
});

test("misapplying the push-off plugin to a production, enabled or unresolved identity refuses rather than stripping capability", async () => {
  for (const [bundleIdentifier, nativePushEnabled] of [["com.mshpit.app", false], ["com.mshpit.app.dev", true], ["com.mshpit.app.dev", undefined]]) {
    const config = withPlugins({ name: "fixture", slug: "fixture", _internal: { projectRoot: root }, ios: { bundleIdentifier, entitlements: { "aps-environment": "production" } }, extra: { nativePushEnabled } }, [withLocalPushOff]);
    await assert.rejects(compileModsAsync(config, { projectRoot: root, platforms: ["ios"], introspect: true, ignoreExistingNativeFiles: true }), /restricted to the push-disabled Mshpit Dev/);
  }
});
