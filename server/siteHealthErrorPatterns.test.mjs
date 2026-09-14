import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  collectSeriousErrorPatterns,
  formatSeriousErrorPatterns,
  SITE_HEALTH_ERROR_PATTERN_LIMIT,
} from "./siteHealthErrorPatterns.js";

const HOUR = 3_600_000;
const END = Date.parse("2026-09-14T13:01:18.548Z");
const START = Date.parse("2026-09-13T13:00:00Z");

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE error_events (
    fingerprint TEXT PRIMARY KEY,level TEXT,code TEXT,status INTEGER,
    method TEXT,route TEXT,cause TEXT,last_request_id TEXT,count INTEGER,
    first_seen INTEGER,last_seen INTEGER
  ); CREATE TABLE error_occurrence_buckets (
    fingerprint TEXT,hour_start INTEGER,count INTEGER,
    PRIMARY KEY(fingerprint,hour_start)
  )`);
  let sequence = 0;
  const event = (fields = {}) => {
    const row = { fingerprint: (++sequence).toString(16).padStart(24, "0"), level: "error",
      code: "INTERNAL_ERROR", status: 500, method: "GET", route: "/api/feed",
      cause: "Error", requestId: null, count: 999, firstSeen: START - 10 * HOUR,
      lastSeen: END + 24 * HOUR, ...fields };
    db.prepare("INSERT INTO error_events VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
      row.fingerprint, row.level, row.code, row.status, row.method, row.route,
      row.cause, row.requestId, row.count, row.firstSeen, row.lastSeen,
    );
    return row.fingerprint;
  };
  const bucket = (id, hour, count) => db.prepare("INSERT INTO error_occurrence_buckets VALUES (?,?,?)").run(id, hour, count);
  return { db, event, bucket, read: () => collectSeriousErrorPatterns(db, { since: END - 24 * HOUR, until: END }) };
}

test("serious totals and ranked pattern counts share a window, never retained lifetime counts", (t) => {
  const { event, bucket, read } = fixture(t);
  const media = event({ code: "MEDIA_STORAGE_UNAVAILABLE", status: 503, method: "POST", route: "/api/media/assets/:id/finalize" });
  const client = event({ code: "PIT-APP-001", level: "fatal", status: 0, method: "POST", route: "/client/landing" });
  const provider = event({ code: "PROVIDER_UNAVAILABLE", status: 502, route: "/api/artists/resolve" });
  bucket(media, START, 3);
  bucket(media, START + HOUR, 1);
  bucket(media, START - HOUR, 80);
  bucket(media, START + 25 * HOUR, 90);
  bucket(client, START + HOUR, 2);
  bucket(provider, START + 2 * HOUR, 1);
  const readiness = event({ code: "MEDIA_STORAGE_UNAVAILABLE", status: 503, route: "/api/readiness" });
  const denied = event({ code: "AUTH_REQUIRED", status: 401 });
  bucket(readiness, START + HOUR, 127);
  bucket(denied, START + HOUR, 32);
  const report = read();
  assert.equal(report.occurrences, 7);
  assert.equal(report.kinds, 3);
  assert.deepEqual(report.patterns.map((row) => row.occurrences), [4, 2, 1]);
  assert.equal(report.patterns[0].lastObservedHour, START + HOUR, "a later retained occurrence is not the affected window hour");
  assert.equal(report.patterns[0].fingerprint, media);
  assert.ok(Object.isFrozen(report.patterns[0]));
  assert.match(formatSeriousErrorPatterns(report).join("\n"), /4x 503 POST \/api\/media\/assets\/:id\/finalize/);
});

test("historical snapshots exclude future hours and state the approximate boundary-hour range", (t) => {
  const { event, bucket, read } = fixture(t);
  const id = event();
  bucket(id, START - HOUR, 100);
  bucket(id, START, 1);
  bucket(id, START + 24 * HOUR, 2);
  bucket(id, START + 25 * HOUR, 200);
  const future = event();
  bucket(future, START + 26 * HOUR, 300);
  const report = read();
  assert.equal(report.occurrences, 3);
  assert.equal(report.kinds, 1);
  assert.equal(report.startedAt, START);
  assert.equal(report.collectedThrough, END);
  assert.equal(report.bucketEndExclusive, START + 25 * HOUR);
  assert.match(formatSeriousErrorPatterns(report)[0], /2026-09-13T13:00:00.000Z to 2026-09-14T13:01:18.548Z/);
  assert.match(formatSeriousErrorPatterns(report)[0], /boundary hours are approximate/);
});

test("a bounded pattern list preserves all-window totals and explicitly counts omitted kinds", (t) => {
  const { event, bucket, read } = fixture(t);
  for (let index = 1; index <= 12; index += 1) bucket(event(), START + HOUR, index);
  const report = read();
  assert.equal(report.patterns.length, SITE_HEALTH_ERROR_PATTERN_LIMIT);
  assert.equal(report.occurrences, 78);
  assert.equal(report.kinds, 12);
  assert.equal(report.omittedKinds, 4);
  assert.deepEqual(report.patterns.map((row) => row.occurrences), [12, 11, 10, 9, 8, 7, 6, 5]);
  const lines = formatSeriousErrorPatterns(report);
  assert.match(lines.at(-1), /4 additional pattern\(s\)/);
  assert.ok(lines.join("\n").length < 3_500);
});

test("diagnostic metadata withholds unknown path-shaped values, codes, causes, request IDs and messages", (t) => {
  const { event, bucket, read } = fixture(t);
  const id = event({ fingerprint: "person-private-fingerprint", code: "PRIVATE_FAILURE",
    method: "PRIVATE", route: "/api/users/private-person", status: 999,
    cause: "C:/private/raw/path token=secret-value", requestId: "private-request" });
  bucket(id, START + HOUR, 1);
  const report = read();
  const row = report.patterns[0];
  assert.equal(row.fingerprint, null);
  assert.equal(row.code, "UNKNOWN");
  assert.equal(row.route, null);
  assert.equal(row.method, null);
  assert.equal(row.status, null);
  const output = JSON.stringify(report) + formatSeriousErrorPatterns(report).join("\n");
  for (const forbidden of ["person-private-fingerprint", "PRIVATE_FAILURE", "/api/users/private-person",
    "C:/private/raw/path", "secret-value", "private-request", "PRIVATE"])
    assert.equal(output.includes(forbidden), false, `leaked ${forbidden}`);
  assert.match(output, /route withheld; check moderation/);
});

test("known paths with query strings, raw member IDs or trailing text never enter the digest", (t) => {
  const { event, bucket, read } = fixture(t);
  for (const route of ["/api/feed?token=secret", "/api/posts/member-post-id", "/client/landing private-text", "https://example.com/api/feed"])
    bucket(event({ route }), START + HOUR, 1);
  const report = read();
  assert.equal(report.patterns.length, 4);
  assert.ok(report.patterns.every((row) => row.route === null));
  assert.equal(JSON.stringify(report).includes("secret"), false);
});

test("canonical account and concert routes remain actionable without copying entity identifiers", (t) => {
  const { event, bucket, read } = fixture(t);
  const routes = ["/api/login", "/api/logout", "/api/signup", "/api/me", "/api/going", "/api/tourdates"];
  for (const route of routes) bucket(event({ route }), START + HOUR, 1);
  assert.deepEqual(read().patterns.map((row) => row.route).sort(), routes.sort());
});

test("empty, invalid and unavailable windows do not invent healthy diagnostic evidence", (t) => {
  const { db, read } = fixture(t);
  assert.deepEqual(read().patterns, []);
  assert.equal(read().occurrences, 0);
  assert.equal(read().kinds, 0);
  for (const times of [{ since: NaN, until: END }, { since: -1, until: END }, { since: END, until: START },
    { since: START, until: 1e100 }, { since: START, until: 8_640_000_000_000_000 }])
    assert.equal(collectSeriousErrorPatterns(db, times), null);
  const broken = { prepare() { throw new Error("private-database-failure"); } };
  assert.equal(collectSeriousErrorPatterns(broken, { since: START, until: END }), null);
  assert.match(formatSeriousErrorPatterns(null)[0], /unavailable/);
  assert.equal(formatSeriousErrorPatterns(null).join("").includes("private-database-failure"), false);
});
