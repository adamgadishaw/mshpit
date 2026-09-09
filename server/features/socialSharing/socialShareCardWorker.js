import sharp from "sharp";
import {
  normalizedShareProcessInput,
  normalizedShareProcessResult,
} from "./socialShareCardProcess.js";

sharp.cache({ memory: 16, files: 0, items: 8 });
sharp.concurrency(1);

function supportedArtwork(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return false;
  return (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
}

function sendResult(message) {
  if (!process.connected || typeof process.send !== "function") {
    process.exitCode = 1;
    return;
  }
  try {
    process.send(message, (error) => {
      if (error) process.exitCode = 1;
      if (process.connected) process.disconnect();
    });
  } catch {
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
}

async function respond(payload) {
  try {
    const { model, ...options } = normalizedShareProcessInput(payload?.model, payload || {});
    // Sharp must enable SVG for the server-generated card. Never let an
    // arbitrary remote SVG/PDF/TIFF reach that same native loader as artwork.
    if (options.artworkBytes && !supportedArtwork(options.artworkBytes)) options.artworkBytes = null;
    const { renderSocialShareCardResult, socialShareCardConstants } = await import("./socialShareCardRenderer.js");
    if (options.artworkDataUri) {
      // A JPEG label alone is not a format/pixel proof. Validate prepared URIs
      // too, before embedding them into the internally generated SVG.
      try {
        const bytes = Buffer.from(options.artworkDataUri.slice("data:image/jpeg;base64,".length), "base64");
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error("Invalid JPEG framing");
        const metadata = await sharp(bytes, { animated: false, failOn: "warning",
          limitInputPixels: socialShareCardConstants.artworkInputPixels }).metadata();
        const pixels = Number(metadata.width) * Number(metadata.height);
        if (metadata.format !== "jpeg" || Number(metadata.pages || 1) !== 1
          || !Number.isSafeInteger(pixels) || pixels < 1
          || pixels > socialShareCardConstants.artworkInputPixels) throw new Error("Invalid JPEG dimensions");
      } catch {
        options.artworkDataUri = "";
      }
    }
    const result = normalizedShareProcessResult(await renderSocialShareCardResult(model, options));
    sendResult({ ok: true, result });
  } catch {
    // No provider URLs, paths, source bytes, or exception details cross back.
    sendResult({ ok: false });
  }
}

process.once("message", (payload) => { void respond(payload); });
process.once("disconnect", () => process.exit(0));
