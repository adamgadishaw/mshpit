const { withEntitlementsPlist } = require("expo/config-plugins");

// Keep the Notifications plugin's Android/channel and local-notification setup.
// Only the explicitly push-off development variant omits APNs signing capability.
module.exports = function withLocalPushOff(config) {
  return withEntitlementsPlist(config, config => {
    if (config.ios?.bundleIdentifier !== "com.mshpit.app.dev" || config.extra?.nativePushEnabled !== false) {
      throw new Error("Push-off entitlements are restricted to the push-disabled Mshpit Dev variant.");
    }
    delete config.modResults["aps-environment"];
    return config;
  });
};
