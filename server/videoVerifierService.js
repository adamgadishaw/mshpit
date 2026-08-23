import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

import {
  VIDEO_VERIFIER_PIPELINE_VERSION,
  VIDEO_VERIFIER_PROTOCOL_VERSION,
  signVideoVerifierResponse,
  verifyVideoVerifierRequest,
} from "./videoVerifierProtocol.js";

const REQUEST_MAX_BYTES = 16 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const VIDEO_MAX_DURATION_MS = 60_000;
const VIDEO_MAX_EDGE = 4_096;
const VIDEO_MAX_SAMPLES = 3_602;
const VIDEO_MAX_CODED_PIXEL_SAMPLES = 120n * 68n * 256n * 60n * 60n;
const POSTER_MAX_BYTES = 1_500_000;
const POSTER_MAX_EDGE = 1_280;
const JOB_TIMEOUT_MS = 50_000;
const COMMAND_OUTPUT_MAX_BYTES = 64 * 1024;
const HEALTH_FRESH_MS = 60_000;
const NONCE_TTL_MS = 2 * 60_000;
const NONCE_CACHE_MAX = 2_048;
const OBJECT_KEY = /^users\/[A-Za-z0-9_-]{1,128}\/post\/[A-Za-z0-9_-]{1,240}\.mp4$/;
const STRONG_ETAG = /^"[\x21\x23-\x7e]{1,200}"$/u;
const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_RENDER_PORTS = new Set([10_000, 18_012, 18_013, 19_099]);
const ISO_MP4_MAJOR_BRANDS = new Set(["isom", "mp41", "mp42"]);
const ISO_MP4_COMPATIBLE_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "avc1", "mp41", "mp42"]);

function serviceError(code, message, { status = 422, cause } = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.status = status;
  return error;
}

function boundedInteger(value, { min, max, label }) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw serviceError("invalid_request", `${label} is invalid.`);
  }
  return number;
}

function cleanExecutable(value, fallback) {
  const executable = String(value || fallback).trim();
  return /^[A-Za-z0-9._/-]{1,240}$/.test(executable) ? executable : null;
}

function checkedStorageBase(value) {
  let url;
  try { url = new URL(String(value || "")); }
  catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  return url;
}

export function getVideoVerifierServiceConfig(env = process.env) {
  const secret = String(env?.PIT_VIDEO_VERIFIER_SECRET || "");
  const sourceStorageBase = checkedStorageBase(env?.PIT_VIDEO_SOURCE_ORIGIN);
  const sourceBucket = String(env?.PIT_VIDEO_SOURCE_BUCKET || "").trim();
  const outputStorageBase = checkedStorageBase(env?.PIT_VIDEO_OUTPUT_ORIGIN || env?.MEDIA_ENDPOINT);
  const outputBucket = String(env?.PIT_VIDEO_OUTPUT_BUCKET || env?.MEDIA_BUCKET || "").trim();
  const ffmpeg = cleanExecutable(env?.PIT_FFMPEG_PATH, "ffmpeg");
  const ffprobe = cleanExecutable(env?.PIT_FFPROBE_PATH, "ffprobe");
  const port = Number(env?.PORT || 10_001);
  const configured = Buffer.byteLength(secret, "utf8") >= 32
    && Buffer.byteLength(secret, "utf8") <= 1_024
    && !!sourceStorageBase
    && !!outputStorageBase
    && /^[A-Za-z0-9._-]{3,255}$/.test(sourceBucket)
    && /^[A-Za-z0-9._-]{3,255}$/.test(outputBucket)
    && sourceBucket !== outputBucket
    && !!ffmpeg
    && !!ffprobe
    && Number.isSafeInteger(port)
    && port >= 1
    && port <= 65_535
    && !FORBIDDEN_RENDER_PORTS.has(port);
  return configured
    ? { configured, secret, sourceStorageBase, sourceBucket, outputStorageBase, outputBucket, ffmpeg, ffprobe, port }
    : { configured: false, port: Number.isSafeInteger(port) ? port : 10_001 };
}

function safeChildEnvironment(directory) {
  // Never pass the HMAC secret or signed storage capability through a decoder's
  // environment. FFmpeg sees one random local file in an otherwise empty temp
  // directory and receives no application credentials.
  return {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    TMPDIR: directory,
  };
}

function killProcessGroup(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") child.kill?.("SIGKILL");
  }
}

export function runVerifierProcess(executable, args, {
  cwd,
  signal,
  outputLimit = COMMAND_OUTPUT_MAX_BYTES,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout = [];
    const stderr = [];
    let child;
    try {
      child = spawn(executable, args, {
        cwd,
        env: safeChildEnvironment(cwd),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      reject(serviceError("decoder_unavailable", "Decoder process could not start.", { status: 503, cause: error }));
      return;
    }
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    let abortError = null;
    const onAbort = () => {
      abortError = serviceError("job_cancelled", "Decoder job was cancelled.", { status: 503, cause: signal?.reason });
      killProcessGroup(child);
    };
    const collect = (list, chunk, stream) => {
      const bytes = Buffer.byteLength(chunk);
      if (stream === "stdout") stdoutBytes += bytes;
      else stderrBytes += bytes;
      if (stdoutBytes + stderrBytes > outputLimit) {
        killProcessGroup(child);
        finish(serviceError("decoder_output_invalid", "Decoder produced too much diagnostic output.", { status: 503 }));
        return;
      }
      list.push(Buffer.from(chunk));
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk) => collect(stderr, chunk, "stderr"));
    child.on("error", (error) => finish(serviceError("decoder_unavailable", "Decoder process failed.", { status: 503, cause: error })));
    child.on("close", (code, closeSignal) => {
      if (abortError) {
        finish(abortError);
        return;
      }
      if (code !== 0) {
        finish(serviceError("decode_failed", "Media decode failed.", {
          status: 422,
          cause: new Error(`decoder exit=${String(code)} signal=${String(closeSignal || "none")}`),
        }));
        return;
      }
      finish(null, {
        stdout: Buffer.concat(stdout, stdoutBytes).toString("utf8"),
        stderr: Buffer.concat(stderr, stderrBytes).toString("utf8"),
      });
    });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function expectedObjectPath(storageBase, bucket, objectKey) {
  const encode = (part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const prefix = storageBase.pathname.replace(/\/+$/, "");
  return `${prefix}/${[bucket, ...objectKey.split("/")].map(encode).join("/")}`;
}

export function validateVideoVerifierJob(payload, config) {
  if (payload?.protocol !== VIDEO_VERIFIER_PROTOCOL_VERSION) {
    throw serviceError("incompatible_protocol", "Verifier protocol is incompatible.");
  }
  const object = payload?.object;
  const objectKey = String(object?.key || "");
  const byteSize = boundedInteger(object?.byteSize, { min: 1, max: VIDEO_MAX_BYTES, label: "Object size" });
  const etag = String(object?.etag || "");
  if (!OBJECT_KEY.test(objectKey) || object?.contentType !== "video/mp4" || !STRONG_ETAG.test(etag)) {
    throw serviceError("invalid_request", "Object identity is invalid.");
  }
  let downloadUrl;
  try { downloadUrl = new URL(String(object?.downloadUrl || "")); }
  catch { throw serviceError("invalid_request", "Object capability is invalid."); }
  if (downloadUrl.protocol !== "https:"
      || downloadUrl.origin !== config.sourceStorageBase.origin
      || downloadUrl.pathname !== expectedObjectPath(config.sourceStorageBase, config.sourceBucket, objectKey)
      || downloadUrl.username
      || downloadUrl.password
      || downloadUrl.hash) {
    throw serviceError("invalid_request", "Object capability is invalid.");
  }
  const allowedQuery = new Set([
    "X-Amz-Algorithm",
    "X-Amz-Credential",
    "X-Amz-Date",
    "X-Amz-Expires",
    "X-Amz-SignedHeaders",
    "X-Amz-Signature",
  ]);
  for (const key of downloadUrl.searchParams.keys()) {
    if (!allowedQuery.has(key) || downloadUrl.searchParams.getAll(key).length !== 1) {
      throw serviceError("invalid_request", "Object capability is invalid.");
    }
  }
  if (downloadUrl.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256"
      || downloadUrl.searchParams.get("X-Amz-SignedHeaders") !== "host;if-match"
      || !/^[a-f0-9]{64}$/.test(String(downloadUrl.searchParams.get("X-Amz-Signature") || ""))
      || !/^[0-9]{8}T[0-9]{6}Z$/.test(String(downloadUrl.searchParams.get("X-Amz-Date") || ""))) {
    throw serviceError("invalid_request", "Object capability is invalid.");
  }
  const expires = boundedInteger(downloadUrl.searchParams.get("X-Amz-Expires"), {
    min: 30,
    max: 120,
    label: "Object capability lifetime",
  });
  const credential = String(downloadUrl.searchParams.get("X-Amz-Credential") || "");
  if (!/^[A-Za-z0-9._-]{1,255}\/[0-9]{8}\/[A-Za-z0-9._-]{1,100}\/s3\/aws4_request$/.test(credential)) {
    throw serviceError("invalid_request", "Object capability is invalid.");
  }
  const downloadHeaders = object?.downloadHeaders;
  if (!downloadHeaders || Object.keys(downloadHeaders).length !== 1 || downloadHeaders["If-Match"] !== etag) {
    throw serviceError("invalid_request", "Object generation binding is invalid.");
  }
  const structural = {
    width: boundedInteger(payload?.structural?.width, { min: 1, max: VIDEO_MAX_EDGE, label: "Video width" }),
    height: boundedInteger(payload?.structural?.height, { min: 1, max: VIDEO_MAX_EDGE, label: "Video height" }),
    codedWidth: boundedInteger(payload?.structural?.codedWidth, { min: 16, max: VIDEO_MAX_EDGE, label: "Coded video width" }),
    codedHeight: boundedInteger(payload?.structural?.codedHeight, { min: 16, max: VIDEO_MAX_EDGE, label: "Coded video height" }),
    sampleCount: boundedInteger(payload?.structural?.sampleCount, { min: 1, max: VIDEO_MAX_SAMPLES, label: "Video sample count" }),
    durationMs: boundedInteger(payload?.structural?.durationMs, { min: 1, max: VIDEO_MAX_DURATION_MS, label: "Video duration" }),
  };
  const sampleLimit = Math.floor((structural.durationMs * 60) / 1_000) + 2;
  const codedWork = BigInt(structural.codedWidth) * BigInt(structural.codedHeight) * BigInt(structural.sampleCount);
  if (structural.codedWidth % 16 !== 0 || structural.codedHeight % 16 !== 0
      || structural.codedWidth < structural.width || structural.codedHeight < structural.height
      || structural.sampleCount > sampleLimit || codedWork > VIDEO_MAX_CODED_PIXEL_SAMPLES) {
    throw serviceError("invalid_request", "Video decode-work proof is invalid.");
  }
  const poster = {
    timeMs: boundedInteger(payload?.poster?.timeMs, { min: 0, max: structural.durationMs - 1, label: "Poster time" }),
    maxBytes: boundedInteger(payload?.poster?.maxBytes, { min: 4, max: POSTER_MAX_BYTES, label: "Poster size limit" }),
    maxEdge: boundedInteger(payload?.poster?.maxEdge, { min: 64, max: POSTER_MAX_EDGE, label: "Poster edge limit" }),
  };
  if (payload?.poster?.contentType !== "image/jpeg") {
    throw serviceError("invalid_request", "Poster format is invalid.");
  }
  const output = payload?.output;
  const outputKey = String(output?.key || "");
  if (!OBJECT_KEY.test(outputKey) || outputKey === objectKey || output?.contentType !== "video/mp4") {
    throw serviceError("invalid_request", "Delivery identity is invalid.");
  }
  let uploadUrl;
  try { uploadUrl = new URL(String(output?.uploadUrl || "")); }
  catch { throw serviceError("invalid_request", "Delivery capability is invalid."); }
  if (uploadUrl.protocol !== "https:"
      || uploadUrl.origin !== config.outputStorageBase.origin
      || uploadUrl.pathname !== expectedObjectPath(config.outputStorageBase, config.outputBucket, outputKey)
      || uploadUrl.username || uploadUrl.password || uploadUrl.hash) {
    throw serviceError("invalid_request", "Delivery capability is invalid.");
  }
  for (const key of uploadUrl.searchParams.keys()) {
    if (!allowedQuery.has(key) || uploadUrl.searchParams.getAll(key).length !== 1) {
      throw serviceError("invalid_request", "Delivery capability is invalid.");
    }
  }
  if (uploadUrl.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256"
      || uploadUrl.searchParams.get("X-Amz-SignedHeaders") !== "content-type;host;if-none-match"
      || !/^[a-f0-9]{64}$/.test(String(uploadUrl.searchParams.get("X-Amz-Signature") || ""))) {
    throw serviceError("invalid_request", "Delivery capability is invalid.");
  }
  const uploadHeaders = output?.uploadHeaders;
  if (!uploadHeaders || Object.keys(uploadHeaders).length !== 2
      || uploadHeaders["Content-Type"] !== "video/mp4" || uploadHeaders["If-None-Match"] !== "*") {
    throw serviceError("invalid_request", "Delivery headers are invalid.");
  }
  return {
    objectKey, byteSize, etag, downloadUrl, downloadHeaders, structural, poster, expires,
    output: { key: outputKey, uploadUrl, uploadHeaders },
  };
}

async function downloadExactObject(job, filePath, { fetchImpl, signal }) {
  let response;
  try {
    response = await fetchImpl(job.downloadUrl, {
      method: "GET",
      redirect: "error",
      headers: job.downloadHeaders,
      signal,
    });
  } catch (error) {
    throw serviceError("storage_unavailable", "Source download failed.", { status: 503, cause: error });
  }
  if (response?.status !== 200) {
    if (response?.status === 404 || response?.status === 412) {
      throw serviceError("object_changed", "Source object no longer matches its verified generation.", { status: 409 });
    }
    throw serviceError("storage_unavailable", "Source download failed.", { status: 503 });
  }
  const contentType = String(response.headers?.get?.("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  const contentLength = Number(response.headers?.get?.("content-length"));
  const etag = String(response.headers?.get?.("etag") || "").trim();
  if (contentType !== "video/mp4" || contentLength !== job.byteSize || etag !== job.etag || !response.body) {
    throw serviceError("object_changed", "Source object no longer matches its verified generation.", { status: 409 });
  }
  let observed = 0;
  const limiter = new TransformStream({
    transform(chunk, controller) {
      observed += chunk.byteLength;
      if (observed > job.byteSize) {
        controller.error(serviceError("object_changed", "Source object exceeded its signed size.", { status: 409 }));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  try {
    await pipeline(
      createReadStreamFromWeb(response.body.pipeThrough(limiter)),
      createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
      { signal },
    );
  } catch (error) {
    if (error?.code === "object_changed") throw error;
    throw serviceError("storage_unavailable", "Source download failed.", { status: 503, cause: error });
  }
  if (observed !== job.byteSize) {
    throw serviceError("object_changed", "Source object ended before its signed size.", { status: 409 });
  }
}

function createReadStreamFromWeb(stream) {
  // Node 24 implements Readable.fromWeb, but importing through node:stream here
  // would obscure the only conversion boundary. The async iterable returned by
  // a fetch body is accepted directly by pipeline.
  return stream;
}

function parseProbeJson(text, label) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw serviceError("decode_failed", `${label} metadata is invalid.`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw serviceError("decode_failed", `${label} metadata is invalid.`);
  }
  return value;
}

async function probeVideo(filePath, config, { runProcess, directory, signal }) {
  const result = await runProcess(config.ffprobe, [
    "-v", "error",
    "-protocol_whitelist", "file,pipe",
    "-f", "mov",
    "-show_entries", "stream=codec_type,codec_name,codec_tag_string,profile,level,pix_fmt,width,height,coded_width,coded_height,field_order,sample_aspect_ratio,avg_frame_rate,r_frame_rate,channels,channel_layout,sample_rate:stream_disposition=attached_pic:stream_tags=rotate:stream_side_data=rotation:format=format_name,duration:format_tags=major_brand,compatible_brands",
    "-of", "json",
    filePath,
  ], { cwd: directory, signal });
  const probe = parseProbeJson(result.stdout, "Video");
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.filter((stream) => stream?.codec_type === "video");
  const audio = streams.filter((stream) => stream?.codec_type === "audio");
  const unknown = streams.filter((stream) => !new Set(["video", "audio"]).has(stream?.codec_type));
  const formatNames = String(probe.format?.format_name || "").split(",");
  const majorBrand = String(probe.format?.tags?.major_brand || "");
  const compatibleRaw = String(probe.format?.tags?.compatible_brands || "");
  const compatibleBrands = compatibleRaw.length % 4 === 0
    ? Array.from({ length: compatibleRaw.length / 4 }, (_, index) => compatibleRaw.slice(index * 4, index * 4 + 4))
    : [];
  const durationMs = Math.round(Number(probe.format?.duration) * 1_000);
  const frameRate = (value) => {
    const match = /^([0-9]+)\/([1-9][0-9]*)$/.exec(String(value || ""));
    return match ? Number(match[1]) / Number(match[2]) : Number.NaN;
  };
  const avgFps = frameRate(video[0]?.avg_frame_rate);
  const realFps = frameRate(video[0]?.r_frame_rate);
  const videoProfile = String(video[0]?.profile || "");
  const videoLevel = Number(video[0]?.level);
  const audioProfile = String(audio[0]?.profile || "");
  const sampleRate = Number(audio[0]?.sample_rate);
  const codedWidth = Number(video[0]?.coded_width);
  const codedHeight = Number(video[0]?.coded_height);
  const estimatedSamples = Number.isFinite(avgFps) && Number.isFinite(realFps) && Number.isSafeInteger(durationMs)
    ? Math.ceil(Math.max(avgFps, realFps) * (durationMs / 1_000))
    : VIDEO_MAX_SAMPLES + 1;
  const estimatedCodedWork = Number.isSafeInteger(codedWidth) && Number.isSafeInteger(codedHeight)
      && Number.isSafeInteger(estimatedSamples)
    ? BigInt(codedWidth) * BigInt(codedHeight) * BigInt(estimatedSamples)
    : VIDEO_MAX_CODED_PIXEL_SAMPLES + 1n;
  if (video.length !== 1 || video[0]?.codec_name !== "h264"
      || video[0]?.codec_tag_string !== "avc1"
      || !new Set(["Baseline", "Constrained Baseline", "Main", "High"]).has(videoProfile)
      || !Number.isInteger(videoLevel) || videoLevel < 10 || videoLevel > 51
      || video[0]?.pix_fmt !== "yuv420p"
      || video[0]?.field_order !== "progressive"
      || video[0]?.sample_aspect_ratio !== "1:1"
      || video[0]?.disposition?.attached_pic === 1
      || !Number.isFinite(avgFps) || avgFps <= 0 || avgFps > 60.01
      || !Number.isFinite(realFps) || realFps <= 0 || realFps > 60.01
      || audio.length > 1 || audio.some((stream) => stream?.codec_name !== "aac" || stream?.codec_tag_string !== "mp4a")
      || (audio.length && (audioProfile !== "LC"
        || !new Set([1, 2]).has(Number(audio[0]?.channels))
        || !new Set(["mono", "stereo"]).has(String(audio[0]?.channel_layout || ""))
        || !Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000))
      || !Number.isSafeInteger(codedWidth) || !Number.isSafeInteger(codedHeight)
      || codedWidth % 16 !== 0 || codedHeight % 16 !== 0
      || codedWidth < Number(video[0]?.width) || codedHeight < Number(video[0]?.height)
      || estimatedSamples > VIDEO_MAX_SAMPLES || estimatedCodedWork > VIDEO_MAX_CODED_PIXEL_SAMPLES
      || unknown.length || !formatNames.includes("mp4")
      || !ISO_MP4_MAJOR_BRANDS.has(majorBrand) || !compatibleBrands.length
      || compatibleBrands.some((brand) => !ISO_MP4_COMPATIBLE_BRANDS.has(brand))
      || !Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > VIDEO_MAX_DURATION_MS) {
    throw serviceError("unsupported_media", "Clip must be a bounded H.264/AAC MP4.");
  }
  const width = boundedInteger(video[0]?.width, { min: 1, max: VIDEO_MAX_EDGE, label: "Decoded width" });
  const height = boundedInteger(video[0]?.height, { min: 1, max: VIDEO_MAX_EDGE, label: "Decoded height" });
  const rotations = [
    video[0]?.tags?.rotate,
    ...(Array.isArray(video[0]?.side_data_list) ? video[0].side_data_list.map((item) => item?.rotation) : []),
  ].filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => ((Number(value) % 360) + 360) % 360);
  if (rotations.some((value) => ![0, 90, 180, 270].includes(value))
      || rotations.some((value) => value !== rotations[0])) {
    throw serviceError("unsupported_media", "Clip rotation metadata is invalid.");
  }
  const rotation = rotations[0] || 0;
  return {
    width,
    height,
    codedWidth,
    codedHeight,
    durationMs,
    rotation,
    codec: "h264",
    audioCodec: audio.length ? "aac" : "none",
  };
}

async function decodeAllStreams(filePath, config, { runProcess, directory, signal }) {
  await runProcess(config.ffmpeg, [
    "-nostdin",
    "-v", "error",
    "-xerror",
    "-err_detect", "explode",
    "-threads", "2",
    "-filter_threads", "1",
    "-protocol_whitelist", "file,pipe",
    "-f", "mov",
    "-i", filePath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-f", "null",
    "-",
  ], { cwd: directory, signal });
}

async function transcodeSanitizedDelivery(sourcePath, deliveryPath, config, { runProcess, directory, signal }) {
  const videoFilter = "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1";
  await runProcess(config.ffmpeg, [
    "-nostdin", "-v", "error", "-xerror", "-err_detect", "explode",
    "-threads", "2", "-filter_threads", "1",
    "-protocol_whitelist", "file,pipe", "-f", "mov", "-i", sourcePath,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", videoFilter,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
    "-profile:v", "high", "-level:v", "4.2", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-profile:a", "aac_low", "-ac", "2", "-ar", "48000", "-b:a", "160k",
    "-map_metadata", "-1", "-map_chapters", "-1", "-metadata:s:v:0", "rotate=0",
    "-movflags", "+faststart", "-brand", "mp42", "-f", "mp4", "-y", deliveryPath,
  ], { cwd: directory, signal });
  const file = await stat(deliveryPath);
  if (!file.isFile() || file.size < 16 || file.size > VIDEO_MAX_BYTES) {
    throw serviceError("delivery_invalid", "Sanitized delivery is outside its byte limit.");
  }
  const video = await probeVideo(deliveryPath, config, { runProcess, directory, signal });
  if (video.rotation !== 0) throw serviceError("delivery_invalid", "Sanitized delivery retained rotation metadata.");
  await decodeAllStreams(deliveryPath, config, { runProcess, directory, signal });
  return { file, video };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function uploadSanitizedDelivery(job, deliveryPath, delivery, { fetchImpl, signal }) {
  const sha256 = await sha256File(deliveryPath);
  let response;
  try {
    response = await fetchImpl(job.output.uploadUrl, {
      method: "PUT",
      redirect: "error",
      headers: { ...job.output.uploadHeaders, "Content-Length": String(delivery.file.size) },
      body: createReadStream(deliveryPath),
      duplex: "half",
      signal,
    });
  } catch (error) {
    throw serviceError("storage_unavailable", "Sanitized delivery upload failed.", { status: 503, cause: error });
  }
  if (!response || !((response.status >= 200 && response.status < 300) || response.status === 412)) {
    throw serviceError("storage_unavailable", "Sanitized delivery upload failed.", { status: 503 });
  }
  return {
    key: job.output.key,
    contentType: "video/mp4",
    byteSize: delivery.file.size,
    sha256,
    width: delivery.video.width,
    height: delivery.video.height,
    durationMs: delivery.video.durationMs,
    rotation: 0,
    codec: delivery.video.codec,
    audioCodec: delivery.video.audioCodec,
    uploadStatus: response.status === 412 ? "existing" : "created",
  };
}

async function generateAndVerifyPoster(filePath, posterPath, job, video, config, { runProcess, directory, signal }) {
  const seconds = (job.poster.timeMs / 1_000).toFixed(3);
  const scale = `scale=w='min(${job.poster.maxEdge},iw)':h='min(${job.poster.maxEdge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`;
  await runProcess(config.ffmpeg, [
    "-nostdin",
    "-v", "error",
    "-xerror",
    "-threads", "2",
    "-filter_threads", "1",
    "-protocol_whitelist", "file,pipe",
    "-ss", seconds,
    "-f", "mov",
    "-i", filePath,
    "-map", "0:v:0",
    "-frames:v", "1",
    "-vf", scale,
    "-map_metadata", "-1",
    "-q:v", "4",
    "-f", "image2",
    "-y",
    posterPath,
  ], { cwd: directory, signal });
  const file = await stat(posterPath);
  if (!file.isFile() || file.size < 4 || file.size > job.poster.maxBytes) {
    throw serviceError("poster_invalid", "Generated cover is outside its byte limit.");
  }
  const probeResult = await runProcess(config.ffprobe, [
    "-v", "error",
    "-f", "image2",
    "-c:v", "mjpeg",
    "-show_entries", "stream=codec_type,codec_name,width,height",
    "-of", "json",
    posterPath,
  ], { cwd: directory, signal });
  const probe = parseProbeJson(probeResult.stdout, "Poster");
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  if (streams.length !== 1 || streams[0]?.codec_type !== "video" || streams[0]?.codec_name !== "mjpeg") {
    throw serviceError("poster_invalid", "Generated cover codec is invalid.");
  }
  const width = boundedInteger(streams[0]?.width, { min: 1, max: job.poster.maxEdge, label: "Poster width" });
  const height = boundedInteger(streams[0]?.height, { min: 1, max: job.poster.maxEdge, label: "Poster height" });
  const displayWidth = video.rotation === 90 || video.rotation === 270 ? video.height : video.width;
  const displayHeight = video.rotation === 90 || video.rotation === 270 ? video.width : video.height;
  const sourceRatio = displayWidth / displayHeight;
  const posterRatio = width / height;
  if (Math.abs(sourceRatio - posterRatio) > Math.max(0.02, sourceRatio * 0.02)) {
    throw serviceError("poster_invalid", "Generated cover orientation is invalid.");
  }
  // Decode the generated artifact independently. Successful encode alone is not
  // accepted as proof that the returned JPEG can be consumed by clients.
  await runProcess(config.ffmpeg, [
    "-nostdin",
    "-v", "error",
    "-xerror",
    "-threads", "1",
    "-protocol_whitelist", "file,pipe",
    "-f", "image2",
    "-c:v", "mjpeg",
    "-i", posterPath,
    "-frames:v", "1",
    "-f", "null",
    "-",
  ], { cwd: directory, signal });
  const bytes = await readFile(posterPath);
  if (bytes.byteLength !== file.size || bytes[0] !== 0xff || bytes[1] !== 0xd8
      || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw serviceError("poster_invalid", "Generated cover bytes are invalid.");
  }
  return {
    contentType: "image/jpeg",
    byteSize: bytes.byteLength,
    width,
    height,
    timeMs: job.poster.timeMs,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    dataBase64: bytes.toString("base64"),
  };
}

export async function runVideoVerifierJob(payload, {
  config,
  fetchImpl = globalThis.fetch,
  runProcess = runVerifierProcess,
  signal,
  temporaryRoot = tmpdir(),
} = {}) {
  if (!config?.configured || typeof fetchImpl !== "function") {
    throw serviceError("decoder_unavailable", "Verifier is not configured.", { status: 503 });
  }
  const job = validateVideoVerifierJob(payload, config);
  const directory = await mkdtemp(join(temporaryRoot, "pit-video-verify-"));
  const sourcePath = join(directory, "source.mp4");
  const deliveryPath = join(directory, "delivery.mp4");
  const posterPath = join(directory, "poster.jpg");
  try {
    await downloadExactObject(job, sourcePath, { fetchImpl, signal });
    const video = await probeVideo(sourcePath, config, { runProcess, directory, signal });
    if (video.width !== job.structural.width
        || video.height !== job.structural.height
        || video.codedWidth !== job.structural.codedWidth
        || video.codedHeight !== job.structural.codedHeight
        || Math.abs(video.durationMs - job.structural.durationMs) > 1_500) {
      throw serviceError("metadata_mismatch", "Decoded clip does not match structural preflight.", { status: 409 });
    }
    await decodeAllStreams(sourcePath, config, { runProcess, directory, signal });
    const delivery = await transcodeSanitizedDelivery(sourcePath, deliveryPath, config, { runProcess, directory, signal });
    const poster = await generateAndVerifyPoster(deliveryPath, posterPath, job, delivery.video, config, { runProcess, directory, signal });
    if (!SHA256.test(poster.sha256)) throw serviceError("poster_invalid", "Generated cover hash is invalid.");
    const published = await uploadSanitizedDelivery(job, deliveryPath, delivery, { fetchImpl, signal });
    return {
      ok: true,
      protocol: VIDEO_VERIFIER_PROTOCOL_VERSION,
      pipeline: VIDEO_VERIFIER_PIPELINE_VERSION,
      object: { key: job.objectKey, byteSize: job.byteSize, etag: job.etag },
      video,
      delivery: published,
      poster,
    };
  } finally {
    // The directory was created by mkdtemp under the configured temp root and
    // never contains user-derived path segments. Cleanup runs on success,
    // timeout, client disconnect, decode failure, and service shutdown.
    await rm(directory, { recursive: true, force: true });
  }
}

async function prerequisiteProbe(config, { runProcess, signal, temporaryRoot }) {
  const directory = await mkdtemp(join(temporaryRoot, "pit-video-health-"));
  const posterPath = join(directory, "probe.jpg");
  try {
    const ffmpeg = await runProcess(config.ffmpeg, ["-version"], { cwd: directory, signal, outputLimit: 16 * 1024 });
    await runProcess(config.ffprobe, ["-version"], { cwd: directory, signal, outputLimit: 16 * 1024 });
    await runProcess(config.ffmpeg, [
      "-nostdin", "-v", "error", "-xerror",
      "-f", "lavfi", "-i", "color=c=black:s=16x16:d=0.04",
      "-frames:v", "1", "-q:v", "5", "-f", "image2", "-y", posterPath,
    ], { cwd: directory, signal });
    await runProcess(config.ffmpeg, [
      "-nostdin", "-v", "error", "-xerror", "-i", posterPath,
      "-frames:v", "1", "-f", "null", "-",
    ], { cwd: directory, signal });
    const probe = await runProcess(config.ffprobe, [
      "-v", "error", "-f", "image2", "-c:v", "mjpeg",
      "-show_entries", "stream=codec_name,width,height", "-of", "json", posterPath,
    ], { cwd: directory, signal });
    const metadata = parseProbeJson(probe.stdout, "Health poster");
    const stream = metadata.streams?.[0];
    if (metadata.streams?.length !== 1 || stream?.codec_name !== "mjpeg"
        || Number(stream?.width) !== 16 || Number(stream?.height) !== 16) {
      throw serviceError("decoder_unavailable", "Poster encoder/decoder health probe failed.", { status: 503 });
    }
    const firstLine = ffmpeg.stdout.split(/\r?\n/, 1)[0].replace(/[^A-Za-z0-9 ._+-]/g, "").slice(0, 80);
    return { ffmpegVersion: firstLine || "ffmpeg" };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readRequestBody(req, maxBytes = REQUEST_MAX_BYTES) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && (declared < 0 || declared > maxBytes)) {
    throw serviceError("request_too_large", "Request body is too large.", { status: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > maxBytes) throw serviceError("request_too_large", "Request body is too large.", { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

function sendJson(res, status, body, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function sendUnsignedError(res, status) {
  sendJson(res, status, JSON.stringify({ ok: false }));
}

function sendSigned(res, { config, path, requestNonce, status, payload }) {
  const signed = signVideoVerifierResponse({
    secret: config.secret,
    path,
    requestNonce,
    payload,
  });
  sendJson(res, status, signed.body, signed.headers);
}

function safeFailurePayload(error) {
  // No decoder stderr, filenames, source URL, query string, object key, or
  // user-controlled metadata crosses this boundary.
  const code = /^[a-z_]{2,40}$/.test(String(error?.code || "")) ? error.code : "verification_failed";
  return { ok: false, code };
}

function makeNonceLedger() {
  const values = new Map();
  return {
    reserve(nonce, at) {
      for (const [key, expiresAt] of values) {
        if (expiresAt <= at) values.delete(key);
      }
      if (values.has(nonce)) return false;
      while (values.size >= NONCE_CACHE_MAX) values.delete(values.keys().next().value);
      values.set(nonce, at + NONCE_TTL_MS);
      return true;
    },
    size() { return values.size; },
  };
}

export function createVideoVerifierService({
  env = process.env,
  fetchImpl = globalThis.fetch,
  runProcess = runVerifierProcess,
  temporaryRoot = tmpdir(),
  clock = () => Date.now(),
  verifyJob = runVideoVerifierJob,
  prerequisiteCheck = prerequisiteProbe,
} = {}) {
  const config = getVideoVerifierServiceConfig(env);
  const nonces = makeNonceLedger();
  const shutdown = new AbortController();
  let activeJob = null;
  let prerequisiteInFlight = null;
  let prerequisite = { checkedAt: 0, ffmpegVersion: null };

  const prerequisites = async (signal) => {
    const at = clock();
    if (prerequisite.checkedAt && at - prerequisite.checkedAt <= HEALTH_FRESH_MS) return prerequisite;
    if (activeJob) throw serviceError("busy", "Verifier is busy.", { status: 429 });
    if (prerequisiteInFlight) return prerequisiteInFlight;
    const probeSignal = AbortSignal.any([shutdown.signal, signal, AbortSignal.timeout(5_000)]);
    prerequisiteInFlight = prerequisiteCheck(config, { runProcess, signal: probeSignal, temporaryRoot })
      .then((result) => {
        prerequisite = { checkedAt: clock(), ffmpegVersion: result.ffmpegVersion };
        return prerequisite;
      })
      .finally(() => { prerequisiteInFlight = null; });
    return prerequisiteInFlight;
  };

  const handler = async (req, res) => {
    const path = String(req.url || "").split("?", 1)[0];
    if (req.method !== "POST" || !new Set(["/v2/health", "/v2/verify"]).has(path)) {
      sendUnsignedError(res, 404);
      return;
    }
    if (!config.configured || String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      sendUnsignedError(res, 503);
      return;
    }
    const requestAbort = new AbortController();
    const abortRequest = () => {
      if (!requestAbort.signal.aborted) requestAbort.abort(new Error("Verifier caller disconnected."));
    };
    req.once("aborted", abortRequest);
    res.once("close", () => {
      if (!res.writableEnded) abortRequest();
    });
    if (req.aborted || res.destroyed) {
      abortRequest();
      return;
    }
    let rawBody;
    let authenticated;
    try {
      rawBody = await readRequestBody(req);
      authenticated = verifyVideoVerifierRequest({
        secret: config.secret,
        path,
        body: rawBody,
        headers: req.headers,
        at: clock(),
      });
    } catch (error) {
      sendUnsignedError(res, Number(error?.status) || 401);
      return;
    }
    if (!nonces.reserve(authenticated.nonce, clock())) {
      sendSigned(res, {
        config,
        path,
        requestNonce: authenticated.nonce,
        status: 409,
        payload: { ok: false, code: "replay" },
      });
      return;
    }
    if (requestAbort.signal.aborted || req.aborted || res.destroyed) return;
    try {
      if (path === "/v2/health") {
        const ready = await prerequisites(requestAbort.signal);
        sendSigned(res, {
          config,
          path,
          requestNonce: authenticated.nonce,
          status: 200,
          payload: {
            ok: true,
            protocol: VIDEO_VERIFIER_PROTOCOL_VERSION,
            pipeline: VIDEO_VERIFIER_PIPELINE_VERSION,
            decoder: { ffmpeg: true, ffprobe: true, version: ready.ffmpegVersion },
            poster: { generated: true, decoded: true },
            storage: { privateInput: true, sanitizedOutput: true },
            concurrency: 1,
          },
        });
        return;
      }
      if (activeJob || prerequisiteInFlight) {
        sendSigned(res, {
          config,
          path,
          requestNonce: authenticated.nonce,
          status: 429,
          payload: { ok: false, code: "busy" },
        });
        return;
      }
      // Validate the full fixed-origin capability before reserving the only
      // decoder slot, so malformed authenticated requests do not block a valid
      // clip for the job timeout.
      validateVideoVerifierJob(authenticated.payload, config);
      const jobAbort = new AbortController();
      const abortJob = () => {
        if (!jobAbort.signal.aborted) jobAbort.abort(requestAbort.signal.reason || shutdown.signal.reason);
      };
      requestAbort.signal.addEventListener("abort", abortJob, { once: true });
      shutdown.signal.addEventListener("abort", abortJob, { once: true });
      const signal = AbortSignal.any([jobAbort.signal, AbortSignal.timeout(JOB_TIMEOUT_MS)]);
      const promise = verifyJob(authenticated.payload, {
        config,
        fetchImpl,
        runProcess,
        signal,
        temporaryRoot,
      });
      activeJob = { promise, abort: abortJob };
      try {
        const result = await promise;
        sendSigned(res, {
          config,
          path,
          requestNonce: authenticated.nonce,
          status: 200,
          payload: result,
        });
      } finally {
        requestAbort.signal.removeEventListener("abort", abortJob);
        shutdown.signal.removeEventListener("abort", abortJob);
        if (activeJob?.promise === promise) activeJob = null;
      }
    } catch (error) {
      if (!requestAbort.signal.aborted && !res.destroyed && !res.writableEnded) {
        const status = [409, 413, 422, 429, 503].includes(Number(error?.status)) ? Number(error.status) : 503;
        sendSigned(res, {
          config,
          path,
          requestNonce: authenticated.nonce,
          status,
          payload: safeFailurePayload(error),
        });
      }
    }
  };

  const server = createServer((req, res) => {
    handler(req, res).catch(() => sendUnsignedError(res, 503));
  });
  return {
    config,
    server,
    handler,
    status: () => ({
      configured: config.configured,
      active: !!activeJob,
      nonceCount: nonces.size(),
      prerequisitesCheckedAt: prerequisite.checkedAt || null,
    }),
    listen(port = config.port, host = "0.0.0.0") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          resolve(server.address());
        });
      });
    },
    async close() {
      if (!shutdown.signal.aborted) shutdown.abort(new Error("Video verifier is shutting down."));
      activeJob?.abort?.();
      if (!server.listening) return;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function main() {
  const service = createVideoVerifierService();
  if (!service.config.configured) {
    // Configuration names are not emitted because even a missing-name list can
    // reveal deployment topology. Render records the nonzero exit.
    process.stderr.write("[video-verifier] configuration invalid\n");
    process.exitCode = 1;
    return;
  }
  await service.listen();
  process.stdout.write(`[video-verifier] listening on port ${service.config.port}\n`);
  const stop = async () => {
    await service.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => { void stop(); });
  process.once("SIGINT", () => { void stop(); });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
