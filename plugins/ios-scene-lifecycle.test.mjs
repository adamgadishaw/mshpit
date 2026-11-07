import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from './with-ios-scene-lifecycle.cjs';
const legacy = `class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?
  func launch() {
    reactNativeFactory = factory
#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
  // Linking and delegate overrides must remain intact.
  func openURL() { return RCTLinkingManager.application(app, open: url, options: options) }
}`;
test('iOS 27 delegates window startup to Expo scene lifecycle without losing linking', () => {
  const result = plugin.migrateAppDelegate(legacy);
  assert.match(result, /ExpoAppDelegate, ExpoReactNativeFactoryProvider/);
  assert.match(result, /reactNativeFactory = factory/);
  assert.match(result, /return super.application/);
  assert.match(result, /RCTLinkingManager.application/);
  assert.doesNotMatch(result, /UIWindow\(frame:|factory.startReactNative\(/);
  assert.equal(plugin.migrateAppDelegate(result), result);
});
test('scene manifest uses Expo runtime class and is repeatable', () => {
  const result = plugin.sceneManifest({custom: true, UISceneConfigurations: {otherRole: []}});
  assert.equal(result.UIApplicationSupportsMultipleScenes, false);
  assert.equal(result.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName, 'EXExpoAppSceneDelegate');
  assert.deepEqual(result.UISceneConfigurations.otherRole, []);
  assert.equal(result.custom, true);
  assert.deepEqual(plugin.sceneManifest(result), result);
});
test('unexpected templates and custom scene delegates fail explicitly', () => {
  assert.throws(() => plugin.migrateAppDelegate('class OtherDelegate {}'), /unsupported/);
  assert.throws(() => plugin.migrateAppDelegate('class AppDelegate: ExpoAppDelegate {}'), /expected legacy/);
  assert.throws(() => plugin.sceneManifest({UISceneConfigurations: {UIWindowSceneSessionRoleApplication: [{UISceneDelegateClassName: 'Custom'}]}}), /refusing/);
});
