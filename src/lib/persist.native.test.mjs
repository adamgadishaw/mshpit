import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createJsonPersistence } from "./persistenceAdapter.mjs";
import { AUTH_INTENT_KEY } from "../domain/authTransitions.mjs";
import { purgeAccountLocalPrivacy } from "../domain/accountLocalPrivacy.mjs";
import { emptyNewsroomForm, newsroomArticlePayload, newsroomDraftEnvelope, newsroomDraftStorageKey,
  newsroomSaveAttempt, restoreNewsroomDraft } from "../domain/newsroomComposition.mjs";

// Execute the actual native adapter with a synthetic SQLite backing. Recreating
// it destroys every process-local Map while keeping only durable key writes.
const source = readFileSync(new URL("./persist.native.js", import.meta.url), "utf8");
const body = parse(source, { sourceType: "module" }).program.body
  .filter(node => node.type !== "ImportDeclaration")
  .map(node => node.type === "ExportNamedDeclaration" ? node.declaration : node)
  .map(node => source.slice(node.start, node.end)).join("\n");
const loadNativeAdapter = new Function("Storage", "createJsonPersistence", "AUTH_INTENT_KEY", `${body}\nreturn { load, save, remove };`);
function device() {
  const disk = new Map();
  const storage = { getItemSync: key => disk.get(key) ?? null,
    setItemSync: (key, value) => disk.set(key, value), removeItemSync: key => disk.delete(key) };
  return { disk, restart: () => loadNativeAdapter(storage, createJsonPersistence, AUTH_INTENT_KEY) };
}

test("native process recreation retains the exact uncertain article and retry key without media files or URLs", () => {
  const f = device(), first = f.restart(), accountId = "synthetic-editor";
  const form = { ...emptyNewsroomForm(), headline: "Synthetic artist announces new music", category: "release",
    body: "The reported new album and its creative context. ".repeat(150),
    sources: [{ name: "NME", url: "https://www.nme.com/synthetic" }, { name: "Stereogum", url: "https://www.stereogum.com/synthetic" },
      { name: "Pitchfork", url: "https://pitchfork.com/synthetic" }, { name: "Yonhap", url: "https://en.yna.co.kr/synthetic" }],
    photo: { assetId: "ma_synthetic_photo", uri: "file:///private-original", file: "private-bytes" } };
  const attempt = newsroomSaveAttempt(null, newsroomArticlePayload(form), () => "synthetic-save-key-0001");
  const key = newsroomDraftStorageKey(accountId);
  first.save(key, newsroomDraftEnvelope(accountId, form, attempt, null, 100));
  first.save("pit.feed.v2.synthetic-editor", { private: "volatile feed" });
  const restarted = f.restart();
  const restored = restoreNewsroomDraft(accountId, restarted.load(key, null), 101);
  assert.equal(restored.form.body, form.body);
  assert.equal(restored.form.category, "release");
  assert.deepEqual(restored.form.sources, form.sources);
  assert.deepEqual(restored.form.photo, { assetId: "ma_synthetic_photo" });
  assert.equal(newsroomSaveAttempt(restored.attempt, newsroomArticlePayload(restored.form), () => assert.fail("Do not rotate a retry key")).key, attempt.key);
  assert.equal(restarted.load("pit.feed.v2.synthetic-editor", null), null, "large caches still remain volatile");
  assert.equal(f.disk.get(key).includes("private-original"), false);
  assert.equal(f.disk.get(key).includes("private-bytes"), false);
  assert.equal(restoreNewsroomDraft("another-editor", restarted.load(key), 101), null);
});

test("logout physically removes the native Newsroom draft and retry key without erasing another account", () => {
  const f = device(), first = f.restart();
  for (const accountId of ["editor/a", "editor-b"]) first.save(newsroomDraftStorageKey(accountId),
    newsroomDraftEnvelope(accountId, { ...emptyNewsroomForm(), body: "Private article" }, { key: "private-retry-key", payload: "{}" }, null, 100));
  purgeAccountLocalPrivacy({ accountId: "editor/a", ...first });
  const restarted = f.restart();
  assert.equal(f.disk.has(newsroomDraftStorageKey("editor/a")), false);
  assert.equal(restarted.load(newsroomDraftStorageKey("editor/a"), null), null);
  assert.equal(restoreNewsroomDraft("editor-b", restarted.load(newsroomDraftStorageKey("editor-b")), 101).form.body, "Private article");
});

test("native restart retains a maximum-length escaped article and migrates an old uncertain receipt without rotating it", () => {
  const words = "reported music ".repeat(1000);
  const form = { ...emptyNewsroomForm(), headline: "Synthetic band announces a new album", summary: "Reported creative details for the new record.",
    body: words + String.fromCharCode(34, 92).repeat((60000 - words.length) / 2), category: "release",
    photo: { assetId: "ma_synthetic_photo", uri: "file:///private-original" } };
  const attempt = newsroomSaveAttempt(null, newsroomArticlePayload(form), () => "native-long-retry-0001");
  assert.ok(attempt.payload.length > 100000);
  for (const legacy of [false, true]) {
    const f = device(), first = f.restart(), key = newsroomDraftStorageKey("editor");
    const envelope = newsroomDraftEnvelope("editor", form, attempt, attempt.payload, 100);
    if (legacy) { envelope.attempt.payload = attempt.payload.slice(0, 100000); envelope.savedPayload = envelope.attempt.payload; }
    first.save(key, envelope);
    const second = f.restart(), restored = restoreNewsroomDraft("editor", second.load(key), 101);
    assert.equal(restored.form.body, form.body);
    const retry = newsroomSaveAttempt(restored.attempt, newsroomArticlePayload(restored.form), () => assert.fail("Restart must retain the original receipt"));
    assert.equal(retry.key, attempt.key); assert.equal(retry.payload, attempt.payload);
    assert.equal(restored.savedPayload, legacy ? null : attempt.payload);
    second.save(key, newsroomDraftEnvelope("editor", restored.form, retry, restored.savedPayload, 102));
    assert.equal(restoreNewsroomDraft("editor", f.restart().load(key), 103).attempt.payload, attempt.payload);
    purgeAccountLocalPrivacy({ accountId: "editor", ...second });
    assert.equal(f.restart().load(key, null), null);
  }
});
