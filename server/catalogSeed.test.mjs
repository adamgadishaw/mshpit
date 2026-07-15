import test from "node:test";
import assert from "node:assert/strict";
import { growOutcome, shouldEnrichAfterCrawl } from "./catalogSeed.js";

// Regression cover for the 2026-07-14 incident. "Grow by 10k" added zero artists
// (every genre cursor had reached the end of its results) yet reported success and
// still ran a full Deezer re-enrichment over 5,599 existing profiles. That pass
// rewrote ~46k short-lived preview URLs, which then expired and broke playback.

test("a grow that adds nothing reports exhausted, never done", () => {
  const outcome = growOutcome({ added: 0, reachedTarget: false, stopRequested: false });
  assert.equal(outcome.phase, "exhausted");
  assert.equal(outcome.errorCode, "CATALOG_CRAWL_EXHAUSTED");
  assert.match(outcome.note, /left untouched/i);
});

test("a grow that adds artists reports done without an error code", () => {
  const outcome = growOutcome({ added: 120, reachedTarget: false, stopRequested: false });
  assert.equal(outcome.phase, "done");
  assert.equal(outcome.errorCode, undefined);
});

test("reaching the requested target is done even though the crawl stopped early", () => {
  const outcome = growOutcome({ added: 2000, reachedTarget: true, stopRequested: false });
  assert.equal(outcome.phase, "done");
});

test("a target already satisfied is not misreported as exhausted", () => {
  // reachedTarget short-circuits the crawl before it can add anything.
  const outcome = growOutcome({ added: 0, reachedTarget: true, stopRequested: false });
  assert.equal(outcome.phase, "done");
  assert.equal(outcome.errorCode, undefined);
});

test("an operator stop outranks both outcomes and keeps what was added", () => {
  assert.equal(growOutcome({ added: 0, reachedTarget: false, stopRequested: true }).phase, "stopped");
  assert.equal(growOutcome({ added: 50, reachedTarget: false, stopRequested: true }).phase, "stopped");
});

test("enrichment never runs when the crawl added nothing", () => {
  // The exact fall-through that rewrote ~46k expiring preview URLs.
  assert.equal(shouldEnrichAfterCrawl({ enrich: true, added: 0, stopRequested: false }), false);
});

test("enrichment runs only for artists this crawl actually added", () => {
  assert.equal(shouldEnrichAfterCrawl({ enrich: true, added: 12, stopRequested: false }), true);
  assert.equal(shouldEnrichAfterCrawl({ enrich: false, added: 12, stopRequested: false }), false);
  assert.equal(shouldEnrichAfterCrawl({ enrich: true, added: 12, stopRequested: true }), false);
});
