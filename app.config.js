// Only the local mobile commands opt into a separate install alongside Mshpit.
export default ({ config }) => {
  if (process.env.MSHPIT_LOCAL_DEV !== "1") return config;
  return {
    ...config,
    name: "Mshpit Dev",
    scheme: "mshpit-dev",
    android: { ...config.android, package: "com.mshpit.app.dev" },
    ios: { ...config.ios, bundleIdentifier: "com.mshpit.app.dev" },
  };
};
