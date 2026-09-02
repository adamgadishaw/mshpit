import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BoundedJsonResponseError,
  readBoundedJsonResponse,
} from "./boundedJsonResponse.js";

test("bounded JSON reader parses streamed UTF-8 below its byte ceiling", async () => {
  const payload = { artist: "Beyoncé", shows: [1, 2, 3] };
  const response = new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
  assert.deepEqual(await readBoundedJsonResponse(response, { maxBytes: 128 }), payload);
});

test("bounded JSON reader rejects declared and streamed oversized bodies", async () => {
  let opened = false;
  const declared = {
    headers: new Headers({ "content-length": "65" }),
    body: {
      async cancel() {},
      getReader() {
        opened = true;
        throw new Error("must not read");
      },
    },
  };
  await assert.rejects(
    readBoundedJsonResponse(declared, { maxBytes: 64 }),
    (error) => error instanceof BoundedJsonResponseError
      && error.code === "response_too_large"
      && error.receivedBytes === 65,
  );
  assert.equal(opened, false);

  const streamed = new Response(JSON.stringify({ value: "x".repeat(200) }));
  await assert.rejects(
    readBoundedJsonResponse(streamed, { maxBytes: 64 }),
    (error) => error instanceof BoundedJsonResponseError
      && error.code === "response_too_large"
      && error.receivedBytes > 64,
  );

  await assert.rejects(
    readBoundedJsonResponse({
      headers: new Headers({ "content-length": "1e3" }),
      body: { async cancel() {} },
    }, { maxBytes: 2_000 }),
    (error) => error instanceof BoundedJsonResponseError && error.code === "invalid_content_length",
  );
});

test("bounded JSON reader keeps invalid JSON and cancellation distinguishable", async () => {
  await assert.rejects(
    readBoundedJsonResponse(new Response("{"), { maxBytes: 64 }),
    (error) => error instanceof BoundedJsonResponseError && error.code === "invalid_json",
  );

  const controller = new AbortController();
  controller.abort(new DOMException("Caller left", "AbortError"));
  await assert.rejects(
    readBoundedJsonResponse(new Response("{}"), { signal: controller.signal }),
    (error) => error?.name === "AbortError" && error?.message === "Caller left",
  );
});

test("json-only injected adapters remain size checked", async () => {
  assert.deepEqual(
    await readBoundedJsonResponse({ json: async () => ({ ok: true }) }, { maxBytes: 32 }),
    { ok: true },
  );
  await assert.rejects(
    readBoundedJsonResponse({ json: async () => ({ value: "x".repeat(100) }) }, { maxBytes: 32 }),
    (error) => error instanceof BoundedJsonResponseError && error.code === "response_too_large",
  );
  const circular = {};
  circular.self = circular;
  await assert.rejects(
    readBoundedJsonResponse({ json: async () => circular }, { maxBytes: 32 }),
    (error) => error instanceof BoundedJsonResponseError && error.code === "invalid_json",
  );
});

test("fixed-origin provider readers use the shared bounded parser", () => {
  for (const relative of [
    "./musicProviders.js",
    "./tourdates.js",
    "./artistTourDateDemandRefresh.js",
    "./musicBrainzGenreRefresh.js",
    "./wikidataChannels.js",
    "./api.js",
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /readBoundedJsonResponse/u, `${relative} must use the bounded response reader`);
    assert.doesNotMatch(source, /\.json\(\)/u, `${relative} must not allocate provider JSON without a byte ceiling`);
  }
});
