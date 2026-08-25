import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

import { MAX_IMAGE_PIXELS } from "./imageInspection.js";

const MAX_ACTIVE_IMAGE_JOBS = 1;
const MAX_IMAGE_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_OUTPUT_BYTES = 12 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;
const CHILD_HEAP_MIB = 160;
const WORKER_PATH = fileURLToPath(new URL("./imageProcessorWorker.js", import.meta.url));

let activeImageJobs = 0;

export class ImageProcessorError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "ImageProcessorError";
    this.code = code;
  }
}

function normalizedTimeout(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1_000, Math.min(30_000, Math.trunc(numeric))) : DEFAULT_TIMEOUT_MS;
}

function inputBytes(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : null;
  if (!bytes || bytes.byteLength < 12 || bytes.byteLength > MAX_IMAGE_INPUT_BYTES) {
    throw new ImageProcessorError("resource_limit", "Image input exceeds the safe processing limit.");
  }
  return bytes;
}

function childEnvironment() {
  const env = {
    NODE_ENV: "production",
    UV_THREADPOOL_SIZE: "1",
    // Private uploads arrive as <=12 MiB buffers. Do not lower libvips' disk
    // threshold or opt decoded pixels into temp-file spill; file caching is
    // disabled inside the worker as a second independent control.
    VIPS_BLOCK_UNTRUSTED: "true",
    MALLOC_ARENA_MAX: "2",
  };
  for (const key of [
    "PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR",
    "LANG", "LC_ALL", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH",
  ]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return env;
}

function terminate(child) {
  if (!child?.pid) return;
  try { child.kill("SIGKILL"); }
  catch (error) { if (error?.code !== "ESRCH") void error; }
}

function normalizedWorkerResult(message, operation) {
  if (!message || typeof message !== "object") {
    throw new ImageProcessorError("worker_protocol", "Image verification returned an invalid response.");
  }
  if (!message.ok) {
    const code = /^[a-z0-9_]{1,64}$/i.test(String(message?.error?.code || ""))
      ? String(message.error.code)
      : "decode";
    const detail = typeof message?.error?.message === "string" && message.error.message
      ? message.error.message
      : "Image pixels could not be decoded safely.";
    throw new ImageProcessorError(code, detail);
  }
  const result = message.result;
  const width = Number(result?.width);
  const height = Number(result?.height);
  const pixels = Number(result?.pixels);
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1
      || !Number.isSafeInteger(pixels) || pixels !== width * height || pixels > MAX_IMAGE_PIXELS
      || typeof result?.mimeType !== "string") {
    throw new ImageProcessorError("worker_protocol", "Image verification returned invalid dimensions.");
  }
  if (operation === "validate") {
    return Object.freeze({ mimeType: result.mimeType, width, height, pixels });
  }
  const bytes = Buffer.isBuffer(result?.bytes)
    ? result.bytes
    : result?.bytes instanceof Uint8Array
      ? Buffer.from(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength)
      : null;
  const byteSize = Number(result?.byteSize);
  if (!bytes || !Number.isSafeInteger(byteSize) || byteSize !== bytes.byteLength
      || byteSize < 1 || byteSize > MAX_IMAGE_OUTPUT_BYTES) {
    throw new ImageProcessorError("worker_protocol", "Image verification returned an invalid rendition.");
  }
  return Object.freeze({ bytes, byteSize, mimeType: result.mimeType, width, height, pixels });
}

function runIsolatedImageJob(operation, bytes, options = {}) {
  if (activeImageJobs >= MAX_ACTIVE_IMAGE_JOBS) {
    return Promise.reject(new ImageProcessorError("busy", "Image verification capacity is full."));
  }
  const input = inputBytes(bytes);
  activeImageJobs += 1;
  return new Promise((resolve, reject) => {
    let child;
    let timer;
    let outcome = null;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeImageJobs = Math.max(0, activeImageJobs - 1);
    };
    const fail = (error) => {
      if (!outcome) outcome = { error };
      terminate(child);
    };
    try {
      child = fork(WORKER_PATH, [], {
        env: childEnvironment(),
        execArgv: [`--max-old-space-size=${CHILD_HEAP_MIB}`, "--max-semi-space-size=8"],
        serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      });
    } catch (error) {
      release();
      reject(new ImageProcessorError("worker_unavailable", "Image verification could not start.", error));
      return;
    }
    timer = setTimeout(() => {
      fail(new ImageProcessorError("timeout", "Image verification timed out."));
    }, normalizedTimeout(options.timeoutMs));
    timer.unref?.();
    child.once("message", (message) => {
      if (outcome) return;
      try { outcome = { value: normalizedWorkerResult(message, operation) }; }
      catch (error) { outcome = { error }; }
      terminate(child);
    });
    child.once("error", (error) => {
      fail(new ImageProcessorError("worker_unavailable", "Image verification process failed.", error));
    });
    child.once("close", () => {
      clearTimeout(timer);
      release();
      if (!outcome) {
        reject(new ImageProcessorError("worker_unavailable", "Image verification ended without a result."));
      } else if (outcome.error) {
        reject(outcome.error);
      } else {
        resolve(outcome.value);
      }
    });
    try {
      child.send({
        operation,
        bytes: input,
        expectedType: options.expectedType,
        outputType: options.outputType,
        maxOutputBytes: options.maxOutputBytes,
        // HEVC-backed HEIC decoding is intentionally recovery-only. Keeping
        // this as an explicit, strict boolean prevents ordinary upload routes
        // from silently acquiring a second decoder surface.
        allowHeicFallback: options.allowHeicFallback === true,
      }, (error) => {
        if (error) fail(new ImageProcessorError("worker_unavailable", "Image verification input could not be delivered.", error));
      });
    } catch (error) {
      fail(new ImageProcessorError("worker_unavailable", "Image verification input could not be delivered.", error));
    }
  });
}

export async function validateDecodedImage(bytes, {
  expectedType,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return runIsolatedImageJob("validate", bytes, { expectedType, timeoutMs });
}

export async function sanitizeDecodedImage(bytes, {
  expectedType,
  outputType = expectedType,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = MAX_IMAGE_OUTPUT_BYTES,
  allowHeicFallback = false,
} = {}) {
  return runIsolatedImageJob("sanitize", bytes, {
    expectedType,
    outputType,
    timeoutMs,
    maxOutputBytes,
    allowHeicFallback: allowHeicFallback === true,
  });
}

export function imageProcessorHealth() {
  return Object.freeze({
    available: true,
    isolation: "child_process",
    active: activeImageJobs,
    capacity: MAX_ACTIVE_IMAGE_JOBS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    childHeapMiB: CHILD_HEAP_MIB,
    maxInputBytes: MAX_IMAGE_INPUT_BYTES,
    maxPixels: MAX_IMAGE_PIXELS,
    maxOutputBytes: MAX_IMAGE_OUTPUT_BYTES,
    diskCache: false,
    untrustedOperationsBlocked: true,
    sharpVersion: "isolated-worker",
    vipsVersion: "isolated-worker",
  });
}
