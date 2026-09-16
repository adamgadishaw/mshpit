import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reviewRatingSummary } from "./reviewRatingSummary.mjs";

test("overall-only logging displays one honest night score, not unrated zeros or half a score", () => {
  const score = reviewRatingSummary({ overall: 5, band: null, room: null, dims: { performance: 0, setlist: 0, sound: 0, venue: 0, crowd: 0, experience: 5 } });
  assert.deepEqual(score, { band: null, room: null, night: 5, overall: 5, factors: "Night 5.0", hasDimensions: true });
});

test("partial categories average only explicit ratings and ignore stale legacy aggregates", () => {
  const score = reviewRatingSummary({ overall: 4, band: 5, room: 5, dims: { performance: 4, setlist: 0, sound: 0, venue: 3, crowd: 4, experience: 5 } });
  assert.equal(score.factors, "Band 4.0 · Room 3.0 · Night 4.5");
  assert.equal(reviewRatingSummary({ band: 5, room: 4, dims: { experience: 0 } }).factors, "");
});

test("legacy aggregates remain compatible without inventing categories from overall", () => {
  assert.equal(reviewRatingSummary({ overall: 4, band: "4.5", room: 3 }).factors, "Band 4.5 · Room 3.0");
  assert.equal(reviewRatingSummary({ overall: 4 }).factors, "");
  assert.equal(reviewRatingSummary({ overall: "4", band: null, room: 0 }).overall, 4);
});

test("invalid and missing ratings never crash or become fabricated factors", () => {
  for (const value of [null, undefined, "", "invalid", Infinity, NaN, -1, 0, 6, true, false]) {
    assert.equal(reviewRatingSummary({ band: value, room: value, overall: value }).factors, "");
    assert.equal(reviewRatingSummary({ dims: { experience: value } }).factors, "");
  }
  assert.equal(reviewRatingSummary({ dims: { sound: "3.5" } }).factors, "Room 3.5");
});

test("feed ticket uses the same sparse-rating projection as the tested summary", () => {
  const source = readFileSync(new URL("../components/TicketStub.jsx", import.meta.url), "utf8");
  assert.match(source, /reviewRatingSummary\(log\)/);
  assert.doesNotMatch(source, /\(log\.dims\.crowd \|\| 0\) \+ \(log\.dims\.experience \|\| 0\)/);
  assert.match(source, /\{!!factors && <Text style=\{styles\.factors\}>\{factors\}<\/Text>\}/);
});
