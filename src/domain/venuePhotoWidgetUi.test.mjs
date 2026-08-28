import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const source = readFileSync(new URL("../components/VenuePhotoWidget.jsx", import.meta.url), "utf8");
const viewerSource = readFileSync(new URL("../components/PhotoViewer.jsx", import.meta.url), "utf8");

test("venue photo widget remains parseable and scopes failed deliveries to the active venue photos", () => {
  assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(source, /const attemptScope = venuePhotoAttemptScope\(venueName, photos\)/);
  assert.match(source, /useEffect\(\(\) => \{\s*setAttempt\(\{\}\);\s*setI\(0\);\s*\}, \[attemptScope\]\)/s);
  assert.match(source, /const retryPhotos = \(\) => \{\s*setAttempt\(\{\}\);\s*setI\(0\);/s);
});

test("venue photo widget uses shared display compatibility and never leaves an empty dark frame", () => {
  assert.match(source, /displaySrc\(photo\.uri, 1600\)/);
  assert.match(source, /style=\{styles\.emptyArtwork\}/);
  assert.match(source, /No verified photos of \$\{venueName\} are available yet/);
  assert.match(source, /Photos could not be displayed - tap to retry/);
});

test("venue photo credits use validated provenance and safe accessible external links", () => {
  assert.doesNotThrow(() => parse(viewerSource, { sourceType: "module", plugins: ["jsx"] }));
  for (const componentSource of [source, viewerSource]) {
    assert.match(componentSource, /venuePhotoAttribution/);
    assert.match(componentSource, /verifiedHttpsUrl/);
    assert.match(componentSource, /hrefAttrs:\s*\{\s*target:\s*"_blank",\s*rel:\s*"noopener noreferrer"\s*\}/s);
    assert.match(componentSource, /accessibilityRole="link"/);
    assert.match(componentSource, /modificationNotice/);
  }
  assert.match(source, /Open original source in browser/);
  assert.match(source, /license terms in browser/);
  assert.match(viewerSource, /Open original source in browser/);
  assert.match(viewerSource, /license terms in browser/);
});
