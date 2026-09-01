import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  landingMediaPostIdFromPath,
  serveLandingMediaRequest,
} from "./landingMediaDelivery.js";

function responseRecorder() {
  const stream = new PassThrough();
  const chunks = [];
  stream.status = null;
  stream.headers = null;
  stream.writeHead = (status, headers) => {
    stream.status = status;
    stream.headers = headers;
    return stream;
  };
  stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  return {
    stream,
    body: () => Buffer.concat(chunks),
    ended: new Promise((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
    }),
  };
}

test("landing media path accepts only one bounded opaque post id", () => {
  assert.equal(landingMediaPostIdFromPath("/media/landing/post_123"), "post_123");
  assert.equal(landingMediaPostIdFromPath("/media/landing/post_123/extra"), null);
  assert.equal(landingMediaPostIdFromPath("/media/landing/../secret"), null);
  assert.equal(landingMediaPostIdFromPath("https://tracker.example/photo"), null);
});

test("landing image delivery streams a verified image through first-party headers", async () => {
  const recorder = responseRecorder();
  const bytes = Buffer.from("verified-image");
  await serveLandingMediaRequest({
    req: { method: "GET", headers: {} },
    res: recorder.stream,
    pathname: "/media/landing/post_123",
    viewerId: "u_viewer",
    securityHeaders: { "X-Content-Type-Options": "nosniff" },
    resolveSource: ({ postId, viewerId }) => {
      assert.equal(postId, "post_123");
      assert.equal(viewerId, "u_viewer");
      return { url: "https://media.example/users/u/post/photo.webp" };
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://media.example/users/u/post/photo.webp");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Accept, "image/webp,image/png,image/jpeg");
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "content-length": String(bytes.length),
          etag: "\"landing-v1\"",
        },
      });
    },
  });
  await recorder.ended;

  assert.equal(recorder.stream.status, 200);
  assert.equal(recorder.stream.headers["Content-Type"], "image/webp");
  assert.equal(recorder.stream.headers["Cache-Control"], "private, max-age=300, must-revalidate");
  assert.equal(recorder.stream.headers.Vary, "Cookie");
  assert.equal(recorder.stream.headers["X-Content-Type-Options"], "nosniff");
  assert.deepEqual(recorder.body(), bytes);
});

test("landing image delivery refuses withdrawn and non-image sources", async () => {
  const withdrawn = responseRecorder();
  await serveLandingMediaRequest({
    req: { method: "GET", headers: {} },
    res: withdrawn.stream,
    pathname: "/media/landing/post_123",
    resolveSource: () => null,
  });
  await withdrawn.ended;
  assert.equal(withdrawn.stream.status, 404);

  const invalid = responseRecorder();
  await serveLandingMediaRequest({
    req: { method: "HEAD", headers: {} },
    res: invalid.stream,
    pathname: "/media/landing/post_123",
    resolveSource: () => ({ url: "https://media.example/file" }),
    fetchImpl: async () => new Response(null, {
      status: 200,
      headers: { "content-type": "text/html", "content-length": "20" },
    }),
  });
  await invalid.ended;
  assert.equal(invalid.stream.status, 502);
  assert.equal(invalid.stream.headers["Cache-Control"], "no-store");
});

test("landing image delivery rejects an oversized verified derivative before streaming", async () => {
  const recorder = responseRecorder();
  await serveLandingMediaRequest({
    req: { method: "HEAD", headers: {} },
    res: recorder.stream,
    pathname: "/media/landing/post_oversized",
    resolveSource: () => ({ url: "https://media.example/users/u/post/large.jpg" }),
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Accept.includes("image/avif"), false);
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": String((12 * 1024 * 1024) + 1),
        },
      });
    },
  });
  await recorder.ended;
  assert.equal(recorder.stream.status, 502);
  assert.equal(recorder.stream.headers["Cache-Control"], "no-store");
});

test("landing image delivery times out a stalled upstream request", async () => {
  const recorder = responseRecorder();
  await serveLandingMediaRequest({
    req: { method: "GET", headers: {} },
    res: recorder.stream,
    pathname: "/media/landing/post_stalled",
    resolveSource: () => ({ url: "https://media.example/users/u/post/stalled.jpg" }),
    timeoutMs: 15,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  await recorder.ended;
  assert.equal(recorder.stream.status, 502);
  assert.equal(recorder.stream.headers["Cache-Control"], "no-store");
  assert.equal(recorder.body().toString(), "Photo unavailable.");
});
