import assert from "node:assert/strict";
import test from "node:test";
import { createVisibleDirectMessageRead } from "./visibleDirectMessageRead.mjs";

const viewport = { x: 10, y: 100, width: 300, height: 200 };
const row = (id, at, extra = {}) => ({ id, at, from: "peer", ...extra });
const visible = (id, bounds = {}) => ({ id, bounds: { x: 20, y: 180, width: 180, height: 40, ...bounds } });
const layout = (y, height = 40) => ({ nativeEvent: { layout: { x: 0, y, width: 300, height } } });

function fixture(messages = [row("a", 1)]) {
  const queued = [], calls = [];
  let current = true;
  const controller = createVisibleDirectMessageRead({
    accountId: "me", otherId: "peer", isCurrent: () => current,
    enqueue: (callback) => queued.push(callback),
    send: (id, signal) => new Promise((resolve, reject) => calls.push({ id, signal, resolve, reject })),
  });
  controller.activate();
  controller.setMessages(messages);
  return {
    controller, queued, calls,
    setCurrent(value) { current = value; },
    observe(rows, token = controller.claim(), measuredViewport = viewport) {
      controller.observeMeasured(token, measuredViewport, rows);
    },
    start() {
      assert.ok(queued.length, "expected a scheduled write");
      return queued.shift()();
    },
    async complete(result = { ok: true }) {
      const pending = this.start();
      calls.at(-1).resolve(result);
      await pending;
    },
  };
}

test("layout, scrolling, candidate selection and content changes never earn a read marker", () => {
  const f = fixture();
  const c = f.controller;
  c.viewportLayout(layout(0, 200));
  c.rowLayout("a", layout(80));
  c.scrolled({ nativeEvent: { layoutMeasurement: { height: 200 }, contentOffset: { y: 0 } } });
  const plan = c.measurementPlan();
  assert.equal(plan.anchorId, "a");
  assert.deepEqual(c.candidatesFromAnchor(plan.token, viewport, visible("a").bounds, "a"), ["a"]);
  c.contentChanged();
  assert.equal(c.snapshot().earned, null);
  assert.equal(f.queued.length, 0);
  assert.equal(f.calls.length, 0);
});

test("final measured row bottoms determine the cursor, even when layout predicts a newer candidate", async () => {
  const f = fixture([row("a", 1), row("b", 2)]);
  const c = f.controller;
  c.viewportLayout(layout(0, 200));
  c.rowLayout("a", layout(80));
  c.rowLayout("b", layout(140));
  const token = c.claim();
  assert.ok(c.candidatesFromAnchor(token, viewport, visible("a").bounds, "a").includes("b"));
  f.observe([visible("a"), visible("b", { y: 290, height: 40 })], token);
  await f.complete();
  assert.deepEqual(f.calls.map(({ id }) => id), ["a"]);
  assert.deepEqual(c.snapshot().acknowledged, { id: "a", createdAt: 1 });
});

test("a tall message is unread until its bottom enters the measured viewport", async () => {
  const f = fixture();
  f.observe([visible("a", { y: 100, height: 450 })]);
  f.observe([visible("a", { y: -350, height: 450 })]);
  assert.equal(f.queued.length, 0, "bottom at the upper edge has not entered the viewport");
  f.observe([visible("a", { y: -150, height: 450 })]);
  await f.complete();
  assert.equal(f.calls[0].id, "a");
});

test("horizontally offscreen rows cannot earn a marker; a visible horizontal intersection can", async () => {
  const f = fixture();
  f.observe([visible("a", { x: 310 })]);
  f.observe([visible("a", { x: -170, width: 180 })]);
  assert.equal(f.queued.length, 0);
  f.observe([visible("a", { x: 309, width: 180 })]);
  await f.complete();
  assert.equal(f.calls.length, 1);
});

test("invalid geometry and unconfirmed, own or unrelated rows cannot earn a marker", () => {
  const f = fixture([
    row("own", 6, { from: "me" }), row("stranger", 5, { from: "stranger" }),
    row("pending", 4, { pending: true }), row("failed", 3, { failed: true }),
    row("bad-time", -1), row("a", 1),
  ]);
  f.observe(["own", "stranger", "pending", "failed", "bad-time", "absent"].map((id) => visible(id)));
  f.observe([visible("a", { height: 0 })]);
  f.observe([visible("a", { x: NaN })]);
  f.observe([visible("a")], f.controller.claim(), { ...viewport, width: 0 });
  assert.equal(f.controller.snapshot().earned, null);
  assert.equal(f.queued.length, 0);
});

test("visible targets use server timestamp and id ordering rather than row or array order", async () => {
  const f = fixture([row("b", 20), row("a", 20), row("z", 10)]);
  f.observe([visible("b"), visible("a"), visible("z")]);
  await f.complete();
  assert.deepEqual(f.calls.map(({ id }) => id), ["b"]);
  f.observe([visible("z")]);
  assert.equal(f.queued.length, 0, "older visible rows cannot move a confirmed cursor backwards");
});

test("geometry changes retire old measurement claims before they can earn a marker", () => {
  const invalidations = [
    (c) => c.rowLayout("a", layout(10)),
    (c) => c.viewportLayout(layout(0, 200)),
    (c) => c.scrolled({ nativeEvent: { layoutMeasurement: { height: 200 }, contentOffset: { y: 20 } } }),
    (c) => c.contentChanged(),
    (c) => c.setMessages([row("a", 1), row("b", 2)]),
  ];
  for (const invalidate of invalidations) {
    const f = fixture();
    const token = f.controller.claim();
    invalidate(f.controller);
    assert.equal(f.controller.valid(token), false);
    f.observe([visible("a")], token);
    assert.equal(f.queued.length, 0);
  }
});

test("failed targets remain earned and retry only on recovery, at most three attempts per episode", async () => {
  const f = fixture();
  f.observe([visible("a")]);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await f.complete({ ok: false });
    assert.equal(f.controller.snapshot().attempts, attempt);
    assert.equal(f.controller.snapshot().failed, true);
    assert.deepEqual(f.controller.snapshot().earned, { id: "a", createdAt: 1 });
    assert.equal(f.controller.snapshot().acknowledged, null);
    f.observe([visible("a")]);
    assert.equal(f.queued.length, 0, "repeated observation must not spin retries");
    f.controller.recover();
    assert.equal(f.queued.length, attempt < 3 ? 1 : 0);
  }
  f.controller.suspend();
  f.controller.activate();
  assert.equal(f.queued.length, 0, "foregrounding does not bypass the automatic retry limit");
  assert.equal(f.calls.length, 3);
});

test("successful explicit refresh can retry the unchanged earned target after three failures", async () => {
  const f = fixture();
  f.observe([visible("a")]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await f.complete({ ok: false });
    f.controller.recover();
  }
  f.controller.recover({ explicit: true });
  f.controller.recover({ explicit: true });
  assert.equal(f.queued.length, 1, "concurrent refresh recoveries coalesce");
  await f.complete();
  assert.deepEqual(f.calls.map(({ id }) => id), ["a", "a", "a", "a"]);
  assert.deepEqual(f.controller.snapshot().acknowledged, { id: "a", createdAt: 1 });
  assert.equal(f.controller.snapshot().failed, false);
});

test("foregrounding after automatic retries are exhausted still permits explicit refresh recovery", async () => {
  const f = fixture();
  f.observe([visible("a")]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await f.complete({ ok: false });
    f.controller.recover();
  }
  f.controller.suspend();
  f.controller.activate();
  assert.equal(f.queued.length, 0, "foregrounding alone must respect the automatic retry limit");
  f.controller.recover({ explicit: true });
  assert.equal(f.queued.length, 1, "manual refresh must still recover the previously earned target");
  await f.complete();
  assert.deepEqual(f.controller.snapshot().acknowledged, { id: "a", createdAt: 1 });
});

test("a thrown send is retained for explicit recovery rather than acknowledged or looped", async () => {
  const f = fixture();
  f.observe([visible("a")]);
  const pending = f.start();
  f.calls[0].reject(new Error("offline"));
  await pending;
  assert.equal(f.controller.snapshot().failed, true);
  assert.equal(f.controller.snapshot().acknowledged, null);
  assert.equal(f.queued.length, 0);
  f.controller.recover();
  await f.complete();
  assert.equal(f.calls.length, 2);
});

test("queued observations coalesce and a later measured target waits for the in-flight write", async () => {
  const f = fixture([row("a", 1), row("b", 2), row("c", 3)]);
  f.observe([visible("a")]);
  f.observe([visible("b")]);
  assert.equal(f.queued.length, 1);
  const pending = f.start();
  assert.equal(f.calls[0].id, "b");
  f.observe([visible("c")]);
  assert.equal(f.queued.length, 0);
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ ok: true });
  await pending;
  await f.complete();
  assert.deepEqual(f.calls.map(({ id }) => id), ["b", "c"]);
  assert.deepEqual(f.controller.snapshot().acknowledged, { id: "c", createdAt: 3 });
});

test("suspension aborts in-flight work and late completion cannot acknowledge or release its replacement", async () => {
  const f = fixture();
  f.observe([visible("a")]);
  const previous = f.start();
  const oldClaim = f.controller.claim();
  f.controller.suspend();
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.controller.valid(oldClaim), false);
  f.controller.activate();
  const replacement = f.start();
  f.calls[0].resolve({ ok: true, readCursor: { id: "unseen", createdAt: 100 } });
  await previous;
  assert.equal(f.controller.snapshot().acknowledged, null);
  assert.equal(f.controller.snapshot().pending, true);
  f.calls[1].resolve({ ok: true });
  await replacement;
  assert.deepEqual(f.controller.snapshot().acknowledged, { id: "a", createdAt: 1 });
});

test("foreground recovery retries earned visibility without a fresh layout and leaves new unseen rows unread", async () => {
  const f = fixture();
  f.observe([visible("a")]);
  await f.complete({ ok: false });
  const oldClaim = f.controller.claim();
  f.controller.suspend();
  f.controller.setMessages([row("a", 1), row("b", 2)]);
  f.controller.activate();
  f.observe([visible("b")], oldClaim);
  await f.complete();
  assert.deepEqual(f.calls.map(({ id }) => id), ["a", "a"]);
  assert.deepEqual(f.controller.snapshot().acknowledged, { id: "a", createdAt: 1 });
  assert.equal(f.queued.length, 0);
  f.observe([visible("b")]);
  await f.complete();
  assert.equal(f.calls.at(-1).id, "b", "new rows require current measured evidence");
});

test("losing the account or route scope blocks queued sends and measurement callbacks", async () => {
  const f = fixture();
  f.observe([visible("a")]);
  f.setCurrent(false);
  assert.equal(f.controller.isEligible(), false);
  await f.start();
  assert.equal(f.calls.length, 0);
  f.controller.activate();
  f.observe([visible("a")]);
  assert.equal(f.queued.length, 0);
  assert.equal(f.controller.snapshot().active, false);
});

test("scope loss during a request prevents a late success from acknowledging it", async () => {
  const f = fixture();
  f.observe([visible("a")]);
  const pending = f.start();
  f.setCurrent(false);
  f.calls[0].resolve({ ok: true });
  await pending;
  assert.equal(f.controller.snapshot().acknowledged, null);
  assert.equal(f.controller.snapshot().active, false);
  assert.equal(f.queued.length, 0);
});

test("removing a target revokes pending measurements and queued or failed retries", async () => {
  const queued = fixture();
  const token = queued.controller.claim();
  queued.observe([visible("a")]);
  queued.controller.setMessages([]);
  queued.observe([visible("a")], token);
  await queued.start();
  assert.equal(queued.calls.length, 0);
  assert.equal(queued.controller.snapshot().earned, null);

  const failed = fixture();
  failed.observe([visible("a")]);
  await failed.complete({ ok: false });
  failed.controller.setMessages([]);
  failed.controller.recover({ explicit: true });
  failed.controller.suspend();
  failed.controller.activate();
  assert.equal(failed.queued.length, 0);
  assert.equal(failed.controller.snapshot().earned, null);
  assert.equal(failed.controller.snapshot().failed, false);
});

test("disposal retires queued work and permanently prevents reactivation", async () => {
  const f = fixture();
  f.observe([visible("a")]);
  f.controller.dispose();
  await f.start();
  f.controller.activate();
  f.observe([visible("a")]);
  assert.equal(f.calls.length, 0);
  assert.equal(f.queued.length, 0);
  assert.equal(f.controller.isEligible(), false);
});
