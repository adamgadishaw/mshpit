import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  NEWS_ILLUSTRATION_ARTWORK, NEWS_ILLUSTRATION_CONTEXT,
  isNewsIllustrationArtwork, loadNewsIllustration,
} from "./newsIllustration.js";
import { loadShareArtwork } from "./features/socialSharing/socialShareArtwork.js";

const HASH = "e0788b4b2b524ce23d08bf6879f47273e46a554788868e9784b8b4a7249d8244";
const SIZE = 123830;

function fileFixture(bytes, { size = bytes.length, regular = true, onRead = null, chunk = 32768 } = {}) {
  const state = { reads: 0, closes: 0, opened: [] };
  const openFile = async (...args) => {
    state.opened.push(args);
    return {
      async stat() { return { size, isFile: () => regular }; },
      async read(target, offset, length, position) {
        state.reads += 1;
        assert.ok(length <= SIZE && target.length === SIZE, "one pinned-size buffer bounds the read");
        const available = Math.max(0, Math.min(bytes.length - position, length, chunk));
        bytes.copy(target, offset, position, position + available);
        onRead?.();
        return { bytesRead: available };
      },
      async close() { state.closes += 1; },
    };
  };
  return { state, openFile };
}

test("news illustration is one immutable exact identifier, not a URL or path fetcher", () => {
  assert.ok(Object.isFrozen(NEWS_ILLUSTRATION_ARTWORK));
  assert.equal(isNewsIllustrationArtwork({ ...NEWS_ILLUSTRATION_ARTWORK }), true);
  assert.match(NEWS_ILLUSTRATION_CONTEXT, /^Illustrative live-music photo/u);
  const url = NEWS_ILLUSTRATION_ARTWORK.url;
  for (const candidate of [null, [], {},
    { source: "owned-media", url },
    { source: "bundled-news", url: url + "?x=1" },
    { source: "bundled-news", url: url + "#x" },
    { source: "bundled-news", url: url.replace("https:", "http:") },
    { source: "bundled-news", url: url.replace("www.mshpit.com", "evil.test") },
    { source: "bundled-news", url: "file:///etc/passwd" },
    { source: "bundled-news", url: "../../private.jpg" },
  ]) assert.equal(isNewsIllustrationArtwork(candidate), false);
});

test("bundled illustration has the approved exact bytes and hash without retaining shared buffers", async () => {
  const bytes = await loadNewsIllustration();
  assert.equal(bytes?.length, SIZE);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), HASH);
  assert.equal(bytes.subarray(0, 3).toString("hex"), "ffd8ff");
  const fixture = fileFixture(bytes);
  assert.deepEqual(await loadNewsIllustration({ openFile: fixture.openFile }), bytes);
  assert.equal(fixture.state.closes, 1);
  assert.equal(fixture.state.reads, Math.ceil(SIZE / 32768));
  assert.equal(fixture.state.opened[0][1], "r");
  assert.equal(fixture.state.opened[0][0].pathname.endsWith("/public/images/news/live-music-context.jpg"), true);
  bytes[0] = 0;
  assert.equal((await loadNewsIllustration())[0], 0xff, "one caller cannot mutate a cached asset for another");
});

test("missing, oversized, truncated, nonfile or hash-changed assets return no unchecked artwork", async () => {
  assert.equal(await loadNewsIllustration({ openFile: async () => { throw new Error("missing private path"); } }), null);
  for (const options of [{ size: 0 }, { size: SIZE + 1 }, { regular: false }]) {
    const fixture = fileFixture(Buffer.alloc(SIZE), options);
    assert.equal(await loadNewsIllustration({ openFile: fixture.openFile }), null);
    assert.equal(fixture.state.reads, 0);
    assert.equal(fixture.state.closes, 1);
  }
  for (const data of [Buffer.alloc(12), Buffer.alloc(SIZE)]) {
    const fixture = fileFixture(data, { size: SIZE });
    assert.equal(await loadNewsIllustration({ openFile: fixture.openFile }), null);
    assert.equal(fixture.state.closes, 1);
  }
});

test("illustration cancellation is honored before opening and after an in-flight read", async () => {
  const before = new AbortController();
  before.abort();
  let opens = 0;
  await assert.rejects(loadNewsIllustration({ signal: before.signal, openFile: async () => { opens += 1; } }), { name: "AbortError" });
  assert.equal(opens, 0);
  const during = new AbortController();
  const fixture = fileFixture(Buffer.alloc(SIZE), { onRead: () => during.abort() });
  await assert.rejects(loadNewsIllustration({ signal: during.signal, openFile: fixture.openFile }), { name: "AbortError" });
  assert.equal(fixture.state.reads, 1);
  assert.equal(fixture.state.closes, 1);
});

test("share loader reads only exact bundled artwork locally and runs the normal decoder callback", async () => {
  let fetches = 0;
  let accepts = 0;
  const result = await loadShareArtwork([NEWS_ILLUSTRATION_ARTWORK], {
    env: {}, fetchImpl: async () => { fetches += 1; throw new Error("unexpected network"); },
    acceptBytes(bytes, candidate) {
      accepts += 1;
      assert.equal(bytes.length, SIZE);
      assert.equal(candidate, NEWS_ILLUSTRATION_ARTWORK);
      return { accepted: true };
    },
  });
  assert.deepEqual(result, { accepted: true });
  assert.equal(fetches, 0);
  assert.equal(accepts, 1);
  assert.equal((await loadShareArtwork([NEWS_ILLUSTRATION_ARTWORK], { fetchImpl: null })).length, SIZE);
  assert.equal(await loadShareArtwork([NEWS_ILLUSTRATION_ARTWORK], { maxBytes: 1024, fetchImpl: null }), null);
  for (const url of ["file:///etc/passwd", "https://evil.test/a.jpg", NEWS_ILLUSTRATION_ARTWORK.url + "?tamper"]) {
    assert.equal(await loadShareArtwork([{ source: "bundled-news", url }], {
      fetchImpl: async () => { fetches += 1; }, acceptBytes() { throw new Error("forged bytes reached decoder"); },
    }), null);
  }
  assert.equal(fetches, 0, "forged local identifiers cannot be fetched remotely");
});

test("bundled artwork shares decoder rejection, terminal failure and cancellation semantics", async () => {
  let accepts = 0;
  const decoded = await loadShareArtwork([NEWS_ILLUSTRATION_ARTWORK, NEWS_ILLUSTRATION_ARTWORK], {
    fetchImpl: null, acceptBytes() { accepts += 1; if (accepts === 1) throw new Error("bad decode"); return "decoded"; },
  });
  assert.equal(decoded, "decoded");
  assert.equal(accepts, 2);
  await assert.rejects(loadShareArtwork([NEWS_ILLUSTRATION_ARTWORK], {
    fetchImpl: null, acceptBytes() { throw new Error("renderer busy"); }, acceptErrorIsTerminal: () => false,
  }), /renderer busy/u);
  const controller = new AbortController();
  let cancelledAccepts = 0;
  await assert.rejects(loadShareArtwork([NEWS_ILLUSTRATION_ARTWORK, NEWS_ILLUSTRATION_ARTWORK], {
    signal: controller.signal, fetchImpl: null, acceptBytes() { cancelledAccepts += 1; controller.abort(); return "stale decoded result"; },
  }), { name: "AbortError" });
  assert.equal(cancelledAccepts, 1);
});
