import assert from 'node:assert/strict';
import test from 'node:test';

test('native city bootstrap works when the runtime lacks Intl.DisplayNames', async () => {
  const original = Intl.DisplayNames;
  Intl.DisplayNames = undefined;
  try {
    const { cityIdentityForLocation } = await import('../src/cityIdentity.native.js');
    assert.equal(typeof Intl.DisplayNames, 'function');
    assert.equal(new Intl.DisplayNames(['en'], { type: 'region' }).of('CA'), 'Canada');
    assert.ok(cityIdentityForLocation({ city: 'Toronto', countryCode: 'CA', region: 'ON' }));
  } finally {
    Intl.DisplayNames = original;
  }
});
