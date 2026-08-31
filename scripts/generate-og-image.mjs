import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const width = 1200;
const height = 630;
const textLayer = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="18%" cy="10%" r="90%">
      <stop offset="0" stop-color="#3b2a0c"/>
      <stop offset="0.55" stop-color="#15100a"/>
      <stop offset="1" stop-color="#080706"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" x2="1">
      <stop offset="0" stop-color="#ffcf45"/>
      <stop offset="1" stop-color="#f3a712"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="44" y="44" width="1112" height="542" rx="34" fill="none" stroke="#4e3c18" stroke-width="2"/>
  <text x="535" y="248" fill="url(#gold)" font-family="Arial, Helvetica, sans-serif" font-size="94" font-weight="800" letter-spacing="5">MSHPIT</text>
  <text x="540" y="318" fill="#fff7e8" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="650">Your life's musical journey</text>
  <text x="540" y="383" fill="#cabfae" font-family="Arial, Helvetica, sans-serif" font-size="24">Concert reviews · artist stories · live music discovery</text>
  <text x="540" y="478" fill="#f3b61f" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" letter-spacing="2">MSHPIT.COM</text>
</svg>`);

const logo = await sharp(join(root, "assets", "pit-icon-v2.png"))
  .resize(420, 420, { fit: "cover" })
  .png()
  .toBuffer();

await sharp(textLayer)
  .composite([{ input: logo, left: 72, top: 105 }])
  .png({ compressionLevel: 9, palette: true })
  .toFile(join(root, "public", "og.png"));

console.log("Generated public/og.png (1200x630)");
