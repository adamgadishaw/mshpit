import assert from "node:assert/strict";
import test from "node:test";
import { readNewsroomImport } from "./newsroomImportClient.mjs";
const file = new File(["Fixture article text"], "article.txt");
class FakeWorker {
  static workers = [];
  constructor(url, options) { this.url = url; this.options = options; this.terminated = false; FakeWorker.workers.push(this); }
  postMessage(message) { this.message = message; }
  terminate() { this.terminated = true; }
}
test("worker results are local-only and terminate the parser after preview extraction", async () => {
  const pending = readNewsroomImport([file], { WorkerClass: FakeWorker });
  const worker = FakeWorker.workers.at(-1);
  assert.equal(worker.url, "/newsroom-import/worker.mjs"); assert.equal(worker.options.type, "module");
  assert.deepEqual(worker.message.files, [file]);
  const result = { articles: [], media: {} };
  worker.onmessage({ data: { sourceName: "worker", targetName: "main", action: "ready", data: {} } });
  assert.equal(worker.terminated, false, "PDF.js startup is not an importer error");
  worker.onmessage({ data: { type: "preview", result } });
  assert.deepEqual(await pending, result); assert.equal(worker.terminated, true);
});
test("account change or navigation cancellation terminates parsing and ignores late messages", async () => {
  const controller = new AbortController();
  const pending = readNewsroomImport([file], { WorkerClass: FakeWorker, signal: controller.signal });
  const worker = FakeWorker.workers.at(-1); controller.abort();
  worker.onmessage({ data: { type: "preview", result: { articles: ["old account"] } } });
  await assert.rejects(pending, { name: "AbortError" }); assert.equal(worker.terminated, true);
});
test("timeout kills the worker and malformed file selection never creates one", async () => {
  await assert.rejects(readNewsroomImport([file], { WorkerClass: FakeWorker, timeoutMs: 5 }), /too long/u);
  assert.equal(FakeWorker.workers.at(-1).terminated, true);
  const count = FakeWorker.workers.length;
  await assert.rejects(readNewsroomImport([file, file, file, file], { WorkerClass: FakeWorker }));
  await assert.rejects(readNewsroomImport([new File(["x"], "macro.docm")], { WorkerClass: FakeWorker }));
  assert.equal(FakeWorker.workers.length, count);
});
