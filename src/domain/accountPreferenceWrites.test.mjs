import assert from "node:assert/strict";
import test from "node:test";
import { createAccountPreferenceWrites } from "./accountPreferenceWrites.mjs";

test("preference write queue is bounded and releases completed and rejected entries", async () => {
  const queue = createAccountPreferenceWrites({ maxPending: 2 });
  let finish;
  const first = queue.run("account:epoch:field", () => true, () => new Promise((resolve) => { finish = resolve; }));
  const second = queue.run("account:epoch:field", () => true, () => { throw new Error("Explicit failed save"); });
  await assert.rejects(queue.run("other-field", () => true, () => assert.fail("must stay bounded")), /wait/);
  assert.equal(queue.pending, 2);
  finish("saved");
  assert.equal(await first, "saved");
  await assert.rejects(second, /Explicit failed save/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.pending, 0);
  assert.equal(await queue.run("account:epoch:field", () => true, () => "next"), "next");
});
