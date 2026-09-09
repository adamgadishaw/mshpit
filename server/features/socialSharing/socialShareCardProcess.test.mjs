import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { fork } from "node:child_process";
import test from "node:test";
import sharp from "sharp";
import {
  createIsolatedSocialShareCardRenderer,
  normalizedShareProcessInput,
  normalizedShareProcessResult,
  SHARE_PROCESS_LIMITS,
} from "./socialShareCardProcess.js";

const model = Object.freeze({
  version: "process-test", variant: "going", label: "GOING", kicker: "A SHOW WORTH COUNTING DOWN TO",
  statement: "A fan is going to The Example.", artist: "The Example", subtitle: "The Last Encore Tour",
  venue: "Massey Hall", place: "Toronto, Canada", date: "OCT 16, 2026", time: "7:30 PM",
  rating: "", quote: "", artwork: [], canonicalUrl: "https://www.mshpit.com/event/test-show",
});

function fakePng() {
  const bytes = Buffer.alloc(100);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  return bytes;
}

function harness() {
  const child = new EventEmitter();
  child.pid = 12345;
  child.kills = [];
  child.kill = (signal) => { child.kills.push(signal); return true; };
  child.send = (input, callback) => { child.input = input; child.sendCallback = callback; };
  let fireTimer;
  let forkOptions;
  let forkCount = 0;
  let clears = 0;
  const render = createIsolatedSocialShareCardRenderer({
    forkImpl(path, args, options) {
      assert.match(path, /socialShareCardWorker\.js$/);
      assert.deepEqual(args, []);
      forkOptions = options;
      forkCount += 1;
      return child;
    },
    setTimer(callback, milliseconds) {
      assert.equal(milliseconds, 3500);
      fireTimer = callback;
      return { unref() {} };
    },
    clearTimer() { clears += 1; },
  });
  return { child, render, timeout: () => fireTimer(), get options() { return forkOptions; },
    get forks() { return forkCount; }, get clears() { return clears; } };
}

async function assertPending(promise) {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "admission must remain held until the child closes");
}

test("share process strips credentials, bounds the child heap, and settles success only after close", async () => {
  const state = harness();
  const artwork = { url: "https://media.mshpit.com/photo.jpg", source: "owned-media" };
  const pending = state.render(model, { artworkBytes: Buffer.alloc(100), artwork });
  assert.equal(state.forks, 1);
  assert.equal(state.options.serialization, "advanced");
  assert.equal(state.options.windowsHide, true);
  assert.deepEqual(state.options.stdio, ["ignore", "ignore", "ignore", "ipc"]);
  assert.deepEqual(state.options.execArgv, ["--max-old-space-size=192", "--max-semi-space-size=8"]);
  assert.equal(state.options.env.UV_THREADPOOL_SIZE, "1");
  assert.equal(state.options.env.VIPS_BLOCK_UNTRUSTED, undefined, "server-generated SVG needs its native loader");
  assert.deepEqual(Object.keys(state.options.env).filter((key) => /KEY|TOKEN|PASSWORD|PIT_|NODE_OPTIONS/.test(key)), []);
  assert.deepEqual(Object.keys(state.child.input).sort(), ["artwork", "artworkBytes", "artworkDataUri", "model"]);
  const bytes = fakePng();
  state.child.emit("message", { ok: true, result: { bytes, artworkApplied: true, artwork } });
  assert.deepEqual(state.child.kills, ["SIGKILL"]);
  await assertPending(pending);
  state.child.emit("close", null, "SIGKILL");
  assert.deepEqual(await pending, { bytes, artworkApplied: true, artwork });
  assert.equal(state.clears, 1);
});

test("a share timeout kills a hung native worker and waits for close before rejecting", async () => {
  const state = harness();
  const pending = state.render(model);
  state.timeout();
  assert.deepEqual(state.child.kills, ["SIGKILL"]);
  await assertPending(pending);
  state.child.emit("message", { ok: true, result: { bytes: fakePng(), artworkApplied: false, artwork: null } });
  state.child.emit("close", null, "SIGKILL");
  await assert.rejects(pending, { code: "renderer_timeout" });
});

test("abort kills a share child and overrides an unclosed successful result", async () => {
  const state = harness();
  const controller = new AbortController();
  const pending = state.render(model, { signal: controller.signal });
  state.child.emit("message", { ok: true, result: { bytes: fakePng(), artworkApplied: false, artwork: null } });
  const reason = new DOMException("Request left", "AbortError");
  controller.abort(reason);
  await assertPending(pending);
  state.child.emit("close", null, "SIGKILL");
  await assert.rejects(pending, (error) => error === reason);
  assert.deepEqual(state.child.kills, ["SIGKILL", "SIGKILL"]);
});

test("pre-aborted and oversized share work never forks", async () => {
  const state = harness();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(state.render(model, { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(state.render(model, { artworkBytes: Buffer.alloc(SHARE_PROCESS_LIMITS.inputBytes + 1) }),
    { code: "renderer_resource_limit" });
  await assert.rejects(state.render({ ...model, artist: "x".repeat(SHARE_PROCESS_LIMITS.metadataBytes + 1) }),
    { code: "renderer_resource_limit" });
  assert.equal(state.forks, 0);
});

test("share spawn, send, protocol, and premature-exit failures are contained", async () => {
  const unavailable = createIsolatedSocialShareCardRenderer({ forkImpl() { throw new Error("spawn failed"); } });
  await assert.rejects(unavailable(model), { code: "renderer_unavailable" });
  for (const kind of ["send", "error", "protocol", "worker", "exit"]) {
    const state = harness();
    const pending = state.render(model);
    if (kind === "send") state.child.sendCallback(new Error("channel failure"));
    if (kind === "error") state.child.emit("error", new Error("spawn failure"));
    if (kind === "protocol") state.child.emit("message", { ok: true, result: { bytes: Buffer.alloc(100), artworkApplied: false } });
    if (kind === "worker") state.child.emit("message", { ok: false, error: { message: "private provider URL must not escape" } });
    await assertPending(pending);
    state.child.emit("close", 1, null);
    await assert.rejects(pending, (error) => {
      assert.equal(error.code, kind === "protocol" ? "renderer_protocol" : kind === "worker" ? "renderer_failed" : "renderer_unavailable");
      assert.doesNotMatch(error.message, /private provider/);
      return true;
    });
  }
});

test("share IPC rejects unbounded output and malformed inputs while keeping typed byte views", () => {
  assert.equal(normalizedShareProcessInput(model, { artworkBytes: Buffer.alloc(SHARE_PROCESS_LIMITS.inputBytes) })
    .artworkBytes.length, SHARE_PROCESS_LIMITS.inputBytes, "metadata does not shrink the existing six-MiB source allowance");
  assert.throws(() => normalizedShareProcessResult({ bytes: Buffer.alloc(SHARE_PROCESS_LIMITS.outputBytes + 1), artworkApplied: false }),
    { code: "renderer_protocol" });
  assert.throws(() => normalizedShareProcessInput(model, { artworkDataUri: "data:image/svg+xml;base64,PHN2Zy8+" }),
    { code: "renderer_protocol" });
  assert.throws(() => normalizedShareProcessInput(model, { artworkBytes: "not bytes" }), { code: "renderer_protocol" });
  const cyclic = { ...model };
  cyclic.self = cyclic;
  assert.throws(() => normalizedShareProcessInput(cyclic), { code: "renderer_protocol" });
  const result = normalizedShareProcessResult({ bytes: new Uint8Array(fakePng()), artworkApplied: false, artwork: null });
  assert.ok(Buffer.isBuffer(result.bytes));
});

test("real isolated share child returns a complete PNG and is closed before resolution", { timeout: 10_000 }, async () => {
  let closed = false;
  const render = createIsolatedSocialShareCardRenderer({ forkImpl(...args) {
    const child = fork(...args);
    child.once("close", () => { closed = true; });
    return child;
  } });
  const result = await render(model);
  assert.equal(closed, true);
  assert.equal(result.artworkApplied, false);
  assert.equal(result.artwork, null);
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);
});

test("real isolated share child prepares owned artwork inside the child", { timeout: 10_000 }, async () => {
  const bytes = await sharp({ create: { width: 64, height: 96, channels: 3, background: "#ab2055" } }).jpeg().toBuffer();
  const artwork = { url: "https://media.mshpit.com/owned-test.jpg", source: "owned-media" };
  const result = await createIsolatedSocialShareCardRenderer()(model, { artworkBytes: bytes, artwork });
  assert.equal(result.artworkApplied, true);
  assert.deepEqual(result.artwork, artwork);
  assert.equal((await sharp(result.bytes).metadata()).width, 1080);
});

test("real share child is terminated on abort before the promise releases ownership", { timeout: 10_000 }, async () => {
  let child;
  let closed = false;
  const controller = new AbortController();
  const render = createIsolatedSocialShareCardRenderer({ forkImpl(...args) {
    child = fork(...args);
    child.once("close", () => { closed = true; });
    return child;
  } });
  const pending = render(model, { signal: controller.signal });
  assert.ok(child.pid);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(closed, true);
});

test("real hung child cannot retain share ownership beyond the kill deadline", { timeout: 10_000 }, async () => {
  let closed = false;
  const render = createIsolatedSocialShareCardRenderer({ forkImpl(path, args, options) {
    // A CPU-bound child cannot service cooperative cancellation, just like a
    // stuck native decoder. Keep the real 3.5-second parent kill deadline.
    const child = fork(path, args, { ...options, execArgv: [
      "--input-type=module", "--eval", "process.once('message', () => { for (;;) {} });",
    ] });
    child.once("close", () => { closed = true; });
    return child;
  } });
  await assert.rejects(render(model), { code: "renderer_timeout" });
  assert.equal(closed, true);
});

test("isolated worker refuses caller-supplied SVG artwork but retains the complete no-photo card", { timeout: 10_000 }, async () => {
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
  for (const input of [{ artworkBytes: bytes }, { artworkDataUri: `data:image/jpeg;base64,${bytes.toString("base64")}` }]) {
    const result = await createIsolatedSocialShareCardRenderer()(model, {
      ...input, artwork: { url: "https://media.mshpit.com/not-a-jpeg.jpg", source: "owned-media" },
    });
    assert.equal(result.artworkApplied, false);
    assert.equal(result.artwork, null);
    assert.equal((await sharp(result.bytes).metadata()).format, "png");
  }
});
