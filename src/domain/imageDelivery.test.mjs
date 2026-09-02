import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { previewSrc, proxied } from "../lib/img.js";

test("public image previews request a bounded derivative and never nest the image proxy", () => {
  const preview = new URL(previewSrc("https://media.example/avatar.jpg", 128));
  assert.equal(preview.hostname, "wsrv.nl");
  assert.equal(preview.searchParams.get("url"), "https://media.example/avatar.jpg");
  assert.equal(preview.searchParams.get("w"), "128");

  const alreadyBounded = preview.toString();
  assert.equal(proxied(alreadyBounded, 96), alreadyBounded);
  assert.equal(previewSrc(alreadyBounded, 96), alreadyBounded);
});

test("preview delivery leaves local and non-public development URLs first-party", () => {
  assert.equal(previewSrc("http://localhost:8081/avatar.jpg", 128), "http://localhost:8081/avatar.jpg");
  assert.equal(previewSrc("https://192.168.1.20/avatar.jpg", 128), "https://192.168.1.20/avatar.jpg");
  assert.equal(previewSrc("https://[fe80::1]/avatar.jpg", 128), "https://[fe80::1]/avatar.jpg");
  const smallest = new URL(previewSrc("https://media.example/small.jpg", 1));
  const largest = new URL(previewSrc("https://media.example/large.jpg", 9999));
  assert.equal(smallest.searchParams.get("w"), "64");
  assert.equal(largest.searchParams.get("w"), "2400");
});

test("media-first cards use existing stage colours and visibility-scoped priority", () => {
  const card = readFileSync(new URL("../components/TicketStub.jsx", import.meta.url), "utf8");
  assert.match(card, /statusMedia\.length > 0 && !campaignPresentation && styles\.mediaStatusCard/);
  assert.match(card, /styles\.mediaStatusRegisterAmber/);
  assert.match(card, /styles\.mediaStatusRegisterMagenta/);
  assert.match(card, /styles\.mediaStatusRegisterCool/);
  assert.match(card, /const avatarPriority = mediaViewable === true \? "high" : "normal"/);
  assert.equal((card.match(/priority=\{avatarPriority\}/g) || []).length, 2);
});
