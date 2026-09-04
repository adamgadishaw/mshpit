import assert from "node:assert/strict";
import test from "node:test";

import { photoCreditUrlFromLinkHeader } from "./httpLinkHeader.mjs";

const id = "a84ab2bcd680ed638991343983552341926bac7c9714782d";
const creditUrl = `https://www.mshpit.com/photo-credits/${id}`;

test("photo credit Link parsing accepts only the exact first-party license relation", () => {
  assert.equal(photoCreditUrlFromLinkHeader(
    `<https://www.mshpit.com/event/example>; rel="canonical", <${creditUrl}>; rel="license"`,
  ), creditUrl);
  assert.equal(photoCreditUrlFromLinkHeader(`<${creditUrl}>; type="text/html"; rel=license`), creditUrl);
  assert.equal(photoCreditUrlFromLinkHeader(`<${creditUrl}>; rel="alternate license"`), creditUrl);
});

test("photo credit Link parsing rejects redirects, near misses, and off-site targets", () => {
  for (const value of [
    null,
    `<https://tracker.example/photo-credits/${id}>; rel="license"`,
    `<${creditUrl}?next=https://tracker.example>; rel="license"`,
    `<https://www.mshpit.com/photo-credits/${id}/extra>; rel="license"`,
    `<${creditUrl}>; rel="canonical"`,
    `<${creditUrl}>; rel="license-evil"`,
    `<${creditUrl}>; rel="not-license"`,
    `<https://www.mshpit.com@tracker.example/photo-credits/${id}>; rel="license"`,
  ]) assert.equal(photoCreditUrlFromLinkHeader(value), null);
});
