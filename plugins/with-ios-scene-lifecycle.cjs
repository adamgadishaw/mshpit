const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

// Expo SDK 57 supplies the scene delegate, but its legacy prebuild template
// still creates the window in AppDelegate. iOS 27 rejects that lifecycle.
const provider = 'ExpoReactNativeFactoryProvider';
const legacyStartup = /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)\s+factory\.startReactNative\(\s+withModuleName: "main",\s+in: window,\s+launchOptions: launchOptions\)\s*#endif/;
const sceneStartup = '// ExpoAppSceneDelegate creates the window and starts React Native.';

function migrateAppDelegate(contents) {
  const declaration = /class AppDelegate: ExpoAppDelegate([^\{]*)\{/;
  const match = contents.match(declaration);
  if (!match) throw new Error('iOS scene lifecycle: unsupported AppDelegate template');
  if (!match[1].includes(provider)) {
    contents = contents.replace(declaration, `class AppDelegate: ExpoAppDelegate${match[1].trimEnd()}, ${provider} {`);
  }
  if (legacyStartup.test(contents)) return contents.replace(legacyStartup, sceneStartup);
  if (contents.includes(sceneStartup) && !contents.includes('factory.startReactNative(')) return contents;
  throw new Error('iOS scene lifecycle: expected legacy window startup was not found; review the Expo template before regenerating');
}

function sceneManifest(existing = {}) {
  const roles = existing.UISceneConfigurations || {};
  const current = roles.UIWindowSceneSessionRoleApplication;
  if (current && (current.length !== 1 || current[0].UISceneDelegateClassName !== 'EXExpoAppSceneDelegate')) {
    throw new Error('iOS scene lifecycle: refusing to replace an existing custom scene configuration');
  }
  return {
    ...existing,
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      ...roles,
      UIWindowSceneSessionRoleApplication: [{
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
      }],
    },
  };
}

function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = sceneManifest(mod.modResults.UIApplicationSceneManifest);
    return mod;
  });
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') throw new Error('iOS scene lifecycle requires the Expo Swift AppDelegate');
    mod.modResults.contents = migrateAppDelegate(mod.modResults.contents);
    return mod;
  });
}
module.exports = withIosSceneLifecycle;
module.exports.migrateAppDelegate = migrateAppDelegate;
module.exports.sceneManifest = sceneManifest;
