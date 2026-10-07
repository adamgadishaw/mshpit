import assert from "node:assert/strict";
import test from "node:test";
import { publicProviderEventText } from "./providerEventText.js";
import { publicTourDateProviderFields, publicTourDateArtistProjection } from "./tourDateMetadata.js";

test("repair is limited to recognized provider apostrophes and never establishes artist identity", () => {
  const cases = [["\u00e2\u0080\u0099", "\u2019"], ["\u00e2\u20ac\u2122", "\u2019"], ["\u00e2\u0080\u0098", "\u2018"], ["\u00e2\u20ac\u02dc", "\u2018"]];
  for (const [bad, good] of cases) {
    const value = 'Miind' + bad + 'S Eye';
    assert.equal(publicProviderEventText(value), 'Miind' + good + 'S Eye');
    assert.equal(publicProviderEventText(value, 'member-1'), value);
    assert.equal(publicProviderEventText(publicProviderEventText(value)), publicProviderEventText(value));
  }
  for (const value of [null, 12, "Beyoncé", "Seinäjoki", "What's Left Records", "Miind’S Eye", "broken\ufffd", "unknown\u0081"])
    assert.equal(publicProviderEventText(value), value);
  const row = { event_name: 'Miind\u00e2\u0080\u0099S Eye', artist: 'Miind\u00e2\u0080\u0099S Eye', artist_key: 'old-key',
    source: 'ticketmaster', artist_identity_status: 'pending', provider_event_id: '16e0Z_o8MG7Bv5g' };
  const before = { ...row };
  assert.equal(publicTourDateProviderFields(row).eventName, 'Miind’S Eye');
  assert.equal(publicTourDateProviderFields(row).providerEventId, '16e0Z_o8MG7Bv5g');
  assert.equal(publicTourDateArtistProjection(row).bindingAllowed, false);
  assert.deepEqual(row, before);
});
