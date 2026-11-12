// Optional native geometry gate. Requires a local C++20 compiler, never fetches
// a Yoga package: compile the exact source shipped by installed React Native.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { parse } from '@babel/parser';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/features/profileMedia/ProfileMediaPresentation.ios.jsx', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const declaration = ast.program.body.find(node => node.type === 'VariableDeclaration' && node.declarations.some(value => value.id.name === 'styles')).declarations.find(value => value.id.name === 'styles');
const definitions = declaration.init.arguments[0].properties;
const style = name => Object.fromEntries(definitions.find(value => value.key.name === name).value.properties
  .filter(value => ['NumericLiteral', 'StringLiteral'].includes(value.value?.type))
  .map(value => [value.key.name, value.value.value]));
const row = style('gallery'), cell = style('galleryCell'), art = style('galleryArtwork');
assert.equal(row.flexDirection, 'row'); assert.equal(row.flexWrap, 'wrap');
assert.equal(art.position, undefined, 'Media must contribute its square size in flow');
assert.equal(cell.aspectRatio, 1); assert.equal(art.aspectRatio, 1); assert.equal(art.width, '100%');
const values = [row.marginHorizontal, row.gap, Number.parseFloat(cell.width), cell.minWidth, cell.minHeight, cell.aspectRatio, Number.parseFloat(art.width), art.aspectRatio];
assert.ok(values.every(Number.isFinite));
const reactNativeRoot = dirname(require.resolve('react-native/package.json'));
const yogaRoot = join(reactNativeRoot, 'ReactCommon', 'yoga');
const cpp = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? cpp(join(directory, entry.name)) : entry.name.endsWith('.cpp') ? [join(directory, entry.name)] : []);
const temporary = mkdtempSync(join(tmpdir(), 'mshpit-gallery-yoga-'));
const binary = join(temporary, 'gallery-layout');
try {
  const compile = spawnSync('c++', ['-std=c++20', '-I', yogaRoot, fileURLToPath(new URL('./fixtures/ios-profile-gallery-layout.cpp', import.meta.url)), ...cpp(join(yogaRoot, 'yoga')), '-o', binary], { stdio: 'inherit', env: { ...process.env, TMPDIR: temporary } });
  if (compile.error) throw compile.error;
  assert.equal(compile.status, 0, 'Native Yoga fixture failed to compile');
  const result = spawnSync(binary, values.map(String), { stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Native Yoga geometry regression');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
