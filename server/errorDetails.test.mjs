import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  boundedAlertDetail,
  currentRelease,
  describeErrorLocation,
  describeErrorReason,
  ensureErrorDetailSchema,
  errorDetailFromError,
  errorDetailsByFingerprint,
  formatErrorDetailLines,
  pruneErrorDetails,
  recordErrorDetail,
} from "./errorDetails.js";

const THIS_FILE = /^server\/errorDetails\.test\.mjs:\d+:\d+/;

function throwsTypeError() {
  const profile = undefined;
  return profile.photos;
}
function stopPeriodicJob() {
  return new DOMException("Periodic job stopped.", "AbortError");
}
function abortWithoutReason() {
  const controller = new AbortController();
  controller.abort();
  return controller.signal.reason;
}

function database(t) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE error_events (fingerprint TEXT PRIMARY KEY)");
  ensureErrorDetailSchema(db);
  t.after(() => db.close());
  return db;
}

test("a thrown error reports the application file, line and function, and its message", () => {
  let caught;
  try { throwsTypeError(); } catch (error) { caught = error; }
  const detail = errorDetailFromError(caught);
  assert.match(detail.location, THIS_FILE);
  assert.match(detail.location, /^[^<]* in throwsTypeError/);
  assert.equal(detail.reason, "TypeError: Cannot read properties of undefined (reading 'photos')");
});

test("an abort reason names the code that aborted, past Node's internal frames", () => {
  const explicit = errorDetailFromError(stopPeriodicJob());
  assert.match(explicit.location, THIS_FILE);
  assert.match(explicit.location, /^[^<]* in stopPeriodicJob/);
  assert.doesNotMatch(explicit.location, /node:internal|domexception/);
  assert.equal(explicit.reason, "AbortError [20]: Periodic job stopped.");

  // abort() with no reason makes Node create the DOMException internally.
  const implicit = errorDetailFromError(abortWithoutReason());
  assert.match(implicit.location, /^[^<]* in abortWithoutReason/);
  assert.equal(implicit.reason, "AbortError [20]: This operation was aborted");
});

test("the reason follows the cause chain, redacted, and stops at a cycle", () => {
  const network = new Error("getaddrinfo ENOTFOUND acct.r2.cloudflarestorage.com");
  const fetchFailure = new TypeError("fetch failed", { cause: network });
  const wrapped = Object.assign(new Error("The upload could not be verified yet. Try again.", { cause: fetchFailure }), {
    name: "ApiError", code: "MEDIA_STORAGE_UNAVAILABLE",
  });
  assert.equal(
    describeErrorReason(wrapped),
    "ApiError [MEDIA_STORAGE_UNAVAILABLE]: The upload could not be verified yet. Try again.; caused by TypeError: fetch failed; caused by Error: getaddrinfo ENOTFOUND acct.r2.cloudflarestorage.com",
  );

  const leaky = new Error("PUT https://acct.r2.cloudflarestorage.com/pit/a.jpg?X-Amz-Signature=abc failed for jane@example.com");
  assert.equal(describeErrorReason(leaky), "Error: PUT https://acct.r2.cloudflarestorage.com/pit/a.jpg failed for <email>");

  const cyclic = new Error("loop");
  cyclic.cause = cyclic;
  assert.equal(describeErrorReason(cyclic), "Error: loop");
});

test("frames outside this checkout, in dependencies, or in Node internals are handled", () => {
  const rendered = {
    name: "Error",
    message: "x",
    stack: [
      "Error: x",
      "    at node:internal/process/task_queues:95:5",
      "    at Object.run (/opt/render/project/src/node_modules/lib/index.js:1:1)",
      "    at coalescedProviderJob (/opt/render/project/src/server/musicProviders.js:164:12)",
      "    at async resolve (/opt/render/project/src/server/api.js:4663:17)",
    ].join("\n"),
  };
  assert.equal(
    describeErrorLocation(rendered, { root: "/nowhere/else" }),
    "server/musicProviders.js:164:12 in coalescedProviderJob <- server/api.js:4663:17 in resolve",
  );
  const windowsUrl = { stack: "Error: x\n    at handler (file:///C:/Users/ADAMGA%7E1/work/pit/src/domain/genre.mjs:12:3)" };
  assert.equal(describeErrorLocation(windowsUrl, { root: "/nowhere/else" }), "src/domain/genre.mjs:12:3 in handler");
  assert.equal(describeErrorLocation({ stack: "Error: x\n    at node:internal/timers:1:1" }), null);
  assert.equal(describeErrorLocation({ stack: 42 }), null);
});

test("thrown non-errors and hostile objects still produce a safe description", () => {
  assert.equal(describeErrorReason("disk full for jane@example.com"), "Thrown value: disk full for <email>");
  const hostile = {};
  Object.defineProperty(hostile, "stack", { get() { throw new Error("no"); } });
  Object.defineProperty(hostile, "message", { get() { throw new Error("no"); } });
  assert.deepEqual(errorDetailFromError(hostile), { location: null, reason: "Error" });
  assert.deepEqual(errorDetailFromError(undefined), { location: null, reason: null });
});

test("release identity comes only from a real commit hash", () => {
  assert.equal(currentRelease({ RENDER_GIT_COMMIT: "4603CB3E6084ABCDEF0123456789ABCDEF012345" }), "4603cb3e6084");
  assert.equal(currentRelease({ RENDER_GIT_COMMIT: "unreleased" }), null);
  assert.equal(currentRelease({}), null);
});

test("the latest detail is kept per problem without erasing it on a detail-less occurrence", (t) => {
  const db = database(t);
  db.prepare("INSERT INTO error_events (fingerprint) VALUES ('fp1'),('fp2')").run();
  assert.equal(recordErrorDetail(db, { fingerprint: "fp1", location: "server/a.js:1:1", reason: "Error: first", release: "4603cb3e6084", at: 1 }), true);
  assert.equal(recordErrorDetail(db, { fingerprint: "fp1", location: null, reason: "Error: second", release: "455488a1b2c3", at: 2 }), true);
  assert.equal(recordErrorDetail(db, { fingerprint: "fp1", location: null, reason: null, at: 3 }), false);
  assert.equal(recordErrorDetail(db, { fingerprint: "not a fingerprint!", reason: "Error: x" }), false);
  assert.equal(recordErrorDetail(db, { fingerprint: "fp2", reason: "Error: token=abc for jane@example.com" }), true);

  const details = errorDetailsByFingerprint(db, ["fp1", "fp2", "missing", 7]);
  assert.deepEqual(details.get("fp1"), { release: "455488a1b2c3", location: "server/a.js:1:1", reason: "Error: second" });
  assert.equal(details.get("fp2").reason, "Error: token=<redacted> for <email>");
  assert.equal(details.has("missing"), false);

  db.prepare("DELETE FROM error_events WHERE fingerprint='fp2'").run();
  assert.equal(pruneErrorDetails(db), 1);
  assert.deepEqual([...errorDetailsByFingerprint(db, ["fp1", "fp2"]).keys()], ["fp1"]);
});

test("alert lines render only what is known, bounded", () => {
  assert.equal(
    formatErrorDetailLines({ location: "server/a.js:1:1 in run", reason: "Error: boom", release: "4603cb3e6084" }),
    "Where: server/a.js:1:1 in run\nWhy: Error: boom\nRelease: 4603cb3e6084",
  );
  assert.equal(formatErrorDetailLines({ reason: "Error: boom", release: "not-a-hash" }), "Why: Error: boom");
  assert.equal(formatErrorDetailLines({ release: "4603cb3e6084" }), "");
  assert.equal(formatErrorDetailLines(null), "");
  assert.equal(boundedAlertDetail({ location: "x".repeat(1000) }).location.length, 240);
});
