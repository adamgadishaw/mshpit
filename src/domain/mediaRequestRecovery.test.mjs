import assert from "node:assert/strict";
import test from "node:test";
import { boundedMediaRequest, mediaRequestWasTemporary, recoverMediaRequest, waitForMediaRecovery } from "./mediaRequestRecovery.mjs";

const temporary = () => Object.assign(new Error("Private storage reconnecting"), { status: 503, serverCode: "MEDIA_STORAGE_UNAVAILABLE", retryable: true });

test("media recovery retries only typed temporary transport/service failures", () => {
  for (const error of [temporary(), { status: 502 }, { status: 504 }, { status: 408 }, { status: 0, code: "PIT-NET-001" }, { status: 0, code: "PIT-NET-002" }]) {
    assert.equal(mediaRequestWasTemporary(error), true);
  }
  for (const error of [new TypeError("bad input"), new Error("unknown"), { status: 400 }, { status: 401 }, { status: 403 }, { status: 404 }, { status: 409 }, { status: 415 }, { status: 422 }, { status: 429 },
    { status: 503, retryable: false }, { status: 503, stale: true }, { status: 503, name: "AbortError" }, { status: 503, serverCode: "IDENTITY_CHANGED" }, { code: "PIT-REQ-001" }, { code: "MEDIA_UPLOAD_QUOTA_EXCEEDED" }]) {
    assert.equal(mediaRequestWasTemporary(error), false, JSON.stringify(error));
  }
});

test("temporary control-plane failure retries at two and five seconds with at most three attempts", async () => {
  let calls = 0, clock = 0;
  const waits = [], retries = [];
  const result = await recoverMediaRequest(async () => { calls += 1; if (calls < 3) throw temporary(); return "ready"; }, {
    now: () => clock, wait: async (ms) => { waits.push(ms); clock += ms; }, onRetry: (value) => retries.push(value.attempt),
  });
  assert.equal(result, "ready"); assert.equal(calls, 3);
  assert.deepEqual(waits, [2_000, 5_000]); assert.deepEqual(retries, [2, 3]);
  calls = 0;
  await assert.rejects(recoverMediaRequest(async () => { calls += 1; throw temporary(); }, { wait: async () => {} }), { status: 503 });
  assert.equal(calls, 3);
});

test("auth, permission, validation and unknown callback errors are never retried", async () => {
  for (const error of [{ status: 401 }, { status: 403 }, { status: 409, code: "IDENTITY_CHANGED" }, { status: 422 }, { status: 429 }, new TypeError("bad local data")]) {
    let calls = 0;
    await assert.rejects(recoverMediaRequest(async () => { calls += 1; throw error; }, { wait: async () => { throw new Error("Must not wait"); } }), (value) => value === error);
    assert.equal(calls, 1);
  }
});

test("cancellation during backoff cannot issue another request", async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(recoverMediaRequest(async () => { calls += 1; throw temporary(); }, {
    signal: controller.signal, wait: async () => { controller.abort(); },
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("the total recovery budget excludes any request after its deadline", async () => {
  let clock = 0, calls = 0;
  await assert.rejects(recoverMediaRequest(async () => { calls += 1; clock += 29_500; throw temporary(); }, {
    now: () => clock, wait: async () => { throw new Error("No budget to retry"); },
  }), { status: 503 });
  assert.equal(calls, 1);
});

test("ignored abort still settles immediately and a late response cannot publish success", async () => {
  const controller = new AbortController(); let release, childSignal;
  const pending = boundedMediaRequest(({ signal }) => { childSignal = signal; return new Promise((done) => { release = done; }); }, { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { name: "AbortError" });
  assert.equal(childSignal.aborted, true); release("late ready");
  await new Promise((done) => setImmediate(done));
});

test("a stalled media adapter cannot strand the caller beyond its independent deadline", async () => {
  let childSignal;
  await assert.rejects(boundedMediaRequest(({ signal }) => { childSignal = signal; return new Promise(() => {}); }, { timeoutMs: 10 }), { code: "PIT-NET-002" });
  assert.equal(childSignal.aborted, true);
});

test("already-cancelled requests and retry delays never start work", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(boundedMediaRequest(() => { calls += 1; }, { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(waitForMediaRecovery(5_000, controller.signal), { name: "AbortError" });
  assert.equal(calls, 0);
});
