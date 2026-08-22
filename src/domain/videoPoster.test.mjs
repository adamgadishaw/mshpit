import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_AUTO_POSTER_CANDIDATES,
  VIDEO_POSTER_ERROR_CODES,
  VideoPosterError,
  boundedPosterSize,
  normalizeVideoPosterOptions,
  videoPosterCandidateTimes,
  videoPosterError,
  videoPosterFileName,
  videoPosterFrameIsStrong,
  videoPosterFrameIsUsable,
  videoPosterFrameProfile,
  videoPosterFrameScore,
  videoPosterSourceNeedsCorsProbe,
} from "./videoPoster.mjs";

test("poster options are bounded and preserve an explicit author cover time", () => {
  const options = normalizeVideoPosterOptions(
    { duration: 12_000 },
    { timeMs: 4_250, maxDimension: 9_999, quality: 0.1, timeoutMs: 1 },
  );
  assert.deepEqual(options, {
    durationMs: 12_000,
    explicitTime: true,
    timeMs: 4_250,
    maxDimension: 1920,
    quality: 0.5,
    timeoutMs: 3_000,
    signal: null,
  });
});

test("automatic poster times stay bounded while sampling across the video", () => {
  assert.deepEqual(videoPosterCandidateTimes({ durationMs: 5_000 }), [350, 400, 1_400, 2_600, 3_700, 4_500]);
  assert.deepEqual(videoPosterCandidateTimes({ durationMs: 200 }), [100, 104, 148, 180, 199]);
  const longClip = videoPosterCandidateTimes({ durationMs: 60_000 });
  assert.deepEqual(longClip, [350, 4_800, 16_800, 31_200, 44_400, 54_000]);
  assert.equal(longClip.length, MAX_AUTO_POSTER_CANDIDATES);
  assert.ok(longClip.at(-1) > 50_000, "automatic sampling reaches beyond a long black intro");
  assert.deepEqual(videoPosterCandidateTimes({ durationMs: 10_000, timeMs: 0, explicitTime: true }), [100]);
  assert.deepEqual(videoPosterCandidateTimes({ durationMs: 10_000, timeMs: 20_000, explicitTime: true }), [9_999]);
});

test("poster dimensions preserve aspect ratio and never upscale", () => {
  assert.deepEqual(boundedPosterSize(3840, 2160, 1280), { width: 1280, height: 720 });
  assert.deepEqual(boundedPosterSize(720, 1280, 1280), { width: 720, height: 1280 });
  assert.deepEqual(boundedPosterSize(640, 360, 1280), { width: 640, height: 360 });
});

test("same-origin poster sources never receive a redundant CORS HEAD probe", () => {
  assert.equal(videoPosterSourceNeedsCorsProbe(
    "https://www.mshpit.com/media/legacy.mp4?token=1",
    "https://www.mshpit.com/feed",
  ), false);
  assert.equal(videoPosterSourceNeedsCorsProbe(
    "https://media.mshpit.com/media/legacy.mp4",
    "https://www.mshpit.com/feed",
  ), true);
  assert.equal(videoPosterSourceNeedsCorsProbe(
    "https://pub-example.r2.dev/media/legacy.mp4",
    "https://www.mshpit.com/feed",
  ), true);
});

test("frame profiles accept detailed low light while rejecting near-black, blown, and flat frames", () => {
  const black = new Uint8ClampedArray(16).fill(0);
  const white = new Uint8ClampedArray(16).fill(255);
  const flatGrey = new Uint8ClampedArray(16).fill(80);
  const solidDarkRed = new Uint8ClampedArray([
    16, 0, 0, 255,
    16, 0, 0, 255,
    16, 0, 0, 255,
    16, 0, 0, 255,
  ]);
  const solidRed = new Uint8ClampedArray([
    120, 0, 0, 255,
    120, 0, 0, 255,
    120, 0, 0, 255,
    120, 0, 0, 255,
  ]);
  const alexBlankCapture = new Uint8ClampedArray([
    16, 17, 23, 255,
    16, 17, 23, 255,
    16, 17, 23, 255,
    16, 17, 23, 255,
  ]);
  const compressedBlankIntro = new Uint8ClampedArray(Array.from({ length: 1_024 }, (_, index) => (
    index % 2 ? [20, 21, 27, 255] : [12, 13, 19, 255]
  )).flat());
  const widerCompressedBlankIntro = new Uint8ClampedArray(Array.from({ length: 1_024 }, (_, index) => (
    index % 2 ? [22, 23, 29, 255] : [10, 11, 17, 255]
  )).flat());
  const nearBlackGrey = new Uint8ClampedArray([
    0, 0, 0, 255,
    0, 0, 0, 255,
    0, 0, 0, 255,
    16, 16, 16, 255,
  ]);
  const blownStage = new Uint8ClampedArray([
    255, 255, 255, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
    180, 20, 10, 255,
  ]);
  const darkConcert = new Uint8ClampedArray([
    0, 0, 0, 255,
    12, 0, 0, 255,
    0, 12, 0, 255,
    0, 0, 12, 255,
  ]);
  const concert = new Uint8ClampedArray([
    8, 5, 14, 255,
    240, 90, 35, 255,
    25, 130, 220, 255,
    190, 175, 80, 255,
  ]);
  assert.ok(videoPosterFrameScore(concert) > videoPosterFrameScore(black));
  assert.ok(videoPosterFrameScore(concert) > videoPosterFrameScore(white));
  const darkConcertProfile = videoPosterFrameProfile(darkConcert);
  assert.ok(darkConcertProfile.mean < 12, "the valid regression fixture remains genuinely low light");
  assert.ok(darkConcertProfile.spatialVariation >= 5, "real low-light detail varies across the sampled image");
  assert.ok(darkConcertProfile.spatialRange >= 12, "real low-light detail has a meaningful channel range");
  assert.equal(videoPosterFrameIsUsable(darkConcertProfile), true);
  assert.equal(videoPosterFrameIsStrong(darkConcertProfile), false,
    "a subtle usable frame must not stop remote sampling before a clearer stage frame");
  assert.equal(videoPosterFrameIsUsable(videoPosterFrameProfile(concert)), true);
  assert.equal(videoPosterFrameIsStrong(videoPosterFrameProfile(concert)), true);
  assert.equal(videoPosterFrameIsUsable(videoPosterFrameProfile(nearBlackGrey)), false);
  assert.equal(videoPosterFrameIsUsable(videoPosterFrameProfile(blownStage)), false);
  assert.equal(videoPosterFrameIsUsable(videoPosterFrameProfile(solidDarkRed)), false);
  assert.equal(videoPosterFrameIsStrong(videoPosterFrameProfile(solidDarkRed)), false);
  assert.equal(videoPosterFrameIsUsable(videoPosterFrameProfile(solidRed)), false);
  assert.equal(videoPosterFrameIsStrong(videoPosterFrameProfile(solidRed)), false);
  const alexBlankProfile = videoPosterFrameProfile(alexBlankCapture);
  assert.equal(alexBlankProfile.spatialVariation, 0);
  assert.equal(videoPosterFrameIsUsable(alexBlankProfile), false);
  const compressedBlankProfile = videoPosterFrameProfile(compressedBlankIntro);
  assert.equal(compressedBlankProfile.spatialVariation, 4);
  assert.equal(compressedBlankProfile.spatialRange, 8);
  assert.equal(videoPosterFrameIsUsable(compressedBlankProfile), false);
  assert.equal(videoPosterFrameIsStrong(compressedBlankProfile), false,
    "remote generation must continue past a noisy blank 350ms frame");
  const widerCompressedBlankProfile = videoPosterFrameProfile(widerCompressedBlankIntro);
  assert.equal(widerCompressedBlankProfile.spatialVariation, 6);
  assert.equal(widerCompressedBlankProfile.spatialRange, 12);
  assert.equal(widerCompressedBlankProfile.paletteSize, 2);
  assert.equal(videoPosterFrameIsUsable(widerCompressedBlankProfile), false);
  assert.equal(videoPosterFrameIsStrong(widerCompressedBlankProfile), false);
  assert.equal(videoPosterFrameIsUsable(videoPosterFrameProfile(black)), false);
  assert.equal(videoPosterFrameIsUsable(videoPosterFrameProfile(white)), false);
  assert.equal(videoPosterFrameIsUsable(videoPosterFrameProfile(flatGrey)), false);
  assert.equal(videoPosterFrameIsUsable(videoPosterFrameProfile(null)), false);
  assert.equal(videoPosterFrameScore(null), Number.NEGATIVE_INFINITY);
});

test("poster filenames and errors remain stable and privacy-safe", () => {
  assert.equal(videoPosterFileName({ fileName: "../My Crowd.mov" }), "My Crowd-pit-poster.jpg");
  assert.equal(videoPosterFileName({ fileName: "🔥.mp4" }), "pit-video-pit-poster.jpg");
  const existing = new VideoPosterError(VIDEO_POSTER_ERROR_CODES.aborted);
  assert.equal(videoPosterError(existing, VIDEO_POSTER_ERROR_CODES.frameFailed), existing);
  const wrapped = videoPosterError(new Error("private details"), VIDEO_POSTER_ERROR_CODES.encodeFailed);
  assert.equal(wrapped.code, "PIT_POSTER_ENCODE_FAILED");
  assert.equal(wrapped.message, "The preview frame could not be saved.");
  assert.match(new VideoPosterError(VIDEO_POSTER_ERROR_CODES.lowQuality).message, /Choose a cover frame/);
});

test("native automatic covers score multiple decoded frames before full-quality export", () => {
  const source = readFileSync(new URL("../lib/videoPoster.native.js", import.meta.url), "utf8");
  assert.match(source, /candidateTimes\.map\(\(time\) => time \/ 1_000\)/);
  assert.match(source, /scoreNativeThumbnail\(thumbnail\)/);
  assert.match(source, /videoPosterFrameProfile\(pixels\)/);
  assert.match(source, /videoPosterFrameIsUsable\(profile\)/);
  assert.match(source, /profile\.score > best\.profile\.score/);
  assert.match(source, /if \(!normalized\.explicitTime/);
  assert.match(source, /\[requestedTimeMs \/ 1_000\][\s\S]*maxWidth: normalized\.maxDimension/);
  assert.match(source, /const workTracker = createVideoPosterWorkTracker\(\)/);
  assert.match(source, /markVideoPosterPermitUntil\(result, workTracker\.settled\)/);
  assert.equal(
    (source.match(/deferredCleanup\([^;]*workTracker\);/g) || []).length,
    4,
    "every deferred native operation must retain its scheduler permit through cleanup",
  );
});

test("web legacy covers preserve output time without degrading local cover selection", () => {
  const source = readFileSync(new URL("../lib/videoPoster.web.js", import.meta.url), "utf8");
  assert.match(source, /const outputReserveMs = Math\.min\([\s\S]*REMOTE_POSTER_OUTPUT_RESERVE_MS[\s\S]*Math\.floor\(remainingMs \* 0\.35\)[\s\S]*const availableScoringMs = remainingMs - outputReserveMs/);
  assert.match(source, /source\.crossOrigin && error\?\.code === VIDEO_POSTER_ERROR_CODES\.timeout && best\) break/);
  assert.match(source, /if \(source\.crossOrigin && videoPosterFrameIsStrong\(profile\)\) break/);
  assert.match(source, /normalized\.explicitTime \|\| videoPosterFrameIsUsable\(profile\)/);
  assert.match(source, /profile\.score > best\.profile\.score/);
});
