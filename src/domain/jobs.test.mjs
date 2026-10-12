import assert from "node:assert/strict";
import test from "node:test";
import { jobApplicationHref } from "./jobs.mjs";
import { desktopRightRailLayout, sponsorRailWidth } from "./desktopRailLayout.mjs";
test("paired banners fit with the paused player and preserve the center-width floor", () => {
  for (const viewportWidth of [375, 768, 1200, 1440, 1920]) {
    const leftWidth = sponsorRailWidth(viewportWidth, viewportWidth >= 1200);
    const rail = desktopRightRailLayout({ viewportWidth, desktop: viewportWidth >= 1200, playerColumnWidth: leftWidth });
    const visible = leftWidth > 0 && rail.visible;
    assert.equal(visible, viewportWidth >= 1320);
    if (visible) assert.ok(rail.centerWidth >= 860);
  }
  for (const playerWidth of [82, 356, 460]) {
    const leftWidth = sponsorRailWidth(1920-playerWidth, true);
    const rail = desktopRightRailLayout({ viewportWidth: 1920, playerColumnWidth: playerWidth+leftWidth });
    assert.ok(rail.visible && rail.centerWidth >= 860);
  }
});
test("application destinations support HTTPS and plain email without mailbox injection", () => {
  assert.equal(jobApplicationHref("jobs@example.test"), "mailto:jobs@example.test");
  assert.equal(jobApplicationHref("https://example.test/apply"), "https://example.test/apply");
  for (const value of ["mailto:jobs@example.test?bcc=hidden@example.test", "jobs@example.test?subject=bad", "javascript:alert(1)"]) assert.equal(jobApplicationHref(value), null);
});
