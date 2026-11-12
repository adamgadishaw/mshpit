// Read-only, offline source checks. This does not generate or compile an Xcode project.
// Run from any directory: node scripts/check-iphone-build-inputs.mjs [report.json]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import scenePlugin from '../plugins/with-ios-scene-lifecycle.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const json = (name) => JSON.parse(read(name));
const sha256 = (name) => createHash('sha256').update(readFileSync(path.join(root, name))).digest('hex');
const env = {
  ...process.env,
  EXPO_NO_TELEMETRY: '1', EXPO_OFFLINE: '1', EXPO_NO_DOTENV: '1',
  // Inspect the default release identity, irrespective of local dev shell settings.
  MSHPIT_LOCAL_DEV: '',
};
function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  // Do not echo child output here: future app config may contain private values.
  assert.equal(result.error, undefined, `${label}: could not start command`);
  assert.equal(result.status, 0, `${label}: command failed; inspect locally without publishing config or credentials`);
  return result.stdout.trim().replace(/^\uFEFF/, '');
}
function nodeJson(script, args, label) {
  return JSON.parse(run(process.execPath, [path.join(root, script), ...args], label));
}
const autoLink = 'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js';
const config = nodeJson('node_modules/expo/bin/cli', ['config', '--type', 'introspect', '--json'], 'Expo introspection');
const apple = nodeJson(autoLink, ['resolve', '--platform', 'apple', '--json'], 'Expo Apple autolinking');
const rn = nodeJson(autoLink, ['react-native-config', '--platform', 'ios', '--json'], 'React Native iOS autolinking');
const verification = nodeJson(autoLink, ['verify', '--platform', 'ios', '--json'], 'iOS duplicate verification');
assert.deepEqual(verification.duplicates, [], 'Duplicate native modules need review');

const lock = json('package-lock.json');
const versions = {};
for (const name of ['expo', 'react-native', 'react']) {
  const installed = json(`node_modules/${name}/package.json`).version;
  assert.equal(installed, lock.packages[`node_modules/${name}`].version, `${name} differs from the lockfile`);
  versions[name] = installed;
}
let expoPodCount = 0;
for (const module of apple.modules) {
  for (const pod of module.pods) {
    assert.ok(existsSync(pod.podspecDir), `${module.packageName}: pod directory missing`);
    assert.ok(readdirSync(pod.podspecDir).some((name) => name.endsWith('.podspec')), `${module.packageName}: podspec missing`);
    expoPodCount += 1;
  }
}
const rnModules = Object.entries(rn.dependencies).filter(([, dependency]) => dependency.platforms?.ios);
assert.ok(rnModules.length > 0, 'No React Native iOS modules resolved');
for (const [name, dependency] of rnModules) {
  assert.ok(existsSync(dependency.platforms.ios.podspecPath), `${name}: podspec missing`);
}

const template = 'node_modules/expo/template.tgz';
const templateFile = (name) => run('tar', ['-xOf', path.join(root, template), `package/ios/${name}`], 'Bundled Expo template read');
const originalDelegate = templateFile('HelloWorld/AppDelegate.swift');
const migratedDelegate = scenePlugin.migrateAppDelegate(originalDelegate);
assert.equal(scenePlugin.migrateAppDelegate(migratedDelegate), migratedDelegate, 'Scene migration must be repeatable');
assert.match(migratedDelegate, /class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider/);
assert.match(migratedDelegate, /var window: UIWindow\?/);
assert.match(migratedDelegate, /var reactNativeFactory: RCTReactNativeFactory\?/);
assert.match(migratedDelegate, /reactNativeFactory = factory/);
assert.doesNotMatch(migratedDelegate, /UIWindow\(frame:|factory\.startReactNative\(/);
assert.match(migratedDelegate, /RCTLinkingManager\.application\(app, open: url/);
assert.match(migratedDelegate, /RCTLinkingManager\.application\(application, continue: userActivity/);
assert.match(migratedDelegate, /Bundle\.main\.url\(forResource: "main", withExtension: "jsbundle"\)/);
assert.match(read('node_modules/expo/ios/AppDelegates/ExpoReactNativeFactoryProvider.swift'), /public protocol ExpoReactNativeFactoryProvider/);
assert.match(read('node_modules/expo/ios/AppDelegates/ExpoAppSceneDelegate.swift'), /@objc\(EXExpoAppSceneDelegate\)/);
const plist = config._internal.modResults.ios.infoPlist;
const manifest = plist.UIApplicationSceneManifest;
assert.equal(manifest.UIApplicationSupportsMultipleScenes, false);
assert.equal(manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName, 'EXExpoAppSceneDelegate');
const schemeTemplate = templateFile('HelloWorld.xcodeproj/xcshareddata/xcschemes/HelloWorld.xcscheme');
assert.match(schemeTemplate, /<ArchiveAction\s+buildConfiguration = "Release"/);
assert.match(schemeTemplate, /<LaunchAction\s+buildConfiguration = "Debug"/);
const podfile = templateFile('Podfile');
assert.match(podfile, /platform :ios, podfile_properties\['ios.deploymentTarget'\] \|\| '16\.4'/);
assert.match(podfile, /use_expo_modules!/);
assert.equal(config.ios.bundleIdentifier, 'com.mshpit.app');
assert.equal(config.scheme, 'mshpit');

const eas = json('eas.json');
const { IOSConfig } = require('@expo/config-plugins');
const report = {
  scope: 'Offline source/config/template validation only; no generated Xcode project, compilation, signing, or device validation',
  passed: true,
  versions,
  hashes: { packageLockSha256: sha256('package-lock.json'), expoTemplateSha256: sha256(template) },
  identity: { name: config.name, bundleIdentifier: config.ios.bundleIdentifier, scheme: config.scheme, version: config.version, configuredBuildNumber: config.ios.buildNumber },
  inferredNativeDefaults: { scheme: IOSConfig.XcodeUtils.sanitizedName(config.name), archiveConfiguration: 'Release', minimumIosFromTemplate: '16.4', generatedProjectVerified: false },
  autolinking: { expoModules: apple.modules.length, expoPods: expoPodCount, reactNativeIosModules: rnModules.length, duplicates: verification.duplicates.length, podspecsExist: true },
  sceneLifecycle: { actualBundledTemplateMigration: true, idempotent: true, linkingPreserved: true, runtimeClassAndProtocolPresent: true, swiftCompilationVerified: false },
  buildConfiguration: { node: eas.build.base.node, previewDistribution: eas.build.preview.distribution, versionSource: eas.cli.appVersionSource, productionAutoIncrement: eas.build.production.autoIncrement, requiresCommit: eas.cli.requireCommit },
  signing: { easProjectLinkedInSource: Boolean(config.extra?.eas?.projectId), ownerConfiguredInSource: Boolean(config.owner), appleTeamConfiguredInSource: Boolean(config.ios.appleTeamId), credentialsAndAccountNotInspected: true },
};
const output = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv[2]) writeFileSync(path.resolve(process.argv[2]), output);
console.log(output.trimEnd());
