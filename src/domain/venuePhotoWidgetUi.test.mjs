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
  assert.doesNotMatch(source, /useAppActive|setInterval|setTimeout|autoplay|slideshow/i);
  assert.match(source, /accessibilityLabel="Previous venue photo"/);
  assert.match(source, /accessibilityLabel="Next venue photo"/);
  assert.match(source, /style=\{styles\.photoCounter\}/);
  assert.match(source, /else if \(onPress\) onPress\(slides\[cur\], cur\)/);
});

test("venue photo widget uses shared display compatibility and never leaves an empty dark frame", () => {
  assert.match(source, /displaySrc\(photo\.uri, 1600\)/);
  assert.match(source, /style=\{styles\.emptyArtwork\}/);
  assert.match(source, /No verified photos of \$\{venueName\} are available yet/);
  assert.match(source, /Photos could not be displayed - tap to retry/);
});

test("venue photos use one compact source action while the viewer retains full provenance", () => {
  assert.doesNotThrow(() => parse(viewerSource, { sourceType: "module", plugins: ["jsx"] }));
  for (const componentSource of [source, viewerSource]) {
    assert.match(componentSource, /venuePhotoAttribution/);
    assert.match(componentSource, /verifiedHttpsUrl/);
    assert.match(componentSource, /hrefAttrs:\s*\{\s*target:\s*"_blank",\s*rel:\s*"noopener noreferrer"\s*\}/s);
    assert.match(componentSource, /accessibilityRole="link"/);
  }
  assert.match(source, /<Text style=\{styles\.sourceButtonText\}>SOURCE<\/Text>/);
  assert.match(source, /Photo source:/);
  assert.doesNotMatch(source, /Photo by|>LICENSE<|attributionCard/);
  assert.match(viewerSource, /modificationNotice/);
  assert.match(viewerSource, /Open original source in browser/);
  assert.match(viewerSource, /license terms in browser/);
});
