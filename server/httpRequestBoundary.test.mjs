import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedRequestListener } from "./httpRequestBoundary.js";

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("owned HTTP listeners contain synchronous and asynchronous request failures", async () => {
  const unhandled = [];
  const observeUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", observeUnhandled);
  try {
    for (const handler of [
      () => { throw new Error("synchronous request failure"); },
      async () => { throw new Error("asynchronous request failure"); },
    ]) {
      const reported = [];
      const response = {
        destroyed: false,
        writableEnded: false,
        destroyCalls: 0,
        destroy() { this.destroyed = true; this.destroyCalls += 1; },
      };
      const listener = createOwnedRequestListener(handler, {
        onRejected(error) { reported.push(error.message); },
      });

      assert.equal(listener({ method: "GET" }, response), undefined);
      await nextTurn();
      assert.equal(reported.length, 1);
      assert.equal(response.destroyCalls, 1);
    }
    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener("unhandledRejection", observeUnhandled);
  }
});

test("the final HTTP boundary tolerates a failing reporter and settled response", async () => {
  const unfinished = {
    destroyed: false,
    writableEnded: false,
    destroyCalls: 0,
    destroy() { this.destroyed = true; this.destroyCalls += 1; },
  };
  createOwnedRequestListener(async () => { throw new Error("route failed"); }, {
    onRejected() { throw new Error("reporter failed"); },
  })({}, unfinished);
  await nextTurn();
  assert.equal(unfinished.destroyCalls, 1);

  const settled = {
    destroyed: false,
    writableEnded: true,
    destroyCalls: 0,
    destroy() { this.destroyCalls += 1; },
  };
  createOwnedRequestListener(async () => { throw new Error("late failure"); })({}, settled);
  await nextTurn();
  assert.equal(settled.destroyCalls, 0);
});
