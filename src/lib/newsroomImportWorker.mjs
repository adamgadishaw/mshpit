import { parseNewsroomFiles } from "./newsroomImport.mjs";
// This module is copied with its pinned parser assets to the same-origin public
// directory by prepare-newsroom-import. Nothing is fetched from a document URL.
const services = {
  zip: () => import("./fflate.mjs"),
  docx: async (bytes) => {
    await import("./mammoth.js");
    const result = await globalThis.mammoth.extractRawText({ arrayBuffer: bytes.buffer }, { externalFileAccess: false });
    return result.value;
  },
  pdf: async (bytes) => {
    const pdfjs = await import("./pdf.mjs");
    globalThis.pdfjsWorker = await import("./pdf.worker.mjs");
    const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false,
      useSystemFonts: false, disableFontFace: true, disableAutoFetch: true, disableStream: true,
      disableRange: true, enableXfa: false, stopAtErrors: true, isOffscreenCanvasSupported: false });
    task.onPassword = () => { void task.destroy(); };
    let document;
    try {
      document = await task.promise;
      if (document.numPages > 100) throw new Error("PDF page limit");
      let value = "";
      for (let index = 1; index <= document.numPages; index += 1) {
        const page = await document.getPage(index);
        const content = await page.getTextContent();
        value += content.items.map((item) => typeof item.str === "string" ? item.str + (item.hasEOL ? "\n" : " ") : "").join("") + "\n\n";
        page.cleanup();
        if (value.length > 60000) throw new Error("PDF text limit");
      }
      return value;
    } finally { await task.destroy(); }
  },
};
self.onmessage = async ({ data }) => {
  if (!Array.isArray(data?.files)) return;
  try { self.postMessage({ type: "preview", result: await parseNewsroomFiles(data.files, services) }); }
  catch (error) {
    self.postMessage({ type: "error", message: error?.code === "PIT-REQ-001" ? error.message
      : "This document could not be read. Try a plain DOCX or unencrypted text PDF. Scans need a text export." });
  }
};
