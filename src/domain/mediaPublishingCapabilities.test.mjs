import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_MEDIA_PUBLISHING_CAPABILITIES,
  MEDIA_PUBLISHING_UNAVAILABLE_COPY,
  MEDIA_PUBLISHING_HEALTH_PATH,
  VIDEO_PUBLISHING_PREPARING_COPY,
  VIDEO_PUBLISHING_PIPELINE_VERSION,
  mediaPublishingAttachmentLabel,
  mediaPublishingAvailabilityCopy,
  mediaPublishingCapabilitiesForRuntime,
  mediaPublishingCapabilitiesFromHealth,
  mediaPublishingSelection,
  mediaPublishingSourceRequestAllowed,
} from "./mediaPublishingCapabilities.mjs";

test("the new client opts into only the exact verified media health contract", () => {
  assert.equal(MEDIA_PUBLISHING_HEALTH_PATH, "/api/health?mediaPipeline=private-derivative-v1");
  assert.notEqual(MEDIA_PUBLISHING_HEALTH_PATH, "/api/health");
});

test("video publishing fails closed unless the deployed runtime explicitly enables it", () => {
  assert.deepEqual(mediaPublishingCapabilitiesForRuntime(), { photos: true, videos: false });
  assert.equal(mediaPublishingCapabilitiesForRuntime({ PIT_VIDEO_PUBLISHING_ENABLED: "false" }).videos, false);
  assert.equal(mediaPublishingCapabilitiesForRuntime({ PIT_VIDEO_PUBLISHING_ENABLED: "tru" }).videos, false);
  assert.equal(mediaPublishingCapabilitiesForRuntime({ PIT_VIDEO_PUBLISHING_ENABLED: "TRUE" }).videos, true);
});

test("the client trusts only the explicit boolean health capability", () => {
  assert.deepEqual(mediaPublishingCapabilitiesFromHealth(null), DEFAULT_MEDIA_PUBLISHING_CAPABILITIES);
  assert.deepEqual(mediaPublishingCapabilitiesFromHealth({ capabilities: { mediaPublishing: { photos: false, videos: false } } }), { photos: false, videos: false, sourceTypes: [] });
  assert.equal(mediaPublishingCapabilitiesFromHealth({ capabilities: { mediaPublishing: { videos: "true" } } }).videos, false);
  assert.equal(mediaPublishingCapabilitiesFromHealth({ capabilities: { mediaPublishing: { photos: true, videos: true } } }).videos, false,
    "the rollout flag alone cannot expose a pipeline the server has not declared ready");
  assert.equal(mediaPublishingCapabilitiesFromHealth({
    capabilities: { mediaPublishing: { photos: true, videos: true, pipeline: "almost-ready" } },
  }).videos, false);
  assert.equal(mediaPublishingCapabilitiesFromHealth({
    capabilities: { mediaPublishing: { photos: true, videos: true, pipeline: VIDEO_PUBLISHING_PIPELINE_VERSION } },
  }).videos, true);
  assert.deepEqual(mediaPublishingCapabilitiesFromHealth({
    capabilities: { mediaPublishing: { photos: true, videos: true, pipeline: VIDEO_PUBLISHING_PIPELINE_VERSION } },
  }).sourceTypes, ["video/mp4"], "an older healthy worker keeps MP4 available during a rolling deploy");
  assert.deepEqual(mediaPublishingCapabilitiesFromHealth({
    capabilities: { mediaPublishing: { photos: true, videos: true, pipeline: VIDEO_PUBLISHING_PIPELINE_VERSION,
      sourceTypes: ["video/mp4", "video/quicktime"] } },
  }).sourceTypes, ["video/mp4", "video/quicktime"]);
});

test("the selection gate preserves photos and rejects only new videos while disabled", () => {
  const image = { id: "image", kind: "image" };
  const video = { id: "video", kind: "video", mimeType: "video/mp4" };
  assert.deepEqual(mediaPublishingSelection([image, video]), { accepted: [image], blockedPhotos: 0, blockedVideos: 1 });
  assert.deepEqual(mediaPublishingSelection([image, video], { photos: true, videos: true }), {
    accepted: [image, video],
    blockedPhotos: 0,
    blockedVideos: 0,
  });
  assert.deepEqual(mediaPublishingSelection([image, video], { photos: false, videos: true }), {
    accepted: [video],
    blockedPhotos: 1,
    blockedVideos: 0,
  });
  assert.deepEqual(mediaPublishingSelection([image, video], { photos: false, videos: false }), {
    accepted: [],
    blockedPhotos: 1,
    blockedVideos: 1,
  });
  const mov = { id: "mov", kind: "video", mimeType: "video/quicktime", fileName: "concert.mov" };
  assert.deepEqual(mediaPublishingSelection([video, mov], {
    photos: true,
    videos: true,
    sourceTypes: ["video/mp4"],
  }), { accepted: [video], blockedPhotos: 0, blockedVideos: 1 });
});

test("composer availability copy and labels match each negotiated media type", () => {
  assert.equal(mediaPublishingAvailabilityCopy({ photos: true, videos: true }), "");
  assert.equal(mediaPublishingAvailabilityCopy({ photos: true, videos: false }), VIDEO_PUBLISHING_PREPARING_COPY);
  assert.equal(mediaPublishingAvailabilityCopy({ photos: false, videos: false }), MEDIA_PUBLISHING_UNAVAILABLE_COPY);
  assert.equal(mediaPublishingAttachmentLabel({ photos: false, videos: false }), "Media");
  assert.equal(mediaPublishingAttachmentLabel({ photos: false, videos: true }), "Videos");
  assert.doesNotMatch(VIDEO_PUBLISHING_PREPARING_COPY, /Photo Studio is available now/);
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
  assert.match(VIDEO_PUBLISHING_PREPARING_COPY, /Photo uploads are available/);
  assert.match(VIDEO_PUBLISHING_PREPARING_COPY, /Existing clips remain viewable/);
  assert.match(source, /loadMediaPublishingCapabilities\(\{\s*apiCall: api,\s*signal: controller\.signal,\s*force,/);
  assert.doesNotMatch(source, /api\(MEDIA_PUBLISHING_HEALTH_PATH/);
  assert.match(source, /AppState\.addEventListener\("change"/);
  assert.match(source, /if \(state === "active"\) void refreshMediaPublishingCapabilities\(\{ background: true \}\)/);
  assert.match(source, /allowPhotos: pickerCapabilities\.photos/);
  assert.match(source, /allowVideos: pickerCapabilities\.videos/);
  assert.match(source, /mediaPublishingSelection\(candidateAssets, capabilities\)/);
  assert.match(source, /mediaPublishingSelection\(selected, activeCapabilities\)/);
  assert.match(source, /await refreshMediaPublishingCapabilities\(\{ force: true, background: true \}\)/);
  assert.match(source, /mediaPublishingAvailabilityCopy\(mediaPublishingCapabilities\)/);
  assert.match(source, /accessibilityLabel="Check media upload availability again"/);
});
