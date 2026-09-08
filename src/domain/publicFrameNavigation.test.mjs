import assert from "node:assert/strict";
import test from "node:test";

import {
  publicCollectionHydration,
  hydratePublicEntryHistory,
  publicDirectoryProgramme,
  publicEntryFrame,
  publicFramePath,
  resolvedPublicCollectionFrame,
  updatedAuthFrame,
} from "./publicFrameNavigation.mjs";
import { discoverProgrammeKey } from "./discoverProgramme.mjs";
import { replaceNavigationFrame } from "./navigationStack.mjs";
import { readFileSync } from "node:fs";

test("public entry pages round-trip between links and navigation frames", () => {
  for (const path of ["/venues", "/signup", "/login"]) {
    assert.equal(publicFramePath(publicEntryFrame(path)), path);
  }
  assert.equal(publicEntryFrame("/venues/unknown"), null);
  assert.equal(publicEntryFrame("/settings"), null);
  assert.equal(publicFramePath({ signupSetup: true }), null, "Optional private setup does not become a public page");
});

test("direct entry history closes onto a real root URL", () => {
  for (const path of ["/login", "/signup", "/venues"]) {
    const entries = [path];
    const history = {
      replaceState: (_state, _title, url) => { entries[entries.length - 1] = url; },
      pushState: (_state, _title, url) => { entries.push(url); },
    };
    assert.equal(hydratePublicEntryHistory(history, path), true);
    assert.deepEqual(entries, ["/", path]);
    entries.pop();
    assert.equal(entries.at(-1), "/", "Closing the direct form must not leave its URL behind for reload.");
  }
});

test("history hydration rejects unknown and private paths without writing history", () => {
  for (const path of ["/", "/settings", "/login/other", "/login?email=private@example.test"]) {
    assert.equal(hydratePublicEntryHistory({ replaceState() { assert.fail("No history writes"); } }, path), false);
  }
});

test("auth mode replacement preserves the existing underlying page and clears no account state", () => {
  const parent = { artistName: "A real artist" };
  const original = { auth: true, authMode: "signup" };
  const next = updatedAuthFrame(original, "login");
  assert.deepEqual(replaceNavigationFrame([{}, parent, original], next), [{}, parent, { auth: true, authMode: "login" }]);
  assert.equal(original.authMode, "signup");
  assert.equal(publicFramePath(next), "/login");
  assert.equal(publicFramePath(updatedAuthFrame(next, "signup")), "/signup");
  const forgot = updatedAuthFrame(next, "forgot");
  assert.equal(forgot.authMode, "forgot", "Forgot is retained as local screen intent.");
  assert.equal(publicFramePath(forgot), "/login", "Forgot never publishes a separate token or identity URL.");
  assert.equal(updatedAuthFrame(parent, "signup"), null);
  assert.equal(updatedAuthFrame(original, "admin"), null);
});

test("directory intent reaches the same native and web Discover section while ordinary Discover defaults to shows", () => {
  assert.equal(publicDirectoryProgramme({ directory: "artists" }), "artists");
  assert.equal(publicDirectoryProgramme({ directory: "events" }), "shows");
  assert.equal(publicDirectoryProgramme({}), undefined);
  assert.equal(discoverProgrammeKey(publicDirectoryProgramme({})), "shows");
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../screens/AuthScreen.jsx", import.meta.url), "utf8");
  assert.match(app, /initialProgramme=\{publicDirectoryProgramme\(nav\)\}/);
  assert.match(app, /hydratePublicEntryHistory\(window\.history, path\)/);
  assert.match(app, /updatedAuthFrame\(stackRef\.current\[stackRef\.current\.length - 1\], mode\)/);
  assert.match(auth, /if \(busyRef\.current\) return;[\s\S]*onModeChange\?\.\(next\)/);
});

test("artist archive frames serialize only with an authoritative public slug", () => {
  assert.equal(
    publicFramePath({ artistArchive: { name: "Earl Sweatshirt", publicSlug: "earl-sweatshirt" } }),
    "/artist/earl-sweatshirt/concerts",
  );
  assert.equal(publicFramePath({ artistArchive: { name: "Earl Sweatshirt" } }), null);
  assert.equal(
    publicFramePath(
      { artistArchive: { name: "Earl Sweatshirt" } },
      { resolveArtistMeta: () => ({ publicSlug: "earl-sweatshirt" }) },
    ),
    "/artist/earl-sweatshirt/concerts",
  );
});

test("direct artist-concert archive URLs resolve the base artist then rebuild the archive frame", () => {
  const hydration = publicCollectionHydration("/artist/earl-sweatshirt/concerts");
  assert.deepEqual(hydration, {
    type: "artist-concerts",
    publicSlug: "earl-sweatshirt",
    resolvePath: "/artist/earl-sweatshirt",
  });
  assert.deepEqual(
    resolvedPublicCollectionFrame(hydration, {
      kind: "artist",
      name: "Earl Sweatshirt",
      artistKey: "earl sweatshirt",
    }),
    {
      artistArchive: {
        name: "Earl Sweatshirt",
        artistKey: "earl sweatshirt",
        publicSlug: "earl-sweatshirt",
      },
    },
  );
});

test("unrelated and unresolved collection routes do not manufacture frames", () => {
  assert.equal(publicCollectionHydration("/concerts/ca/toronto"), null);
  assert.equal(
    resolvedPublicCollectionFrame(
      publicCollectionHydration("/artist/earl-sweatshirt/concerts"),
      { kind: "venue", name: "History" },
    ),
    null,
  );
});
