import { fork } from "node:child_process";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const SITEMAP_PROCESS_LIMITS = Object.freeze({
  outputBytes: 96 * 1024 * 1024,
  documentBytes: 50 * 1024 * 1024,
  metadataBytes: 64 * 1024,
  timeoutMs: 60_000,
  childHeapMiB: 384,
  maxDocuments: 50_001,
});
const WORKER_PATH = fileURLToPath(new URL("./sitemapWorker.js", import.meta.url));
const PUBLIC_ENV_KEYS = Object.freeze(["PUBLIC_ORIGIN", "MEDIA_PUBLIC_BASE_URL"]);

export class SitemapProcessError extends Error {
  constructor(code) {
    super("Sitemap background build failed safely.");
    this.name = "SitemapProcessError";
    this.code = code;
  }
}

function publicEnvironment(env = {}) {
  const result = {};
  for (const key of PUBLIC_ENV_KEYS) {
    if (env[key] == null || env[key] === "") continue;
    const value = String(env[key]);
    if (value.length > 2048) throw new SitemapProcessError("sitemap_protocol");
    let url;
    try { url = new URL(value); } catch { throw new SitemapProcessError("sitemap_protocol"); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new SitemapProcessError("sitemap_protocol");
    }
    result[key] = value;
  }
  return result;
}

export function normalizedSitemapProcessInput({ databasePath, now, env } = {}) {
  if (typeof databasePath !== "string" || !isAbsolute(databasePath) || databasePath.length > 4096
      || !Number.isSafeInteger(now) || now < 0) throw new SitemapProcessError("sitemap_protocol");
  return { databasePath, now, env: publicEnvironment(env) };
}

export function sitemapDocumentBytes(path, xml) {
  if (typeof path !== "string" || !/^\/(?:sitemap\.xml|sitemaps\/[a-z0-9-]+\.xml)$/.test(path)
    || path.length > 128 || typeof xml !== "string") throw new SitemapProcessError("sitemap_protocol");
  const bytes = Buffer.byteLength(xml, "utf8");
  if (bytes > SITEMAP_PROCESS_LIMITS.documentBytes) throw new SitemapProcessError("sitemap_resource_limit");
  return bytes + Buffer.byteLength(path, "utf8") + 32;
}

function childEnvironment() {
  const env = { NODE_ENV: "production", UV_THREADPOOL_SIZE: "1", MALLOC_ARENA_MAX: "2" };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR",
    "LANG", "LC_ALL", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return env;
}

function abortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : new DOMException("Sitemap build cancelled.", "AbortError");
}

// The snapshot manager owns single-flight, admission and stale-on-failure.
// This promise holds that lease until process close, including timeout/OOM.
export function createIsolatedSitemapBuilder({ databasePath, forkImpl = fork,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  return async function buildSnapshot({ env = process.env, now = Date.now(), signal } = {}) {
    if (signal?.aborted) throw abortReason(signal);
    const input = normalizedSitemapProcessInput({ databasePath, now, env });
    return new Promise((resolve, reject) => {
      let child, timer, outcome = null, closed = false, outputBytes = 0;
      const documents = Object.create(null);
      let documentCount = 0;
      const terminate = () => {
        if (!child?.pid || closed) return;
        try { child.kill("SIGKILL"); }
        catch (error) { if (error?.code !== "ESRCH") void error; }
      };
      const fail = (error) => {
        if (closed) return;
        if (!outcome) outcome = { error };
        terminate();
      };
      const onAbort = () => {
        if (closed) return;
        outcome = { error: abortReason(signal) };
        terminate();
      };
      try {
        child = forkImpl(WORKER_PATH, [], {
          env: { ...childEnvironment(), ...input.env },
          execArgv: [`--max-old-space-size=${SITEMAP_PROCESS_LIMITS.childHeapMiB}`, "--max-semi-space-size=8"],
          serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true,
        });
      } catch {
        reject(new SitemapProcessError("sitemap_unavailable"));
        return;
      }
      const receive = (message) => {
        if (outcome || closed) return;
        try {
          if (message?.type === "document") {
            const bytes = sitemapDocumentBytes(message.path, message.xml);
            if (Object.hasOwn(documents, message.path)) throw new SitemapProcessError("sitemap_protocol");
            outputBytes += bytes;
            documentCount++;
            if (outputBytes > SITEMAP_PROCESS_LIMITS.outputBytes || documentCount > SITEMAP_PROCESS_LIMITS.maxDocuments) {
              throw new SitemapProcessError("sitemap_resource_limit");
            }
            documents[message.path] = message.xml;
            return;
          }
          if (message?.type !== "complete" || message.generatedAt !== input.now || !Array.isArray(message.paths)
              || message.paths.length < 1 || message.paths.length + 1 !== documentCount
              || !Object.hasOwn(documents, "/sitemap.xml")) throw new SitemapProcessError("sitemap_protocol");
          const metadataBytes = Buffer.byteLength(JSON.stringify(message), "utf8");
          if (metadataBytes > SITEMAP_PROCESS_LIMITS.metadataBytes
              || outputBytes + metadataBytes > SITEMAP_PROCESS_LIMITS.outputBytes) throw new SitemapProcessError("sitemap_resource_limit");
          if (new Set(message.paths).size !== message.paths.length
              || message.paths.some(path => path === "/sitemap.xml" || !Object.hasOwn(documents, path))) {
            throw new SitemapProcessError("sitemap_protocol");
          }
          Object.freeze(documents);
          outcome = { value: Object.freeze({
            generatedAt: message.generatedAt, paths: Object.freeze([...message.paths]), stats: message.stats,
            xmlFor(path) { return Object.hasOwn(documents, path) ? documents[path] : null; },
          }) };
          terminate();
        } catch (error) { fail(error instanceof SitemapProcessError ? error : new SitemapProcessError("sitemap_protocol")); }
      };
      child.on("message", receive);
      child.once("error", () => fail(new SitemapProcessError("sitemap_unavailable")));
      child.once("close", () => {
        if (closed) return;
        closed = true;
        clearTimer(timer);
        signal?.removeEventListener("abort", onAbort);
        child.removeListener("message", receive);
        if (outcome?.error) reject(outcome.error);
        else if (outcome?.value) resolve(outcome.value);
        else reject(new SitemapProcessError("sitemap_unavailable"));
      });
      timer = setTimer(() => fail(new SitemapProcessError("sitemap_timeout")), SITEMAP_PROCESS_LIMITS.timeoutMs);
      timer.unref?.();
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      try { child.send(input, error => { if (error) fail(new SitemapProcessError("sitemap_unavailable")); }); }
      catch { fail(new SitemapProcessError("sitemap_unavailable")); }
    });
  };
}
