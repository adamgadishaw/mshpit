import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const source = readFileSync(new URL("./AccountSwitcher.jsx", import.meta.url), "utf8");
let initializer;
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "VariableDeclarator" && node.id?.name === "perform") initializer = node.init;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(parse(source, { sourceType: "module", plugins: ["jsx"] }).program);
assert.ok(initializer);

function fixture(switchAccount) {
  const request = { current: null }, mounted = { current: true }, owner = { current: "alice" };
  const calls = { back: 0, busy: [], errors: [] };
  const bindings = {
    request, mounted, owner, session: { id: "alice" }, AbortController,
    setBusy: (value) => calls.busy.push(value), setError: (value) => calls.errors.push(value),
    switchAccount, onClose: () => calls.back++, password: "",
    connectLinkedAccounts: () => assert.fail("Unexpected connect request"),
    loadLinkedAccounts: () => assert.fail("Unexpected load request"),
  };
  const perform = new Function(...Object.keys(bindings), `return (${source.slice(initializer.start, initializer.end)});`)(...Object.values(bindings));
  return { request, mounted, owner, calls, perform };
}

test("successful real switch callback never races the App account-boundary reset with Back", async () => {
  for (const boundaryCommitted of [false, true]) {
    const f = fixture(async (target, options) => {
      assert.equal(target, "bob");
      assert.equal(options.expectedAccountId, "alice");
      assert.equal(options.signal, f.request.current.signal);
      if (boundaryCommitted) { f.owner.current = "bob"; f.mounted.current = false; }
      return { ok: true };
    });
    await f.perform("switch", "bob");
    assert.equal(f.calls.back, 0, "only the authoritative App account boundary chooses the next page");
    assert.equal(f.request.current, null);
    assert.deepEqual(f.calls.errors, [""]);
  }
});

test("failed and cancelled switches remain local and do not navigate or display stale errors", async () => {
  const failed = fixture(async () => ({ ok: false, error: "Switch unavailable" }));
  await failed.perform("switch", "bob");
  assert.equal(failed.calls.back, 0);
  assert.equal(failed.calls.errors.at(-1), "Switch unavailable");
  assert.equal(failed.calls.busy.at(-1), false);
  const cancelled = fixture(async () => {
    cancelled.request.current.abort();
    cancelled.mounted.current = false;
    return { ok: false, error: "Late cancelled result" };
  });
  await cancelled.perform("switch", "bob");
  assert.equal(cancelled.calls.back, 0);
  assert.deepEqual(cancelled.calls.errors, [""]);
  assert.equal(cancelled.request.current, null);
  assert.match(source, /mounted\.current = false; request\.current\?\.abort\(\)/, "leaving an unfinished switch still cancels its authentication intent");
  assert.match(source, /<SheetHeader title="Switch account" onClose=\{onClose\}/, "the explicit Back action remains available outside an active request");
});
