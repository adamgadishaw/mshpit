import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = readFileSync(new URL('./mobile-smoke-preload.mjs', import.meta.url), 'utf8');

function checkoutFixture(t) {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(join(parent, 'mobile smoke checkout '));
  t.after(() => {
    const target = realpathSync(root);
    assert.equal(dirname(target), parent);
    assert.ok(basename(target).startsWith('mobile smoke checkout '));
    rmSync(target, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'scripts'));
  const preload = join(root, 'scripts', 'mobile-smoke-preload.mjs');
  writeFileSync(preload, source);
  return { root, preload };
}

test('disposable mobile backend follows its checkout while retaining isolation guards', (t) => {
  const { root, preload } = checkoutFixture(t);
  const runner = join(root, 'probe.mjs');
  writeFileSync(runner, `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    import http from 'node:http';
    import https from 'node:https';
    import tls from 'node:tls';
    import { existsSync } from 'node:fs';
    import { resolve, relative, isAbsolute } from 'node:path';
    let listening;
    net.Server.prototype.listen = function (...args) { listening = args; return this; };
    await import(${JSON.stringify(pathToFileURL(preload).href)});
    const relativeData = relative(resolve('.tmp'), process.env.PIT_DATA_DIR);
    assert.ok(relativeData && !relativeData.startsWith('..') && !isAbsolute(relativeData));
    assert.equal(existsSync(process.env.PIT_DATA_DIR), true);
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.env.PIT_ENV, 'staging');
    assert.equal(process.env.PORT, '3000');
    assert.equal(process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP, 'true');
    assert.equal(process.env.RESEND_API_KEY, undefined);
    assert.equal(process.env.MAIL_FROM, undefined);
    assert.equal(process.env.FIXTURE_INHERITED_SECRET, undefined);
    await assert.rejects(fetch('https://fixture.invalid'), /OUTBOUND_BLOCKED/);
    for (const attempt of [
      () => http.get('http://fixture.invalid'),
      () => https.request('https://fixture.invalid'),
      () => net.createConnection(443, 'fixture.invalid'),
      () => tls.connect(443, 'fixture.invalid'),
    ]) assert.throws(attempt, /OUTBOUND_BLOCKED/);
    const server = http.createServer();
    server.listen(3000);
    assert.deepEqual(listening[0], { port: 3000, host: '127.0.0.1' });
    assert.throws(() => server.listen(3001), /Unexpected mobile smoke port/);
    assert.throws(() => server.listen({ port: 3000, host: '0.0.0.0' }), /Unexpected mobile smoke listen shape/);
    console.log('SMOKE_CHECKOUT_ISOLATION_VERIFIED');
  `);
  const result = spawnSync(process.execPath, [runner], { cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, RESEND_API_KEY: 'synthetic-fixture-secret', MAIL_FROM: 'fixture@example.invalid', FIXTURE_INHERITED_SECRET: 'synthetic' } });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /SMOKE_CHECKOUT_ISOLATION_VERIFIED/);
});

test('mobile backend rejects running a different checkout preload from the wrong directory', (t) => {
  const { root, preload } = checkoutFixture(t);
  const wrong = join(root, 'other');
  mkdirSync(wrong);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, '-e', 'console.log("UNEXPECTED_START")'], {
    cwd: wrong, encoding: 'utf8', timeout: 15000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Mobile smoke must run from its .*checkout/);
  assert.doesNotMatch(result.stdout, /UNEXPECTED_START/);
});
