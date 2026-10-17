import assert from 'node:assert/strict';
import test from 'node:test';
import { tabPanelAccessibilityProps } from './tabPanelAccessibility.mjs';
test('web panels retain the existing ARIA role and tab association', () => {
  assert.deepEqual(tabPanelAccessibilityProps('web', 'shows'), {
    accessibilityRole: 'tabpanel', 'aria-labelledby': 'shows',
  });
});
test('native panels keep their children accessible without an unsupported role', () => {
  for (const platform of ['android', 'ios']) {
    assert.deepEqual(tabPanelAccessibilityProps(platform, 'shows'), { accessible: false });
  }
});
