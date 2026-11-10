import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('native city bootstrap works when the runtime lacks Intl.DisplayNames', async () => {
  const original = Intl.DisplayNames;
  Intl.DisplayNames = undefined;
  try {
    const { cityIdentityForLocation, findShowFrame } = await import('../src/cityIdentity.native.js');
    assert.equal(typeof Intl.DisplayNames, 'function');
    assert.equal(new Intl.DisplayNames(['en'], { type: 'region' }).of('CA'), 'Canada');
    assert.ok(cityIdentityForLocation({ city: 'Toronto', countryCode: 'CA', region: 'ON' }));
    assert.equal(findShowFrame({ city: 'Toronto', countryCode: 'CA', region: 'ON' }).cityGuide.homeShowPrompt, true);
  } finally {
    Intl.DisplayNames = original;
  }
});

test('Metro-selected native city entries preserve the shared exports and Find a Show destinations', async () => {
  const require = createRequire(import.meta.url);
  const root = dirname(fileURLToPath(new URL('../App.js', import.meta.url)));
  const config = require('../metro.config.cjs');
  const shared = await import('../src/cityIdentity.js');
  for (const platform of ['ios', 'android']) {
    const selected = config.resolver.resolveRequest({
      originModulePath: join(root, 'App.js'),
      resolveRequest() { assert.fail('the native city import must use the Intl bootstrap'); },
    }, './src/cityIdentity.js', platform);
    assert.equal(selected.filePath, join(root, 'src', 'cityIdentity.native.js'));
    const native = await import(pathToFileURL(selected.filePath).href);
    assert.deepEqual(Object.keys(native).sort(), Object.keys(shared).sort(), `${platform} export parity`);
    for (const home of [
      Object.freeze({ city: 'New York', country: 'United States', region: 'New York' }),
      Object.freeze({ city: 'London', countryCode: 'CA', region: 'ON' }),
      Object.freeze({ city: 'London', countryCode: 'GB' }),
      Object.freeze({ city: 'London' }),
      Object.freeze({ city: '' }), null,
    ]) assert.deepEqual(native.findShowFrame(home), shared.findShowFrame(home), `${platform}: ${JSON.stringify(home)}`);
  }
});
