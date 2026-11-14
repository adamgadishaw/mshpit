// Only the local mobile commands opt into a separate install alongside Mshpit.
export default ({ config }) => {
  const projectId = process.env.MSHPIT_EAS_PROJECT_ID || config.extra?.eas?.projectId;
  const enabled = process.env.MSHPIT_NATIVE_PUSH_ENABLED === "1";
  const localDevelopment = process.env.MSHPIT_LOCAL_DEV === "1";
  if (enabled && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId || "")) throw new Error("Native push requires the app's configured EAS project ID.");
  config = { ...config,
    extra: { ...config.extra, nativePushEnabled: enabled, ...(projectId ? { eas: { ...config.extra?.eas, projectId } } : {}) },
    ios: { ...config.ios, supportsTablet: true },
    android: { ...config.android, ...(process.env.MSHPIT_GOOGLE_SERVICES_FILE ? { googleServicesFile: process.env.MSHPIT_GOOGLE_SERVICES_FILE } : {}) },
    // Entitlements mods run in reverse registration order. This guarded local
    // override runs after Notifications, including during repeated prebuilds.
    plugins: [...(localDevelopment && !enabled ? ["./plugins/with-local-push-off.cjs"] : []), ...(config.plugins || []), ["expo-notifications", { defaultChannel: "local-shows" }], ["expo-secure-store", { configureAndroidBackup: true }]],
  };
  if (!localDevelopment) return config;
  return {
    ...config,
    name: "Mshpit Dev",
    scheme: "mshpit-dev",
    android: { ...config.android, package: "com.mshpit.app.dev" },
    ios: { ...config.ios, bundleIdentifier: "com.mshpit.app.dev" },
  };
};
