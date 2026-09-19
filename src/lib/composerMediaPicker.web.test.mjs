import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launchComposerMediaLibrary, releaseComposerPickerAsset } from "./composerMediaPicker.web.mjs";
import { MEDIA_POST_MAX_ATTACHMENTS } from "../domain/mediaUploadPolicy.mjs";

function browser({ failUrlAt = 0, clickError = null } = {}) {
  const inputs = [], allocated = [], revoked = [];
  const document = {
    body: { appendChild(input) { input.attached = true; } },
    createElement(tag) {
      assert.equal(tag, "input", "the picker must not decode images or videos");
      const handlers = new Map();
      const input = { style: {}, files: [], attributes: {}, attached: false, clicks: 0,
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(event, handler) { handlers.set(event, handler); },
        removeEventListener(event) { handlers.delete(event); },
        remove() { this.attached = false; },
        click() { this.clicks += 1; if (clickError) throw clickError; },
        dispatch(event) { handlers.get(event)?.(); },
        get listeners() { return handlers.size; } };
      inputs.push(input); return input;
    },
  };
  const urlApi = {
    createObjectURL(file) {
      if (allocated.length + 1 === failUrlAt) throw new Error("allocation unavailable");
      const url = `blob:test-${inputs.length}-${allocated.length}`;
      allocated.push({ url, file }); return url;
    },
    revokeObjectURL(url) { revoked.push(url); },
  };
  return { document, urlApi, inputs, allocated, revoked };
}
const file = (name, type = "", size = 1) => ({ name, type, size,
  arrayBuffer() { throw new Error("picker must not read file bytes"); },
  slice() { throw new Error("picker must not read file bytes"); } });
const options = { allowsMultipleSelection: true, selectionLimit: 20 };

test("web selection resolves directly with File handles even when Safari cannot decode their metadata", async () => {
  const env = browser();
  const promise = launchComposerMediaLibrary(options, env);
  const input = env.inputs[0];
  assert.equal(input.clicks, 1, "file input opens synchronously inside the user gesture");
  input.files = [file("IMG.HEIC", "image/heic", 8_000_000), file("IMG.MOV", "video/quicktime", 80_000_000), file("blank-mime.mp4")];
  input.dispatch("change");
  const result = await promise;
  assert.equal(result.canceled, false);
  assert.equal(result.assets.length, 3);
  assert.deepEqual(result.assets.map((asset) => asset.type), ["image", "video", "video"]);
  assert.equal(result.assets[0].file, input.files[0]);
  assert.equal(result.assets[0].width, 0);
  assert.equal(result.assets[1].duration, undefined, "unknown duration is not fabricated");
  assert.equal(input.attached, false);
  assert.equal(input.listeners, 0);
  result.assets.forEach(releaseComposerPickerAsset);
});

test("web selection honors available post slots before any object URLs are allocated", async () => {
  const env = browser();
  const promise = launchComposerMediaLibrary({ ...options, selectionLimit: 2 }, env);
  env.inputs[0].files = Array.from({ length: 500 }, (_, index) => file(`${index}.mov`, "video/quicktime", 100_000_000));
  env.inputs[0].dispatch("change");
  const result = await promise;
  assert.equal(env.allocated.length, 2);
  assert.equal(result.omittedCount, 498);
  result.assets.forEach(releaseComposerPickerAsset);
});

test("selection hard cap cannot exceed the shared post maximum", async () => {
  const env = browser();
  const promise = launchComposerMediaLibrary({ ...options, selectionLimit: 1_000_000 }, env);
  env.inputs[0].files = Array.from({ length: MEDIA_POST_MAX_ATTACHMENTS + 1 }, () => file("photo.jpg", "image/jpeg"));
  env.inputs[0].dispatch("change");
  const result = await promise;
  assert.equal(result.assets.length, MEDIA_POST_MAX_ATTACHMENTS);
  result.assets.forEach(releaseComposerPickerAsset);
});

test("cancel, empty change, and account abort settle and remove hidden picker listeners", async () => {
  for (const event of ["cancel", "change", "abort"]) {
    const env = browser(), controller = new AbortController();
    const promise = launchComposerMediaLibrary(options, { ...env, signal: controller.signal });
    if (event === "abort") controller.abort(); else env.inputs[0].dispatch(event);
    assert.deepEqual(await promise, { canceled: true, assets: null, ...(event === "change" ? { omittedCount: 0 } : {}) });
    assert.equal(env.inputs[0].attached, false);
    assert.equal(env.inputs[0].listeners, 0);
    env.inputs[0].files = [file("late.mov", "video/quicktime")];
    env.inputs[0].dispatch("change");
    assert.equal(env.allocated.length, 0, "a canceled picker cannot revive late files");
  }
});

test("cancel followed by selecting the same file creates a fresh, working input", async () => {
  const env = browser();
  const first = launchComposerMediaLibrary(options, env);
  env.inputs[0].dispatch("cancel"); await first;
  const second = launchComposerMediaLibrary(options, env);
  env.inputs[1].files = [file("same.jpg", "image/jpeg")];
  env.inputs[1].dispatch("change");
  const result = await second;
  assert.equal(result.assets.length, 1);
  result.assets.forEach(releaseComposerPickerAsset);
});

test("failed allocation revokes earlier handles and click failure removes its input", async () => {
  const env = browser({ failUrlAt: 2 });
  const promise = launchComposerMediaLibrary(options, env);
  env.inputs[0].files = [file("first.jpg"), file("second.jpg")];
  env.inputs[0].dispatch("change");
  await assert.rejects(promise, /allocation unavailable/);
  assert.deepEqual(env.revoked, [env.allocated[0].url]);
  assert.equal(env.inputs[0].attached, false);
  const blocked = browser({ clickError: new Error("picker blocked") });
  await assert.rejects(launchComposerMediaLibrary(options, blocked), /picker blocked/);
  assert.equal(blocked.inputs[0].attached, false);
});

test("releasing an owned selection is idempotent and never revokes another component's URL", async () => {
  const env = browser();
  const promise = launchComposerMediaLibrary(options, env);
  env.inputs[0].files = [file("photo.jpg")]; env.inputs[0].dispatch("change");
  const asset = (await promise).assets[0];
  assert.equal(releaseComposerPickerAsset({ uri: "blob:another-component" }), false);
  assert.equal(releaseComposerPickerAsset(asset), true);
  assert.equal(releaseComposerPickerAsset(asset), false);
  assert.deepEqual(env.revoked, [asset.uri]);
});

test("web has a no-decoder platform override while native retains Expo's original picker", () => {
  const native = readFileSync(new URL("./composerMediaPicker.js", import.meta.url), "utf8");
  const web = readFileSync(new URL("./composerMediaPicker.web.js", import.meta.url), "utf8");
  assert.match(native, /ImagePicker\.launchImageLibraryAsync\(options\)/);
  assert.match(web, /composerMediaPicker\.web\.mjs/);
});
