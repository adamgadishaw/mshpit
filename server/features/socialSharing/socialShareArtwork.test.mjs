import assert from "node:assert/strict";
import test from "node:test";

import {
  loadShareArtwork,
  ShareArtworkTransientError,
  socialShareArtworkConstants,
  trustedShareArtworkUrl,
} from "./socialShareArtwork.js";

const ENV = { MEDIA_PUBLIC_BASE_URL: "https://media.mshpit.test/public" };
const PHOTO = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0xff, 0xd9,
]);

test("share artwork accepts verified first-party media and rejects provider hosting without export permission", () => {
  assert.equal(
    trustedShareArtworkUrl({ url: "https://s1.ticketm.net/dam/a/show.jpg", source: "ticketmaster" }, { env: ENV }),
    null,
  );
  assert.equal(
    trustedShareArtworkUrl({ url: "https://media.mshpit.test/public/users/u/post/p.jpg", source: "owned-media" }, { env: ENV }),
    "https://media.mshpit.test/public/users/u/post/p.jpg",
  );
  for (const candidate of [
    { url: "https://attacker.example/photo.jpg", source: "ticketmaster" },
    { url: "https://s1.ticketm.net.attacker.example/photo.jpg", source: "ticketmaster" },
    { url: "https://cdn.s1.ticketm.net/photo.jpg", source: "ticketmaster" },
    { url: "https://s1-ticketm.net/photo.jpg", source: "ticketmaster" },
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

test("a timed-out artwork source cannot suppress the remaining trusted candidates", async () => {
  const candidates = ["first", "second", "third"].map((name) => ({
    url: `https://media.mshpit.test/public/share-tests/${name}.jpg`,
    source: "owned-media",
  }));
  const requestSignals = [];
  let requests = 0;
  const result = await loadShareArtwork(candidates, {
    env: ENV,
    timeoutMs: 100,
    fetchImpl: async (_url, options) => {
      requests += 1;
      requestSignals.push(options.signal);
      if (requests === 1) {
        return new Response(PHOTO, {
          headers: { "content-type": "text/html", "content-length": String(PHOTO.length) },
        });
      }
      if (requests === 3) {
        return new Response(PHOTO, {
          headers: { "content-type": "image/jpeg", "content-length": String(PHOTO.length) },
        });
      }
      return new Promise((resolve, reject) => {
        const rejectAbort = () => reject(options.signal.reason || new DOMException("Aborted", "AbortError"));
        if (options.signal.aborted) rejectAbort();
        else options.signal.addEventListener("abort", rejectAbort, { once: true });
      });
    },
  });

  assert.deepEqual(result, PHOTO);
  assert.equal(requests, 3, "every trusted fallback receives one bounded attempt");
  assert.notEqual(requestSignals[0], requestSignals[1]);
  assert.notEqual(requestSignals[1], requestSignals[2]);
});

test("bad MIME, oversized declarations and truncated responses fall through to the no-photo design", async () => {
  const candidate = [{ url: "https://media.mshpit.test/public/share-tests/show.jpg", source: "owned-media" }];
  const badMime = await loadShareArtwork(candidate, {
    env: ENV,
    fetchImpl: async () => new Response(PHOTO, {
      headers: { "content-type": "text/html", "content-length": String(PHOTO.length) },
    }),
  });
  assert.equal(badMime, null);

  const oversized = await loadShareArtwork(candidate, {
    env: ENV,
    maxBytes: 1_024,
    fetchImpl: async () => new Response(PHOTO, {
      headers: { "content-type": "image/jpeg", "content-length": "1025" },
    }),
  });
  assert.equal(oversized, null);

  const truncated = await loadShareArtwork(candidate, {
    env: ENV,
    fetchImpl: async () => new Response(PHOTO, {
      headers: { "content-type": "image/jpeg", "content-length": String(PHOTO.length + 1) },
    }),
  });
  assert.equal(truncated, null);
  assert.equal(socialShareArtworkConstants.maxBytes, 6 * 1024 * 1024);
  assert.equal(socialShareArtworkConstants.timeoutMs, 3_000);
});

test("permanent artwork failures settle on the stable no-photo design", async () => {
  const candidates = [404, 410].map((status) => ({
    url: `https://media.mshpit.test/public/share-tests/missing-${status}.jpg`,
    source: "owned-media",
  }));
  let requests = 0;
  const result = await loadShareArtwork(candidates, {
    env: ENV,
    fetchImpl: async () => {
      const status = [404, 410][requests];
      requests += 1;
      return new Response(null, { status });
    },
  });
  assert.equal(result, null);
  assert.equal(requests, 2);
});

test("temporary artwork exhaustion is classified as retryable", async () => {
  const candidates = [408, 429, 503].map((status) => ({
    url: `https://media.mshpit.test/public/share-tests/temporary-${status}.jpg`,
    source: "owned-media",
  }));
  let requests = 0;
  await assert.rejects(loadShareArtwork(candidates, {
    env: ENV,
    fetchImpl: async () => {
      const status = [408, 429, 503][requests];
      requests += 1;
      return new Response(null, { status });
    },
  }), ShareArtworkTransientError);
  assert.equal(requests, 3);
});

test("a rejecting image decoder is terminal for only that candidate", async () => {
  const candidates = ["corrupt", "valid"].map((name) => ({
    url: `https://media.mshpit.test/public/share-tests/${name}.jpg`,
    source: "owned-media",
  }));
  let accepts = 0;
  const accepted = Object.freeze({ prepared: true });
  const result = await loadShareArtwork(candidates, {
    env: ENV,
    fetchImpl: async () => new Response(PHOTO, {
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(PHOTO.length),
      },
    }),
    acceptBytes: async () => {
      accepts += 1;
      if (accepts === 1) throw new Error("decoder rejected corrupt bytes");
      return accepted;
    },
  });
  assert.equal(result, accepted);
  assert.equal(accepts, 2);
});

test("streaming artwork without Content-Length is stopped at the byte ceiling", async () => {
  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.concat([PHOTO, Buffer.alloc(700, 1)]));
      controller.enqueue(Buffer.alloc(700, 2));
    },
  });
  const result = await loadShareArtwork([
    { url: "https://media.mshpit.test/public/share-tests/stream.jpg", source: "owned-media" },
  ], {
    env: ENV,
    maxBytes: 1_024,
    fetchImpl: async () => new Response(oversizedStream, {
      headers: { "content-type": "image/jpeg" },
    }),
  });
  assert.equal(result, null);
});

test("declared artwork type must match a supported file signature", async () => {
  const candidate = [{ url: "https://media.mshpit.test/public/share-tests/show.jpg", source: "owned-media" }];
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const mismatch = await loadShareArtwork(candidate, {
    env: ENV,
    fetchImpl: async () => new Response(pngSignature, {
      headers: { "content-type": "image/jpeg" },
    }),
  });
  const disguised = await loadShareArtwork(candidate, {
    env: ENV,
    fetchImpl: async () => new Response(Buffer.from("GIF89a-not-a-jpeg"), {
      headers: { "content-type": "image/jpeg" },
    }),
  });
  assert.equal(mismatch, null);
  assert.equal(disguised, null);
});
