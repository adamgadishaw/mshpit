import test from "node:test";
import assert from "node:assert/strict";
import { artistDeathWatchCooldown } from "./artistDeathWatchPresentation.mjs";

test("only an active provider retry window disables checking and expiry restores it", () => {
  const settings = { lastErrorCode: "musicbrainz_unavailable", nextScanAt: 7200000 };
  assert.deepEqual(artistDeathWatchCooldown(settings, 3600000), { active: true, nextScanAt: 7200000, remainingMs: 3600000 });
  assert.equal(artistDeathWatchCooldown(settings, 7200000).active, false);
  assert.equal(artistDeathWatchCooldown(settings, 7200001).active, false);
  assert.equal(artistDeathWatchCooldown({ ...settings, lastErrorCode: null }, 0).active, false);
  assert.equal(artistDeathWatchCooldown({ ...settings, lastErrorCode: "internal_error" }, 0).active, false);
});
test("malformed provider timestamps never produce Invalid Date or permanently disabled controls", () => {
  for (const nextScanAt of [null, "no date", Infinity, -1, 8_640_000_000_000_001, 1.5]) {
    assert.equal(artistDeathWatchCooldown({ lastErrorCode: "wikidata_timeout", nextScanAt }, 1).active, false);
  }
});
