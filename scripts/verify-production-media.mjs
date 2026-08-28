import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  MEDIA_PUBLISHING_HEALTH_PATH,
  VIDEO_PUBLISHING_PIPELINE_VERSION,
} from "../src/domain/mediaPublishingCapabilities.mjs";

export const DEFAULT_PRODUCTION_MEDIA_ORIGIN = "https://www.mshpit.com";
export const PRODUCTION_MEDIA_CHECK_TIMEOUT_MS = 10_000;
export const PRODUCTION_MEDIA_HEALTH_MAX_BYTES = 32 * 1024;

function checkedOrigin(value) {
  let url;
  try { url = new URL(String(value || DEFAULT_PRODUCTION_MEDIA_ORIGIN)); }
  catch { throw new Error("Production media origin is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || !["", "/"].includes(url.pathname)) {
    throw new Error("Production media verification requires a plain HTTPS origin.");
  }
  return url.origin;
}

function boundedTimeout(value) {
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs)) return PRODUCTION_MEDIA_CHECK_TIMEOUT_MS;
  return Math.max(1_000, Math.min(30_000, Math.trunc(timeoutMs)));
}

async function boundedResponseText(response, signal) {
  const header = response?.headers?.get?.("content-length");
  const declared = header === null ? null : Number(header);
  if (declared !== null && (!Number.isFinite(declared) || declared < 0 || declared > PRODUCTION_MEDIA_HEALTH_MAX_BYTES)) {
    throw new Error("Production media health response was too large.");
  }
  if (!response?.body || typeof response.body.getReader !== "function") {
    const text = await response?.text?.();
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > PRODUCTION_MEDIA_HEALTH_MAX_BYTES) {
      throw new Error("Production media health response was too large.");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || new Error("Production media verification timed out.");
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > PRODUCTION_MEDIA_HEALTH_MAX_BYTES) {
        await reader.cancel("response too large");
        throw new Error("Production media health response was too large.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

function codecsInclude(matrix, type, expected) {
  const codecs = matrix?.[type];
  return Array.isArray(codecs) && expected.every((codec) => codecs.includes(codec));
}

function exactContractMetadata(payload) {
  const contract = payload?.mediaPublishingContract;
  return payload?.ok === true
    && contract?.negotiationRequired === false
    && contract?.pipeline === VIDEO_PUBLISHING_PIPELINE_VERSION
    && new Set(["ready", "unavailable"]).has(contract?.state);
}

function exactHealthyCapability(payload) {
  const contract = payload?.mediaPublishingContract;
  const capability = payload?.capabilities?.mediaPublishing;
  const sourceTypes = capability?.sourceTypes;
  return contract?.state === "ready"
    && capability?.videos === true
    && capability?.pipeline === VIDEO_PUBLISHING_PIPELINE_VERSION
    && Array.isArray(sourceTypes)
    && sourceTypes.includes("video/mp4")
    && sourceTypes.includes("video/quicktime")
    && codecsInclude(capability?.sourceCodecs, "video/mp4", ["h264", "hevc"])
    && codecsInclude(capability?.sourceCodecs, "video/quicktime", ["h264", "hevc"]);
}

export function productionMediaHealthUrl(origin = DEFAULT_PRODUCTION_MEDIA_ORIGIN) {
  return new URL(MEDIA_PUBLISHING_HEALTH_PATH, `${checkedOrigin(origin)}/`).toString();
}

export async function verifyProductionMedia({
  origin = DEFAULT_PRODUCTION_MEDIA_ORIGIN,
  timeoutMs = PRODUCTION_MEDIA_CHECK_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  const url = productionMediaHealthUrl(origin);
  const signal = AbortSignal.timeout(boundedTimeout(timeoutMs));
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal,
      headers: {
        accept: "application/json",
        "user-agent": "Mshpit-Production-Media-Verification/1.0",
      },
    });
  } catch (error) {
    throw new Error("Production media health could not be reached.", { cause: error });
  }
  if (response?.status !== 200) {
    throw new Error(`Production media health returned HTTP ${Number(response?.status) || "unknown"}.`);
  }
  const contentType = String(response.headers?.get?.("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new Error("Production media health did not return JSON.");
  }
  const raw = await boundedResponseText(response, signal);
  let payload;
  try { payload = JSON.parse(raw); }
  catch { throw new Error("Production media health returned invalid JSON."); }
  if (!exactContractMetadata(payload)) {
    throw new Error("Production media observability contract is not deployed or is incompatible.");
  }
  if (!exactHealthyCapability(payload)) {
    throw new Error("Production video publishing is not ready for the exact client pipeline.");
  }
  return Object.freeze({
    ok: true,
    url,
    pipeline: VIDEO_PUBLISHING_PIPELINE_VERSION,
    state: "ready",
    sourceTypes: Object.freeze([...payload.capabilities.mediaPublishing.sourceTypes]),
  });
}

function cliOptions(argv) {
  let origin = DEFAULT_PRODUCTION_MEDIA_ORIGIN;
  let timeoutMs = PRODUCTION_MEDIA_CHECK_TIMEOUT_MS;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--origin" && argv[index + 1]) origin = argv[++index];
    else if (argv[index] === "--timeout-ms" && argv[index + 1]) timeoutMs = argv[++index];
    else throw new Error("Usage: npm run verify:production-media -- [--origin https://www.mshpit.com] [--timeout-ms 10000]");
  }
  return { origin, timeoutMs };
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  let options;
  try { options = cliOptions(process.argv.slice(2)); }
  catch (error) {
    console.error(`FAIL  ${error.message}`);
    process.exitCode = 1;
  }
  if (options) {
    verifyProductionMedia(options)
      .then((result) => {
        console.log(`PASS  Production video publishing is ready (${result.pipeline}; ${result.sourceTypes.join(", ")}).`);
      })
      .catch((error) => {
        console.error(`FAIL  ${error?.message || "Production video publishing verification failed."}`);
        process.exitCode = 1;
      });
  }
}
