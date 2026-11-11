import assert from 'node:assert/strict';
import test from 'node:test';
import { pageTranslation, pageSettleDuration } from './iosPageGeometry.mjs';
test('full-width pages share an exact edge throughout either direction, cancellation and settlement', () => {
  for (const width of [320, 375, 393, 430, 768]) for (const direction of [-1, 1]) for (const progress of [0, .01, .24, .5, .999, 1]) {
    const dx = direction * width * progress;
    const source = pageTranslation(dx, width), target = pageTranslation(dx, width, -direction);
    assert.equal(Math.abs(target - source), width);
    assert.ok(Math.min(source, target) <= 0 && Math.max(source, target) + width >= width);
    if (progress === 1) assert.equal(target, 0);
  }
});
test('settle uses remaining travel and velocity within bounded native-like duration', () => {
  assert.ok(pageSettleDuration(-50, 400, 'negative', -1800) < pageSettleDuration(-50, 400, 'negative', -850));
  for (const dx of [0, -30, -390, -400]) for (const speed of [0, 100, 2000, 9000]) {
    const duration = pageSettleDuration(dx, 400, 'negative', speed);
    assert.ok(duration >= 110 && duration <= 260);
  }
});
