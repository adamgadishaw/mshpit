import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createServer } from "node:http";
import { parse } from "@babel/parser";
import { apiIdentityBarrierDecision } from "../domain/apiIdentityState.mjs";
import { createRequestControl } from "./requestControl.mjs";
import { retryAfterDelayMs } from "./retryAfter.mjs";

// Actual production transport with synthetic responses and loopback-only fetch.
const source = readFileSync(new URL("./api.js", import.meta.url), "utf8");
const body = parse(source, { sourceType: "module" }).program.body.flatMap(node => {
  if (node.type === "ImportDeclaration" || (node.type === "ExportNamedDeclaration" && !node.declaration)) return [];
  const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
  return [source.slice(declaration.start, declaration.end)];
}).join("\n");

function fixture(headers) {
  const requests = [], diagnostics = [];
  let cancelled = 0, aborted = 0;
  const bindings = {
    Platform: { OS: "test" }, apiBaseForRuntime: () => "https://synthetic.invalid",
    reviewAllowsRequest: () => true,
    AppError: class extends Error { constructor(message, options) { super(message); Object.assign(this, options); } },
    captureAppError: error => { diagnostics.push(error); return error; },
    apiIdentityBarrierDecision, createRequestControl, retryAfterDelayMs,
    photoCreditUrlFromLinkHeader: () => null,
    fetch: async (url, options) => {
      requests.push({ url, options });
      let streamController;
      const stream = new ReadableStream({
        start(controller) { streamController = controller; controller.enqueue(new Uint8Array([1])); },
        cancel() { cancelled++; },
      });
      options.signal.addEventListener("abort", () => {
        aborted++;
        try { streamController.error(options.signal.reason); } catch { /* stream may already be closed */ }
      }, { once: true });
      return new Response(stream, { status: 200, headers });
    },
  };
  const api = new Function(...Object.keys(bindings), `${body}\nreturn { apiBinary, configureApiIdentity };`)(...Object.values(bindings));
  api.configureApiIdentity("synthetic-account");
  return { ...api, requests, diagnostics, get cancelled() { return cancelled; }, get aborted() { return aborted; } };
}

function transportWithFetch(fetch) {
  const bindings = {
    Platform: { OS: "test" }, apiBaseForRuntime: () => "",
    reviewAllowsRequest: () => true,
    AppError: class extends Error { constructor(message, options) { super(message); Object.assign(this, options); } },
    captureAppError: error => error,
    apiIdentityBarrierDecision, createRequestControl, retryAfterDelayMs,
    photoCreditUrlFromLinkHeader: () => null, fetch,
  };
  const transport = new Function(...Object.keys(bindings), `${body}\nreturn { apiBinary, configureApiIdentity };`)(...Object.values(bindings));
  transport.configureApiIdentity("synthetic-account");
  return transport;
}

for (const oversized of [false, true]) {
  test(`real loopback fetch retires unread ${oversized ? "oversized" : "unsupported"} response on header rejection`, async (t) => {
    const receipt = { chunks: 0, closed: false, ended: false };
    const timers = new Set();
    const server = createServer((request, response) => {
      response.writeHead(200, oversized
        ? { "Content-Type": "image/png", "Content-Length": "8388609" }
        : { "Content-Type": "text/html" });
      response.on("close", () => { receipt.closed = true; });
      const send = () => {
        if (response.destroyed) return;
        receipt.chunks++;
        response.write(Buffer.alloc(32, 65));
      };
      send();
      const interval = setInterval(send, 5);
      timers.add(interval);
      response.on("close", () => { clearInterval(interval); timers.delete(interval); });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      for (const timer of timers) clearInterval(timer);
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    });
    let requestSignal;
    const transport = transportWithFetch((url, options) => {
      requestSignal = options.signal;
      return globalThis.fetch(url, options);
    });
    const caller = new AbortController();
    const url = `http://127.0.0.1:${server.address().port}/synthetic-share-card`;
    await assert.rejects(transport.apiBinary(url, { signal: caller.signal, timeoutMs: 10_000 }), { kind: "invalid_response" });
    const chunksAtRejection = receipt.chunks;
    assert.equal(requestSignal.aborted, true, "header rejection cancels before the caller does");
    caller.abort();
    // Allow slow CI scheduling to deliver fetch's connection-close callback.
    for (let attempt = 0; attempt < 50 && !receipt.closed; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    t.diagnostic(JSON.stringify({ ...receipt, chunksAtRejection, requestAborted: requestSignal.aborted }));
    assert.equal(receipt.closed, true, "real fetch must close the unread HTTP response after header rejection");
    assert.equal(requestSignal.aborted, true, "the transport cancellation must work without Response.body.cancel");
  });
}

test("an accepted bounded binary response succeeds without cancelling completed transport", async () => {
  let signal;
  const transport = transportWithFetch(async (url, options) => {
    signal = options.signal;
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
  });
  const result = await transport.apiBinary("/synthetic-share-card");
  assert.deepEqual([...result.bytes], [137, 80, 78, 71]);
  assert.equal(signal.aborted, false);
});

test("header rejection cancels transport when the native-style response has no body stream API", async () => {
  let signal, read = false;
  const transport = transportWithFetch(async (url, options) => {
    signal = options.signal;
    return { ok: true, status: 200, headers: new Headers({ "Content-Type": "text/html" }),
      arrayBuffer: async () => { read = true; return new ArrayBuffer(1); } };
  });
  await assert.rejects(transport.apiBinary("/synthetic-share-card"), { kind: "invalid_response" });
  assert.equal(read, false, "a refused body is never consumed");
  assert.equal(signal.aborted, true, "cleanup uses AbortController rather than requiring Response.body.cancel");
});

for (const [label, headers] of [
  ["unsupported content type", { "Content-Type": "text/html" }],
  ["oversized declared body", { "Content-Type": "image/png", "Content-Length": "8388609" }],
]) {
  test(`binary header rejection cancels its unread ${label}`, async () => {
    const f = fixture(headers), caller = new AbortController();
    await assert.rejects(f.apiBinary("/api/share-card/synthetic", { signal: caller.signal, timeoutMs: 10 }), { kind: "invalid_response" });
    assert.equal(f.diagnostics.length, 1, "the safe response error remains visible");
    assert.ok(f.cancelled > 0 || f.aborted > 0, "header rejection owns cancellation");
    caller.abort();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(f.cancelled > 0 || f.aborted > 0,
      "header rejection must retire the still-streaming body; caller cancellation and the cleared deadline cannot do it later");
  });
}

test("request control removes its deadline and caller listener after cooperative completion", async () => {
  const caller = new AbortController();
  let listenerCount = 0;
  const signal = {
    get aborted() { return caller.signal.aborted; },
    get reason() { return caller.signal.reason; },
    addEventListener(...args) { listenerCount++; caller.signal.addEventListener(...args); },
    removeEventListener(...args) { listenerCount--; caller.signal.removeEventListener(...args); },
  };
  const control = createRequestControl({ timeoutMs: 5, callerSignal: signal });
  assert.equal(listenerCount, 1);
  control.cleanup();
  assert.equal(listenerCount, 0);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(control.signal.aborted, false, "completed work retains no live deadline");
  caller.abort();
  assert.equal(control.signal.aborted, false, "completed work retains no caller forwarding listener");
});
