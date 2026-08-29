import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { MEDIA_VIDEO_MAX_DURATION_MS } from "../src/domain/mediaUploadPolicy.mjs";

const dataDir = mkdtempSync(join(tmpdir(), "pit-media-assets-"));
process.env.PIT_DATA_DIR = dataDir;

Object.assign(process.env, {
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-media",
  MEDIA_SOURCE_BUCKET: "pit-media-private",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "media-test-access",
  MEDIA_SECRET_ACCESS_KEY: "media-test-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
});

const { db, q } = await import("./db.js");
const { hashPassword } = await import("./auth.js");
const { routes } = await import("./api.js");
const {
  createMediaAsset,
  createMediaVariant,
  cancelMediaAsset,
  attachPostMedia,
  assetObjectRecords,
  finalizeMediaAsset: finalizeMediaAssetRuntime,
  finalizeMediaVariant: finalizeMediaVariantRuntime,
  mediaSelection,
  ownedMediaAsset,
  updateMediaAsset,
} = await import("./mediaAssets.js");
const {
  enqueueExpiredMediaTickets,
  MEDIA_UPLOAD_SETTLE_BUFFER_MS,
  recordMediaObjectTicket,
} = await import("./mediaDeletion.js");
const { inspectImageBytes } = await import("./imageInspection.js");
const { startVideoFinalizeJob, videoFinalizeState } = await import("./videoFinalizeJobs.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword("media-password"), "fan", "Toronto", 43.65, -79.38, "MA", "#123456", Date.now());
  return q.userById.get(id);
}

function sourceBody(overrides = {}) {
  return {
    clientAssetId: "asset-retry-0001",
    purpose: "post",
    contentType: "image/jpeg",
    fileSize: 4_096,
    name: "concert.jpg",
    ...overrides,
  };
}

function verifiedHead(bytes, type, capture = null) {
  return async (url, options) => {
    capture?.push({ url, options });
    return {
      status: 200,
      headers: new Headers({ "content-length": String(bytes), "content-type": type }),
    };
  };
}

function mp4Box(type, ...parts) {
  const payload = Buffer.concat(parts);
  const box = Buffer.alloc(8 + payload.length);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, 4, "ascii");
  payload.copy(box, 8);
  return box;
}

function unsignedGolombBits(value) {
  const encoded = (value + 1).toString(2);
  return [...Array(encoded.length - 1).fill(0), ...[...encoded].map(Number)];
}

function packBitArray(bits) {
  const padded = [...bits];
  while (padded.length % 8) padded.push(0);
  const output = Buffer.alloc(padded.length / 8);
  padded.forEach((bit, index) => { output[Math.floor(index / 8)] |= bit << (7 - (index % 8)); });
  return output;
}

function baselineSps(width, height) {
  const widthInMbs = Math.ceil(width / 16);
  const heightInMapUnits = Math.ceil(height / 16);
  const cropRight = (widthInMbs * 16 - width) / 2;
  const cropBottom = (heightInMapUnits * 16 - height) / 2;
  const bits = [
    ...unsignedGolombBits(0), // seq_parameter_set_id
    ...unsignedGolombBits(0), // log2_max_frame_num_minus4
    ...unsignedGolombBits(0), // pic_order_cnt_type
    ...unsignedGolombBits(0), // log2_max_pic_order_cnt_lsb_minus4
    ...unsignedGolombBits(1), // max_num_ref_frames
    0,
    ...unsignedGolombBits(widthInMbs - 1),
    ...unsignedGolombBits(heightInMapUnits - 1),
    1, // frame_mbs_only_flag
    1, // direct_8x8_inference_flag
    cropRight || cropBottom ? 1 : 0,
  ];
  if (cropRight || cropBottom) {
    bits.push(...unsignedGolombBits(0), ...unsignedGolombBits(cropRight),
      ...unsignedGolombBits(0), ...unsignedGolombBits(cropBottom));
  }
  bits.push(0, 1); // no VUI; rbsp stop bit
  return Buffer.concat([Buffer.from([0x67, 66, 0, 40]), packBitArray(bits)]);
}

function compatibleMp4(bytes, durationMs, { videoSampleEntry = "avc1", container = "mp4" } = {}) {
  const quickTime = container === "quicktime";
  const hevc = videoSampleEntry === "hvc1";
  const ftyp = mp4Box("ftyp",
    Buffer.from(quickTime ? "qt  " : "isom", "ascii"),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from(quickTime ? "qt  " : hevc ? "isomiso6hvc1mp42" : "isomiso2avc1mp41", "ascii"));
  const timescale = 1_000;
  const encodedWidth = 1_080;
  const encodedHeight = 1_920;
  // Four-byte AVC length prefix + one IDR I-slice whose first_mb_in_slice,
  // slice_type, and pic_parameter_set_id Exp-Golomb fields are 0, 2, and 0.
  const firstSample = hevc
    ? Buffer.from([0, 0, 0, 3, 19 << 1, 1, 0])
    : Buffer.from([0, 0, 0, 2, 0x65, 0xb8]);
  const buildMoov = (chunkOffset) => {
    const mvhdPayload = Buffer.alloc(100);
    mvhdPayload.writeUInt32BE(timescale, 12);
    mvhdPayload.writeUInt32BE(durationMs, 16);
    const mvhd = mp4Box("mvhd", mvhdPayload);

    const visualSample = Buffer.alloc(78);
    visualSample.writeUInt16BE(1, 6);
    visualSample.writeUInt16BE(encodedWidth, 24);
    visualSample.writeUInt16BE(encodedHeight, 26);
    visualSample.writeUInt32BE(0x00480000, 28);
    visualSample.writeUInt32BE(0x00480000, 32);
    visualSample.writeUInt16BE(1, 40);
    visualSample.writeUInt16BE(24, 74);
    visualSample.writeInt16BE(-1, 76);
    const sps = baselineSps(encodedWidth, encodedHeight);
    const avcConfiguration = mp4Box("avcC", Buffer.concat([
      Buffer.from([1, 66, 0, 40, 0xff, 0xe1, (sps.length >> 8) & 0xff, sps.length & 0xff]),
      sps,
      Buffer.from([1, 0, 1, 0x68]),
    ]));
    const hevcHeader = Buffer.alloc(23);
    hevcHeader[0] = 1;
    hevcHeader[1] = 2;
    hevcHeader[12] = 120;
    hevcHeader[13] = 0xf0;
    hevcHeader[15] = 0xfc;
    hevcHeader[16] = 0xfd;
    hevcHeader[17] = 0xf9;
    hevcHeader[18] = 0xf9;
    hevcHeader[21] = 0x03;
    hevcHeader[22] = 3;
    const hevcParameterArray = (type) => Buffer.from([
      0x80 | type,
      0, 1,
      0, 3,
      (type << 1) & 0x7e, 1, 0,
    ]);
    const hevcConfiguration = mp4Box("hvcC", hevcHeader,
      hevcParameterArray(32), hevcParameterArray(33), hevcParameterArray(34));
    const sampleEntry = mp4Box(videoSampleEntry, visualSample,
      hevc ? hevcConfiguration : avcConfiguration);
    const stsdHeader = Buffer.alloc(8);
    stsdHeader.writeUInt32BE(1, 4);
    const stsd = mp4Box("stsd", stsdHeader, sampleEntry);
    const sttsPayload = Buffer.alloc(16);
    sttsPayload.writeUInt32BE(1, 4);
    sttsPayload.writeUInt32BE(1, 8);
    sttsPayload.writeUInt32BE(durationMs, 12);
    const stts = mp4Box("stts", sttsPayload);
    const stszPayload = Buffer.alloc(12);
    stszPayload.writeUInt32BE(firstSample.length, 4);
    stszPayload.writeUInt32BE(1, 8);
    const stsz = mp4Box("stsz", stszPayload);
    const stscPayload = Buffer.alloc(20);
    stscPayload.writeUInt32BE(1, 4);
    stscPayload.writeUInt32BE(1, 8);
    stscPayload.writeUInt32BE(1, 12);
    stscPayload.writeUInt32BE(1, 16);
    const stsc = mp4Box("stsc", stscPayload);
    const stcoPayload = Buffer.alloc(12);
    stcoPayload.writeUInt32BE(1, 4);
    stcoPayload.writeUInt32BE(chunkOffset, 8);
    const stco = mp4Box("stco", stcoPayload);
    const stbl = mp4Box("stbl", stsd, stts, stsz, stsc, stco);
    const minf = mp4Box("minf", stbl);
    const mdhdPayload = Buffer.alloc(20);
    mdhdPayload.writeUInt32BE(timescale, 12);
    mdhdPayload.writeUInt32BE(durationMs, 16);
    const mdhd = mp4Box("mdhd", mdhdPayload);
    const hdlrPayload = Buffer.alloc(24);
    hdlrPayload.write("vide", 8, 4, "ascii");
    const hdlr = mp4Box("hdlr", hdlrPayload);
    return mp4Box("moov", mvhd, mp4Box("trak", mp4Box("mdia", mdhd, hdlr, minf)));
  };
  const provisionalMoov = buildMoov(0);
  const chunkOffset = ftyp.length + provisionalMoov.length + 8;
  const moov = buildMoov(chunkOffset);
  const used = ftyp.length + moov.length + 8;
  if (!Number.isSafeInteger(bytes) || bytes < used + firstSample.length) throw new Error("MP4 fixture is too small");
  const mdatPayload = Buffer.alloc(bytes - used);
  firstSample.copy(mdatPayload);
  return Buffer.concat([ftyp, moov, mp4Box("mdat", mdatPayload)]);
}

const FIXTURE_DELIVERY_BYTES = Buffer.from("pit-sanitized-delivery-fixture-v1");

function verifiedMp4(bytes, durationMs, capture = null, options = {}) {
  const object = compatibleMp4(bytes, durationMs, options);
  const etag = `"fixture-${bytes}-${durationMs}-${options.videoSampleEntry || "avc1"}"`;
  return async (url, request = {}) => {
    capture?.push({ url, options: request });
    const method = String(request.method || "GET").toUpperCase();
    if (new URL(url).pathname.includes("/pit-media/users/")) {
      const deliveryHeaders = new Headers({
        "content-length": String(FIXTURE_DELIVERY_BYTES.byteLength),
        "content-type": "video/mp4",
        etag: '"fixture-delivery"',
      });
      if (method === "HEAD") return { status: 200, headers: deliveryHeaders };
      if (method === "GET") return new Response(FIXTURE_DELIVERY_BYTES, { status: 200, headers: deliveryHeaders });
      return { status: 200, headers: new Headers() };
    }
    if (method === "HEAD") {
      return {
        status: 200,
        headers: new Headers({
          "content-length": String(object.length),
          "content-type": options.sourceContentType || "video/mp4",
          etag,
        }),
      };
    }
    if (method !== "GET") return { status: 405, headers: new Headers() };
    const headers = new Headers(request.headers || {});
    if (headers.get("if-match") !== etag) return { status: 412, headers: new Headers() };
    const match = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range") || "");
    if (!match) return { status: 400, headers: new Headers() };
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= object.length) {
      return { status: 416, headers: new Headers({ "content-range": `bytes */${object.length}` }) };
    }
    const chunk = object.subarray(start, end + 1);
    return {
      status: 206,
      headers: new Headers({
        "content-length": String(chunk.length),
        "content-range": `bytes ${start}-${end}/${object.length}`,
        "content-type": "video/mp4",
        etag,
      }),
      arrayBuffer: async () => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
    };
  };
}

// Test-only stand-in for the authoritative full decoder/transcoder integration.
// The HTTP API never supplies this hook, so production-default assertions below
// still exercise the fail-closed path while linkage/deletion tests can model a
// future decoder-approved asset without weakening the runtime contract.
async function authoritativeFixtureDecode({ structural, output }) {
  return {
    ...structural,
    delivery: {
      key: output.key,
      contentType: "video/mp4",
      byteSize: FIXTURE_DELIVERY_BYTES.byteLength,
      sha256: createHash("sha256").update(FIXTURE_DELIVERY_BYTES).digest("hex"),
      width: structural.width,
      height: structural.height,
      durationMs: structural.durationMs,
      rotation: 0,
    },
  };
}

function testBox(type, payload) {
  const box = Buffer.alloc(8 + payload.length);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, 4, "ascii");
  payload.copy(box, 8);
  return box;
}

function imageFixture(bytes, type, width, height, { metadata = false, trailing = null } = {}) {
  if (type === "image/jpeg") {
    const app0Payload = Buffer.from([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const segment = (marker, payload) => {
      const output = Buffer.alloc(payload.length + 4);
      output[0] = 0xff;
      output[1] = marker;
      output.writeUInt16BE(payload.length + 2, 2);
      payload.copy(output, 4);
      return output;
    };
    const sof = Buffer.alloc(15);
    sof[0] = 8;
    sof.writeUInt16BE(height, 1);
    sof.writeUInt16BE(width, 3);
    sof[5] = 3;
    sof.set([1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 6);
    const sos = Buffer.from([3, 1, 0, 2, 0, 3, 0, 0, 63, 0]);
    const prefix = [Buffer.from([0xff, 0xd8]), segment(0xe0, app0Payload)];
    if (metadata) prefix.push(segment(0xe1, Buffer.from("Exif\0\0private-gps", "ascii")));
    prefix.push(segment(0xc0, sof), segment(0xda, sos));
    const suffix = Buffer.from([0xff, 0xd9]);
    const fixed = prefix.reduce((sum, part) => sum + part.length, 0) + suffix.length;
    if (bytes < fixed) throw new Error("JPEG fixture is too small");
    const image = Buffer.concat([...prefix, Buffer.alloc(bytes - fixed), suffix]);
    return trailing ? Buffer.concat([image, Buffer.from(trailing)]) : image;
  }
  if (type === "image/webp") {
    const payloadLength = bytes - 20;
    if (payloadLength < 5 || payloadLength % 2) throw new Error("WebP fixture size must be even and at least 26 bytes");
    const payload = Buffer.alloc(payloadLength);
    payload[0] = 0x2f;
    const packed = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
    payload.writeUInt32LE(packed >>> 0, 1);
    const chunk = Buffer.alloc(8 + payload.length);
    chunk.write("VP8L", 0, 4, "ascii");
    chunk.writeUInt32LE(payload.length, 4);
    payload.copy(chunk, 8);
    const image = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii"), chunk]);
    image.writeUInt32LE(image.length - 8, 4);
    return trailing ? Buffer.concat([image, Buffer.from(trailing)]) : image;
  }
  if (type === "image/heic" || type === "image/heif") {
    const ftyp = testBox("ftyp", Buffer.concat([
      Buffer.from(type === "image/heic" ? "heic" : "mif1", "ascii"),
      Buffer.alloc(4),
      Buffer.from("mif1heic", "ascii"),
    ]));
    const ispePayload = Buffer.alloc(12);
    ispePayload.writeUInt32BE(width, 4);
    ispePayload.writeUInt32BE(height, 8);
    const meta = testBox("meta", Buffer.concat([Buffer.alloc(4), testBox("iprp", testBox("ipco", testBox("ispe", ispePayload)))]));
    const used = ftyp.length + meta.length + 8;
    if (bytes < used) throw new Error("HEIF fixture is too small");
    return Buffer.concat([ftyp, meta, testBox("mdat", Buffer.alloc(bytes - used))]);
  }
  throw new Error(`Unsupported image fixture type: ${type}`);
}

function verifiedImage(bytes, type, width, height, capture = null, options = {}) {
  const object = options.sourceBytes
    ? Buffer.from(options.sourceBytes)
    : imageFixture(bytes, type, width, height, options);
  const etag = `"image-${type}-${bytes}-${width}-${height}"`;
  const deliveryType = options.deliveryType || type;
  const deliveryEtag = `"delivery-${deliveryType}-${bytes}-${width}-${height}"`;
  let delivery = null;
  return async (url, request = {}) => {
    capture?.push({ url, options: request });
    const method = String(request.method || "GET").toUpperCase();
    const publicDelivery = new URL(url).pathname.includes("/pit-media/users/");
    if (method === "PUT") {
      if (!publicDelivery) return { status: 405, headers: new Headers() };
      if (delivery) return { status: 412, headers: new Headers() };
      delivery = Buffer.from(request.body || []);
      options.onDelivery?.(delivery);
      return { status: 200, headers: new Headers({ etag: deliveryEtag }) };
    }
    const selected = publicDelivery ? delivery : object;
    if (!selected) return { status: 404, headers: new Headers() };
    const selectedEtag = publicDelivery ? deliveryEtag : etag;
    const headers = new Headers({
      "content-length": String(selected.length),
      "content-type": publicDelivery ? deliveryType : type,
      etag: selectedEtag,
    });
    if (method === "HEAD") return { status: 200, headers };
    if (method !== "GET") return { status: 405, headers: new Headers() };
    if (new Headers(request.headers || {}).get("if-match") !== selectedEtag) return { status: 412, headers: new Headers() };
    return new Response(selected, { status: 200, headers });
  };
}

const fixtureImageProcessor = Object.freeze({
  async validate(bytes, { expectedType }) {
    return inspectImageBytes(bytes, { expectedType, sanitized: false });
  },
  async sanitize(bytes, { expectedType }) {
    const inspection = inspectImageBytes(bytes, { expectedType, sanitized: false });
    return {
      bytes: Buffer.from(bytes),
      byteSize: bytes.length,
      mimeType: expectedType,
      width: inspection.width,
      height: inspection.height,
      pixels: inspection.pixels,
    };
  },
});

const finalizeMediaAsset = (database, options) => finalizeMediaAssetRuntime(database, {
  imageProcessor: fixtureImageProcessor,
  ...options,
});
const finalizeMediaVariant = (database, options) => finalizeMediaVariantRuntime(database, {
  imageProcessor: fixtureImageProcessor,
  ...options,
});

async function authoritativeFixtureDecodeWithPoster({ structural, posterTimeMs, output }) {
  const landscape = structural.width >= structural.height;
  const width = landscape ? 1_280 : 720;
  const height = landscape ? 720 : 1_280;
  const posterBytes = imageFixture(1_024, "image/jpeg", width, height);
  return {
    ...structural,
    delivery: {
      key: output.key,
      contentType: "video/mp4",
      byteSize: FIXTURE_DELIVERY_BYTES.byteLength,
      sha256: createHash("sha256").update(FIXTURE_DELIVERY_BYTES).digest("hex"),
      width: structural.width,
      height: structural.height,
      durationMs: structural.durationMs,
      rotation: 0,
    },
    poster: {
      contentType: "image/jpeg",
      bytes: posterBytes,
      byteSize: posterBytes.byteLength,
      width,
      height,
      timeMs: posterTimeMs,
      sha256: createHash("sha256").update(posterBytes).digest("hex"),
    },
  };
}

function verifiedMp4WithPoster(bytes, durationMs, capture = null, options = {}) {
  const sourceFetch = verifiedMp4(bytes, durationMs, capture, options);
  let storedPoster = null;
  const posterEtag = `"fixture-poster-${bytes}-${durationMs}"`;
  return async (url, request = {}) => {
    const pathname = new URL(url).pathname;
    if (/\.(?:mp4|mov)$/.test(pathname)) return sourceFetch(url, request);
    capture?.push({ url, options: request });
    const method = String(request.method || "GET").toUpperCase();
    if (method === "PUT") {
      if (storedPoster) return { status: 412, headers: new Headers() };
      storedPoster = Buffer.from(request.body || []);
      return { status: 200, headers: new Headers({ etag: posterEtag }) };
    }
    if (!storedPoster) return { status: 404, headers: new Headers() };
    const headers = new Headers({
      "content-length": String(storedPoster.byteLength),
      "content-type": "image/jpeg",
      etag: posterEtag,
    });
    if (method === "HEAD") return { status: 200, headers };
    if (method === "GET") return new Response(storedPoster, { status: 200, headers });
    return { status: 405, headers: new Headers() };
  };
}

test("asset creation mints a stable owner-bound object identity and retries idempotently", () => {
  const altColumn = db.prepare("PRAGMA table_info(media_assets)").all().find((column) => column.name === "alt_text");
  assert.equal(altColumn?.notnull, 1);
  assert.equal(altColumn?.dflt_value, "''");
  const user = addUser("media_asset_create_owner");
  const first = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody(),
    assetId: "ma_aaaaaaaaaaaaaaaaaaaaaaaa",
    at: 1_000,
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.asset.id, "ma_aaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(first.asset.status, "upload_pending");
  assert.match(first.upload.key, /^users\/media_asset_create_owner\/post\/ms_[a-f0-9]{24}\.jpg$/);
  assert.equal(first.asset.sourceUrl, null);
  assert.equal(first.upload.publicUrl, null);
  assert.equal(first.upload.storageScope, "private");
  assert.equal(first.upload.storageLocator, `pit-private:${first.upload.key}`);
  assert.equal(first.upload.key.includes(first.asset.id.slice(3)), false,
    "a projected asset id cannot reveal or share the private source object token");
  const ledger = db.prepare("SELECT owner_id,status FROM media_objects WHERE object_key=?").get(first.upload.key);
  assert.deepEqual({ ...ledger }, { owner_id: user.id, status: "issued" });

  const retried = createMediaAsset(db, { ownerId: user.id, body: sourceBody(), at: 2_000 });
  assert.equal(retried.duplicate, true);
  assert.equal(retried.asset.id, first.asset.id);
  assert.equal(retried.upload.key, first.upload.key);
  assert.throws(
    () => createMediaAsset(db, { ownerId: user.id, body: sourceBody({ fileSize: 4_097 }), at: 3_000 }),
    (error) => error.code === "CONFLICT" && error.status === 409,
  );
});

test("asset registration rejects caller-supplied object locations and isolates owner reads", () => {
  const owner = addUser("media_asset_boundary_owner");
  const stranger = addUser("media_asset_boundary_stranger");
  assert.throws(
    () => createMediaAsset(db, {
      ownerId: owner.id,
      body: sourceBody({ clientAssetId: "asset-retry-foreign", sourceUrl: "https://evil.example/file.jpg" }),
    }),
    (error) => error.code === "VALIDATION_FAILED",
  );
  const created = createMediaAsset(db, {
    ownerId: owner.id,
    body: sourceBody({ clientAssetId: "asset-retry-private" }),
    assetId: "ma_bbbbbbbbbbbbbbbbbbbbbbbb",
  });
  assert.ok(ownedMediaAsset(db, { ownerId: owner.id, assetId: created.asset.id }));
  assert.equal(ownedMediaAsset(db, { ownerId: stranger.id, assetId: created.asset.id }), null);
  assert.throws(
    () => routes["GET /api/media/assets/:id"]({ user: stranger, ip: "asset-read-stranger", params: { id: created.asset.id } }),
    (error) => error.code === "NOT_FOUND",
  );
});

test("owner cancellation atomically queues every draft object, honors PUT barriers, and never resurrects the old source", async () => {
  const owner = addUser("media_asset_cancel_owner");
  const stranger = addUser("media_asset_cancel_stranger");
  const body = sourceBody({ clientAssetId: "asset-cancel-source", fileSize: 12_000 });
  const created = createMediaAsset(db, {
    ownerId: owner.id,
    body,
    assetId: "ma_cancelcancelcancelcancelcanc",
    sourceObjectId: "ms_cancelcancelcancelcancelcanc",
    at: 1_000,
  });
  await finalizeMediaAsset(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: { width: 1_000, height: 1_250, editRecipe: {} },
    fetchImpl: verifiedImage(12_000, "image/jpeg", 1_000, 1_250),
    at: 2_000,
  });
  const rendition = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    variantId: "mv_cancelcancelcancelcancelcanc",
    body: {
      clientVariantId: "asset-cancel-render",
      role: "render",
      contentType: "image/webp",
      fileSize: 8_000,
      name: "cancelled.webp",
    },
    at: 3_000,
  });

  assert.deepEqual(cancelMediaAsset(db, {
    ownerId: stranger.id,
    assetId: created.asset.id,
    at: 3_500,
  }), { removed: false, queuedObjects: 0 }, "foreign cancellation is indistinguishable from a missing id");
  assert.deepEqual(cancelMediaAsset(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    at: 4_000,
  }), { removed: true, queuedObjects: 2 });
  assert.equal(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(created.asset.id), undefined);
  assert.equal(db.prepare("SELECT 1 FROM media_variants WHERE id=?").get(rendition.variant.id), undefined);
  for (const key of [created.upload.key, rendition.upload.key]) {
    assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(key).status, "delete_queued");
    const queue = db.prepare("SELECT status,next_attempt_at FROM media_deletion_queue WHERE object_key=?").get(key);
    assert.equal(queue.status, "pending");
    const uploadExpiry = db.prepare("SELECT upload_expires_at FROM media_objects WHERE object_key=?").get(key).upload_expires_at;
    assert.equal(queue.next_attempt_at, uploadExpiry + MEDIA_UPLOAD_SETTLE_BUFFER_MS,
      "cancellation cannot delete bytes while a previously signed PUT may still settle");
  }
  assert.deepEqual(cancelMediaAsset(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    at: 5_000,
  }), { removed: false, queuedObjects: 0 }, "lost-response retry is idempotent");

  const restarted = createMediaAsset(db, {
    ownerId: owner.id,
    body,
    assetId: "ma_restartrestartrestartrestart",
    sourceObjectId: "ms_restartrestartrestartrestart",
    at: 6_000,
  });
  assert.notEqual(restarted.upload.key, created.upload.key);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(created.upload.key).status, "delete_queued");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(restarted.upload.key).status, "issued");

  const routeDraft = createMediaAsset(db, {
    ownerId: owner.id,
    body: sourceBody({ clientAssetId: "asset-cancel-route", fileSize: 4_500 }),
    assetId: "ma_routecancelroutecancelroute",
    at: Date.now(),
  });
  let routeJobSignal = null;
  const routeJob = startVideoFinalizeJob({
    ownerId: owner.id,
    assetId: routeDraft.asset.id,
    fingerprint: "d".repeat(64),
    run: async ({ signal }) => {
      routeJobSignal = signal;
      await new Promise((resolve, reject) => {
        const stop = () => reject(signal.reason || new DOMException("Cancelled", "AbortError"));
        if (signal.aborted) stop();
        else signal.addEventListener("abort", stop, { once: true });
      });
      return { asset: { id: routeDraft.asset.id, status: "ready" } };
    },
  });
  await Promise.resolve();
  assert.equal(routeJobSignal?.aborted, false);
  assert.deepEqual(routes["DELETE /api/media/assets/:id"]({
    user: stranger,
    ip: "asset-cancel-route-stranger",
    params: { id: routeDraft.asset.id },
  }), { removed: false, queuedObjects: 0 });
  assert.equal(routeJobSignal.aborted, false, "a foreign delete cannot cancel the owner's verifier");
  assert.deepEqual(routes["DELETE /api/media/assets/:id"]({
    user: owner,
    ip: "asset-cancel-route-owner",
    params: { id: routeDraft.asset.id },
  }), { removed: true, queuedObjects: 1 });
  assert.equal(routeJobSignal.aborted, true, "deleting the owner draft aborts its detached verifier");
  await assert.rejects(routeJob.completion, (error) => error?.name === "AbortError");
  assert.deepEqual(videoFinalizeState({ ownerId: owner.id, assetId: routeDraft.asset.id }), { state: "idle" });
  assert.equal(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(routeDraft.asset.id), undefined,
    "a cancelled verifier cannot recreate the deleted draft");
  assert.deepEqual(routes["DELETE /api/media/assets/:id"]({
    user: owner,
    ip: "asset-cancel-route-owner-retry",
    params: { id: routeDraft.asset.id },
  }), { removed: false, queuedObjects: 0 });
});

test("owner cancellation loses the publish race and cannot retire attached media", async () => {
  const owner = addUser("media_asset_cancel_attached_owner");
  const created = createMediaAsset(db, {
    ownerId: owner.id,
    body: sourceBody({ clientAssetId: "asset-cancel-attached", fileSize: 13_000 }),
    assetId: "ma_cancelattachedcancelattach",
    at: 1_000,
  });
  await finalizeMediaAsset(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: { width: 1_000, height: 1_250, editRecipe: {} },
    fetchImpl: verifiedImage(13_000, "image/jpeg", 1_000, 1_250),
    at: 2_000,
  });
  const rendition = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    variantId: "mv_cancelattachedcancelattach",
    body: {
      clientVariantId: "asset-cancel-attached-render",
      role: "render",
      contentType: "image/webp",
      fileSize: 8_500,
      name: "attached.webp",
    },
    at: 3_000,
  });
  await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    variantId: rendition.variant.id,
    body: { width: 1_000, height: 1_250 },
    fetchImpl: verifiedImage(8_500, "image/webp", 1_000, 1_250),
    at: 4_000,
  });
  routes["POST /api/posts"]({
    user: owner,
    ip: "asset-cancel-attached-post",
    body: {
      kind: "status",
      review: "This attached media wins the cancellation race.",
      mediaAssetIds: [created.asset.id],
      clientMutationId: "asset-cancel-attached-post-01",
    },
  });

  assert.throws(() => routes["DELETE /api/media/assets/:id"]({
    user: owner,
    ip: "asset-cancel-attached-delete",
    params: { id: created.asset.id },
  }), (error) => error.status === 409 && error.code === "CONFLICT");
  assert.ok(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(created.asset.id));
  assert.ok(db.prepare("SELECT 1 FROM post_media WHERE asset_id=?").get(created.asset.id));
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(created.upload.key).status,
    "associated");
  assert.equal(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(created.upload.key), undefined);
});

test("source finalization verifies storage transport metadata and fails closed on mismatch", async () => {
  const user = addUser("media_asset_verify_owner");
  const created = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({ clientAssetId: "asset-retry-verify", fileSize: 8_192 }),
    assetId: "ma_cccccccccccccccccccccccc",
  });
  assert.throws(
    () => updateMediaAsset(db, {
      ownerId: user.id,
      assetId: created.asset.id,
      body: { altText: "Too early" },
    }),
    (error) => error.status === 409 && error.code === "CONFLICT",
  );
  await assert.rejects(
    finalizeMediaAsset(db, {
      ownerId: user.id,
      assetId: created.asset.id,
      body: { width: 1_920, height: 1_080, altText: "x".repeat(1_001), editRecipe: {} },
      fetchImpl: async () => { throw new Error("invalid copy must fail before storage"); },
    }),
    (error) => error.code === "VALIDATION_FAILED" && error.status === 400,
  );
  await assert.rejects(
    finalizeMediaAsset(db, {
      ownerId: user.id,
      assetId: created.asset.id,
      body: { width: 1_920, height: 1_080, orientation: 0, altText: "  Crowd\nunder   gold lights  ", editRecipe: {} },
      fetchImpl: verifiedImage(8_191, "image/jpeg", 1_920, 1_080),
    }),
    (error) => error.code === "CONFLICT",
  );
  assert.equal(db.prepare("SELECT status,source_verified_at FROM media_assets WHERE id=?").get(created.asset.id).status, "upload_pending");

  const requests = [];
  const finalized = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: { width: 1_920, height: 1_080, orientation: 0, altText: "  Crowd\nunder   gold lights  ", editRecipe: {} },
    fetchImpl: verifiedImage(8_192, "image/jpeg", 1_920, 1_080, requests),
    at: 10_000,
  });
  assert.equal(finalized.asset.status, "render_pending");
  assert.equal(finalized.asset.metadataStatus, "declared");
  assert.equal(finalized.asset.altText, "Crowd under gold lights");
  assert.equal(finalized.asset.url, null, "even an identity edit requires a public delivery rendition");
  assert.equal(requests[0].options.method, "HEAD");
  assert.equal(requests[0].url.includes("media-test-secret"), false);

  const duplicate = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: { width: 1_920, height: 1_080, orientation: 0, altText: "Crowd under gold lights", editRecipe: {} },
    fetchImpl: async () => { throw new Error("idempotent finalize must not hit storage"); },
  });
  assert.equal(duplicate.duplicate, true);
});

test("unedited photos are normalized once on the server and publish only a sanitized derivative", async () => {
  const user = addUser("media_server_original_owner");
  const created = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "server-original-photo-0001",
      fileSize: 8_192,
      name: "IMG_4102.JPG",
    }),
    assetId: "ma_server_original_000001",
  });
  const safeBytes = imageFixture(4_096, "image/jpeg", 1_920, 1_080);
  let sanitizes = 0;
  let validates = 0;
  const imageProcessor = {
    async validate() {
      validates += 1;
      throw new Error("server-original delivery must sanitize instead of validating twice");
    },
    async sanitize(bytes, options) {
      sanitizes += 1;
      assert.equal(bytes.byteLength, 8_192);
      assert.equal(options.expectedType, "image/jpeg");
      assert.equal(options.outputType, "image/jpeg");
      assert.equal(options.maxEdge, 2_048);
      assert.equal(options.allowHeicFallback, true);
      assert.equal(options.allowLegacyJpegTrailer, true);
      return {
        bytes: safeBytes,
        byteSize: safeBytes.byteLength,
        mimeType: "image/jpeg",
        width: 1_920,
        height: 1_080,
        pixels: 1_920 * 1_080,
        sourceWidth: 1_920,
        sourceHeight: 1_080,
      };
    },
  };
  const finalized = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: { deliveryMode: "server", editRecipe: {}, altText: "Crowd from the balcony" },
    fetchImpl: verifiedImage(8_192, "image/jpeg", 1_920, 1_080),
    imageProcessor,
    at: 12_000,
  });
  assert.equal(finalized.asset.status, "ready");
  assert.equal(finalized.asset.renderState, "ready");
  assert.match(finalized.asset.url, /^https:\/\/media\.example\.com\/cdn\//);
  assert.equal(sanitizes, 1);
  assert.equal(validates, 0);
  assert.deepEqual({ ...db.prepare(`SELECT storage_scope,status FROM media_objects
    WHERE owner_id=? AND object_key=?`).get(user.id, created.upload.key) },
  { storage_scope: "private", status: "issued" }, "the original camera file remains private");
  assert.deepEqual({ ...db.prepare(`SELECT v.status,v.verification_origin,v.mime_type,o.storage_scope
    FROM media_variants v JOIN media_objects o ON o.owner_id=? AND o.object_key=v.object_key
    WHERE v.asset_id=? AND v.role='render'`).get(user.id, created.asset.id) }, {
    status: "verified",
    verification_origin: "private_derivative_v1",
    mime_type: "image/jpeg",
    storage_scope: "public",
  });

  const duplicate = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: { deliveryMode: "server", editRecipe: {}, altText: "Crowd from the balcony" },
    fetchImpl: async () => { throw new Error("exact retry must not reach storage"); },
    imageProcessor,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(sanitizes, 1);
});

test("concurrent exact photo source finalizers share one generation-bound GET and conflicting edits do no work", async () => {
  const user = addUser("media_source_coalesce_owner");
  const created = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "source-coalesce-client-0001",
      fileSize: 9_000,
    }),
    assetId: "ma_source_coalesce_000001",
  });
  const requests = [];
  const verifiedFetch = verifiedImage(9_000, "image/jpeg", 1_200, 1_500, requests);
  let releaseGet;
  const getGate = new Promise((resolve) => { releaseGet = resolve; });
  let announceGet;
  const getStarted = new Promise((resolve) => { announceGet = resolve; });
  let sourceGets = 0;
  let decodes = 0;
  const fetchImpl = async (url, options = {}) => {
    if (String(options.method || "GET").toUpperCase() === "GET") {
      sourceGets += 1;
      announceGet();
      await getGate;
    }
    return verifiedFetch(url, options);
  };
  const imageProcessor = {
    ...fixtureImageProcessor,
    async validate(bytes, options) {
      decodes += 1;
      return fixtureImageProcessor.validate(bytes, options);
    },
  };
  const body = {
    width: 1_200,
    height: 1_500,
    orientation: 0,
    altText: "One shared crowd photo",
    editRecipe: {},
  };
  const first = finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body,
    fetchImpl,
    imageProcessor,
  });
  await Promise.race([
    getStarted,
    first.then(
      () => { throw new Error("finalization completed before its source GET"); },
      (error) => { throw error; },
    ),
    new Promise((resolve, reject) => {
      void resolve;
      const timer = setTimeout(() => reject(new Error("source GET did not start")), 2_000);
      void timer;
    }),
  ]);
  let duplicateStorageCalls = 0;
  const joined = finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body,
    fetchImpl: async () => {
      duplicateStorageCalls += 1;
      throw new Error("a coalesced retry must not reach storage");
    },
    imageProcessor,
  });
  await assert.rejects(
    finalizeMediaAsset(db, {
      ownerId: user.id,
      assetId: created.asset.id,
      body: { ...body, altText: "Conflicting edit" },
      fetchImpl: async () => {
        duplicateStorageCalls += 1;
        throw new Error("a conflicting retry must fail before storage");
      },
      imageProcessor,
    }),
    (error) => error?.status === 409 && error?.code === "CONFLICT",
  );
  assert.equal(sourceGets, 1);
  assert.equal(requests.filter((request) => request.options.method === "HEAD").length, 1);
  assert.equal(duplicateStorageCalls, 0);
  releaseGet();
  const [leader, duplicate] = await Promise.all([first, joined]);
  assert.equal(leader.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(leader.asset.status, "render_pending");
  assert.equal(duplicate.asset.status, "render_pending");
  assert.equal(sourceGets, 1);
  assert.equal(decodes, 1);
  assert.equal(duplicateStorageCalls, 0);
});

test("new stable delivery preserves GIF motion, accepts verified MOV, limits duration, and blocks raw HEIC publication", async () => {
  const user = addUser("media_asset_delivery_owner");
  assert.throws(
    () => createMediaAsset(db, {
      ownerId: user.id,
      body: sourceBody({ clientAssetId: "delivery-venue-source", purpose: "venue" }),
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  const animatedGif = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAAKAAAALAAAAAABAAEAAAIBTAAh+QQACgAAACwAAAAAAQABAAACAUQAOw==",
    "base64",
  );
  const gif = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "delivery-gif-source",
      contentType: "image/gif",
      fileSize: animatedGif.byteLength,
      name: "animation.gif",
    }),
    assetId: "ma_animated_gif_source_001",
  });
  let gifDelivery = null;
  const finalizedGif = await finalizeMediaAssetRuntime(db, {
    ownerId: user.id,
    assetId: gif.asset.id,
    body: { deliveryMode: "server", editRecipe: {} },
    fetchImpl: verifiedImage(animatedGif.byteLength, "image/gif", 1, 1, null, {
      sourceBytes: animatedGif,
      deliveryType: "image/webp",
      onDelivery: (bytes) => { gifDelivery = bytes; },
    }),
  });
  assert.equal(finalizedGif.asset.status, "ready");
  assert.equal(finalizedGif.asset.mimeType, "image/webp");
  assert.equal(finalizedGif.asset.url.endsWith(".webp"), true);
  assert.deepEqual(inspectImageBytes(gifDelivery, {
    expectedType: "image/webp",
    sanitized: true,
  }), {
    mimeType: "image/webp", width: 1, height: 1, pixels: 1,
    frames: 2, animated: true, totalPixels: 2, metadataPresent: false, sanitized: true,
  });
  const mov = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "delivery-mov-source",
      contentType: "video/quicktime",
      fileSize: 2_000_000,
      name: "camera.mov",
    }),
    assetId: "ma_movsourcexxxxxxxxxxxxxxxxx",
  });
  assert.equal(mov.upload.key.endsWith(".mov"), true);
  assert.equal(mov.upload.storageScope, "private");
  const finalizedMov = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: mov.asset.id,
    body: { width: 1_080, height: 1_920, durationMs: 10_000, editRecipe: { kind: "video", coverMs: 2_000 } },
    fetchImpl: verifiedMp4WithPoster(2_000_000, 10_000, null, {
      container: "quicktime",
      sourceContentType: "video/quicktime",
    }),
    authoritativeVideoVerifier: authoritativeFixtureDecodeWithPoster,
    authoritativePosterRequired: true,
  });
  assert.equal(finalizedMov.asset.status, "ready");
  assert.equal(finalizedMov.asset.url.endsWith(".mp4"), true, "the public delivery is sanitized MP4");
  assert.equal(finalizedMov.asset.mimeType, "video/mp4");
  assert.equal(db.prepare("SELECT mime_type FROM media_assets WHERE id=?").get(mov.asset.id).mime_type, "video/quicktime");

  const advisoryVideo = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "delivery-advisory-video",
      contentType: "video/mp4",
      fileSize: 2_000_000,
      name: "picker-metadata.mp4",
    }),
    assetId: "ma_jjjjjjjjjjjjjjjjjjjjjjjj",
  });
  const advisoryFinalized = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: advisoryVideo.asset.id,
    body: { width: 1, height: 1, durationMs: MEDIA_VIDEO_MAX_DURATION_MS + 1, editRecipe: {} },
    fetchImpl: verifiedMp4(2_000_000, 10_000),
    authoritativeVideoVerifier: authoritativeFixtureDecode,
  });
  assert.deepEqual({
    width: advisoryFinalized.asset.width,
    height: advisoryFinalized.asset.height,
    durationMs: advisoryFinalized.asset.durationMs,
  }, { width: 1_080, height: 1_920, durationMs: 10_000 },
  "authoritative probe metadata replaces stale or missing picker declarations");

  const video = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "delivery-actual-long-video",
      contentType: "video/mp4",
      fileSize: 2_000_000,
      name: "long.mp4",
    }),
    assetId: "ma_actual_long_video_000001",
  });
  await assert.rejects(
    finalizeMediaAsset(db, {
      ownerId: user.id,
      assetId: video.asset.id,
      body: { width: 1_080, height: 1_920, durationMs: MEDIA_VIDEO_MAX_DURATION_MS, editRecipe: {} },
      fetchImpl: verifiedMp4(2_000_000, MEDIA_VIDEO_MAX_DURATION_MS + 1),
    }),
    (error) => error.status === 415 && error.code === "MEDIA_TYPE_UNSUPPORTED",
    "mvhd/mdhd/stts duration, not the client declaration, enforces the ten-minute ceiling",
  );
  assert.deepEqual({ ...db.prepare("SELECT status,codec_status FROM media_assets WHERE id=?").get(video.asset.id) },
    { status: "upload_pending", codec_status: "pending" });

  const hevc = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "delivery-hevc-source",
      contentType: "video/mp4",
      fileSize: 1_000_000,
      name: "hevc-in-mp4.mp4",
    }),
    assetId: "ma_codec_hevc_accepted_001",
  });
  const finalizedHevc = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: hevc.asset.id,
    body: {
      width: 1_080,
      height: 1_920,
      durationMs: 10_000,
      editRecipe: { kind: "video", coverMs: 2_000 },
    },
    fetchImpl: verifiedMp4WithPoster(1_000_000, 10_000, null, { videoSampleEntry: "hvc1" }),
    authoritativeVideoVerifier: authoritativeFixtureDecodeWithPoster,
    authoritativePosterRequired: true,
  });
  assert.equal(finalizedHevc.asset.status, "ready");
  assert.equal(finalizedHevc.asset.codecStatus, "verified");
  assert.equal(finalizedHevc.asset.mimeType, "video/mp4");
  assert.equal(finalizedHevc.asset.url.endsWith(".mp4"), true,
    "the HEVC source is published only through its sanitized H.264 MP4 delivery");

  const noGeneration = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "delivery-missing-etag",
      contentType: "video/mp4",
      fileSize: 900_000,
      name: "no-generation.mp4",
    }),
    assetId: "ma_codec_etag_required_001",
  });
  await assert.rejects(
    finalizeMediaAsset(db, {
      ownerId: user.id,
      assetId: noGeneration.asset.id,
      body: { width: 1_080, height: 1_920, durationMs: 10_000, editRecipe: {} },
      fetchImpl: verifiedHead(900_000, "video/mp4"),
    }),
    (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
    "video ranges must be bound to the strong generation observed by HEAD",
  );

  const heic = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "delivery-heic-source",
      contentType: "image/heic",
      fileSize: 20_000,
      name: "iphone.heic",
    }),
    assetId: "ma_kkkkkkkkkkkkkkkkkkkkkkkk",
  });
  const pending = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: heic.asset.id,
    body: { width: 3_024, height: 4_032, editRecipe: {} },
    fetchImpl: verifiedImage(20_000, "image/heic", 3_024, 4_032),
  });
  assert.equal(pending.asset.status, "render_pending");
  assert.equal(pending.asset.url, null, "a raw compatibility source is never projected as ready");
  const rendition = createMediaVariant(db, {
    ownerId: user.id,
    assetId: heic.asset.id,
    body: {
      clientVariantId: "delivery-heic-render",
      role: "render",
      contentType: "image/webp",
      fileSize: 8_000,
      name: "compatible.webp",
    },
    variantId: "mv_kkkkkkkkkkkkkkkkkkkkkkkk",
  });
  const ready = await finalizeMediaVariant(db, {
    ownerId: user.id,
    assetId: heic.asset.id,
    variantId: rendition.variant.id,
    body: { width: 1_536, height: 2_048 },
    fetchImpl: verifiedImage(8_000, "image/webp", 1_536, 2_048),
  });
  assert.equal(ready.asset.status, "ready");
  assert.equal(rendition.upload.publicUrl, null, "client-authored renditions remain private staging objects");
  assert.equal(ready.asset.url, ready.variant.url);
  assert.match(ready.variant.url, /^https:\/\/media\.example\.com\/cdn\//);
  assert.notEqual(ready.variant.url, rendition.upload.storageLocator,
    "only the distinct server-authored rendition becomes public");
});

test("edited images stay unpublishable until a verified rendition is uploaded", async () => {
  const user = addUser("media_asset_render_owner");
  const created = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({ clientAssetId: "asset-retry-render", fileSize: 10_000 }),
    assetId: "ma_dddddddddddddddddddddddd",
  });
  const source = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: { width: 3_024, height: 4_032, editRecipe: { kind: "image", filter: "pit", aspect: "portrait" } },
    fetchImpl: verifiedImage(10_000, "image/jpeg", 3_024, 4_032),
  });
  assert.equal(source.asset.status, "render_pending");
  assert.equal(source.asset.renderState, "pending");
  assert.equal(source.asset.url, null);

  const variant = createMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: {
      clientVariantId: "render-retry-0001",
      role: "render",
      contentType: "image/webp",
      fileSize: 6_000,
      name: "edited.webp",
    },
    variantId: "mv_eeeeeeeeeeeeeeeeeeeeeeee",
  });
  assert.equal(variant.variant.status, "upload_pending");
  const finished = await finalizeMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    variantId: variant.variant.id,
    body: { width: 1_638, height: 2_048 },
    fetchImpl: verifiedImage(6_000, "image/webp", 1_638, 2_048),
  });
  assert.equal(finished.asset.status, "ready");
  assert.equal(finished.asset.renderState, "ready");
  assert.equal(variant.upload.publicUrl, null, "the edited client output is private staging");
  assert.equal(finished.asset.url, finished.variant.url);
  assert.notEqual(finished.variant.url, variant.upload.storageLocator,
    "publishing uses server-decoded, metadata-free pixels at a distinct key");
  assert.equal(finished.asset.sourceUrl, null, "private originals are not projected as public URLs");
});

test("concurrent exact photo variant finalizers share GET, sanitize, and public staging", async () => {
  const user = addUser("media_variant_coalesce_owner");
  const created = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "variant-coalesce-source-0001",
      fileSize: 10_000,
    }),
    assetId: "ma_variant_coalesce_000001",
  });
  await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: { width: 1_500, height: 2_000, editRecipe: { kind: "image", filter: "pit" } },
    fetchImpl: verifiedImage(10_000, "image/jpeg", 1_500, 2_000),
  });
  const variant = createMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: {
      clientVariantId: "variant-coalesce-client-0001",
      role: "render",
      contentType: "image/webp",
      fileSize: 8_000,
      name: "coalesced.webp",
    },
    variantId: "mv_variant_coalesce_000001",
  });
  const requests = [];
  const verifiedFetch = verifiedImage(8_000, "image/webp", 1_200, 1_600, requests);
  let releaseGet;
  const getGate = new Promise((resolve) => { releaseGet = resolve; });
  let announceGet;
  const getStarted = new Promise((resolve) => { announceGet = resolve; });
  let stagingGets = 0;
  let sanitizes = 0;
  const fetchImpl = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const privateStaging = new URL(url).pathname.includes("/pit-media-private/");
    if (method === "GET" && privateStaging) {
      stagingGets += 1;
      announceGet();
      await getGate;
    }
    return verifiedFetch(url, options);
  };
  const imageProcessor = {
    ...fixtureImageProcessor,
    async sanitize(bytes, options) {
      sanitizes += 1;
      return fixtureImageProcessor.sanitize(bytes, options);
    },
  };
  const body = { width: 1_200, height: 1_600 };
  const first = finalizeMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    variantId: variant.variant.id,
    body,
    fetchImpl,
    imageProcessor,
  });
  await Promise.race([
    getStarted,
    first.then(
      () => { throw new Error("finalization completed before its source GET"); },
      (error) => { throw error; },
    ),
    new Promise((resolve, reject) => {
      void resolve;
      const timer = setTimeout(() => reject(new Error("source GET did not start")), 2_000);
      void timer;
    }),
  ]);
  let duplicateStorageCalls = 0;
  const joined = finalizeMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    variantId: variant.variant.id,
    body,
    fetchImpl: async () => {
      duplicateStorageCalls += 1;
      throw new Error("a coalesced variant retry must not reach storage");
    },
    imageProcessor,
  });
  assert.equal(stagingGets, 1);
  assert.equal(duplicateStorageCalls, 0);
  releaseGet();
  const [leader, duplicate] = await Promise.all([first, joined]);
  assert.equal(leader.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(leader.variant.status, "verified");
  assert.equal(duplicate.variant.status, "verified");
  assert.equal(duplicate.variant.url, leader.variant.url);
  assert.equal(stagingGets, 1);
  assert.equal(sanitizes, 1);
  assert.equal(requests.filter((request) => request.options.method === "PUT").length, 1);
  assert.equal(duplicateStorageCalls, 0);
});

test("pending rendition retries are idempotent and replacement never reuses the old identity", async () => {
  const user = addUser("media_variant_replace_owner");
  const created = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({ clientAssetId: "variant-replace-source", fileSize: 15_000 }),
    assetId: "ma_llllllllllllllllllllllll",
    at: 1_000,
  });
  await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: { width: 2_000, height: 3_000, editRecipe: { kind: "image", filter: "pit" } },
    fetchImpl: verifiedImage(15_000, "image/jpeg", 2_000, 3_000),
    at: 2_000,
  });
  const firstBody = {
    clientVariantId: "variant-replace-first",
    role: "render",
    contentType: "image/webp",
    fileSize: 9_000,
    name: "first.webp",
  };
  const first = createMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: firstBody,
    variantId: "mv_llllllllllllllllllllllll",
    at: 50_000,
  });
  const retried = createMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: firstBody,
    at: 51_000,
  });
  assert.equal(retried.duplicate, true);
  assert.equal(retried.variant.id, first.variant.id);
  assert.equal(retried.upload.key, first.upload.key);
  const oldExpiry = db.prepare("SELECT upload_expires_at FROM media_objects WHERE object_key=?").get(first.upload.key).upload_expires_at;
  const nondeterministic = createMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: { ...firstBody, fileSize: firstBody.fileSize + 1, name: "first-reencoded.webp" },
    variantId: first.variant.id,
    at: 51_500,
  });
  assert.equal(nondeterministic.replaced, true,
    "the same logical token may safely replace unfinished nondeterministic encoder bytes");
  assert.notEqual(nondeterministic.variant.id, first.variant.id);
  assert.notEqual(nondeterministic.upload.key, first.upload.key);
  const firstRetired = db.prepare("SELECT status,next_attempt_at FROM media_deletion_queue WHERE object_key=?").get(first.upload.key);
  assert.equal(firstRetired.status, "pending");
  assert.ok(firstRetired.next_attempt_at >= oldExpiry + MEDIA_UPLOAD_SETTLE_BUFFER_MS);
  assert.throws(
    () => createMediaVariant(db, {
      ownerId: user.id,
      assetId: created.asset.id,
      body: { ...firstBody, fileSize: firstBody.fileSize + 1, name: "first-reencoded.jpg", contentType: "image/jpeg" },
      at: 51_750,
    }),
    (error) => error.status === 409 && error.code === "CONFLICT",
    "a logical token cannot silently switch output format or role",
  );

  const nondeterministicExpiry = db.prepare("SELECT upload_expires_at FROM media_objects WHERE object_key=?")
    .get(nondeterministic.upload.key).upload_expires_at;
  const replacement = createMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: { ...firstBody, clientVariantId: "variant-replace-second", name: "second.webp" },
    variantId: nondeterministic.variant.id,
    at: 52_000,
  });
  assert.equal(replacement.replaced, true);
  assert.notEqual(replacement.variant.id, nondeterministic.variant.id);
  assert.notEqual(replacement.upload.key, nondeterministic.upload.key);
  const retired = db.prepare("SELECT status,next_attempt_at FROM media_deletion_queue WHERE object_key=?").get(nondeterministic.upload.key);
  assert.equal(retired.status, "pending");
  assert.ok(retired.next_attempt_at >= nondeterministicExpiry + MEDIA_UPLOAD_SETTLE_BUFFER_MS,
    "the old still-signed PUT key cannot be deleted before its replay barrier");
  await assert.rejects(
    finalizeMediaVariant(db, {
      ownerId: user.id,
      assetId: created.asset.id,
      variantId: first.variant.id,
      body: { width: 1_333, height: 2_000 },
      fetchImpl: async () => { throw new Error("retired variants must fail before HEAD"); },
    }),
    (error) => error.status === 404 && error.code === "NOT_FOUND",
  );
  await assert.rejects(
    finalizeMediaVariant(db, {
      ownerId: user.id,
      assetId: created.asset.id,
      variantId: nondeterministic.variant.id,
      body: { width: 1_333, height: 2_000 },
      fetchImpl: async () => { throw new Error("replaced variants must fail before HEAD"); },
    }),
    (error) => error.status === 404 && error.code === "NOT_FOUND",
  );

  await finalizeMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    variantId: replacement.variant.id,
    body: { width: 1_333, height: 2_000 },
    fetchImpl: verifiedImage(firstBody.fileSize, "image/webp", 1_333, 2_000),
  });
  assert.throws(
    () => createMediaVariant(db, {
      ownerId: user.id,
      assetId: created.asset.id,
      body: {
        ...firstBody,
        clientVariantId: "variant-replace-second",
        name: "second-reencoded.webp",
        fileSize: firstBody.fileSize + 2,
      },
    }),
    (error) => error.status === 409 && error.code === "CONFLICT",
    "the same logical token cannot replace its descriptor after verification",
  );
  assert.throws(
    () => createMediaVariant(db, {
      ownerId: user.id,
      assetId: created.asset.id,
      body: { ...firstBody, clientVariantId: "variant-replace-third", name: "third.webp" },
    }),
    (error) => error.status === 409 && error.code === "CONFLICT",
    "a verified role descriptor cannot be replaced until the unattached recipe changes",
  );
});

test("asset PATCH stages photo revisions and swaps the ready rendition only after verified output", async () => {
  const owner = addUser("media_asset_patch_owner");
  const stranger = addUser("media_asset_patch_stranger");
  const created = createMediaAsset(db, {
    ownerId: owner.id,
    body: sourceBody({ clientAssetId: "asset-patch-source", fileSize: 18_000 }),
    assetId: "ma_mmmmmmmmmmmmmmmmmmmmmmmm",
    at: 1_000,
  });
  await finalizeMediaAsset(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: { width: 2_400, height: 3_000, altText: "First description", editRecipe: { kind: "image", filter: "pit" } },
    fetchImpl: verifiedImage(18_000, "image/jpeg", 2_400, 3_000),
    at: 2_000,
  });
  const firstRender = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: {
      clientVariantId: "asset-patch-render-one",
      role: "render",
      contentType: "image/webp",
      fileSize: 10_000,
      name: "first.webp",
    },
    variantId: "mv_mmmmmmmmmmmmmmmmmmmmmmmm",
    at: 3_000,
  });
  const firstFinished = await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    variantId: firstRender.variant.id,
    body: { width: 1_638, height: 2_048 },
    fetchImpl: verifiedImage(10_000, "image/webp", 1_638, 2_048),
    at: 4_000,
  });
  const firstRenderUrl = firstFinished.variant.url;
  const firstRenderKey = db.prepare("SELECT object_key FROM media_variants WHERE id=?")
    .get(firstRender.variant.id).object_key;
  assert.notEqual(firstRenderKey, firstRender.upload.key);
  const beforeAlt = db.prepare("SELECT source_key,source_url,finalize_hash,edit_recipe FROM media_assets WHERE id=?").get(created.asset.id);
  const altOnly = routes["PATCH /api/media/assets/:id"]({
    user: owner,
    ip: "asset-patch-alt",
    params: { id: created.asset.id },
    body: { altText: "  Singer\nunder   violet lights  " },
  });
  assert.equal(altOnly.recipeChanged, false);
  assert.equal(altOnly.asset.altText, "Singer under violet lights");
  const afterAlt = db.prepare("SELECT source_key,source_url,finalize_hash,edit_recipe FROM media_assets WHERE id=?").get(created.asset.id);
  assert.deepEqual({ ...afterAlt }, { ...beforeAlt }, "accessibility copy never changes source identity or render recipe");
  const duplicate = await finalizeMediaAsset(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: { width: 2_400, height: 3_000, altText: "stale retry text", editRecipe: { kind: "image", filter: "pit" } },
    fetchImpl: async () => { throw new Error("a lost-response retry must not re-HEAD"); },
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.asset.altText, "Singer under violet lights", "finalize retry never reverts a later alt patch");
  assert.throws(
    () => routes["PATCH /api/media/assets/:id"]({
      user: stranger,
      ip: "asset-patch-stranger",
      params: { id: created.asset.id },
      body: { altText: "Not mine" },
    }),
    (error) => error.status === 404 && error.code === "NOT_FOUND",
  );
  assert.throws(
    () => routes["PATCH /api/media/assets/:id"]({
      user: owner,
      ip: "asset-patch-unsafe",
      params: { id: created.asset.id },
      body: { altText: "white power" },
    }),
    (error) => error.status === 422 && error.code === "CONTENT_REJECTED",
  );

  const recipeUpdate = updateMediaAsset(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: { editRecipe: { kind: "image", filter: "mono" } },
    at: 10_000,
  });
  assert.equal(recipeUpdate.recipeChanged, true);
  assert.equal(recipeUpdate.revisionPending, true);
  assert.equal(recipeUpdate.asset.status, "ready");
  assert.equal(recipeUpdate.asset.url, firstRenderUrl,
    "the previous verified pixels remain available while replacement work is staged");
  assert.equal(recipeUpdate.asset.revisionPending, true);
  assert.equal(recipeUpdate.asset.editRecipe.filter, "mono",
    "owner reads resume the pending recipe even though the active rendition is unchanged");
  assert.ok(db.prepare("SELECT 1 FROM media_variants WHERE id=?").get(firstRender.variant.id));
  assert.equal(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(firstRenderKey), undefined);
  const afterRecipe = db.prepare("SELECT source_key,source_url,finalize_hash FROM media_assets WHERE id=?").get(created.asset.id);
  assert.deepEqual({ ...afterRecipe }, {
    source_key: beforeAlt.source_key,
    source_url: beforeAlt.source_url,
    finalize_hash: beforeAlt.finalize_hash,
  });

  assert.throws(
    () => mediaSelection(db, { ownerId: owner.id, assetIds: [created.asset.id], at: 10_100 }),
    (error) => error.status === 409 && error.code === "CONFLICT" && /pending photo edit/i.test(error.message),
    "a draft cannot publish the stale fallback while its owner has a pending edit",
  );

  const cancelledRender = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: {
      clientVariantId: "asset-patch-render-cancel",
      role: "render",
      contentType: "image/webp",
      fileSize: 9_100,
      name: "cancelled.webp",
    },
    variantId: "mv_cancelledrevisionxxxxxxxxx",
    at: 11_000,
  });
  db.prepare("DELETE FROM media_objects WHERE owner_id=? AND object_key=?")
    .run(owner.id, cancelledRender.upload.key);
  const recoveredRender = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: {
      clientVariantId: "asset-patch-render-cancel",
      role: "render",
      contentType: "image/webp",
      fileSize: 9_100,
      name: "cancelled.webp",
    },
    at: 11_100,
  });
  assert.equal(recoveredRender.replaced, true);
  assert.notEqual(recoveredRender.variant.id, cancelledRender.variant.id);
  assert.notEqual(recoveredRender.upload.key, cancelledRender.upload.key,
    "a staged object already confirmed deleted receives a fresh upload identity");
  assert.ok(assetObjectRecords(db, [created.asset.id])
    .some((record) => record.objectKey === recoveredRender.upload.key),
  "asset cleanup includes an unfinished staged rendition");
  const cancelled = updateMediaAsset(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: { editRecipe: { kind: "image", filter: "pit" } },
    at: 12_000,
  });
  assert.equal(cancelled.recipeChanged, false);
  assert.equal(cancelled.revisionPending, false);
  assert.equal(cancelled.asset.url, firstRenderUrl);
  assert.equal(cancelled.asset.editRecipe.filter, "pit");
  assert.equal(db.prepare("SELECT 1 FROM media_asset_revisions WHERE asset_id=?").get(created.asset.id), undefined);
  assert.equal(db.prepare("SELECT status FROM media_deletion_queue WHERE object_key=?").get(recoveredRender.upload.key).status, "pending");
  assert.equal(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(firstRenderKey), undefined,
    "cancelling a replacement retires only its staged object");

  const restaged = updateMediaAsset(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: { editRecipe: { kind: "image", filter: "mono" } },
    at: 13_000,
  });
  assert.equal(restaged.revisionPending, true);

  const secondRender = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: {
      clientVariantId: "asset-patch-render-two",
      role: "render",
      contentType: "image/webp",
      fileSize: 9_000,
      name: "second.webp",
    },
    variantId: "mv_nnnnnnnnnnnnnnnnnnnnnnnn",
    at: 14_000,
  });
  const retriedSecondRender = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: {
      clientVariantId: "asset-patch-render-two",
      role: "render",
      contentType: "image/webp",
      fileSize: 9_000,
      name: "second.webp",
    },
    at: 14_100,
  });
  assert.equal(retriedSecondRender.duplicate, true);
  assert.equal(retriedSecondRender.variant.id, secondRender.variant.id);
  assert.equal(retriedSecondRender.upload.key, secondRender.upload.key);

  await assert.rejects(finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    variantId: secondRender.variant.id,
    body: { width: 1_638, height: 2_048 },
    fetchImpl: async () => { throw new Error("storage interrupted"); },
    at: 15_000,
  }), (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE");
  const afterFailedReplacement = ownedMediaAsset(db, { ownerId: owner.id, assetId: created.asset.id });
  assert.equal(afterFailedReplacement.url, firstRenderUrl);
  assert.equal(afterFailedReplacement.editRecipe.filter, "mono");
  assert.equal(afterFailedReplacement.revisionPending, true);
  assert.ok(db.prepare("SELECT 1 FROM media_variants WHERE id=?").get(firstRender.variant.id));
  assert.equal(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(firstRenderKey), undefined,
    "failed verification cannot retire the last good rendition");

  const swapped = await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    variantId: secondRender.variant.id,
    body: { width: 1_638, height: 2_048 },
    fetchImpl: verifiedImage(9_000, "image/webp", 1_638, 2_048),
    at: 16_000,
  });
  assert.equal(swapped.asset.url, swapped.variant.url);
  assert.equal(swapped.asset.editRecipe.filter, "mono");
  assert.equal(swapped.asset.revisionPending, false);
  assert.equal(db.prepare("SELECT 1 FROM media_asset_revisions WHERE asset_id=?").get(created.asset.id), undefined);
  assert.equal(db.prepare("SELECT 1 FROM media_variants WHERE id=?").get(firstRender.variant.id), undefined);
  assert.ok(db.prepare("SELECT 1 FROM media_variants WHERE id=?").get(secondRender.variant.id));
  assert.equal(db.prepare("SELECT status FROM media_deletion_queue WHERE object_key=?").get(firstRenderKey).status, "pending");
  const secondRenderKey = db.prepare("SELECT object_key FROM media_variants WHERE id=?")
    .get(secondRender.variant.id).object_key;
  assert.notEqual(secondRenderKey, secondRender.upload.key);
  assert.equal(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(secondRenderKey), undefined);
  const finalizeRetry = await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    variantId: secondRender.variant.id,
    body: { width: 1_638, height: 2_048 },
    fetchImpl: async () => { throw new Error("a committed finalize retry must not HEAD"); },
    at: 17_000,
  });
  assert.equal(finalizeRetry.duplicate, true);
  assert.equal(finalizeRetry.asset.url, swapped.variant.url);
  const published = routes["POST /api/posts"]({
    user: owner,
    ip: "asset-patch-publish",
    body: {
      kind: "status",
      review: "Mutable accessibility copy",
      mediaAssetIds: [created.asset.id],
      clientMutationId: "asset-patch-post-0001",
    },
  });
  assert.throws(
    () => routes["PATCH /api/media/assets/:id"]({
      user: owner,
      ip: "asset-patch-attached-recipe",
      params: { id: created.asset.id },
      body: { editRecipe: { kind: "image", filter: "neon" } },
    }),
    (error) => error.status === 409 && error.code === "CONFLICT",
  );
  routes["PATCH /api/media/assets/:id"]({
    user: owner,
    ip: "asset-patch-attached-alt",
    params: { id: created.asset.id },
    body: { altText: "Corrected after publishing" },
  });
  const publicPost = routes["GET /api/users/:id/posts"]({
    user: null,
    ip: "asset-patch-public-read",
    params: { id: owner.id },
    query: {},
  }).posts.find((post) => post.id === published.id);
  assert.equal(publicPost.media[0].altText, "Corrected after publishing");
});

test("selection and attachment fail closed for retired source, render, and poster ledgers", async () => {
  const owner = addUser("media_live_ledger_owner");
  const source = createMediaAsset(db, {
    ownerId: owner.id,
    body: sourceBody({ clientAssetId: "live-ledger-source", fileSize: 7_000 }),
    assetId: "ma_oooooooooooooooooooooooo",
  });
  await finalizeMediaAsset(db, {
    ownerId: owner.id,
    assetId: source.asset.id,
    body: { width: 1_200, height: 1_500, editRecipe: {} },
    fetchImpl: verifiedImage(7_000, "image/jpeg", 1_200, 1_500),
  });
  const sourceRender = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: source.asset.id,
    body: {
      clientVariantId: "live-ledger-source-render",
      role: "render",
      contentType: "image/webp",
      fileSize: 5_000,
      name: "source-render.webp",
    },
    variantId: "mv_oooooooooooooooooooooooo",
  });
  await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: source.asset.id,
    variantId: sourceRender.variant.id,
    body: { width: 1_200, height: 1_500 },
    fetchImpl: verifiedImage(5_000, "image/webp", 1_200, 1_500),
  });
  const staleSelection = mediaSelection(db, { ownerId: owner.id, assetIds: [source.asset.id] });
  db.prepare("UPDATE media_objects SET status='delete_queued' WHERE object_key=?").run(source.upload.key);
  assert.throws(
    () => mediaSelection(db, { ownerId: owner.id, assetIds: [source.asset.id] }),
    (error) => error.status === 409 && error.code === "CONFLICT",
  );
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run("p_live_ledger_attach", owner.id, "", "", 0, "draft", "[]", 5_000);
  const attach = () => {
    db.exec("BEGIN IMMEDIATE");
    try {
      attachPostMedia(db, {
        postId: "p_live_ledger_attach",
        ownerId: owner.id,
        selection: staleSelection,
        at: 5_001,
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  assert.throws(attach, (error) => error.status === 409 && error.code === "CONFLICT");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM post_media WHERE post_id=?").get("p_live_ledger_attach").count, 0);
  db.prepare("UPDATE media_objects SET status='issued' WHERE object_key=?").run(source.upload.key);

  const edited = createMediaAsset(db, {
    ownerId: owner.id,
    body: sourceBody({ clientAssetId: "live-ledger-render", fileSize: 8_000 }),
    assetId: "ma_pppppppppppppppppppppppp",
  });
  await finalizeMediaAsset(db, {
    ownerId: owner.id,
    assetId: edited.asset.id,
    body: { width: 1_200, height: 1_500, editRecipe: { kind: "image", filter: "encore" } },
    fetchImpl: verifiedImage(8_000, "image/jpeg", 1_200, 1_500),
  });
  const render = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: edited.asset.id,
    body: {
      clientVariantId: "live-ledger-render-out",
      role: "render",
      contentType: "image/webp",
      fileSize: 6_000,
      name: "render.webp",
    },
    variantId: "mv_pppppppppppppppppppppppp",
  });
  const finalizedRender = await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: edited.asset.id,
    variantId: render.variant.id,
    body: { width: 1_200, height: 1_500 },
    fetchImpl: verifiedImage(6_000, "image/webp", 1_200, 1_500),
  });
  const publicRenderKey = db.prepare("SELECT object_key FROM media_variants WHERE id=?")
    .get(render.variant.id).object_key;
  assert.equal(finalizedRender.variant.url,
    db.prepare("SELECT public_url FROM media_variants WHERE id=?").get(render.variant.id).public_url);
  assert.notEqual(publicRenderKey, render.upload.key);
  db.prepare("UPDATE media_objects SET status='delete_queued' WHERE object_key=?").run(publicRenderKey);
  assert.throws(
    () => mediaSelection(db, { ownerId: owner.id, assetIds: [edited.asset.id] }),
    (error) => error.status === 409 && error.code === "CONFLICT",
  );

  const video = createMediaAsset(db, {
    ownerId: owner.id,
    body: sourceBody({
      clientAssetId: "live-ledger-poster",
      contentType: "video/mp4",
      fileSize: 900_000,
      name: "clip.mp4",
    }),
    assetId: "ma_qqqqqqqqqqqqqqqqqqqqqqqq",
  });
  await finalizeMediaAsset(db, {
    ownerId: owner.id,
    assetId: video.asset.id,
    body: { width: 1_080, height: 1_920, durationMs: 10_000, editRecipe: { kind: "video", coverMs: 2_000 } },
    fetchImpl: verifiedMp4WithPoster(900_000, 10_000),
    authoritativeVideoVerifier: authoritativeFixtureDecodeWithPoster,
    authoritativePosterRequired: true,
  });
  const posterKey = db.prepare("SELECT poster_key FROM media_assets WHERE id=?").get(video.asset.id).poster_key;
  assert.match(posterKey, /\.jpg$/);
  db.prepare("UPDATE media_objects SET status='delete_queued' WHERE object_key=?").run(posterKey);
  assert.throws(
    () => mediaSelection(db, { ownerId: owner.id, assetIds: [video.asset.id] }),
    (error) => error.status === 409 && error.code === "CONFLICT" && /cover frame/i.test(error.message),
  );
});

test("orphan cleanup respects refreshed activity, invalidates stale drafts, and loses finalize races safely", async () => {
  const day = 24 * 60 * 60_000;
  const cleanupAt = 2 * day;
  const cleanupEnv = { ...process.env, MEDIA_ORPHAN_TTL_MS: String(day) };

  const staleOwner = addUser("media_orphan_stale_owner");
  const stale = createMediaAsset(db, {
    ownerId: staleOwner.id,
    body: sourceBody({ clientAssetId: "orphan-stale-source", fileSize: 11_000 }),
    assetId: "ma_rrrrrrrrrrrrrrrrrrrrrrrr",
    at: 1_000,
  });
  await finalizeMediaAsset(db, {
    ownerId: staleOwner.id,
    assetId: stale.asset.id,
    body: { width: 1_500, height: 2_000, editRecipe: { kind: "image", filter: "analog" } },
    fetchImpl: verifiedImage(11_000, "image/jpeg", 1_500, 2_000),
    at: 2_000,
  });
  const staleRender = createMediaVariant(db, {
    ownerId: staleOwner.id,
    assetId: stale.asset.id,
    body: {
      clientVariantId: "orphan-stale-render",
      role: "render",
      contentType: "image/webp",
      fileSize: 7_000,
      name: "orphan.webp",
    },
    variantId: "mv_rrrrrrrrrrrrrrrrrrrrrrrr",
    at: 3_000,
  });
  const finalizedStaleRender = await finalizeMediaVariant(db, {
    ownerId: staleOwner.id,
    assetId: stale.asset.id,
    variantId: staleRender.variant.id,
    body: { width: 1_500, height: 2_000 },
    fetchImpl: verifiedImage(7_000, "image/webp", 1_500, 2_000),
    at: 4_000,
  });
  const stalePublicKey = db.prepare("SELECT object_key FROM media_variants WHERE id=?")
    .get(staleRender.variant.id).object_key;
  assert.equal(finalizedStaleRender.variant.url,
    db.prepare("SELECT public_url FROM media_variants WHERE id=?").get(staleRender.variant.id).public_url);
  assert.ok(enqueueExpiredMediaTickets(db, { env: cleanupEnv, at: cleanupAt }) >= 2);
  assert.equal(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(stale.asset.id), undefined,
    "an expired unattached descriptor is removed before it can publish dead URLs");
  assert.deepEqual(db.prepare("SELECT object_key FROM media_deletion_queue WHERE owner_id=? ORDER BY object_key")
    .all(staleOwner.id).map((row) => row.object_key), [
      stale.upload.key,
      staleRender.upload.key,
      stalePublicKey,
    ].sort());

  const finalizedOwner = addUser("media_orphan_finalize_owner");
  const finalizedBody = sourceBody({ clientAssetId: "orphan-finalize-source", fileSize: 12_500 });
  const recentlyFinalized = createMediaAsset(db, {
    ownerId: finalizedOwner.id,
    body: finalizedBody,
    assetId: "ma_wwwwwwwwwwwwwwwwwwwwwwww",
    at: 1_000,
  });
  await finalizeMediaAsset(db, {
    ownerId: finalizedOwner.id,
    assetId: recentlyFinalized.asset.id,
    body: { width: 1_000, height: 1_250, editRecipe: {} },
    fetchImpl: verifiedImage(12_500, "image/jpeg", 1_000, 1_250),
    at: 2_000,
  });
  const resumedRender = createMediaVariant(db, {
    ownerId: finalizedOwner.id,
    assetId: recentlyFinalized.asset.id,
    body: {
      clientVariantId: "orphan-finalize-render",
      role: "render",
      contentType: "image/webp",
      fileSize: 7_500,
      name: "resumed.webp",
    },
    variantId: "mv_wwwwwwwwwwwwwwwwwwwwwwww",
    at: 3_000,
  });
  await finalizeMediaVariant(db, {
    ownerId: finalizedOwner.id,
    assetId: recentlyFinalized.asset.id,
    variantId: resumedRender.variant.id,
    body: { width: 1_000, height: 1_250 },
    fetchImpl: verifiedImage(7_500, "image/webp", 1_000, 1_250),
    at: 4_000,
  });
  const resumed = createMediaAsset(db, {
    ownerId: finalizedOwner.id,
    body: finalizedBody,
    at: cleanupAt - (day / 2),
  });
  assert.equal(resumed.duplicate, true);
  assert.equal(resumed.upload, null);
  assert.equal(resumed.asset.status, "ready");
  assert.equal(enqueueExpiredMediaTickets(db, { env: cleanupEnv, at: cleanupAt }), 0);
  assert.ok(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(recentlyFinalized.asset.id),
    "reopening a ready draft renews its activity lease even when its original PUT ticket is old");

  db.prepare(`UPDATE media_objects SET updated_at=4_000,upload_expires_at=4_000
    WHERE owner_id=? AND object_key IN (?,?)`)
    .run(finalizedOwner.id, recentlyFinalized.upload.key, resumedRender.upload.key);
  const ownerReadAt = cleanupAt - (day / 3);
  const reopened = ownedMediaAsset(db, {
    ownerId: finalizedOwner.id,
    assetId: recentlyFinalized.asset.id,
    renew: true,
    at: ownerReadAt,
  });
  assert.equal(reopened.status, "ready");
  assert.equal(db.prepare("SELECT updated_at FROM media_objects WHERE object_key=?")
    .get(recentlyFinalized.upload.key).updated_at, ownerReadAt);
  assert.equal(enqueueExpiredMediaTickets(db, { env: cleanupEnv, at: cleanupAt }), 0,
    "an authenticated owner read renews a ready draft before orphan cleanup");

  const freshOwner = addUser("media_orphan_refresh_owner");
  const freshBody = sourceBody({ clientAssetId: "orphan-refresh-source", fileSize: 12_000 });
  const fresh = createMediaAsset(db, {
    ownerId: freshOwner.id,
    body: freshBody,
    assetId: "ma_ssssssssssssssssssssssss",
    at: 1_000,
  });
  createMediaAsset(db, {
    ownerId: freshOwner.id,
    body: freshBody,
    at: cleanupAt - (day / 2),
  });
  assert.equal(enqueueExpiredMediaTickets(db, { env: cleanupEnv, at: cleanupAt }), 0);
  assert.ok(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(fresh.asset.id),
    "a fresh ticket retry moves the orphan activity/expiry barrier");

  const attachedOwner = addUser("media_orphan_attached_owner");
  const attached = createMediaAsset(db, {
    ownerId: attachedOwner.id,
    body: sourceBody({ clientAssetId: "orphan-attached-source", fileSize: 13_000 }),
    assetId: "ma_tttttttttttttttttttttttt",
    at: 1_000,
  });
  await finalizeMediaAsset(db, {
    ownerId: attachedOwner.id,
    assetId: attached.asset.id,
    body: { width: 1_000, height: 1_000, editRecipe: {} },
    fetchImpl: verifiedImage(13_000, "image/jpeg", 1_000, 1_000),
    at: 2_000,
  });
  const attachedRender = createMediaVariant(db, {
    ownerId: attachedOwner.id,
    assetId: attached.asset.id,
    body: {
      clientVariantId: "orphan-attached-render",
      role: "render",
      contentType: "image/webp",
      fileSize: 8_000,
      name: "attached.webp",
    },
    variantId: "mv_tttttttttttttttttttttttt",
    at: 3_000,
  });
  await finalizeMediaVariant(db, {
    ownerId: attachedOwner.id,
    assetId: attached.asset.id,
    variantId: attachedRender.variant.id,
    body: { width: 1_000, height: 1_000 },
    fetchImpl: verifiedImage(8_000, "image/webp", 1_000, 1_000),
    at: 4_000,
  });
  routes["POST /api/posts"]({
    user: attachedOwner,
    ip: "orphan-attached-post",
    body: {
      kind: "status",
      review: "Attached wins cleanup",
      mediaAssetIds: [attached.asset.id],
      clientMutationId: "orphan-attached-post-01",
    },
  });
  db.prepare("UPDATE media_objects SET status='issued',updated_at=1,upload_expires_at=1 WHERE object_key=?")
    .run(attached.upload.key);
  assert.equal(enqueueExpiredMediaTickets(db, { env: cleanupEnv, at: cleanupAt }), 0);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(attached.upload.key).status, "associated",
    "an attached row repairs a stale issued ledger instead of being orphaned");

  const raceOwner = addUser("media_orphan_race_owner");
  const racing = createMediaAsset(db, {
    ownerId: raceOwner.id,
    body: sourceBody({ clientAssetId: "orphan-race-source", fileSize: 14_000 }),
    assetId: "ma_uuuuuuuuuuuuuuuuuuuuuuuu",
    at: 1_000,
  });
  await assert.rejects(
    finalizeMediaAsset(db, {
      ownerId: raceOwner.id,
      assetId: racing.asset.id,
      body: { width: 1_000, height: 1_250, editRecipe: {} },
      at: cleanupAt + 1,
      fetchImpl: async () => {
        assert.equal(enqueueExpiredMediaTickets(db, { env: cleanupEnv, at: cleanupAt }), 1);
        return {
          status: 200,
          headers: new Headers({ "content-length": "14000", "content-type": "image/jpeg" }),
        };
      },
    }),
    (error) => error.status === 409 && error.code === "CONFLICT",
  );
  assert.equal(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(racing.asset.id), undefined);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(racing.upload.key).status, "delete_queued");
});

test("aggregate draft activity cannot starve later orphan cleanup batches", async () => {
  const day = 24 * 60 * 60_000;
  const cleanupAt = 2 * day;
  const recentAt = cleanupAt - (day / 2);
  const env = { ...process.env, MEDIA_ORPHAN_TTL_MS: String(day) };
  const activeOwner = addUser("media_orphan_starvation_active");
  const active = createMediaAsset(db, {
    ownerId: activeOwner.id,
    body: sourceBody({ clientAssetId: "orphan-starvation-source", fileSize: 15_000 }),
    assetId: "ma_xxxxxxxxxxxxxxxxxxxxxxxx",
    at: 1_000,
  });
  await finalizeMediaAsset(db, {
    ownerId: activeOwner.id,
    assetId: active.asset.id,
    body: { width: 1_200, height: 1_500, editRecipe: {} },
    fetchImpl: verifiedImage(15_000, "image/jpeg", 1_200, 1_500),
    at: 2_000,
  });
  createMediaVariant(db, {
    ownerId: activeOwner.id,
    assetId: active.asset.id,
    body: {
      clientVariantId: "orphan-starvation-render",
      role: "render",
      contentType: "image/webp",
      fileSize: 8_000,
      name: "active.webp",
    },
    variantId: "mv_xxxxxxxxxxxxxxxxxxxxxxxx",
    at: recentAt,
  });
  db.prepare("UPDATE media_objects SET updated_at=1,upload_expires_at=1 WHERE object_key=?").run(active.upload.key);

  const orphanOwner = addUser("media_orphan_starvation_orphan");
  const orphanKey = `users/${orphanOwner.id}/post/true-orphan.jpg`;
  recordMediaObjectTicket(db, { ownerId: orphanOwner.id, objectKey: orphanKey, at: 2, expiresAt: null });
  assert.equal(enqueueExpiredMediaTickets(db, { env, at: cleanupAt, limit: 1 }), 0);
  assert.equal(db.prepare("SELECT updated_at FROM media_objects WHERE object_key=?").get(active.upload.key).updated_at, recentAt,
    "the skipped asset advances its stale member to the aggregate activity horizon");
  assert.equal(enqueueExpiredMediaTickets(db, { env, at: cleanupAt, limit: 1 }), 1);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(orphanKey).status, "delete_queued");
});

test("production clips stay decode-gated while decoder-approved fixtures exercise cover lifecycle", async () => {
  const user = addUser("media_asset_video_owner");
  const decodeGated = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "asset-video-needs-decoder",
      contentType: "video/mp4",
      fileSize: 1_000_000,
      name: "decoder-gated.mp4",
    }),
    assetId: "ma_decodergatedxxxxxxxxxxxxxx",
  });
  const unavailable = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: decodeGated.asset.id,
    body: {
      width: 1_080,
      height: 1_920,
      durationMs: 10_000,
      editRecipe: { kind: "video", durationMs: 10_000, trimStartMs: 0, trimEndMs: 10_000, coverMs: 2_000 },
    },
    fetchImpl: verifiedMp4(1_000_000, 10_000),
  });
  assert.equal(unavailable.asset.status, "render_unavailable");
  assert.equal(unavailable.asset.renderState, "unavailable");
  assert.equal(unavailable.asset.codecStatus, "pending");
  assert.equal(unavailable.asset.url, null);
  assert.equal(db.prepare("SELECT codec_verified_at FROM media_assets WHERE id=?").get(decodeGated.asset.id).codec_verified_at, null);
  const unavailableEdit = updateMediaAsset(db, {
    ownerId: user.id,
    assetId: decodeGated.asset.id,
    body: {
      editRecipe: { kind: "video", durationMs: 10_000, trimStartMs: 0, trimEndMs: 10_000, coverMs: 3_000 },
    },
  });
  assert.equal(unavailableEdit.asset.status, "render_unavailable");
  assert.equal(unavailableEdit.asset.renderState, "unavailable");
  assert.equal(unavailableEdit.asset.codecStatus, "pending");
  assert.equal(unavailableEdit.asset.url, null,
    "changing a cover recipe cannot relabel a structurally inspected clip as ready");
  assert.throws(
    () => routes["POST /api/posts"]({
      user,
      ip: "video-decoder-gated",
      body: {
        kind: "status",
        review: "A structural MP4 is not a decoded clip",
        mediaAssetIds: [decodeGated.asset.id],
        clientMutationId: "video-decoder-gated-01",
      },
    }),
    (error) => error.status === 409 && error.code === "CONFLICT",
    "the production-default path never publishes a structurally plausible but undecoded clip",
  );

  const coverOnly = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "asset-retry-video-cover",
      contentType: "video/mp4",
      fileSize: 5_000_000,
      name: "encore.mp4",
    }),
    assetId: "ma_ffffffffffffffffffffffff",
  });
  const codecRequests = [];
  const source = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: coverOnly.asset.id,
    body: { width: 1_920, height: 1_080, durationMs: 29_999, editRecipe: {
      kind: "video", durationMs: 29_999, trimStartMs: 0, trimEndMs: 29_999, coverMs: 8_000,
    } },
    fetchImpl: verifiedMp4(5_000_000, 30_000, codecRequests),
    authoritativeVideoVerifier: authoritativeFixtureDecode,
  });
  assert.equal(source.asset.status, "ready");
  assert.equal(source.asset.codecStatus, "verified");
  assert.equal(source.asset.durationMs, 30_000, "the server persists the authoritative track duration");
  assert.deepEqual({ width: source.asset.width, height: source.asset.height }, { width: 1_080, height: 1_920 },
    "the public descriptor uses the verifier-generated delivery geometry");
  assert.equal(source.asset.editRecipe.trimEndMs, 30_000,
    "a one-millisecond picker/probe rounding drift does not fabricate a destructive trim");
  assert.equal(source.asset.sourceUrl, null, "private originals are never returned as public URLs during finalize");
  const reopenedPrivateSource = ownedMediaAsset(db, { ownerId: user.id, assetId: coverOnly.asset.id });
  const reopenedSourceUrl = new URL(reopenedPrivateSource.sourceUrl);
  assert.equal(reopenedSourceUrl.pathname.includes("/pit-media-private/users/"), true);
  assert.equal(reopenedSourceUrl.searchParams.get("X-Amz-SignedHeaders"), "host;if-match");
  const replayedClientPatch = updateMediaAsset(db, {
    ownerId: user.id,
    assetId: coverOnly.asset.id,
    body: { editRecipe: {
      kind: "video", durationMs: 29_999, trimStartMs: 0, trimEndMs: 29_999, coverMs: 8_000,
    } },
  });
  assert.equal(replayedClientPatch.recipeChanged, false);
  assert.equal(replayedClientPatch.asset.status, "ready",
    "the client's immediate post-finalize recipe PATCH cannot reintroduce picker rounding as a trim");
  assert.equal(codecRequests[0].options.method, "HEAD");
  assert.equal(codecRequests.some((request) => String(request.options.method || "GET").toUpperCase() === "GET"
    && new Headers(request.options.headers || {}).get("range")
    && new Headers(request.options.headers || {}).get("if-match")), true,
  "video compatibility reads are bounded, version-bound Range requests");
  assert.throws(
    () => routes["POST /api/posts"]({
      user,
      ip: "video-without-poster",
      body: {
        kind: "status",
        review: "Cover is not ready yet",
        mediaAssetIds: [coverOnly.asset.id],
        clientMutationId: "video-post-without-cover",
      },
    }),
    (error) => error.code === "CONFLICT" && /cover frame/i.test(error.message),
    "the stable-asset path must never publish a clip without a verified durable poster",
  );
  const withPoster = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: coverOnly.asset.id,
    body: { width: 1_920, height: 1_080, durationMs: 29_999, editRecipe: {
      kind: "video", durationMs: 29_999, trimStartMs: 0, trimEndMs: 29_999, coverMs: 8_000,
    } },
    fetchImpl: verifiedMp4WithPoster(5_000_000, 30_000),
    authoritativeVideoVerifier: authoritativeFixtureDecodeWithPoster,
    authoritativePosterRequired: true,
  });
  const poster = db.prepare("SELECT * FROM media_variants WHERE id=?")
    .get(db.prepare("SELECT poster_variant_id FROM media_assets WHERE id=?").get(coverOnly.asset.id).poster_variant_id);
  assert.equal(poster.verification_origin, "private_derivative_v1");
  const posterBinding = db.prepare(`SELECT a.edit_recipe,a.poster_variant_id,v.time_ms,v.status,v.verification_origin,
    o.status ledger_status FROM media_assets a JOIN media_variants v ON v.id=a.poster_variant_id
    JOIN media_objects o ON o.owner_id=a.owner_id AND o.object_key=v.object_key WHERE a.id=?`).get(coverOnly.asset.id);
  assert.equal(JSON.parse(posterBinding.edit_recipe).coverMs, 8_000);
  assert.deepEqual({
    pointer: posterBinding.poster_variant_id,
    timeMs: posterBinding.time_ms,
    status: posterBinding.status,
    origin: posterBinding.verification_origin,
    ledger: posterBinding.ledger_status,
  }, {
    pointer: poster.id,
    timeMs: 8_000,
    status: "verified",
    origin: "private_derivative_v1",
    ledger: "issued",
  });
  assert.equal(withPoster.asset.posterUrl, poster.public_url);
  assert.equal(withPoster.asset.posterTimeMs, 8_000);
  const published = routes["POST /api/posts"]({
    user,
    ip: "video-with-poster",
    body: {
      kind: "status",
      review: "Cover is durable",
      mediaAssetIds: [coverOnly.asset.id],
      clientMutationId: "video-post-with-cover-01",
    },
  });
  assert.equal(published.post.media[0].posterUrl, poster.public_url);
  assert.equal(published.post.media[0].posterTimeMs, 8_000);
  db.prepare("UPDATE media_assets SET codec_status='pending',codec_verified_at=NULL WHERE id=?").run(coverOnly.asset.id);
  const codecRevoked = routes["GET /api/users/:id/posts"]({
    user,
    ip: "stable-media-codec-revoked",
    params: { id: user.id },
    query: {},
  }).posts.find((post) => post.id === published.id);
  assert.deepEqual(codecRevoked.media, []);
  assert.deepEqual(codecRevoked.photos, [],
    "a denormalized stable URL cannot bypass a later fail-closed codec state");
  db.prepare("UPDATE media_assets SET codec_status='verified',codec_verified_at=? WHERE id=?")
    .run(Date.now(), coverOnly.asset.id);
  const moderatorSeed = addUser("media_asset_video_moderator");
  db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(moderatorSeed.id);
  const moderator = q.userById.get(moderatorSeed.id);
  const moderation = routes["POST /api/admin/moderation/actions"];
  moderation({
    user: moderator,
    ip: "stable-media-moderation-remove",
    requestId: "req_stable_media_remove",
    body: { action: "remove", targetType: "post", targetId: published.id, reason: "unsafe clip" },
  });
  assert.equal(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(coverOnly.asset.id), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM post_media WHERE post_id=?").get(published.id).count, 0);
  const queued = new Set(db.prepare("SELECT object_key FROM media_deletion_queue WHERE owner_id=?").all(user.id).map((row) => row.object_key));
  assert.equal(queued.has(coverOnly.upload.key), true);
  assert.equal(queued.has(poster.object_key), true);
  moderation({
    user: moderator,
    ip: "stable-media-moderation-restore",
    requestId: "req_stable_media_restore",
    body: { action: "restore", targetType: "post", targetId: published.id, reason: "text appeal accepted" },
  });
  const restored = routes["GET /api/users/:id/posts"]({
    user,
    ip: "stable-media-restored-read",
    params: { id: user.id },
    query: {},
  }).posts.find((post) => post.id === published.id);
  assert.deepEqual(restored.photos, []);
  assert.deepEqual(restored.media, [], "a text-only restore must not resurrect stable media or its poster");

  const destructive = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "asset-retry-video-edit",
      contentType: "video/mp4",
      fileSize: 4_000_000,
      name: "trim.mp4",
    }),
    assetId: "ma_hhhhhhhhhhhhhhhhhhhhhhhh",
  });
  const blocked = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: destructive.asset.id,
    body: { width: 1_920, height: 1_080, durationMs: 30_000, editRecipe: { kind: "video", trimStartMs: 2_000, trimEndMs: 20_000 } },
    fetchImpl: verifiedMp4(4_000_000, 30_000),
  });
  assert.equal(blocked.asset.status, "render_unavailable");
  assert.equal(blocked.asset.renderState, "unavailable");
  assert.equal(blocked.asset.url, null);
  assert.throws(
    () => createMediaVariant(db, {
      ownerId: user.id,
      assetId: destructive.asset.id,
      body: { clientVariantId: "video-render-retry", role: "render", contentType: "video/mp4", fileSize: 1_000, name: "edited.mp4" },
    }),
    (error) => error.code === "CONFLICT",
  );
});

test("post creation projects stable media and grandfathers stored URL-only media", async () => {
  const user = addUser("media_asset_post_owner");
  assert.throws(
    () => routes["POST /api/media/presign"]({
      user,
      ip: "raw-post-presign-blocked",
      body: { purpose: "post", contentType: "image/jpeg", fileSize: 12_345, name: "raw.jpg" },
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  assert.throws(
    () => routes["POST /api/venues/:key/reviews"]({
      user,
      ip: "legacy-venue-video-blocked",
      params: { key: encodeURIComponent("History") },
      body: { rating: 4, text: "A moving walkthrough", photos: ["https://legacy.example.com/walkthrough.mp4"] },
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  const created = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({ clientAssetId: "asset-retry-post", fileSize: 12_345 }),
    assetId: "ma_iiiiiiiiiiiiiiiiiiiiiiii",
  });
  await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: { width: 1_080, height: 1_350, altText: "Singer reaching toward the front row", editRecipe: {} },
    fetchImpl: verifiedImage(12_345, "image/jpeg", 1_080, 1_350),
  });
  const delivery = createMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: {
      clientVariantId: "asset-post-delivery-render",
      role: "render",
      contentType: "image/webp",
      fileSize: 8_000,
      name: "post-delivery.webp",
    },
    variantId: "mv_iiiiiiiiiiiiiiiiiiiiiiii",
  });
  const finalizedDelivery = await finalizeMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    variantId: delivery.variant.id,
    body: { width: 1_080, height: 1_350 },
    fetchImpl: verifiedImage(8_000, "image/webp", 1_080, 1_350),
  });
  const deliveryUrl = finalizedDelivery.variant.url;
  const stable = routes["POST /api/posts"]({
    user,
    ip: "stable-media-post",
    body: {
      kind: "status",
      review: "From the front row",
      mediaAssetIds: [created.asset.id],
      clientMutationId: "post-media-retry-0001",
    },
  });
  assert.deepEqual(stable.post.photos, [deliveryUrl]);
  assert.equal(stable.post.media.length, 1);
  assert.deepEqual(stable.post.mediaAssetIds, [created.asset.id]);
  assert.equal(stable.post.media[0].id, created.asset.id);
  assert.equal(stable.post.media[0].url, deliveryUrl);
  assert.equal(stable.post.media[0].sourceUrl, null);
  assert.equal(stable.post.media[0].altText, "Singer reaching toward the front row");
  const publicStable = routes["GET /api/users/:id/posts"]({
    user: null,
    ip: "stable-media-public-read",
    params: { id: user.id },
    query: {},
  }).posts.find((post) => post.id === stable.id);
  assert.equal(publicStable.media[0].sourceUrl, deliveryUrl);
  assert.notEqual(publicStable.media[0].sourceUrl, created.upload.storageLocator,
    "non-owners never receive the original source reference");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(created.upload.key).status, "associated");
  const exported = routes["POST /api/me/export"]({ user, ip: "stable-media-export", body: { password: "media-password" } });
  const exportedAsset = exported.mediaAssets.find((asset) => asset.id === created.asset.id);
  assert.equal(exportedAsset?.url, deliveryUrl);
  assert.equal(exportedAsset?.altText, "Singer reaching toward the front row");
  assert.equal(Object.hasOwn(exportedAsset || {}, "sourceUrl"), false,
    "portable exports never serialize a reusable private-source capability");

  const legacyUrl = "https://legacy.example.com/concert.jpg";
  assert.throws(
    () => routes["POST /api/posts"]({
      user,
      ip: "legacy-media-post",
      body: {
        kind: "status",
        review: "Raw image bypass",
        photos: [legacyUrl],
        clientMutationId: "post-media-retry-legacy",
      },
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,photos_public,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    "p_historical_image_edit",
    user.id,
    "Archive Artist",
    "Archive Room",
    4,
    "Historical image",
    JSON.stringify([legacyUrl]),
    1,
    1_000,
  );
  routes["PATCH /api/posts/:id"]({
    user,
    ip: "legacy-image-retain",
    params: { id: "p_historical_image_edit" },
    body: { review: "Historical image retained", photos: [legacyUrl], version: 1_000 },
  });
  assert.deepEqual(JSON.parse(db.prepare("SELECT photos FROM posts WHERE id=?").get("p_historical_image_edit").photos), [legacyUrl]);
  const racedVersion = db.prepare("SELECT updated_at FROM posts WHERE id=?").get("p_historical_image_edit").updated_at;
  let injectedRace = false;
  const racedBody = { photos: [legacyUrl], version: racedVersion };
  Object.defineProperty(racedBody, "review", {
    enumerable: true,
    get() {
      if (!injectedRace) {
        injectedRace = true;
        db.prepare("UPDATE posts SET updated_at=? WHERE id=?").run(racedVersion + 1, "p_historical_image_edit");
      }
      return "Stale edit must not win";
    },
  });
  assert.throws(
    () => routes["PATCH /api/posts/:id"]({
      user,
      ip: "post-edit-race",
      params: { id: "p_historical_image_edit" },
      body: racedBody,
    }),
    (error) => error.status === 409 && error.code === "CONFLICT",
  );
  assert.equal(db.prepare("SELECT review FROM posts WHERE id=?").get("p_historical_image_edit").review, "Historical image retained",
    "a post changed after the snapshot is never overwritten inside the media transaction");
});

test("new URL-only videos are blocked while historical clips are grandfathered and gallery posters are projected", async () => {
  const user = addUser("media_legacy_boundary_owner");
  const historicalVideo = "https://legacy.example.com/archive.mp4";
  assert.throws(
    () => routes["POST /api/posts"]({
      user,
      ip: "legacy-video-create-blocked",
      body: {
        kind: "status",
        review: "Must use stable video",
        photos: [historicalVideo],
        clientMutationId: "legacy-video-create-01",
      },
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  assert.throws(
    () => routes["POST /api/posts"]({
      user,
      ip: "legacy-video-query-create-blocked",
      body: {
        kind: "status",
        review: "Query strings cannot bypass stable video",
        photos: ["https://legacy.example.com/resource?format=.mp4"],
        clientMutationId: "legacy-video-query-create-01",
      },
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );

  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,photos_public,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    "p_historical_video_edit",
    user.id,
    "Archive Artist",
    "Archive Room",
    4,
    "Historical clip",
    JSON.stringify([historicalVideo]),
    1,
    1_000,
  );
  routes["PATCH /api/posts/:id"]({
    user,
    ip: "legacy-video-retain",
    params: { id: "p_historical_video_edit" },
    body: { review: "Historical clip retained", photos: [historicalVideo], version: 1_000 },
  });
  const edited = db.prepare("SELECT updated_at FROM posts WHERE id=?").get("p_historical_video_edit");
  assert.throws(
    () => routes["PATCH /api/posts/:id"]({
      user,
      ip: "legacy-video-add-blocked",
      params: { id: "p_historical_video_edit" },
      body: {
        photos: [historicalVideo, "https://legacy.example.com/new.mov"],
        version: edited.updated_at,
      },
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );

  const legacyImage = "https://legacy.example.com/gallery.jpg";
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,photos_public,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    "p_gallery_legacy_image",
    user.id,
    "Gallery Artist",
    "Old Room",
    4,
    "Legacy gallery image",
    JSON.stringify([legacyImage]),
    1,
    1,
  );
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,photos_public,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    "p_gallery_private_image",
    user.id,
    "Gallery Artist",
    "Private Room",
    4,
    "Private gallery image",
    JSON.stringify(["https://legacy.example.com/private.jpg"]),
    0,
    Date.now() + 10_000,
  );
  const blockedAuthor = addUser("media_gallery_blocked_author");
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,photos_public,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    "p_gallery_blocked_image",
    blockedAuthor.id,
    "Gallery Artist",
    "Blocked Room",
    4,
    "Blocked gallery image",
    JSON.stringify(["https://legacy.example.com/blocked.jpg"]),
    1,
    Date.now() + 20_000,
  );
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
    .run(user.id, blockedAuthor.id, Date.now());

  const video = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "gallery-stable-video",
      contentType: "video/mp4",
      fileSize: 1_200_000,
      name: "gallery.mp4",
    }),
    assetId: "ma_vvvvvvvvvvvvvvvvvvvvvvvv",
  });
  await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: video.asset.id,
    body: {
      width: 1_080,
      height: 1_920,
      durationMs: 15_000,
      altText: "Singer walking through a blue-lit crowd",
      editRecipe: { kind: "video", coverMs: 4_000 },
    },
    fetchImpl: verifiedMp4WithPoster(1_200_000, 15_000),
    authoritativeVideoVerifier: authoritativeFixtureDecodeWithPoster,
    authoritativePosterRequired: true,
  });
  const poster = db.prepare("SELECT * FROM media_variants WHERE id=?")
    .get(db.prepare("SELECT poster_variant_id FROM media_assets WHERE id=?").get(video.asset.id).poster_variant_id);
  const delivery = db.prepare("SELECT * FROM media_variants WHERE asset_id=? AND role='render'").get(video.asset.id);
  assert.equal(poster.verification_origin, "private_derivative_v1");
  const stablePost = routes["POST /api/posts"]({
    user,
    ip: "gallery-stable-post",
    body: {
      artist: "Gallery Artist",
      venue: "New Room",
      overall: 5,
      review: "Stable gallery clip",
      photosPublic: true,
      mediaAssetIds: [video.asset.id],
      clientMutationId: "gallery-stable-post-01",
    },
  });
  const gallery = routes["GET /api/artists/photos"]({
    user,
    ip: "gallery-poster-read",
    query: { name: "Gallery Artist" },
  }).photos;
  const stableItem = gallery.find((item) => item.postId === stablePost.id);
  assert.deepEqual({
    uri: stableItem.uri,
    posterUrl: stableItem.posterUrl,
    posterTimeMs: stableItem.posterTimeMs,
    kind: stableItem.kind,
    altText: stableItem.altText,
  }, {
    uri: delivery.public_url,
    posterUrl: poster.public_url,
    posterTimeMs: 4_000,
    kind: "video",
    altText: "Singer walking through a blue-lit crowd",
  });
  db.prepare("UPDATE media_assets SET codec_status='pending',codec_verified_at=NULL WHERE id=?").run(video.asset.id);
  const hiddenGallery = routes["GET /api/artists/photos"]({
    user,
    ip: "gallery-codec-revoked-read",
    query: { name: "Gallery Artist" },
  }).photos;
  assert.equal(hiddenGallery.some((item) => item.postId === stablePost.id), false,
    "artist galleries cannot fall back to a stable asset's denormalized raw URL");
  db.prepare("UPDATE media_assets SET codec_status='verified',codec_verified_at=? WHERE id=?")
    .run(Date.now(), video.asset.id);
  const legacyItem = gallery.find((item) => item.postId === "p_gallery_legacy_image");
  assert.equal(legacyItem, undefined,
    "historical raw URL-only images are retained in storage but no longer projected publicly");
  assert.equal(gallery.some((item) => item.postId === "p_gallery_private_image"), false,
    "artist gallery privacy and existing ordering filter remain unchanged");
  assert.equal(gallery.some((item) => item.postId === "p_gallery_blocked_image"), false,
    "artist galleries preserve two-way block isolation");

  for (const [id, artistKey, uri] of [
    ["p_gallery_homonym_a", "twin a", "https://legacy.example.com/twin-a.jpg"],
    ["p_gallery_homonym_b", "twin b", "https://legacy.example.com/twin-b.jpg"],
  ]) {
    db.prepare(`INSERT INTO posts (id,user_id,artist,artist_key,venue,overall,review,photos,photos_public,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, user.id, "Twin Act", artistKey, "Twin Room", 4, "Homonym", JSON.stringify([uri]), 1, Date.now());
  }
  const exactArtist = routes["GET /api/artists/photos"]({
    user,
    ip: "gallery-identity-read",
    query: { name: "Twin Act", artistKey: "twin a" },
  }).photos;
  assert.deepEqual(exactArtist.map((item) => item.postId), [],
    "raw URL-only rows stay hidden even when an exact catalog identity is requested");
});
