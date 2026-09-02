import assert from "node:assert/strict";
import test from "node:test";

import {
  binaryApiResponseConstants,
  binaryApiResponsePayload,
  createPngApiResponse,
} from "./binaryApiResponse.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = () => Buffer.concat([PNG_SIGNATURE, Buffer.alloc(120, 1)]);

test("only registered, signature-verified PNG responses cross the binary API boundary", () => {
  const response = createPngApiResponse(png(), {
    canonicalUrl: "https://www.mshpit.com/post/post_123",
    filename: "mshpit-review.png",
  });
  assert.equal(binaryApiResponsePayload(response), response);
  assert.equal(response.headers["Content-Type"], "image/png");
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  assert.equal(response.headers["Content-Length"], String(response.bytes.length));
  assert.equal(response.headers.Link, '<https://www.mshpit.com/post/post_123>; rel="canonical"');

  assert.equal(binaryApiResponsePayload({
    bytes: png(),
    headers: { "Content-Type": "image/png" },
  }), null, "lookalike route results cannot activate the binary escape hatch");
  assert.throws(
    () => createPngApiResponse(Buffer.alloc(128), {
      canonicalUrl: "https://www.mshpit.com/post/post_123",
    }),
    /PNG API response bytes are invalid/,
  );

  response.bytes.fill(0);
  assert.equal(
    binaryApiResponsePayload(response),
    null,
    "registered responses are revalidated after mutable Buffer contents change",
  );
});

test("PNG responses reject off-site or state-bearing canonical links and oversized payloads", () => {
  for (const canonicalUrl of [
    "https://tracker.example/post/post_123",
    "https://www.mshpit.com/post/post_123?email=member@example.com",
    "https://www.mshpit.com/post/post_123#private",
  ]) {
    assert.throws(() => createPngApiResponse(png(), { canonicalUrl }), /canonical Mshpit URL/);
  }
  const oversized = Buffer.alloc(binaryApiResponseConstants.maxBytes + 1);
  PNG_SIGNATURE.copy(oversized);
  assert.throws(
    () => createPngApiResponse(oversized, { canonicalUrl: "https://www.mshpit.com/post/p1" }),
    /PNG API response bytes are invalid/,
  );
});
