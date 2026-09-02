import assert from "node:assert/strict";
import test from "node:test";

import {
  loadShareArtwork,
  socialShareArtworkConstants,
  trustedShareArtworkUrl,
} from "./socialShareArtwork.js";

const ENV = { MEDIA_PUBLIC_BASE_URL: "https://media.mshpit.test/public" };
const PHOTO = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0xff, 0xd9,
]);

test("share artwork accepts only the fixed Ticketmaster host or configured public-media path", () => {
  assert.equal(
    trustedShareArtworkUrl({ url: "https://s1.ticketm.net/dam/a/show.jpg", source: "ticketmaster" }, { env: ENV }),
    "https://s1.ticketm.net/dam/a/show.jpg",
  );
  assert.equal(
    trustedShareArtworkUrl({ url: "https://media.mshpit.test/public/users/u/post/p.jpg", source: "owned-media" }, { env: ENV }),
    "https://media.mshpit.test/public/users/u/post/p.jpg",
  );
  for (const candidate of [
    { url: "https://attacker.example/photo.jpg", source: "ticketmaster" },
    { url: "https://media.mshpit.test/private/source.jpg", source: "owned-media" },
    { url: "https://media.mshpit.test/publicity/not-inside.jpg", source: "owned-media" },
    { url: "https://media.mshpit.test/public/photo.jpg#secret", source: "owned-media" },
    { url: "https://user:pass@s1.ticketm.net/photo.jpg", source: "ticketmaster" },
    { url: "http://s1.ticketm.net/photo.jpg", source: "ticketmaster" },
    { url: "https://s1.ticketm.net/photo.jpg", source: "untrusted" },
  ]) assert.equal(trustedShareArtworkUrl(candidate, { env: ENV }), null);
});

test("artwork loading is bounded, refuses redirects and returns the first valid trusted photo", async () => {
  const requests = [];
  const bytes = await loadShareArtwork([
    { url: "https://attacker.example/skip.jpg", source: "owned-media" },
    { url: "https://media.mshpit.test/public/users/u/post/photo.jpg", source: "owned-media" },
  ], {
    env: ENV,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(PHOTO, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(PHOTO.length),
        },
      });
    },
  });

  assert.deepEqual(bytes, PHOTO);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(requests[0].options.method, "GET");
  assert.match(requests[0].options.headers.Accept, /image\/jpeg/u);
});

test("one artwork deadline is shared across every trusted candidate", async () => {
  const candidates = ["first", "second", "third"].map((name) => ({
    url: `https://s1.ticketm.net/dam/a/${name}.jpg`,
    source: "ticketmaster",
  }));
  const requestSignals = [];
  let requests = 0;
  const result = await loadShareArtwork(candidates, {
    timeoutMs: 100,
    fetchImpl: async (_url, options) => {
      requests += 1;
      requestSignals.push(options.signal);
      if (requests === 1) {
        return new Response(PHOTO, {
          headers: { "content-type": "text/html", "content-length": String(PHOTO.length) },
        });
      }
      return new Promise((resolve, reject) => {
        const rejectAbort = () => reject(options.signal.reason || new DOMException("Aborted", "AbortError"));
        if (options.signal.aborted) rejectAbort();
        else options.signal.addEventListener("abort", rejectAbort, { once: true });
      });
    },
  });

  assert.equal(result, null);
  assert.equal(requests, 2, "the final candidate must not receive a fresh timeout window");
  assert.equal(requestSignals[0], requestSignals[1], "all fetches must use the same deadline signal");
});

test("bad MIME, oversized declarations and truncated responses fall through to the no-photo design", async () => {
  const candidate = [{ url: "https://s1.ticketm.net/dam/a/show.jpg", source: "ticketmaster" }];
  const badMime = await loadShareArtwork(candidate, {
    fetchImpl: async () => new Response(PHOTO, {
      headers: { "content-type": "text/html", "content-length": String(PHOTO.length) },
    }),
  });
  assert.equal(badMime, null);

  const oversized = await loadShareArtwork(candidate, {
    maxBytes: 1_024,
    fetchImpl: async () => new Response(PHOTO, {
      headers: { "content-type": "image/jpeg", "content-length": "1025" },
    }),
  });
  assert.equal(oversized, null);

  const truncated = await loadShareArtwork(candidate, {
    fetchImpl: async () => new Response(PHOTO, {
      headers: { "content-type": "image/jpeg", "content-length": String(PHOTO.length + 1) },
    }),
  });
  assert.equal(truncated, null);
  assert.equal(socialShareArtworkConstants.maxBytes, 6 * 1024 * 1024);
  assert.equal(socialShareArtworkConstants.timeoutMs, 3_000);
});

test("streaming artwork without Content-Length is stopped at the byte ceiling", async () => {
  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.concat([PHOTO, Buffer.alloc(700, 1)]));
      controller.enqueue(Buffer.alloc(700, 2));
    },
  });
  const result = await loadShareArtwork([
    { url: "https://s1.ticketm.net/dam/a/stream.jpg", source: "ticketmaster" },
  ], {
    maxBytes: 1_024,
    fetchImpl: async () => new Response(oversizedStream, {
      headers: { "content-type": "image/jpeg" },
    }),
  });
  assert.equal(result, null);
});

test("declared artwork type must match a supported file signature", async () => {
  const candidate = [{ url: "https://s1.ticketm.net/dam/a/show.jpg", source: "ticketmaster" }];
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const mismatch = await loadShareArtwork(candidate, {
    fetchImpl: async () => new Response(pngSignature, {
      headers: { "content-type": "image/jpeg" },
    }),
  });
  const disguised = await loadShareArtwork(candidate, {
    fetchImpl: async () => new Response(Buffer.from("GIF89a-not-a-jpeg"), {
      headers: { "content-type": "image/jpeg" },
    }),
  });
  assert.equal(mismatch, null);
  assert.equal(disguised, null);
});
