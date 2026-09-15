import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, request } from "node:http";
import test from "node:test";
import { createRequestMetrics, formatRequestMetrics, observeRequestResponse, requestMetricCategory } from "./requestMetrics.js";

test("request telemetry retains only fixed categories and bounded hourly aggregates", () => {
  let at = 0;
  const metrics = createRequestMetrics({ now: () => at });
  for (let index = 0; index < 120; index++) {
    at = index * 60000;
    metrics.record({ category: `/api/users/private-${index}?email=secret`, status: 200, durationMs: 20, responseBytes: 10 });
  }
  const report = metrics.snapshot();
  assert.equal(report.total.completed, 60);
  assert.equal(report.total.knownResponseBytes, 600);
  assert.equal(Object.keys(report.categories).length, 8);
  assert.doesNotMatch(JSON.stringify(report), /private-|secret|email/);
  at += 3600000;
  assert.equal(metrics.snapshot().total.completed, 0);
});

test("health probes do not dilute the user-facing latency distribution", () => {
  const metrics = createRequestMetrics();
  for (let index = 0; index < 1000; index++) metrics.record({ category: "health", durationMs: 1, status: 200 });
  metrics.record({ category: "artist_lookup", durationMs: 800, status: 503, responseBytes: 100 });
  metrics.record({ category: "api", durationMs: 100, status: 429 });
  metrics.record({ category: "api", aborted: true });
  const report = metrics.snapshot();
  assert.deepEqual(report.total, { completed: 2, aborted: 1, serverErrors: 1, rateLimited: 1,
    knownResponseBytes: 100, responsesWithoutLength: 1, meanMs: 450, p95UpperBoundMs: 1000, maxMs: 800 });
  assert.match(formatRequestMetrics(report), /Not total billable bandwidth/);
});

test("category classification drops query strings and resource identifiers", () => {
  assert.equal(requestMetricCategory("/api/artists/resolve?name=private"), "artist_lookup");
  assert.equal(requestMetricCategory("/api/me"), "api");
  assert.equal(requestMetricCategory("/artist/private-person"), "document");
  assert.equal(requestMetricCategory("/media/landing/private-post"), "media");
  assert.equal(requestMetricCategory("/sitemaps/1.xml"), "crawler");
  assert.equal(requestMetricCategory("/assets/app.js"), "asset");
});

function response(length = 123) {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.writableFinished = false;
  res.getHeader = () => length;
  return res;
}

test("finish/close counted once, HEAD bytes excluded, disconnects remain distinct", () => {
  const metrics = createRequestMetrics();
  let elapsed = 10;
  const res = response();
  observeRequestResponse({ method: "HEAD" }, res, { pathname: "/", metrics, monotonicNow: () => elapsed });
  elapsed = 50;
  res.writableFinished = true;
  res.emit("finish");
  res.emit("close");
  const disconnected = response();
  observeRequestResponse({ method: "GET" }, disconnected, { pathname: "/", metrics });
  disconnected.emit("close");
  assert.equal(metrics.snapshot().total.completed, 1);
  assert.equal(metrics.snapshot().total.aborted, 1);
  assert.equal(metrics.snapshot().total.knownResponseBytes, 0);
  assert.equal(res.listenerCount("finish") + res.listenerCount("close"), 0);
});

test("large latency and unknown stream sizes are not falsely reported as measured values", () => {
  const metrics = createRequestMetrics();
  metrics.record({ category: "api", durationMs: 90000 });
  assert.equal(metrics.snapshot().total.p95UpperBoundMs, null);
  assert.equal(metrics.snapshot().total.maxMs, 90000);
  const res = response();
  res.getHeader = () => undefined;
  observeRequestResponse({ method: "GET" }, res, { pathname: "/", metrics });
  res.emit("finish");
  assert.equal(metrics.snapshot().total.responsesWithoutLength, 2);
});

test("real HTTP finish observes writeHead length after setHeader, but not HEAD or unmeasured streams", async (t) => {
  const metrics = createRequestMetrics();
  const server = createServer((req, res) => {
    // Match the application's header order, not just a mocked getHeader().
    res.setHeader("X-Request-Id", "fixture-private-id");
    observeRequestResponse(req, res, { pathname: req.url, metrics });
    if (req.url === "/stream") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("chunk");
      res.end("end");
    } else {
      res.writeHead(200, { "Content-Length": "5", "Content-Type": "text/plain" });
      res.end(req.method === "HEAD" ? undefined : "hello");
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const read = (method, path) => new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.address().port, method, path, agent: false }, (res) => {
      res.on("error", reject);
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.end();
  });
  await read("GET", "/document?private=value");
  await read("HEAD", "/document");
  await read("GET", "/stream");
  const report = metrics.snapshot();
  assert.equal(report.total.completed, 3);
  assert.equal(report.total.aborted, 0);
  assert.equal(report.total.knownResponseBytes, 5);
  assert.equal(report.total.responsesWithoutLength, 1);
  assert.doesNotMatch(JSON.stringify(report), /fixture-private-id|private=value|document\?/);
});
