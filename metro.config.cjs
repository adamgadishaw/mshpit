const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
const previousResolve = config.resolver.resolveRequest;
const sharedCityModule = path.join(__dirname, 'src', 'cityIdentity.js');

// Hermes lacks Intl.DisplayNames. Bootstrap only the native city entry;
// preserve the original browser module and Expo's default resolver otherwise.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if ((platform === 'android' || platform === 'ios') && moduleName.startsWith('.')) {
    const requested = path.resolve(path.dirname(context.originModulePath), moduleName);
    if (requested === sharedCityModule) {
      return { type: 'sourceFile', filePath: path.join(__dirname, 'src', 'cityIdentity.native.js') };
    }
  }
  return previousResolve
    ? previousResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
