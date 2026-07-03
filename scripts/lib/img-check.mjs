/**
 * Shared image-URL liveness check. True only if the URL answers with a real
 * image. HEAD first (cheap), ranged GET as fallback (some hosts reject HEAD).
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT_MS = 8000;

export async function imageLoads(url) {
  if (!/^https?:\/\//.test(url || "")) return false;
  const check = async (method, headers) => {
    try {
      const r = await fetch(url, {
        method,
        headers: { "User-Agent": UA, ...headers },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      return r.ok && ct.startsWith("image");
    } catch {
      return false;
    }
  };
  if (await check("HEAD", {})) return true;
  return check("GET", { Range: "bytes=0-2048" });
}

// Filter a gallery pool down to rows whose URLs actually load, with bounded
// concurrency. Order preserved.
export async function filterLoadable(pool, concurrency = 12) {
  const results = new Array(pool.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pool.length) }, async () => {
      while (i < pool.length) {
        const idx = i++;
        results[idx] = await imageLoads(pool[idx]?.uri);
      }
    })
  );
  return pool.filter((_, idx) => results[idx]);
}
