import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Verify the actual iOS export against this checkout. Source/export evidence
// does not establish UIKit rendering, native linking, or device acceptance.
const [directory, reportPath] = process.argv.slice(2);
assert.ok(directory, 'Usage: node scripts/check-ios-export.mjs <export-directory> [report.json]');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(directory);
const within = (base, relative) => {
  const target = resolve(base, relative);
  assert.ok(target.startsWith(base + sep), `Path outside expected directory: ${relative}`);
  return target;
};
const sha256 = data => createHash('sha256').update(data).digest('hex');
const normalize = text => text.replace(/\r\n/g, '\n');
const metadata = JSON.parse(readFileSync(within(output, 'metadata.json'), 'utf8'));
assert.equal(metadata.bundler, 'metro');
const bundlePath = metadata.fileMetadata?.ios?.bundle;
assert.ok(bundlePath?.endsWith('.hbc'), 'Expected an iOS Hermes bytecode bundle');
const bundle = readFileSync(within(output, bundlePath));
const mapBytes = readFileSync(within(output, `${bundlePath}.map`));
const map = JSON.parse(mapBytes);
assert.equal(map.sources.length, map.sourcesContent.length);
const selected = new Set(map.sources);
const required = [
  '/App.js', '/src/store.js', '/src/cityIdentity.native.js',
  '/src/components/NativeAppHeader.native.jsx', '/src/components/NativeTabRail.native.jsx',
  '/src/components/NativeSwipeRail.native.jsx', '/src/components/NativeFeedMediaLayer.jsx',
  '/src/components/VinylRefreshBoundary.jsx', '/src/components/PageReturnContext.jsx',
  '/src/screens/FeedScreen.jsx', '/src/screens/NotificationsScreen.jsx',
  '/src/screens/CityScreen.jsx', '/src/screens/DiscoverScreen.jsx',
  '/src/domain/postBadgeBundle.mjs', '/src/domain/notificationReadMutation.mjs',
  '/src/features/socialReactions/useFollowingFeed.js',
];
for (const path of required) assert.ok(selected.has(path), `Missing iOS source: ${path}`);
assert.equal(selected.has('/src/cityIdentity.js'), false, 'iOS must use the Intl bootstrap');
const projectModules = [];
for (let index = 0; index < map.sources.length; index++) {
  const source = map.sources[index];
  if (!source.startsWith('/src/') && !['/App.js', '/index.js'].includes(source)) continue;
  assert.doesNotMatch(source, /\.(?:web|android)\./, `Unexpected platform source: ${source}`);
  const actual = normalize(readFileSync(within(root, source.slice(1)), 'utf8'));
  assert.equal(normalize(map.sourcesContent[index]), actual, `Export source differs: ${source}`);
  projectModules.push({ path: source.slice(1), sha256: sha256(actual) });
}
const report = {
  platform: 'ios', kind: 'Metro source/export verification; not native runtime acceptance',
  node: process.version, bundle: bundlePath, bundleBytes: bundle.length, bundleSha256: sha256(bundle),
  sourceMapBytes: mapBytes.length, sourceMapSha256: sha256(mapBytes),
  projectModuleCount: projectModules.length,
  nativeModules: projectModules.filter(module => /\.native\./.test(module.path)).map(module => module.path),
  requiredModules: required, projectModules,
};
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, projectModules: undefined }, null, 2));
