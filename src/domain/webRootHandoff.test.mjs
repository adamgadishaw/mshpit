import assert from "node:assert/strict";
import test from "node:test";
import { clearInjectedPublicDocument } from "./webRootHandoff.mjs";

test("web root handoff clears the exact crawler document before Expo mounts", () => {
  let cleared = 0;
  const root = {
    querySelector: (selector) => selector === ":scope > .seo-document" ? {} : null,
    replaceChildren: () => { cleared += 1; },
  };
  assert.equal(clearInjectedPublicDocument({ getElementById: () => root }), true);
  assert.equal(cleared, 1);
});

test("web root handoff leaves ordinary and no-document roots untouched", () => {
  let cleared = 0;
  const root = {
    querySelector: () => null,
    replaceChildren: () => { cleared += 1; },
  };
  assert.equal(clearInjectedPublicDocument({ getElementById: () => root }), false);
  assert.equal(clearInjectedPublicDocument(null), false);
  assert.equal(cleared, 0);
});
