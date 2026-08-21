import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { youtubePlayerCanReceiveCommands } from "../domain/youtubePlayerLifecycle.mjs";

test("player commands require a ready generation with an attached host and iframe", () => {
  const iframe = { isConnected: true };
  const player = { getIframe: () => iframe };
  const host = { isConnected: true };
  assert.equal(youtubePlayerCanReceiveCommands({ ready: true, host, player }), true);
  assert.equal(youtubePlayerCanReceiveCommands({ ready: false, host, player }), false);
  assert.equal(youtubePlayerCanReceiveCommands({ ready: true, host: { isConnected: false }, player }), false);
  assert.equal(youtubePlayerCanReceiveCommands({ ready: true, host, player: { getIframe: () => ({ isConnected: false }) } }), false);
  assert.equal(youtubePlayerCanReceiveCommands({ ready: true, host, player: {} }), false);
});

test("the iframe lifecycle tears down before conditional host removal and destroys once", async () => {
  const source = await readFile(new URL("./youtubePlayer.js", import.meta.url), "utf8");
  assert.match(source, /useLayoutEffect\(\(\) => \{/);
  assert.match(source, /readyRef\.current = false;[\s\S]*ownedPlayer\?\.destroy\?\.\(\)/);
  assert.equal((source.match(/destroy\?\.\(\)/g) || []).length, 1);
});

test("iframe failures carry the active media identity", async () => {
  const source = await readFile(new URL("./youtubePlayer.js", import.meta.url), "utf8");
  assert.match(source, /mediaKeyRef\.current = mediaKey/);
  const errorWrites = source.match(/setError\(\{ kind: [^\n]+/g) || [];
  assert.ok(errorWrites.length >= 5);
  assert.ok(errorWrites.every((line) => line.includes("mediaKey:")), "every iframe error must be scoped to its track/account generation");
});
