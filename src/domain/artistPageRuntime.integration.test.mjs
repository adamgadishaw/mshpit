import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseSync } = require("@babel/core");
const traverse = require("@babel/traverse").default;

test("past-show failures expose retry without claiming an empty archive", () => {
  const source = fs.readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /reload: retryLiveArchive, refresh: refreshLiveArchive/);
  assert.match(source, /sectionModel\.loadFullArchive \? \[refreshLiveArchive\(\{ signal \}\)\] : \[\]/);
  assert.match(source, /!liveArchive && liveArchiveResource\.status !== "error" \? \(/);
  assert.match(source, /liveArchiveResource\.status === "error" \? \([\s\S]*?accessibilityRole="alert"[\s\S]*?onPress=\{\(\) => retryLiveArchive\(\)\}/);
  assert.match(source, /liveArchiveResource\.status === "error" \? null : \([\s\S]*?The podium is open/);
  const hook = fs.readFileSync(new URL("../features/artistEvents/useArtistEventArchive.js", import.meta.url), "utf8");
  assert.match(hook, /if \(!enabled \|\| !identity\) \{[\s\S]*?const next = createLoadState\(\{ scope, data: EMPTY_ARTIST_EVENT_ARCHIVE \}\)/);
  assert.match(hook, /enabled && identity && projected\.status === "idle"[\s\S]*?\{ \.\.\.projected, status: "loading" \}/);
});

// Parsing alone cannot catch a removed state setter still referenced by an
// effect. Check bindings so that integration fails before a user opens a page.
for (const relative of [
  "../screens/ArtistScreen.jsx",
  "../components/artist/ArtistUpcomingShows.jsx",
  "../features/artistOverview/useArtistOverview.js",
]) {
  test(`${relative} has no unbound runtime identifiers`, () => {
    const source = fs.readFileSync(new URL(relative, import.meta.url), "utf8");
    const ast = parseSync(source, {
      configFile: false,
      babelrc: false,
      parserOpts: { plugins: ["jsx"] },
    });
    const allowedPlatformGlobals = new Set(["AbortController"]);
    const missing = new Set();
    traverse(ast, {
      ReferencedIdentifier(path) {
        const { name } = path.node;
        if (!path.scope.hasBinding(name) && !allowedPlatformGlobals.has(name)) missing.add(name);
      },
    });
    assert.deepEqual([...missing], [], `Unbound identifiers in ${relative}`);
  });
}
