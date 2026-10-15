import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogBatch } from "./catalogBatchState.mjs";
import { catalogBatchStorageKey, purgeAccountLocalPrivacy } from "../../domain/accountLocalPrivacy.mjs";

const draft = (key = "artist") => ({ type: "artist", key, expectedRevision: 0, expectedHash: "a".repeat(64), summary: "A sourced sentence.", sources: [{ label: "Source", url: "https://mshpit.com/source" }], reason: "Fill missing text", hidden: false });
function fixture() {
  const values = new Map(); let serial = 0, at = 1000;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const open = (accountId = "a") => createCatalogBatch({ accountId, storage, now: () => at, newKey: () => `operation_00000000${++serial}` });
  const batch = open();
  const review = controller => controller.review(controller.get().entries.map((entry, index) => ({ index, ok: true, draft: entry.draft, current: { identity: { name: entry.draft.key } } })));
  const calls = [], service = {
    save: async (value, key) => { calls.push([value, key]); return { ok: true, revision: 1, auditId: key, saved: { type: value.type, key: value.key } }; },
    publicText: async value => ({ text: { summary: value.summary, sources: value.sources, revision: 1 } }),
  };
  return { values, storage, open, batch, review, calls, service, time: value => { at = value; } };
}

test("durable batches survive reload, require renewed review, isolate accounts and preserve logout privacy", () => {
  const f = fixture(); f.batch.stage(draft()); f.review(f.batch);
  const id = f.batch.get().entries[0].id;
  assert.equal(f.open().get().entries[0].id, id); assert.equal(f.open().get().entries[0].status, "draft");
  assert.equal(f.open("b").get().entries.length, 0);
  f.open("b").stage(draft("other"));
  purgeAccountLocalPrivacy({ accountId: "a", load: () => null, save() {}, remove: key => f.values.delete(key) });
  assert.equal(f.values.has(catalogBatchStorageKey("a")), false); assert.equal(f.open("b").get().entries.length, 1);
});

test("editing replaces only the exact entity with a fresh key and ten is a batch limit", async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) f.batch.stage(draft(String(i)));
  assert.throws(() => f.batch.stage(draft("11")), /before adding/);
  const id = f.batch.get().entries[0].id; f.batch.stage({ ...draft("0"), summary: "Changed sentence." });
  assert.equal(f.batch.get().entries.length, 10); assert.notEqual(f.batch.get().entries.at(-1).id, id);
  f.review(f.batch); await f.batch.publish({ service: f.service });
  assert.equal(f.calls.length, 10); f.batch.stage(draft("11")); assert.equal(f.batch.get().entries.length, 1);
});

test("partial failure stops sequential publication and uncertain retry after reload uses identical key and body", async () => {
  const f = fixture(); for (const key of ["first", "second", "third"]) f.batch.stage(draft(key)); f.review(f.batch);
  const realSave = f.service.save;
  f.service.save = async (...args) => { if (args[0].key === "second") { f.calls.push(args); throw new Error("Connection lost after save"); } return realSave(...args); };
  await assert.rejects(f.batch.publish({ service: f.service }), /Connection lost/);
  assert.equal(f.calls.length, 2); assert.equal(f.batch.get().receipts.length, 1);
  const failed = f.batch.get().entries[0]; assert.equal(failed.status, "uncertain");
  const restored = f.open(); assert.throws(() => restored.stage(draft("second")), /uncertain/); assert.throws(() => restored.remove(failed.id), /uncertain/);
  assert.throws(() => f.review(restored), /uncertain/);
  f.service.save = realSave; await restored.publish({ service: f.service, id: failed.id });
  assert.deepEqual(f.calls[2].slice(0, 2), f.calls[1].slice(0, 2));
  assert.equal(restored.get().receipts.length, 2); assert.equal(restored.get().entries[0].draft.key, "third");
});

test("storage failure prevents POST and a different window or logout prevents stale mutation", async () => {
  const f = fixture(); f.batch.stage(draft()); f.review(f.batch);
  f.storage.setItem = () => { throw new Error("Disk full"); };
  await assert.rejects(f.batch.publish({ service: f.service }), /Disk full/); assert.equal(f.calls.length, 0);
  f.values.delete(catalogBatchStorageKey("a"));
  assert.throws(() => f.batch.stage(draft("new")), /another window|signed out/);
});

test("receipt replay is historical and a public mismatch or failed verification stops subsequent writes", async () => {
  for (const failure of [false, true]) {
    const f = fixture(); f.batch.stage(draft("first")); f.batch.stage(draft("second")); f.review(f.batch);
    f.service.publicText = async () => { if (failure) throw new Error("Read offline"); return { text: null }; };
    await assert.rejects(f.batch.publish({ service: f.service }), failure ? /Read offline/ : /public text differs/);
    assert.equal(f.calls.length, 1); const record = f.open().get().receipts[0];
    assert.equal(record.receipt.auditId, f.calls[0][1]); assert.equal(record.verification, failure ? "unverified" : "changed");
  }
});

test("account change and interrupted inflight save cannot continue or recreate purged data", async () => {
  const f = fixture(); f.batch.stage(draft("first")); f.batch.stage(draft("second")); f.review(f.batch);
  let finish, active = true;
  f.service.save = () => new Promise(resolve => { finish = resolve; });
  const pending = f.batch.publish({ service: f.service, current: () => active });
  assert.equal(f.open().get().entries[0].status, "uncertain");
  active = false; f.values.delete(catalogBatchStorageKey("a")); finish({ ok: true });
  await assert.rejects(pending, /account or editor changed/); assert.equal(f.values.size, 0);
});

test("uncertain retry expires at seven days and definitive conflict requires review", async () => {
  const f = fixture(); f.batch.stage(draft()); f.review(f.batch);
  f.service.save = async () => { throw new Error("Offline"); };
  await assert.rejects(f.batch.publish({ service: f.service }), /Offline/);
  f.time(1000 + 7 * 86400_000);
  const restored = f.open(); await assert.rejects(restored.publish({ service: f.service, id: restored.get().entries[0].id }), /seven-day/);
  const other = fixture(); other.batch.stage(draft()); other.review(other.batch);
  other.service.save = async () => { throw Object.assign(new Error("Changed page"), { status: 409, serverCode: "CONFLICT" }); };
  await assert.rejects(other.batch.publish({ service: other.service }), /Changed page/);
  assert.equal(other.batch.get().entries[0].status, "conflict"); other.batch.remove(other.batch.get().entries[0].id);
});

test("authorization and rate-limit rejection of an uncertain retry never unlock its key or draft", async () => {
  for (const status of [403, 429]) {
    const f = fixture(); f.batch.stage(draft()); f.review(f.batch);
    f.service.save = async () => { throw new Error("Connection lost"); };
    await assert.rejects(f.batch.publish({ service: f.service }), /Connection lost/);
    const recovered = f.open(), entry = recovered.get().entries[0];
    f.service.save = async () => { throw Object.assign(new Error("Rejected before receipt lookup"), { status }); };
    await assert.rejects(recovered.publish({ service: f.service, id: entry.id }), /Rejected/);
    assert.equal(recovered.get().entries[0].status, "uncertain");
    assert.throws(() => recovered.stage(draft()), /uncertain/); assert.throws(() => recovered.remove(entry.id), /uncertain/);
    assert.equal(recovered.get().entries[0].id, entry.id);
  }
});

test("client identity-generation failure after a committed response remains uncertain", async () => {
  const f = fixture(); f.batch.stage(draft()); f.review(f.batch);
  f.service.save = async () => { throw Object.assign(new Error("Account changed after response"), { status: 409, serverCode: "IDENTITY_CHANGED" }); };
  await assert.rejects(f.batch.publish({ service: f.service }), /Account changed/);
  assert.equal(f.open().get().entries[0].status, "uncertain");
  assert.throws(() => f.batch.remove(null), /uncertain/);
});
