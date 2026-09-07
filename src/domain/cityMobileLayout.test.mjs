import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync(new URL("../screens/CityScreen.jsx", import.meta.url), "utf8");
test("city guide mobile columns retain content height instead of overlapping show buttons", () => {
  const column = screen.match(/^  column: \{([^}]+)\}/m)?.[1];
  assert.ok(column);
  assert.doesNotMatch(column, /\bflex\s*:|\bflexBasis\s*:|\bheight\s*:/);
  assert.match(column, /flexShrink: 0/);
  assert.match(screen, /columnWide: \{ flex: 1 \}/);
  assert.equal((screen.match(/styles.column, wide && styles.columnWide/g) || []).length, 4);
  assert.doesNotMatch(screen, /style=\{styles.column\}/);
});

test("city lists reveal six more rows without discarding the current list or navigating away", () => {
  for (const kind of ["Event", "Venue", "Artist"]) {
    assert.match(screen, new RegExp(`set${kind}Limit\\(\\(count\\) => count \\+ 6\\)`));
  }
  for (const [rows, limit] of [["upcoming", "eventLimit"], ["guide.venues?", "venueLimit"], ["guide.artists?", "artistLimit"]]) {
    assert.ok(screen.includes(`${rows}.length > ${limit}`));
  }
});
