import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "assets");
const INK = { r: 13, g: 11, b: 9 };

const fullMark = await readFile(join(ASSETS, "mshpit-community-mark-v2.svg"));

function transparentCanvas(size) {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
}

function opaqueCanvas(size) {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: INK,
    },
  });
}

async function renderSvg(svg, size) {
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain" })
    .png()
    .toBuffer();
}

async function centeredComposite({ canvas, svg, artSize, output, opaque = false }) {
  const art = await renderSvg(svg, artSize);
  const canvasSize = await canvas.clone().metadata().then(({ width }) => width);
  const inset = Math.round((canvasSize - artSize) / 2);
  const image = canvas.composite([{ input: art, left: inset, top: inset }]);
  if (opaque) image.removeAlpha();
  await image
    .png({ compressionLevel: 9 })
    .toFile(join(ASSETS, output));
}

await sharp(fullMark, { density: 384 })
  .resize(1024, 1024, { fit: "contain" })
  .png({ compressionLevel: 9 })
  .toFile(join(ASSETS, "pit-community-mark-v2.png"));

// Small UI assets keep the exact same two-ring geometry as the master. Only
// the raster dimensions change; MSHpit has no alternate or simplified glyph.
await sharp(fullMark, { density: 384 })
  .resize(256, 256, { fit: "contain" })
  .png({ compressionLevel: 9 })
  .toFile(join(ASSETS, "pit-community-mark-small-v2.png"));

await centeredComposite({
  canvas: opaqueCanvas(1024),
  svg: fullMark,
  artSize: 820,
  output: "pit-icon-v2.png",
  opaque: true,
});

await centeredComposite({
  canvas: transparentCanvas(1024),
  svg: fullMark,
  artSize: 1024,
  output: "pit-splash-icon-v2.png",
});

await centeredComposite({
  canvas: transparentCanvas(512),
  svg: fullMark,
  artSize: 372,
  output: "pit-android-foreground-v2.png",
});

await opaqueCanvas(512)
  .png({ compressionLevel: 9 })
  .toFile(join(ASSETS, "pit-android-background-v2.png"));

await centeredComposite({
  canvas: transparentCanvas(432),
  svg: fullMark,
  artSize: 312,
  output: "pit-android-monochrome-v2.png",
});

await centeredComposite({
  canvas: opaqueCanvas(48),
  svg: fullMark,
  artSize: 44,
  output: "pit-favicon-v2.png",
  opaque: true,
});

console.log("Generated MSHpit community-mark v2 assets.");
