import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-media-assets-"));
process.env.PIT_DATA_DIR = dataDir;

Object.assign(process.env, {
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-media",
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
  attachPostMedia,
  assetObjectRecords,
  finalizeMediaAsset,
  finalizeMediaVariant,
  mediaSelection,
  ownedMediaAsset,
  updateMediaAsset,
} = await import("./mediaAssets.js");
const {
  enqueueExpiredMediaTickets,
  MEDIA_UPLOAD_SETTLE_BUFFER_MS,
  recordMediaObjectTicket,
} = await import("./mediaDeletion.js");

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

function compatibleMp4(bytes, durationMs, { videoSampleEntry = "avc1" } = {}) {
  const ftyp = mp4Box("ftyp",
    Buffer.from("isom", "ascii"),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from("isomiso2avc1mp41", "ascii"));
  const timescale = 1_000;
  const encodedWidth = 1_080;
  const encodedHeight = 1_920;
  // Four-byte AVC length prefix + one IDR I-slice whose first_mb_in_slice,
  // slice_type, and pic_parameter_set_id Exp-Golomb fields are 0, 2, and 0.
  const firstSample = Buffer.from([0, 0, 0, 2, 0x65, 0xb8]);
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
    const sampleEntry = mp4Box(videoSampleEntry, visualSample, avcConfiguration);
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

function verifiedMp4(bytes, durationMs, capture = null, options = {}) {
  const object = compatibleMp4(bytes, durationMs, options);
  const etag = `"fixture-${bytes}-${durationMs}-${options.videoSampleEntry || "avc1"}"`;
  return async (url, request = {}) => {
    capture?.push({ url, options: request });
    const method = String(request.method || "GET").toUpperCase();
    if (method === "HEAD") {
      return {
        status: 200,
        headers: new Headers({
          "content-length": String(object.length),
          "content-type": "video/mp4",
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
async function authoritativeFixtureDecode({ structural }) {
  return structural;
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
  assert.equal(first.asset.sourceUrl, `https://media.example.com/cdn/${first.upload.key}`);
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
      fetchImpl: verifiedHead(8_191, "image/jpeg"),
    }),
    (error) => error.code === "CONFLICT",
  );
  assert.equal(db.prepare("SELECT status,source_verified_at FROM media_assets WHERE id=?").get(created.asset.id).status, "upload_pending");

  const requests = [];
  const finalized = await finalizeMediaAsset(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    body: { width: 1_920, height: 1_080, orientation: 0, altText: "  Crowd\nunder   gold lights  ", editRecipe: {} },
    fetchImpl: verifiedHead(8_192, "image/jpeg", requests),
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

test("new stable delivery rejects GIF and non-MP4 motion, clips over 60 seconds, and raw HEIC publication", async () => {
  const user = addUser("media_asset_delivery_owner");
  assert.throws(
    () => createMediaAsset(db, {
      ownerId: user.id,
      body: sourceBody({ clientAssetId: "delivery-venue-source", purpose: "venue" }),
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  assert.throws(
    () => createMediaAsset(db, {
      ownerId: user.id,
      body: sourceBody({
        clientAssetId: "delivery-gif-source",
        contentType: "image/gif",
        fileSize: 500_000,
        name: "animation.gif",
      }),
    }),
    (error) => error.status === 415 && error.code === "MEDIA_TYPE_UNSUPPORTED" && /MP4/i.test(error.message),
  );
  assert.throws(
    () => createMediaAsset(db, {
      ownerId: user.id,
      body: sourceBody({
        clientAssetId: "delivery-mov-source",
        contentType: "video/quicktime",
        fileSize: 2_000_000,
        name: "camera.mov",
      }),
    }),
    (error) => error.status === 415 && error.code === "MEDIA_TYPE_UNSUPPORTED",
  );

  const video = createMediaAsset(db, {
    ownerId: user.id,
    body: sourceBody({
      clientAssetId: "delivery-long-video",
      contentType: "video/mp4",
      fileSize: 2_000_000,
      name: "long.mp4",
    }),
    assetId: "ma_jjjjjjjjjjjjjjjjjjjjjjjj",
  });
  let headCalls = 0;
  await assert.rejects(
    finalizeMediaAsset(db, {
      ownerId: user.id,
      assetId: video.asset.id,
      body: { width: 1_920, height: 1_080, durationMs: 60_001, editRecipe: {} },
      fetchImpl: async () => { headCalls += 1; return { status: 500 }; },
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  assert.equal(headCalls, 0, "duration policy is enforced before storage is trusted");
  assert.equal(db.prepare("SELECT status FROM media_assets WHERE id=?").get(video.asset.id).status, "upload_pending");
  await assert.rejects(
    finalizeMediaAsset(db, {
      ownerId: user.id,
      assetId: video.asset.id,
      body: { width: 1_080, height: 1_920, durationMs: 60_000, editRecipe: {} },
      fetchImpl: verifiedMp4(2_000_000, 60_001),
    }),
    (error) => error.status === 415 && error.code === "MEDIA_TYPE_UNSUPPORTED",
    "mvhd/mdhd/stts duration, not the client declaration, enforces the 60-second ceiling",
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
    assetId: "ma_codec_hevc_rejected_001",
  });
  await assert.rejects(
    finalizeMediaAsset(db, {
      ownerId: user.id,
      assetId: hevc.asset.id,
      body: { width: 1_080, height: 1_920, durationMs: 10_000, editRecipe: {} },
      fetchImpl: verifiedMp4(1_000_000, 10_000, null, { videoSampleEntry: "hvc1" }),
    }),
    (error) => error.status === 415 && error.code === "MEDIA_TYPE_UNSUPPORTED",
    "an MP4 transport MIME cannot stand in for a supported H.264/AAC track declaration",
  );
  assert.equal(db.prepare("SELECT codec_status FROM media_assets WHERE id=?").get(hevc.asset.id).codec_status, "pending");

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
    fetchImpl: verifiedHead(20_000, "image/heic"),
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
    fetchImpl: verifiedHead(8_000, "image/webp"),
  });
  assert.equal(ready.asset.status, "ready");
  assert.equal(ready.asset.url, rendition.upload.publicUrl);
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
    fetchImpl: verifiedHead(10_000, "image/jpeg"),
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
    fetchImpl: verifiedHead(6_000, "image/webp"),
  });
  assert.equal(finished.asset.status, "ready");
  assert.equal(finished.asset.renderState, "ready");
  assert.equal(finished.asset.url, variant.upload.publicUrl);
  assert.equal(finished.asset.sourceUrl, created.upload.publicUrl, "owner reads retain the original source reference");
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
    fetchImpl: verifiedHead(15_000, "image/jpeg"),
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
    fetchImpl: verifiedHead(firstBody.fileSize, "image/webp"),
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
    fetchImpl: verifiedHead(18_000, "image/jpeg"),
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
  await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    variantId: firstRender.variant.id,
    body: { width: 1_638, height: 2_048 },
    fetchImpl: verifiedHead(10_000, "image/webp"),
    at: 4_000,
  });
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
  assert.equal(recipeUpdate.asset.url, firstRender.upload.publicUrl,
    "the previous verified pixels remain available while replacement work is staged");
  assert.equal(recipeUpdate.asset.revisionPending, true);
  assert.equal(recipeUpdate.asset.editRecipe.filter, "mono",
    "owner reads resume the pending recipe even though the active rendition is unchanged");
  assert.ok(db.prepare("SELECT 1 FROM media_variants WHERE id=?").get(firstRender.variant.id));
  assert.equal(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(firstRender.upload.key), undefined);
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
  assert.equal(cancelled.asset.url, firstRender.upload.publicUrl);
  assert.equal(cancelled.asset.editRecipe.filter, "pit");
  assert.equal(db.prepare("SELECT 1 FROM media_asset_revisions WHERE asset_id=?").get(created.asset.id), undefined);
  assert.equal(db.prepare("SELECT status FROM media_deletion_queue WHERE object_key=?").get(recoveredRender.upload.key).status, "pending");
  assert.equal(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(firstRender.upload.key), undefined,
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
  assert.equal(afterFailedReplacement.url, firstRender.upload.publicUrl);
  assert.equal(afterFailedReplacement.editRecipe.filter, "mono");
  assert.equal(afterFailedReplacement.revisionPending, true);
  assert.ok(db.prepare("SELECT 1 FROM media_variants WHERE id=?").get(firstRender.variant.id));
  assert.equal(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(firstRender.upload.key), undefined,
    "failed verification cannot retire the last good rendition");

  const swapped = await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    variantId: secondRender.variant.id,
    body: { width: 1_638, height: 2_048 },
    fetchImpl: verifiedHead(9_000, "image/webp"),
    at: 16_000,
  });
  assert.equal(swapped.asset.url, secondRender.upload.publicUrl);
  assert.equal(swapped.asset.editRecipe.filter, "mono");
  assert.equal(swapped.asset.revisionPending, false);
  assert.equal(db.prepare("SELECT 1 FROM media_asset_revisions WHERE asset_id=?").get(created.asset.id), undefined);
  assert.equal(db.prepare("SELECT 1 FROM media_variants WHERE id=?").get(firstRender.variant.id), undefined);
  assert.ok(db.prepare("SELECT 1 FROM media_variants WHERE id=?").get(secondRender.variant.id));
  assert.equal(db.prepare("SELECT status FROM media_deletion_queue WHERE object_key=?").get(firstRender.upload.key).status, "pending");
  assert.equal(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(secondRender.upload.key), undefined);
  const finalizeRetry = await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    variantId: secondRender.variant.id,
    body: { width: 1_638, height: 2_048 },
    fetchImpl: async () => { throw new Error("a committed finalize retry must not HEAD"); },
    at: 17_000,
  });
  assert.equal(finalizeRetry.duplicate, true);
  assert.equal(finalizeRetry.asset.url, secondRender.upload.publicUrl);
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
    fetchImpl: verifiedHead(7_000, "image/jpeg"),
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
    fetchImpl: verifiedHead(5_000, "image/webp"),
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
    fetchImpl: verifiedHead(8_000, "image/jpeg"),
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
  await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: edited.asset.id,
    variantId: render.variant.id,
    body: { width: 1_200, height: 1_500 },
    fetchImpl: verifiedHead(6_000, "image/webp"),
  });
  db.prepare("UPDATE media_objects SET status='delete_queued' WHERE object_key=?").run(render.upload.key);
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
    fetchImpl: verifiedMp4(900_000, 10_000),
    authoritativeVideoVerifier: authoritativeFixtureDecode,
  });
  const poster = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: video.asset.id,
    body: {
      clientVariantId: "live-ledger-poster-out",
      role: "poster",
      contentType: "image/jpeg",
      fileSize: 20_000,
      name: "poster.jpg",
    },
    variantId: "mv_qqqqqqqqqqqqqqqqqqqqqqqq",
  });
  await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: video.asset.id,
    variantId: poster.variant.id,
    body: { width: 720, height: 1_280, timeMs: 2_000 },
    fetchImpl: verifiedHead(20_000, "image/jpeg"),
  });
  db.prepare("UPDATE media_objects SET status='delete_queued' WHERE object_key=?").run(poster.upload.key);
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
    fetchImpl: verifiedHead(11_000, "image/jpeg"),
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
  await finalizeMediaVariant(db, {
    ownerId: staleOwner.id,
    assetId: stale.asset.id,
    variantId: staleRender.variant.id,
    body: { width: 1_500, height: 2_000 },
    fetchImpl: verifiedHead(7_000, "image/webp"),
    at: 4_000,
  });
  assert.ok(enqueueExpiredMediaTickets(db, { env: cleanupEnv, at: cleanupAt }) >= 2);
  assert.equal(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(stale.asset.id), undefined,
    "an expired unattached descriptor is removed before it can publish dead URLs");
  assert.deepEqual(db.prepare("SELECT object_key FROM media_deletion_queue WHERE owner_id=? ORDER BY object_key")
    .all(staleOwner.id).map((row) => row.object_key), [stale.upload.key, staleRender.upload.key].sort());

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
    fetchImpl: verifiedHead(12_500, "image/jpeg"),
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
    fetchImpl: verifiedHead(7_500, "image/webp"),
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
    fetchImpl: verifiedHead(13_000, "image/jpeg"),
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
    fetchImpl: verifiedHead(8_000, "image/webp"),
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
    fetchImpl: verifiedHead(15_000, "image/jpeg"),
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
  assert.deepEqual({ width: source.asset.width, height: source.asset.height }, { width: 1_920, height: 1_080 },
    "a picker-reported portrait/landscape axis swap must be an exact permutation of probed dimensions");
  assert.equal(source.asset.editRecipe.trimEndMs, 30_000,
    "a one-millisecond picker/probe rounding drift does not fabricate a destructive trim");
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
  const poster = createMediaVariant(db, {
    ownerId: user.id,
    assetId: coverOnly.asset.id,
    body: {
      clientVariantId: "poster-retry-0001",
      role: "poster",
      contentType: "image/jpeg",
      fileSize: 120_000,
      name: "cover.jpg",
    },
    variantId: "mv_gggggggggggggggggggggggg",
  });
  const withPoster = await finalizeMediaVariant(db, {
    ownerId: user.id,
    assetId: coverOnly.asset.id,
    variantId: poster.variant.id,
    body: { width: 720, height: 1_280, timeMs: 8_000 },
    fetchImpl: verifiedHead(120_000, "image/jpeg"),
  });
  assert.equal(withPoster.asset.posterUrl, poster.upload.publicUrl);
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
  assert.equal(published.post.media[0].posterUrl, poster.upload.publicUrl);
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
  assert.equal(queued.has(poster.upload.key), true);
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
    fetchImpl: verifiedHead(12_345, "image/jpeg"),
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
  await finalizeMediaVariant(db, {
    ownerId: user.id,
    assetId: created.asset.id,
    variantId: delivery.variant.id,
    body: { width: 1_080, height: 1_350 },
    fetchImpl: verifiedHead(8_000, "image/webp"),
  });
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
  assert.deepEqual(stable.post.photos, [delivery.upload.publicUrl]);
  assert.equal(stable.post.media.length, 1);
  assert.deepEqual(stable.post.mediaAssetIds, [created.asset.id]);
  assert.equal(stable.post.media[0].id, created.asset.id);
  assert.equal(stable.post.media[0].url, delivery.upload.publicUrl);
  assert.equal(stable.post.media[0].sourceUrl, created.upload.publicUrl);
  assert.equal(stable.post.media[0].altText, "Singer reaching toward the front row");
  const publicStable = routes["GET /api/users/:id/posts"]({
    user: null,
    ip: "stable-media-public-read",
    params: { id: user.id },
    query: {},
  }).posts.find((post) => post.id === stable.id);
  assert.equal(publicStable.media[0].sourceUrl, delivery.upload.publicUrl);
  assert.notEqual(publicStable.media[0].sourceUrl, created.upload.publicUrl,
    "non-owners never receive the original source reference");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(created.upload.key).status, "associated");
  const exported = routes["GET /api/me/export"]({ user, ip: "stable-media-export", body: {} });
  assert.equal(exported.mediaAssets.some((asset) => asset.id === created.asset.id
    && asset.sourceUrl === created.upload.publicUrl
    && asset.altText === "Singer reaching toward the front row"), true);

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
    fetchImpl: verifiedMp4(1_200_000, 15_000),
    authoritativeVideoVerifier: authoritativeFixtureDecode,
  });
  const poster = createMediaVariant(db, {
    ownerId: user.id,
    assetId: video.asset.id,
    body: {
      clientVariantId: "gallery-stable-poster",
      role: "poster",
      contentType: "image/jpeg",
      fileSize: 30_000,
      name: "gallery-cover.jpg",
    },
    variantId: "mv_vvvvvvvvvvvvvvvvvvvvvvvv",
  });
  await finalizeMediaVariant(db, {
    ownerId: user.id,
    assetId: video.asset.id,
    variantId: poster.variant.id,
    body: { width: 720, height: 1_280, timeMs: 4_000 },
    fetchImpl: verifiedHead(30_000, "image/jpeg"),
  });
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
    uri: video.upload.publicUrl,
    posterUrl: poster.upload.publicUrl,
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
  assert.deepEqual({
    uri: legacyItem.uri,
    posterUrl: legacyItem.posterUrl,
    posterTimeMs: legacyItem.posterTimeMs,
    kind: legacyItem.kind,
    altText: legacyItem.altText,
  }, {
    uri: legacyImage,
    posterUrl: null,
    posterTimeMs: null,
    kind: "image",
    altText: "",
  });
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
  assert.deepEqual(exactArtist.map((item) => item.postId), ["p_gallery_homonym_a"],
    "an explicit catalog identity never mixes a same-named artist into the gallery");
});
