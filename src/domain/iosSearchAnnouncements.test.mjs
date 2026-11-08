import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createIOSSearchAnnouncements } from "./iosSearchAnnouncements.mjs";

function fixture() {
  const jobs = [];
  const said = [];
  const controller = createIOSSearchAnnouncements({
    announce: (...args) => said.push(args),
    schedule: (run, delay) => { const job = { run, delay, cancelled: false }; jobs.push(job); return job; },
    cancel: (job) => { job.cancelled = true; },
  });
  // Deliberately fire even cancelled callbacks to verify generation fences.
  return { controller, jobs, said, flush: () => jobs.splice(0).forEach((job) => job.run()) };
}
const result = (overrides = {}) => ({ scope: "account-a:search", query: "sza", ready: true, outcome: "results", message: "3 results for sza.", ...overrides });

test("blank and restored Search mounts never announce without user intent", () => {
  const f = fixture();
  f.controller.update(result());
  f.controller.request("account-a:search", " ");
  f.controller.update(result({ query: "" }));
  f.flush();
  assert.deepEqual(f.said, []);
});

test("completed results, no matches, and errors queue one announcement per explicit request", () => {
  for (const outcome of ["results", "no-results", "error"]) {
    const f = fixture();
    f.controller.request("account-a:search", " SZA ");
    f.controller.update(result({ ready: false, outcome: "loading" }));
    assert.equal(f.jobs.length, 0);
    f.controller.update(result({ outcome }));
    f.controller.update(result({ outcome }));
    assert.equal(f.jobs.length, 1);
    assert.equal(f.jobs[0].delay, 450);
    f.flush();
    f.controller.update(result({ outcome, message: "A background catalogue update." }));
    f.flush();
    assert.deepEqual(f.said, [["3 results for sza.", { queue: true }]]);
  }
});

test("new query synchronously cancels pending old results and rejects stale completions", () => {
  const f = fixture();
  f.controller.request("account-a:search", "sza");
  f.controller.update(result());
  f.controller.request("account-a:search", "mitski");
  assert.equal(f.jobs[0].cancelled, true);
  f.controller.update(result());
  f.controller.update(result({ query: "mitski", message: "2 results for mitski." }));
  f.flush();
  assert.deepEqual(f.said, [["2 results for mitski.", { queue: true }]]);
});

test("account change, clear, and screen unmount invalidate pending callbacks", () => {
  for (const cancel of [(c) => c.reset(), (c) => c.request("account-a:search", ""), (c) => c.request("account-b:search", "sza")]) {
    const f = fixture();
    f.controller.request("account-a:search", "sza");
    f.controller.update(result());
    cancel(f.controller);
    f.controller.update(result());
    f.flush();
    assert.deepEqual(f.said, []);
  }
});

test("loading invalidates an early snapshot; explicit retry can announce its outcome", () => {
  const f = fixture();
  f.controller.request("account-a:search", "sza");
  f.controller.update(result());
  f.controller.update(result({ ready: false }));
  f.flush();
  assert.deepEqual(f.said, []);
  f.controller.update(result({ outcome: "error", message: "Search could not update." }));
  f.flush();
  f.controller.request("account-a:search", "sza");
  f.controller.update(result());
  f.flush();
  assert.deepEqual(f.said, [["Search could not update.", { queue: true }], ["3 results for sza.", { queue: true }]]);
});

test("Search integration keeps native speech iOS-only and preserves Android live regions", () => {
  const source = readFileSync(new URL("../screens/SearchScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /IS_IOS && !searchAnnouncements.current/);
  assert.match(source, /AccessibilityInfo.announceForAccessibilityWithOptions\(message, options\)/);
  assert.match(source, /if \(!IS_IOS\) return;\s+searchAnnouncements.current.update/);
  assert.match(source, /return \(\) => searchAnnouncements.current\?\.reset\(\);\s+\}, \[searchAccountScope\]\)/);
  assert.match(source, /ready: queryIsSettled && !searchLoading && visibleResultState !== "loading"/);
  assert.match(source, /accessibilityLiveRegion=\{visibleSearchError \|\| actionMessage \? "assertive" : "polite"\}/);
  assert.match(source, /if \(nextQuery !== q.trim\(\).toLowerCase\(\)\) searchAnnouncements.current.request/);
  assert.match(source, /onPress=\{retrySearch\}/);
});
