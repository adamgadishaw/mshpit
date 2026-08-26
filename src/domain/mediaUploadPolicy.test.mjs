import test from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_PHOTO_SOURCE_MAX_BYTES,
  MEDIA_POST_MAX_ATTACHMENTS,
  MEDIA_VIDEO_MAX_DURATION_MS,
  MEDIA_VIDEO_MAX_FRAME_RATE,
  MEDIA_VIDEO_MAX_SAMPLES,
  MEDIA_VIDEO_MIN_DURATION_MS,
  MEDIA_VIDEO_SOURCE_MAX_BYTES,
  mediaPutStatusAccepted,
  mediaUploadLimitLabel,
} from "./mediaUploadPolicy.mjs";

test("shared upload policy exposes the intended camera, clip, and album boundaries", () => {
  assert.equal(MEDIA_PHOTO_SOURCE_MAX_BYTES, 30 * 1024 * 1024);
  assert.equal(MEDIA_VIDEO_SOURCE_MAX_BYTES, 500 * 1024 * 1024);
  assert.equal(MEDIA_VIDEO_MAX_DURATION_MS, 10 * 60_000);
  assert.equal(MEDIA_VIDEO_MIN_DURATION_MS, 1_000);
  assert.equal(MEDIA_POST_MAX_ATTACHMENTS, 20);
  assert.equal(MEDIA_VIDEO_MAX_FRAME_RATE, 60);
  assert.equal(MEDIA_VIDEO_MAX_SAMPLES, 36_002);
  assert.equal(mediaUploadLimitLabel(MEDIA_PHOTO_SOURCE_MAX_BYTES), "30 MB");
  assert.equal(mediaUploadLimitLabel(MEDIA_VIDEO_SOURCE_MAX_BYTES), "500 MB");
  assert.equal(mediaUploadLimitLabel(0), "the supported size");
});

test("create-only media PUT treats only success and an existing immutable key as resumable", () => {
  assert.equal(mediaPutStatusAccepted(199), false);
  assert.equal(mediaPutStatusAccepted(200), true);
  assert.equal(mediaPutStatusAccepted(201), true);
  assert.equal(mediaPutStatusAccepted(204), true);
  assert.equal(mediaPutStatusAccepted(299), true);
  assert.equal(mediaPutStatusAccepted(300), false);
  assert.equal(mediaPutStatusAccepted(412), true);
  assert.equal(mediaPutStatusAccepted(400), false);
  assert.equal(mediaPutStatusAccepted(409), false);
  assert.equal(mediaPutStatusAccepted(500), false);
  assert.equal(mediaPutStatusAccepted(Number.NaN), false);
});
