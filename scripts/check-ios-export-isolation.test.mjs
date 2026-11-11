import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkIsolation, normalizedSource } from './check-ios-export-isolation.mjs';

const script = fileURLToPath(new URL('./check-ios-export-isolation.mjs', import.meta.url));
const map = (sources = ['/src/App.jsx'], extra = {}) => ({ version: 3, sources, names: [], mappings: 'AAAA', ...extra });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pit-export-isolation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const androidDir = join(root, 'android');
  const web = join(root, 'web');
  const chunks = join(web, '_expo/static/js/web');
  mkdirSync(androidDir); mkdirSync(chunks, { recursive: true });
  const androidMap = join(androidDir, 'index.hbc.map');
  const webMap = join(chunks, 'index.js.map');
  const put = (path, value) => writeFileSync(path, JSON.stringify(value));
  put(androidMap, map()); put(webMap, map()); writeFileSync(join(chunks, 'index.js'), 'fixture');
  const check = () => checkIsolation({ androidMap, web });
  const cli = (...args) => spawnSync(process.execPath, [script, '--android-map', androidMap, '--web', web, ...args], { encoding: 'utf8', cwd: root });
  return { root, androidMap, web, chunks, webMap, put, check, cli };
}

test('valid exports pass without writes; static public scripts need no Metro map', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.web, 'static-boot.js'), 'static');
  const before = readFileSync(f.androidMap);
  const entries = readdirSync(f.root);
  assert.equal(f.check().passed, true);
  assert.equal(f.cli().status, 0);
  assert.deepEqual(readdirSync(f.root), entries);
  assert.deepEqual(readFileSync(f.androidMap), before);
});

test('app .ios implementations and exact confined domains fail on either platform', (t) => {
  const f = fixture(t);
  for (const target of [f.androidMap, f.webMap]) {
    for (const source of ['src/components/Panel.ios.jsx', 'src/domain/iosMessageDrafts.mjs', 'src/domain/iosFeedReturn.mjs', 'src/domain/iosSearchAnnouncements.mjs', 'src/domain/iosVenueMap.mjs', 'iosMessageDrafts.mjs', 'iosVenueMap.mjs']) {
      f.put(target, map([source]));
      const result = f.check();
      assert.equal(result.passed, false, source);
      assert.ok(result.issues.some((issue) => issue.source === source));
      f.put(target, map());
    }
  }
});

test('vendor implementations and intentional shared ios-prefixed modules are allowed', (t) => {
  const f = fixture(t);
  f.put(f.androidMap, map(['/node_modules/pkg/src/View.ios.js', '/repo/ios/Pods/Foo/View.ios.js', '/src/domain/iosAccessibility.mjs', '/src/domain/iosMediaCachePolicy.mjs', '/src/components/IOSPostKeyboardView.jsx']));
  assert.equal(f.check().passed, true);
});

test('relative, absolute, file URLs, Windows separators and sourceRoot normalize', (t) => {
  const f = fixture(t);
  const cases = [
    ['../../src/components/Panel.ios.jsx', ''],
    ['/home/private/repo/src/components/Panel.ios.jsx', ''],
    [pathToFileURL('/private/repo/src/components/Panel.ios.jsx').href, ''],
    ['Panel.ios.jsx', 'file:///private/repo/src/components/'],
    ['Panel.ios.jsx', '../../src/components'],
    ['C:\\private\\repo\\src\\components\\Panel.ios.jsx', ''],
    ['../components/Panel.ios.jsx', '/repo/src/hooks'],
    ['%50anel.ios.jsx', '/src/components'],
  ];
  for (const [source, sourceRoot] of cases) {
    f.put(f.androidMap, map([source], { sourceRoot }));
    const report = f.check();
    assert.equal(report.passed, false, source);
    assert.equal(report.issues[0].source, 'src/components/Panel.ios.jsx');
    assert.ok(!JSON.stringify(report).includes('/private/'));
  }
  assert.equal(normalizedSource('/src/X.js', '/unrelated'), '/src/X.js');
});

test('retained inert defaults require matching embedded content but can be tree-shaken away', (t) => {
  const f = fixture(t);
  for (const entry of ['src/domain/messageDraftOwner.js', 'src/hooks/useIOSFeedReturn.js', 'src/hooks/useIOSSearchAnnouncement.js']) {
    const content = readFileSync(new URL(`../${entry}`, import.meta.url), 'utf8');
    f.put(f.androidMap, map([entry], { sourcesContent: [content] }));
    assert.equal(f.check().passed, true, entry);
    assert.deepEqual(f.check().platforms[0].retainedDefaults, [entry]);
    f.put(f.androidMap, map([entry], { sourcesContent: [content + '\nfetch("unexpected");'] }));
    assert.equal(f.check().passed, false);
    f.put(f.androidMap, map([entry]));
    assert.equal(f.check().passed, false);
  }
  f.put(f.androidMap, map());
  assert.equal(f.check().passed, true);
});

test('missing, empty, malformed or vendor-only maps cannot silently pass', (t) => {
  const f = fixture(t);
  for (const value of [null, {}, map([]), map(['']), map([null]), map(undefined, { version: 2 }), map(undefined, { mappings: '' }), map(undefined, { mappings: ';,;' }), map(undefined, { mappings: '!!!' }), map(undefined, { names: null }), map(undefined, { sourceRoot: 5 }), map(undefined, { sourcesContent: [] }), map(['/node_modules/pkg/View.js']), map(undefined, { sections: [] })]) {
    f.put(f.androidMap, value);
    assert.equal(f.check().passed, false, JSON.stringify(value));
  }
  for (const value of ['', '{broken']) {
    writeFileSync(f.androidMap, value);
    assert.equal(f.check().passed, false);
  }
  rmSync(f.androidMap);
  assert.equal(f.check().passed, false);
  assert.equal(f.cli().status, 1);
});

test('all Metro chunks must have maps, including nested lazy chunks', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.chunks, 'lazy'));
  writeFileSync(join(f.chunks, 'lazy/extra.js'), 'fixture');
  assert.equal(f.check().passed, false);
  f.put(join(f.chunks, 'lazy/extra.js.map'), map(['/src/Lazy.ios.jsx']));
  assert.equal(f.check().passed, false);
  f.put(join(f.chunks, 'lazy/extra.js.map'), map(['/src/Lazy.jsx']));
  assert.equal(f.check().passed, true);
  assert.equal(checkIsolation({ androidMap: f.androidMap, web: f.webMap }).passed, true);
});

test('empty web directory is rejected', (t) => {
  const f = fixture(t);
  rmSync(f.webMap); rmSync(join(f.chunks, 'index.js'));
  assert.equal(f.check().passed, false);
});

test('symlinked chunks are rejected when file-link creation is permitted', (t) => {
  const f = fixture(t);
  try { symlinkSync(f.androidMap, join(f.chunks, 'linked.js.map')); }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('Windows account cannot create file symbolic links; directory junction coverage remains active');
      return;
    }
    throw error;
  }
  assert.equal(f.check().passed, false);
});

test('symlinked Metro root and intermediate directories are rejected', (t) => {
  for (const segments of ['_expo', '_expo/static', '_expo/static/js', '_expo/static/js/web']) {
    const f = fixture(t);
    const target = join(f.web, segments);
    const other = join(f.root, 'outside');
    assert.equal(f.check().passed, true);
    renameSync(target, other);
    symlinkSync(other, target, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(f.check().passed, false, segments);
  }
});

test('report is bounded, redacted and explicitly opt-in; failure leaves artifacts untouched', (t) => {
  const f = fixture(t);
  f.put(f.androidMap, map(Array.from({ length: 150 }, (_, i) => `/home/private/repo/src/Panel${i}.ios.jsx`)));
  const before = readFileSync(f.androidMap);
  const reportPath = join(f.root, 'report.json');
  const result = f.cli('--report', reportPath);
  assert.equal(result.status, 1);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.issues.length, 100);
  assert.equal(report.issueCount, 150);
  assert.equal(report.omittedIssues, 50);
  assert.ok(JSON.stringify(report).length < 25000);
  assert.ok(!JSON.stringify(report).includes('/home/private'));
  assert.deepEqual(readFileSync(f.androidMap), before);
  const saved = readFileSync(reportPath);
  assert.equal(f.cli('--report', reportPath).status, 1);
  assert.deepEqual(readFileSync(reportPath), saved);
  assert.equal(f.cli('--report', f.androidMap).status, 1);
  assert.deepEqual(readFileSync(f.androidMap), before);
  assert.equal(f.cli('--report', join(f.web, 'report.json')).status, 1);
  assert.ok(!readdirSync(f.web).includes('report.json'));
});

test('report containment distinguishes sibling prefixes from nested artifact paths', (t) => {
  const f = fixture(t);
  const sibling = `${f.web}-reports`;
  mkdirSync(sibling);
  const report = join(sibling, 'report.json');
  assert.equal(f.cli('--report', report).status, 0);
  assert.equal(JSON.parse(readFileSync(report, 'utf8')).passed, true);
  const nested = join(f.chunks, 'report.json');
  assert.equal(f.cli('--report', nested).status, 1);
  assert.ok(!readdirSync(f.chunks).includes('report.json'));
});

test('CLI rejects missing, unknown and repeated options', (t) => {
  const f = fixture(t);
  for (const args of [['--unknown', 'x'], ['--report'], ['--web', f.web]]) assert.equal(f.cli(...args).status, 1);
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 1);
});


test('session recovery domain stays iOS-only and both retained defaults stay inert on Android/web', (t) => {
  const f = fixture(t);
  const entries = ['src/hooks/sessionValidationStatus.js', 'src/components/SessionValidationPending.jsx'];
  const contents = entries.map(entry => readFileSync(new URL(`../${entry}`, import.meta.url), 'utf8'));
  for (const target of [f.androidMap, f.webMap]) {
    for (const source of ['src/domain/sessionValidationStatus.mjs', 'sessionValidationStatus.mjs']) {
      f.put(target, map([source]));
      const report = f.check();
      assert.equal(report.passed, false);
      assert.ok(report.issues.some(issue => issue.reason === 'iOS-confined domain leaked' && issue.source === source));
    }
    f.put(target, map(entries, { sourcesContent: contents }));
    assert.equal(f.check().passed, true);
    for (let index = 0; index < entries.length; index++) {
      const changed = [...contents]; changed[index] += '\nfetch("unexpected");';
      f.put(target, map(entries, { sourcesContent: changed }));
      assert.equal(f.check().passed, false, entries[index]);
    }
    f.put(target, map(entries));
    assert.equal(f.check().passed, false, 'retained defaults require embedded source');
    f.put(target, map());
  }
});
