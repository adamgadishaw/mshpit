import assert from "node:assert/strict";
import test from "node:test";
import {
  loadYouTubeIframeApi,
  resetYouTubeIframeApiForTests,
} from "./youtubeIframeApi.mjs";

function fakeDom() {
  const windowObject = {};
  const documentObject = {
    currentScript: null,
    querySelector() { return this.currentScript; },
    createElement() {
      const listeners = new Map();
      return {
        dataset: {},
        parentNode: null,
        addEventListener(type, callback, options = {}) {
          const entries = listeners.get(type) || [];
          entries.push({ callback, once: !!options.once });
          listeners.set(type, entries);
        },
        removeEventListener(type, callback) {
          listeners.set(type, (listeners.get(type) || []).filter((entry) => entry.callback !== callback));
        },
        emit(type) {
          const entries = [...(listeners.get(type) || [])];
          for (const entry of entries) entry.callback();
          listeners.set(type, (listeners.get(type) || []).filter((entry) => !entry.once));
        },
        remove() {
          if (documentObject.currentScript === this) documentObject.currentScript = null;
          this.parentNode = null;
        },
      };
    },
    head: {
      appendChild(script) {
        documentObject.currentScript = script;
        script.parentNode = this;
      },
      removeChild(script) {
        if (documentObject.currentScript === script) documentObject.currentScript = null;
        script.parentNode = null;
      },
    },
  };
  return { windowObject, documentObject };
}

test("a failed iframe API script is removed so the next mount can retry", async () => {
  resetYouTubeIframeApiForTests();
  const { windowObject, documentObject } = fakeDom();
  let previousReadyCalls = 0;
  windowObject.onYouTubeIframeAPIReady = () => { previousReadyCalls += 1; };

  const failed = loadYouTubeIframeApi({ windowObject, documentObject, pollIntervalMs: 60_000 });
  const failedScript = documentObject.currentScript;
  failedScript.emit("error");
  await assert.rejects(failed, /yt-api-load-failed/);
  assert.equal(documentObject.currentScript, null);

  const retried = loadYouTubeIframeApi({ windowObject, documentObject, pollIntervalMs: 60_000 });
  const retryScript = documentObject.currentScript;
  assert.notEqual(retryScript, failedScript);
  windowObject.YT = { Player: function Player() {} };
  windowObject.onYouTubeIframeAPIReady();
  assert.equal(await retried, windowObject.YT);
  assert.equal(previousReadyCalls, 1, "an existing ready callback is preserved without wrapper accumulation");
});

test("the global ready callback does not resolve before YT.Player exists", async () => {
  resetYouTubeIframeApiForTests();
  const { windowObject, documentObject } = fakeDom();
  const pending = loadYouTubeIframeApi({ windowObject, documentObject, pollIntervalMs: 60_000 });
  let settled = false;
  pending.then(() => { settled = true; });
  windowObject.onYouTubeIframeAPIReady();
  await Promise.resolve();
  assert.equal(settled, false);

  windowObject.YT = { Player: function Player() {} };
  documentObject.currentScript.emit("load");
  assert.equal(await pending, windowObject.YT);
});

test("concurrent iframe API consumers share one script and one promise", async () => {
  resetYouTubeIframeApiForTests();
  const { windowObject, documentObject } = fakeDom();
  const options = { windowObject, documentObject, pollIntervalMs: 60_000 };
  const first = loadYouTubeIframeApi(options);
  const script = documentObject.currentScript;
  const second = loadYouTubeIframeApi(options);
  assert.equal(second, first);
  assert.equal(documentObject.currentScript, script);

  windowObject.YT = { Player: function Player() {} };
  windowObject.onYouTubeIframeAPIReady();
  await Promise.all([first, second]);
});

test("a timed-out script is also evicted rather than poisoning later mounts", async () => {
  resetYouTubeIframeApiForTests();
  const { windowObject, documentObject } = fakeDom();
  const pending = loadYouTubeIframeApi({
    windowObject,
    documentObject,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: (callback) => { queueMicrotask(callback); return 1; },
    clearTimeoutFn: () => {},
  });
  await assert.rejects(pending, /yt-api-load-timeout/);
  assert.equal(documentObject.currentScript, null);
});
