import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { resolve } = require('metro-resolver');
const { parse } = require('@babel/parser');
// Use the app's Expo configuration. A hand-written js-first extension list
// misses .mjs shadowing a platform adapter before the native root registers.
const config = require('../../metro.config.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));

function resolvedImport(from, specifier, platform) {
  return resolve({
    ...config.resolver,
    originModulePath: path.join(root, from),
    assetExts: new Set(config.resolver.assetExts),
    preferNativePlatform: platform !== 'web',
    getPackageForModule: () => null,
    fileSystemLookup(file) {
      try {
        const stat = statSync(file);
        return { exists: true, type: stat.isDirectory() ? 'd' : 'f', realPath: realpathSync(file) };
      } catch { return { exists: false }; }
    },
  }, specifier, platform);
}

for (const platform of ['ios', 'android', 'web']) {
  test(`actual Expo ${platform} startup imports select the adapter and its callable exports`, () => {
    const adapter = path.join(root, `src/lib/nativeStartupLinks${platform === 'web' ? '' : '.native'}.js`);
    for (const from of ['src/AppearanceApp.jsx', 'App.js', 'src/screens/NativeAccountLinks.native.jsx']) {
      const ast = parse(readFileSync(path.join(root, from), 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
      const dependency = ast.program.body.find(node => node.type === 'ImportDeclaration' && node.source.value.endsWith('/nativeStartupLinks'));
      assert.ok(dependency, `${from} must import the startup adapter`);
      const resolution = resolvedImport(from, dependency.source.value, platform);
      assert.equal(resolution.type, 'sourceFile');
      assert.equal(resolution.filePath, adapter, `${from} must not resolve to the pure helper`);
      const selected = parse(readFileSync(resolution.filePath, 'utf8'), { sourceType: 'module' });
      const functions = selected.program.body.filter(node => node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration')
        .map(node => node.declaration.id.name);
      for (const item of dependency.specifiers) assert.ok(functions.includes(item.imported.name), `${item.imported.name} must be exported by the selected adapter`);
    }
  });
}
