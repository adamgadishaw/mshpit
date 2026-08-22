#!/usr/bin/env node
// Trusted, one-time operator utility for the audited release manifest. This is
// intentionally not an API or a general thumbnail service: it accepts no URLs,
// owners, posts, keys, or hashes from the command line. The decoder process that
// created the reviewed JPEGs never receives R2 credentials; this process only
// validates and publishes those exact five immutable files.

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import { createMediaPresign, getMediaConfig, presignS3Request } from "../server/media.js";
import {
  LEGACY_VIDEO_POSTER_PUBLIC_BASE,
  LEGACY_VIDEO_POSTER_RELEASE,
} from "../server/legacyVideoPosterRelease.js";

const apply = process.argv.includes("--apply");
const directoryIndex = process.argv.indexOf("--poster-dir");
const requestedDirectory = directoryIndex >= 0 ? process.argv[directoryIndex + 1] : "";
if (!requestedDirectory) {
  throw new Error("Pass the reviewed artifact directory with --poster-dir. Add --apply only after dry-run validation.");
}

const posterDirectory = realpathSync(resolve(requestedDirectory));
const config = getMediaConfig(process.env);
if (!config.configured) throw new Error("Active media storage is not configured.");
const configuredBase = `${config.publicBase.origin}${config.publicBase.pathname.replace(/\/+$/, "")}`;
if (configuredBase !== LEGACY_VIDEO_POSTER_PUBLIC_BASE) {
  throw new Error("This release manifest is not authorized for the configured media bucket.");
}

function sha(algorithm, value) {
  return createHash(algorithm).update(value).digest("hex");
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
      || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (startOfFrame.has(marker) && length >= 7) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

function validatedArtifact(entry) {
  if (basename(entry.localFileName) !== entry.localFileName || !entry.localFileName.endsWith(".jpg")) {
    throw new Error(`Unsafe manifest filename for ${entry.postId}.`);
  }
  const path = realpathSync(join(posterDirectory, entry.localFileName));
  const outside = relative(posterDirectory, path);
  if (outside.startsWith("..") || resolve(dirname(path)) !== posterDirectory || !lstatSync(path).isFile()) {
    throw new Error(`Poster artifact escaped the reviewed directory: ${entry.localFileName}.`);
  }
  const bytes = readFileSync(path);
  const dimensions = jpegDimensions(bytes);
  if (!dimensions || dimensions.width !== entry.width || dimensions.height !== entry.height
      || bytes.length !== entry.byteSize || bytes.length < 1024 || bytes.length > 5 * 1024 * 1024
      || sha("sha256", bytes) !== entry.contentSha256 || sha("md5", bytes) !== entry.contentMd5) {
    throw new Error(`Poster artifact failed its immutable JPEG contract: ${entry.localFileName}.`);
  }
  return bytes;
}

function encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function endpointObjectUrl(objectKey) {
  const prefix = config.endpoint.pathname.replace(/\/+$/, "");
  return `${config.endpoint.origin}${prefix}/${[config.bucket, ...objectKey.split("/")].map(encode).join("/")}`;
}

function signedHead(objectKey) {
  return presignS3Request({
    method: "HEAD",
    url: endpointObjectUrl(objectKey),
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresIn: 60,
  });
}

async function head(url) {
  return fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(10_000) });
}

function contentType(response) {
  return String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
}

function assertSource(response, entry) {
  if (response.status !== 200 || Number(response.headers.get("content-length")) !== entry.sourceByteSize
      || contentType(response) !== entry.sourceMimeType
      || String(response.headers.get("etag") || "").trim().toLowerCase() !== entry.sourceEtag) {
    throw new Error(`Historical source bytes changed; refusing poster release for ${entry.postId}.`);
  }
}

function posterMatches(response, entry) {
  return response.status === 200
    && Number(response.headers.get("content-length")) === entry.byteSize
    && contentType(response) === "image/jpeg"
    && String(response.headers.get("etag") || "").trim().toLowerCase() === `"${entry.contentMd5}"`;
}

async function publish(entry, bytes) {
  const source = await head(entry.sourceUrl);
  assertSource(source, entry);
  const before = await head(signedHead(entry.posterKey));
  if (before.status !== 404) {
    if (!posterMatches(before, entry)) throw new Error(`Poster key is occupied by different bytes: ${entry.posterKey}.`);
    return "retained";
  }
  if (!apply) return "ready";
  const objectId = entry.posterKey.split("/").at(-1).replace(/\.jpg$/u, "");
  const ticket = createMediaPresign({
    userId: entry.ownerId,
    body: {
      purpose: "post",
      contentType: "image/jpeg",
      fileSize: entry.byteSize,
      name: entry.localFileName,
    },
    objectId,
  });
  if (ticket.key !== entry.posterKey || ticket.publicUrl !== entry.posterUrl) {
    throw new Error(`Storage identity drifted for ${entry.posterKey}.`);
  }
  const uploaded = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: ticket.requiredHeaders,
    body: bytes,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (uploaded.status === 412) {
    const raced = await head(signedHead(entry.posterKey));
    if (!posterMatches(raced, entry)) throw new Error(`Create-only race produced different bytes: ${entry.posterKey}.`);
    return "retained";
  }
  if (uploaded.status < 200 || uploaded.status >= 300) {
    throw new Error(`R2 rejected poster ${entry.posterKey} with status ${uploaded.status}.`);
  }
  const verified = await head(signedHead(entry.posterKey));
  if (!posterMatches(verified, entry)) throw new Error(`Uploaded poster failed authoritative HEAD: ${entry.posterKey}.`);
  return "created";
}

if (LEGACY_VIDEO_POSTER_RELEASE.length !== 5) throw new Error("The audited release must contain exactly five posters.");
const artifacts = LEGACY_VIDEO_POSTER_RELEASE.map((entry) => ({ entry, bytes: validatedArtifact(entry) }));
const results = [];
for (const artifact of artifacts) {
  results.push({ key: artifact.entry.posterKey, status: await publish(artifact.entry, artifact.bytes) });
}

console.log(`[legacy-posters] ${apply ? "apply" : "dry-run"} validated ${results.length} exact artifacts`);
for (const result of results) console.log(`[legacy-posters] ${result.status} ${result.key}`);
