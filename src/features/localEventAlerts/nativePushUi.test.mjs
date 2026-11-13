import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import configure from "../../../app.config.js";
const require = createRequire(import.meta.url), React = require("react"), RN = require("react-native-web");
const { renderToStaticMarkup } = require("react-dom/server");
const file = new URL("./LocalPushSettings.native.jsx", import.meta.url);
const code = require("@babel/core").transformSync(readFileSync(file, "utf8"), { filename: file.pathname, babelrc: false, configFile: false,
  plugins: [[require.resolve("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require.resolve("@babel/plugin-transform-modules-commonjs")] }).code;
let state;
const module = { exports: {} };
new Function("require", "module", "exports", code)(name => {
  if (name === "react") return { ...React, useSyncExternalStore: (subscribe, snapshot) => snapshot() };
  if (name === "react-native") return RN;
  if (name === "./nativePushService") return { nativePush: { snapshot: () => state, subscribe: () => () => {}, commands: () => ({}) } };
  return require(name);
}, module, module.exports);
function render(snapshot, pushDeliveryEnabled = false) {
  state = snapshot;
  const Row = ({ label, sub, disabled }) => React.createElement("button", { disabled }, label, " ", sub);
  return renderToStaticMarkup(React.createElement(module.exports.default, { preferences: { datesPush: true, salesPush: true },
    Row, Toggle: () => null, styles: {}, pushDeliveryEnabled }));
}
test("native settings render honest permission, capability, transport and retry states", () => {
  assert.match(render({ capable: false }), /configured native build/);
  assert.match(render({ capable: true }), /Enable notifications on this device/);
  assert.match(render({ capable: true }), /not enabled on this server/);
  assert.match(render({ capable: true, data: { enabled: true } }, true), /Turn off notifications on this device/);
  assert.match(render({ capable: true, data: { reason: "permission-denied" } }), /Open device notification settings/);
  assert.match(render({ capable: true, error: { userMessage: "Could not save. Try again." } }), /Could not save. Try again./);
});
test("native config defaults off, requires explicit project identity, and includes tablet and secure backup configuration", () => {
  const keys = ["MSHPIT_NATIVE_PUSH_ENABLED", "MSHPIT_EAS_PROJECT_ID", "MSHPIT_GOOGLE_SERVICES_FILE", "MSHPIT_LOCAL_DEV"];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    const config = { ios: { bundleIdentifier: "com.mshpit.app" }, android: { package: "com.mshpit.app" } };
    assert.equal(configure({ config }).extra.nativePushEnabled, false);
    process.env.MSHPIT_NATIVE_PUSH_ENABLED = "1"; assert.throws(() => configure({ config }), /project ID/);
    process.env.MSHPIT_EAS_PROJECT_ID = "11111111-1111-1111-1111-111111111111";
    const native = configure({ config }); assert.equal(native.ios.supportsTablet, true); assert.equal(native.extra.nativePushEnabled, true);
    assert.deepEqual(native.plugins.at(-1), ["expo-secure-store", { configureAndroidBackup: true }]);
    assert.equal(native.android.googleServicesFile, undefined);
    process.env.MSHPIT_LOCAL_DEV = "1"; assert.equal(configure({ config }).ios.bundleIdentifier, "com.mshpit.app.dev");
  } finally { for (const key of keys) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
});
