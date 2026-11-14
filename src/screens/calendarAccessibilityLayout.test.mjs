import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calendarAccessibilityLayout } from "./calendarAccessibilityLayout.mjs";

for (const platform of ["android", "web"]) {
  test(`${platform} retains original calendar layout at every text size`, () => {
    for (const width of [320, 390, 768]) {
      for (const scale of [1, 1.2, 2, 3.1]) {
        assert.deepEqual(calendarAccessibilityLayout(platform, width, scale, 32), {
          largeText: false, dayMinHeight: 44,
          width: Math.max(308, Math.min(560, width - 32)),
        });
      }
    }
  });
}

test("iOS standard text preserves geometry and large text grows seven reachable day targets", () => {
  for (const width of [320, 390, 768]) {
    for (const scale of [1, 1.15, 1.2, 1.5, 2, 3.1]) {
      const layout = calendarAccessibilityLayout("ios", width, scale, 32);
      assert.equal(layout.largeText, scale > 1.15);
      assert.ok(layout.dayMinHeight >= 44);
      assert.ok(layout.width / 7 >= layout.dayMinHeight);
      if (scale > 1.15) assert.ok(layout.dayMinHeight >= 44 * scale);
    }
  }
});

test("missing or invalid fontScale safely uses standard sizing", () => {
  for (const scale of [undefined, NaN, Infinity, -1]) {
    assert.equal(calendarAccessibilityLayout("ios", 390, scale, 32).largeText, false);
  }
});

test("calendar wires live scale, wrapping identity and unchanged owner/actions", () => {
  const source = readFileSync(new URL("./CalendarScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /width: viewportWidth, fontScale.*useWindowDimensions/);
  assert.match(source, /calendarAccessibilityLayout\(Platform.OS, viewportWidth, fontScale/);
  assert.equal((source.match(/numberOfLines=\{largeIOS \? undefined : 1\}/g) || []).length, 2);
  assert.match(source, /eventLeftLarge: \{ flex: 0, flexBasis: "100%", width: "100%"/);
  assert.match(source, /eventMainLarge: \{ flex: 0, flexWrap: "wrap"/);
  assert.match(source, /eventActionsLarge: \{ flexWrap: "wrap"/);
  assert.match(source, /legendRowIOS: \{ flexWrap: "wrap"/);
  assert.match(source, /ScrollView horizontal/);
  assert.match(source, /accountId: session\?\.id,\s+targetId: session\?\.id/);
  assert.match(source, /onPress=\{\(\) => openEvent\(ev\)\}/);
  assert.match(source, /onPress=\{\(\) => onOpenArtist\(ev.artist\)\}/);
  assert.match(source, /saveCalendar\(ev, `event-/);
  assert.match(source, /openTicketLink\(ev.ticketUrl/);
  assert.match(source, /saveCalendar\(goingEvents, "all"\)/);
});
