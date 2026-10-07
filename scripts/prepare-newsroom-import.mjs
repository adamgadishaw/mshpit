import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(root, "public/newsroom-import");
mkdirSync(destination, { recursive: true });
for (const [source, name] of [
  ["src/domain/newsroomImport.mjs", "newsroomImport.mjs"],
  ["src/domain/newsroomImportArchive.mjs", "newsroomImportArchive.mjs"],
  ["src/lib/newsroomImportWorker.mjs", "worker.mjs"],
  ["node_modules/fflate/esm/browser.js", "fflate.mjs"],
  ["node_modules/mammoth/mammoth.browser.min.js", "mammoth.js"],
  ["node_modules/pdfjs-dist/legacy/build/pdf.min.mjs", "pdf.mjs"],
  ["node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", "pdf.worker.mjs"],
  ["node_modules/fflate/LICENSE", "fflate-LICENSE.txt"],
  ["node_modules/mammoth/LICENSE", "mammoth-LICENSE.txt"],
  ["node_modules/pdfjs-dist/LICENSE", "pdfjs-LICENSE.txt"],
]) copyFileSync(resolve(root, source), resolve(destination, name));
console.log("Prepared lazy Newsroom import worker and pinned parser assets.");
