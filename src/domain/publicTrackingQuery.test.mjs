import assert from "node:assert/strict";
import test from "node:test";
import { hasOnlyPublicTrackingQuery } from "./publicTrackingQuery.mjs";

test("only bounded attribution parameters retain the underlying document policy", () => {
  for (const search of ["", "?", "?utm_source=google&utm_medium=organic", "?gclid=click-id",
    "?UTM_CAMPAIGN=summer%20shows&fbclid=abc", "?srsltid=abc&msclkid=xyz",
    "?utm_source=one&utm_source=two", "?gbraid=&wbraid=abc"]) {
    assert.equal(hasOnlyPublicTrackingQuery(search), true, search);
  }
});

test("tracking keys never exempt private, unknown or content-selecting parameters", () => {
  for (const search of ["?q=private", "?city=Toronto", "?token=secret", "?code=oauth&state=state",
    "?utm_source=google&email=private", "?utm_source=google&page=2", "?utm_unknown=anything",
    "?gclid=abc&gclid[]=secret", "?%00gclid=x", "?gclid=%00secret", "?gclid=x#private",
    "?gclid=x y", "utm_source=google", "?&", "?=x", null, {},
    `?gclid=${"x".repeat(513)}`, `?${Array(21).fill("gclid=x").join("&")}`, `?${"x".repeat(2048)}`]) {
    assert.equal(hasOnlyPublicTrackingQuery(search), false, String(search));
  }
});
