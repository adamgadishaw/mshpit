#!/usr/bin/env node
// Explicit offline asset preparation, never a startup/visitor-time network dependency.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, sep } from "node:path";
import sharp from "sharp";
import { CITY_PHOTO_SEEDS } from "../server/features/cities/cityPhotoSeeds.js";

const root = fileURLToPath(new URL("../public/images/cities/", import.meta.url));
const apply = process.argv.includes("--apply");
const maximum = 12 * 1024 * 1024;
for (const row of CITY_PHOTO_SEEDS) {
  const filename = row.photo.url.split("/").at(-1);
  if (!/^[a-z0-9-]+\.webp$/.test(filename)) throw new Error("Unsafe city image filename");
  const target = resolve(root, filename);
  if (!target.startsWith(resolve(root) + sep)) throw new Error("City image outside asset directory");
  try {
    const current = await readFile(target);
    const metadata = await sharp(current).metadata();
    if (metadata.format === "webp" && metadata.width <= 1200) {
      console.log(row.key + ": ready"); continue;
    }
  } catch { /* A missing or invalid asset is replaced only with --apply. */ }
  if (!apply) throw new Error(row.key + ": missing city asset; run with --apply");
  const url = new URL(row.downloadUrl);
  if (url.protocol !== "https:" || !["upload.wikimedia.org", "thumb.wikimedia.org"].includes(url.hostname)) throw new Error("Unapproved city photo source");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(25000),
    headers: { "User-Agent": "MshpitCityGuides/1.0 (https://mshpit.com; founder@mshpit.com)" } });
  if (!response.ok || !/^image\//.test(response.headers.get("content-type") || "") || Number(response.headers.get("content-length") || 0) > maximum) throw new Error(row.key + ": photo download rejected (" + response.status + ")");
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > maximum) { await response.body.cancel().catch(() => {}); throw new Error("City image too large"); }
    chunks.push(chunk);
  }
  const output = await sharp(Buffer.concat(chunks), { limitInputPixels: 60_000_000 }).rotate().resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  await mkdir(dirname(target), { recursive: true });
  const temporary = target + "." + process.pid + ".tmp";
  try { await writeFile(temporary, output, { flag: "wx" }); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
  console.log(row.key + ": " + output.length + " bytes");
}
