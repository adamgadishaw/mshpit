import assert from "node:assert/strict";
import test from "node:test";

import { uploadBinaryWithProgress } from "./webBinaryUpload.mjs";

function fakeXhr() {
  return {
    upload: {},
    headers: {},
    abortCount: 0,
    open(method, url) { this.method = method; this.url = url; },
    setRequestHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; },
    abort() { this.abortCount += 1; this.onabort?.(); },
  };
}

test("web object PUT preserves signed headers and reports measured byte progress", async () => {
  const xhr = fakeXhr();
  const progress = [];
  const pending = uploadBinaryWithProgress({
    url: "https://storage.example/source.mp4?signature=opaque",
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "If-None-Match": "*" },
    body: { opaque: true },
    expectedBytes: 100,
    onProgress: (value) => progress.push(value),
    xhrFactory: () => xhr,
  });
  assert.equal(xhr.method, "PUT");
  assert.deepEqual(xhr.headers, { "Content-Type": "video/mp4", "If-None-Match": "*" });
  xhr.upload.onprogress({ loaded: 40, total: 100, lengthComputable: true });
  xhr.status = 204;
  xhr.onload();
  assert.deepEqual(await pending, { status: 204 });
  assert.deepEqual(progress, [{ bytesSent: 40, totalBytes: 100, fraction: 0.4 }]);
});

test("web upload cancellation aborts the active request exactly once", async () => {
  const xhr = fakeXhr();
  const controller = new AbortController();
  const pending = uploadBinaryWithProgress({
    url: "https://storage.example/photo.webp?signature=opaque",
    body: { opaque: true },
    signal: controller.signal,
    xhrFactory: () => xhr,
  });
  controller.abort();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  assert.equal(xhr.abortCount, 1);
});

test("an already-aborted upload never creates or sends a browser request", async () => {
  const controller = new AbortController();
  controller.abort();
  let created = 0;
  await assert.rejects(uploadBinaryWithProgress({
    url: "https://storage.example/photo.webp?signature=opaque",
    body: { opaque: true },
    signal: controller.signal,
    xhrFactory: () => { created += 1; return fakeXhr(); },
  }), (error) => error?.name === "AbortError");
  assert.equal(created, 0);
});
