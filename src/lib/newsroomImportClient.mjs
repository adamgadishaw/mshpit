import { importFileKind, IMPORT_LIMITS } from "../domain/newsroomImport.mjs";
// The parser runs off the UI thread and is terminated on timeout, cancellation,
// navigation or account change. Imported content never becomes HTML or code.
export function readNewsroomImport(files, { signal, WorkerClass = globalThis.Worker, timeoutMs = IMPORT_LIMITS.timeout } = {}) {
  return new Promise((resolve, reject) => {
    const abortError = () => Object.assign(new Error("Import cancelled."), { name: "AbortError" });
    if (signal?.aborted) return reject(abortError());
    if (typeof WorkerClass !== "function") return reject(new Error("File import needs a browser with worker support. You can still paste your article below."));
    if (!files?.length || files.length > 3) return reject(new Error("Choose one document or package, plus one photo and one optional video."));
    try { Array.from(files).forEach(importFileKind); } catch (error) { return reject(error); }
    const worker = new WorkerClass("/newsroom-import/worker.mjs", { type: "module" });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(abortError());
    const timer = setTimeout(() => finish(new Error("This document took too long to read. Export a smaller plain document and try again.")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(new Error("The importer could not start. Refresh and try again, or paste your article below."));
    worker.onmessage = ({ data }) => {
      // PDF.js also emits its namespaced worker handshake. Only our explicit
      // result protocol can settle the import; unrelated messages time out.
      if (data?.type === "preview") finish(null, data.result);
      else if (data?.type === "error") finish(new Error(data.message || "The document could not be read."));
    };
    worker.postMessage({ files: Array.from(files) });
  });
}
