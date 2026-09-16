import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Agent, createServer, get } from "node:http";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import { HTTP_SERVER_LIMITS, applyHttpServerLimits } from "./httpServerPolicy.js";

test("HTTP connections have bounded headers, request bodies, reuse, and request counts", () => {
  assert.deepEqual(HTTP_SERVER_LIMITS, {
    headersTimeout: 15_000,
    requestTimeout: 30_000,
    keepAliveTimeout: 120_000,
    keepAliveTimeoutBuffer: 1_000,
    maxHeadersCount: 100,
    maxRequestsPerSocket: 100,
  });
  // Idle reuse and incomplete-request deadlines are independent in Node 24.
  assert.ok(HTTP_SERVER_LIMITS.keepAliveTimeout > 75_000);
  assert.ok(HTTP_SERVER_LIMITS.requestTimeout >= HTTP_SERVER_LIMITS.headersTimeout);

  const server = {};
  assert.equal(applyHttpServerLimits(server), server);
  for (const [property, value] of Object.entries(HTTP_SERVER_LIMITS)) {
    assert.equal(server[property], value);
    assert.ok(Number.isFinite(value) && value > 0);
  }

  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /applyHttpServerLimits\(server\);\s*\n\s*\/\/ Observe fatal errors/);
});

test("idle proxy reuse outlives header deadlines and shutdown closes idle sockets", { timeout: 5_000 }, async (t) => {
  const server = createServer({ connectionsCheckingInterval: 25 }, (_req, res) => res.end("ok"));
  applyHttpServerLimits(server, { ...HTTP_SERVER_LIMITS, headersTimeout: 200, requestTimeout: 1_000 });
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => { agent.destroy(); server.closeAllConnections(); server.close(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = () => new Promise((resolve, reject) => {
    let socket;
    const req = get({ host: "127.0.0.1", port: server.address().port, agent }, (res) => {
      res.resume();
      res.on("end", () => resolve({ socket, status: res.statusCode, keepAlive: res.headers["keep-alive"] }));
      res.on("error", reject);
    });
    req.on("socket", (value) => { socket = value; });
    req.on("error", reject);
  });
  const first = await request();
  assert.equal(first.status, 200);
  assert.match(first.keepAlive, /timeout=120(?:,|$)/);
  await delay(600);
  const second = await request();
  assert.equal(second.status, 200);
  assert.equal(second.socket, first.socket, "the proxy can reuse its connection after the header deadline");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("idle keepalive delayed shutdown")), 1_000);
    server.close((error) => { clearTimeout(timer); error ? reject(error) : resolve(); });
  });
});

test("long idle reuse does not grant partial headers the idle deadline", { timeout: 5_000 }, async (t) => {
  let handled = 0;
  const server = createServer({ connectionsCheckingInterval: 25 }, (_req, res) => {
    handled += 1;
    res.end("unexpected");
  });
  applyHttpServerLimits(server, { ...HTTP_SERVER_LIMITS, headersTimeout: 200, requestTimeout: 1_000 });
  t.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const response = await new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: server.address().port });
    t.after(() => socket.destroy());
    let body = "";
    socket.setEncoding("utf8");
    socket.setTimeout(2_000, () => socket.destroy(new Error("partial headers were not bounded")));
    socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n"));
    socket.on("data", (chunk) => { body += chunk; });
    socket.on("end", () => resolve(body));
    socket.on("error", reject);
  });
  assert.match(response, /^HTTP\/1\.1 408 /);
  assert.equal(handled, 0);
});
