import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_MEDIA_PUBLISHING_CAPABILITIES,
  VIDEO_PUBLISHING_PREPARING_COPY,
  mediaPublishingCapabilitiesForRuntime,
  mediaPublishingCapabilitiesFromHealth,
  mediaPublishingSelection,
  mediaPublishingSourceRequestAllowed,
} from "./mediaPublishingCapabilities.mjs";

test("video publishing fails closed unless the deployed runtime explicitly enables it", () => {
  assert.deepEqual(mediaPublishingCapabilitiesForRuntime(), { photos: true, videos: false });
  assert.equal(mediaPublishingCapabilitiesForRuntime({ PIT_VIDEO_PUBLISHING_ENABLED: "false" }).videos, false);
  assert.equal(mediaPublishingCapabilitiesForRuntime({ PIT_VIDEO_PUBLISHING_ENABLED: "tru" }).videos, false);
  assert.equal(mediaPublishingCapabilitiesForRuntime({ PIT_VIDEO_PUBLISHING_ENABLED: "TRUE" }).videos, true);
});

test("the client trusts only the explicit boolean health capability", () => {
  assert.deepEqual(mediaPublishingCapabilitiesFromHealth(null), DEFAULT_MEDIA_PUBLISHING_CAPABILITIES);
  assert.equal(mediaPublishingCapabilitiesFromHealth({ capabilities: { mediaPublishing: { videos: "true" } } }).videos, false);
  assert.equal(mediaPublishingCapabilitiesFromHealth({ capabilities: { mediaPublishing: { photos: true, videos: true } } }).videos, true);
});

test("the selection gate preserves photos and rejects only new videos while disabled", () => {
  const image = { id: "image", kind: "image" };
  const video = { id: "video", kind: "video" };
  assert.deepEqual(mediaPublishingSelection([image, video]), { accepted: [image], blockedVideos: 1 });
  assert.deepEqual(mediaPublishingSelection([image, video], { photos: true, videos: true }), {
    accepted: [image, video],
    blockedVideos: 0,
  });
});

test("source-ticket policy blocks video on absent and misspelled runtime flags without affecting images", () => {
  const video = { contentType: " Video/MP4; codecs=avc1 " };
  const image = { contentType: "image/jpeg" };
  assert.equal(mediaPublishingSourceRequestAllowed(video), false);
  assert.equal(mediaPublishingSourceRequestAllowed(video, { PIT_VIDEO_PUBLISHING_ENABLED: "tru" }), false);
  assert.equal(mediaPublishingSourceRequestAllowed(video, { PIT_VIDEO_PUBLISHING_ENABLED: "true" }), true);
  assert.equal(mediaPublishingSourceRequestAllowed(image), true);
  assert.equal(mediaPublishingSourceRequestAllowed(image, { PIT_VIDEO_PUBLISHING_ENABLED: "false" }), true);
});

test("the composer exposes the capability, honest transition copy, and both selection/upload gates", async () => {
  const source = await readFile(new URL("../screens/LogScreen.jsx", import.meta.url), "utf8");
  assert.match(VIDEO_PUBLISHING_PREPARING_COPY, /Photo Studio is available now/);
  assert.match(VIDEO_PUBLISHING_PREPARING_COPY, /Existing clips remain viewable/);
  assert.match(source, /api\("\/api\/health"/);
  assert.match(source, /allowVideos: mediaPublishingCapabilities\.videos/);
  assert.match(source, /mediaPublishingSelection\(candidateAssets, mediaPublishingCapabilities\)/);
  assert.match(source, /mediaPublishingSelection\(selected, mediaPublishingCapabilities\)/);
  assert.match(source, /VIDEO_PUBLISHING_PREPARING_COPY/);
});
