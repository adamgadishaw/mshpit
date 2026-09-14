import { APP_PAGE_TITLES as PRIVATE_TITLES, appPageTitle } from "../../domain/appPageMetadata.mjs";

const MAX_HEAD_LENGTH = 128_000;
const META_NAMES = new Set([
  "description", "robots", "twitter:card", "twitter:title", "twitter:description",
  "twitter:image", "twitter:image:alt",
]);
const META_PROPERTIES = new Set([
  "og:site_name", "og:locale", "og:type", "og:title", "og:description", "og:url",
  "og:image", "og:image:width", "og:image:height", "og:image:type", "og:image:alt",
  "og:video", "og:video:secure_url", "og:video:type", "og:video:width", "og:video:height",
  "article:published_time", "article:modified_time",
]);
const MANAGED_SELECTOR = [
  "title", 'link[rel="canonical"]', 'script[type="application/ld+json"]',
  ...[...META_NAMES].map((name) => `meta[name="${name}"]`),
  ...[...META_PROPERTIES].map((property) => `meta[property="${property}"]`),
].join(",");

function pagePath(value) {
  const path = String(value || "/").split("#")[0];
  return path.length <= 500 && /^\/(?!\/)/.test(path) && !/[\\\u0000-\u0020\u007f]/.test(path) ? path : null;
}

function sameOriginUrl(value, origin) {
  if (!String(value || "").trim()) return null;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    // architecture: allow-ambiguous-result -- invalid optional metadata URLs are omitted, never used for navigation.
    return null; // Invalid metadata URLs must never become document navigation targets.
  }
}

/** Read inert, allowlisted metadata only. Never insert server HTML into the live document. */
export function readPageHead(documentObject, origin) {
  const head = documentObject?.head;
  if (!head?.querySelectorAll) return null;
  const title = String(head.querySelector?.("title")?.textContent || "").slice(0, 400);
  const metadata = new Map();
  for (const node of head.querySelectorAll("meta[name],meta[property]")) {
    const name = node.getAttribute("name");
    const property = node.getAttribute("property");
    const key = META_NAMES.has(name) ? { name } : META_PROPERTIES.has(property) ? { property } : null;
    if (!key) continue;
    let content = String(node.getAttribute("content") || "").slice(0, 4_000);
    if (property === "og:url") content = sameOriginUrl(content, origin);
    if (content != null) metadata.set(name || property, { ...key, content });
  }
  const meta = [...metadata.values()];
  const robots = meta.find((entry) => entry.name === "robots");
  if (!title || !robots) return null;
  const canonical = /\bnoindex\b/i.test(robots.content) ? null
    : sameOriginUrl(head.querySelector?.('link[rel="canonical"]')?.getAttribute("href") || "", origin);
  const jsonLd = [];
  let structuredLength = 0;
  for (const node of head.querySelectorAll('script[type="application/ld+json"]')) {
    const text = String(node.textContent || "");
    structuredLength += text.length;
    if (structuredLength > 64_000 || jsonLd.length >= 12) break;
    try {
      const value = JSON.parse(text);
      if (value && typeof value === "object") jsonLd.push(JSON.stringify(value));
    } catch {
      // A malformed structured-data block is ignored; it is never executed.
    }
  }
  return { title, meta, canonical, jsonLd };
}

export function parsePageHead(headText, { origin, DOMParser: Parser } = {}) {
  if (typeof headText !== "string" || headText.length > MAX_HEAD_LENGTH || typeof Parser !== "function") return null;
  const parsed = new Parser().parseFromString(`<!doctype html><html><head>${headText}</head><body></body></html>`, "text/html");
  return readPageHead(parsed, origin);
}

export function applyPageHead(documentObject, value) {
  if (!value || !documentObject?.head || typeof documentObject.createElement !== "function") return false;
  const head = documentObject.head;
  for (const node of head.querySelectorAll(MANAGED_SELECTOR)) node.remove();
  const append = (tag, attributes, text) => {
    const node = documentObject.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    if (text != null) node.textContent = text;
    head.appendChild(node);
  };
  append("title", {}, value.title);
  for (const meta of value.meta) append("meta", meta);
  if (value.canonical) append("link", { rel: "canonical", href: value.canonical });
  for (const text of value.jsonLd) append("script", { type: "application/ld+json" }, text);
  return true;
}

function fallbackHead(path, origin, nofollow) {
  const pathname = path.split("?")[0];
  const title = appPageTitle(pathname) || `${pathname === "/search" ? "Search live music" : "Live music"} | Mshpit`;
  return {
    title, canonical: null, jsonLd: [],
    meta: [
      { name: "robots", content: nofollow ? "noindex,nofollow" : "noindex,follow" },
      { name: "description", content: "Mshpit — concert reviews, photos and live music discovery." },
      { property: "og:title", content: title },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Mshpit" },
      { property: "og:url", content: new URL(pathname, origin).href },
    ],
  };
}

/** One navigation owner, one pending request. Public projections never include the viewer's private state. */
export function createPageHeadController({ document: documentObject, location, apiCall, now = Date.now, cacheLimit = 24, cacheTtlMs = 30_000 } = {}) {
  const origin = location?.origin;
  const Parser = documentObject?.defaultView?.DOMParser;
  const initialPath = pagePath(`${location?.pathname || "/"}${location?.search || ""}`);
  const initial = readPageHead(documentObject, origin);
  const nofollow = initial?.meta.some((item) => item.name === "robots" && /\bnofollow\b/.test(item.content)) || false;
  const cache = new Map();
  if (initial && initialPath) cache.set(initialPath, { value: initial, at: now() });
  let current = initial ? initialPath : null;
  let pending = null;
  let pendingPath = null;
  let pendingResult = null;
  let revision = 0;
  let disposed = false;

  return Object.freeze({
    async sync(value, { signal } = {}) {
      const path = pagePath(value);
      if (!path || disposed || signal?.aborted || !origin) return false;
      if (path === current) return true;
      if (path === pendingPath && pendingResult) return pendingResult;
      const ownedRevision = ++revision;
      pending?.abort();
      pending = null;
      pendingPath = null;
      pendingResult = null;
      const pathname = path.split("?")[0];
      const fallback = fallbackHead(path, origin, nofollow);
      // Private pages, search parameters and fragments must not keep an artist's
      // canonical/structured data or leak typed search text into metadata URLs.
      if (PRIVATE_TITLES[pathname] || path.includes("?")) {
        current = path;
        return applyPageHead(documentObject, fallback);
      }
      const cached = cache.get(path);
      if (cached && now() - cached.at < Math.min(30_000, Math.max(0, cacheTtlMs))) {
        cache.delete(path);
        cache.set(path, cached);
        current = path;
        return applyPageHead(documentObject, cached.value);
      }
      current = null;
      applyPageHead(documentObject, fallback);
      if (typeof apiCall !== "function") return false;
      const controller = new AbortController();
      pending = controller;
      pendingPath = path;
      let complete;
      pendingResult = new Promise((resolve) => { complete = resolve; });
      let succeeded = false;
      const abort = () => controller.abort();
      signal?.addEventListener?.("abort", abort, { once: true });
      try {
        const result = await apiCall(`/api/page-head?path=${encodeURIComponent(path)}`, {
          signal: controller.signal, silent: true, context: "Updating page information",
        });
        if (disposed || ownedRevision !== revision || controller.signal.aborted || result?.path !== path) return false;
        const next = parsePageHead(result.head, { origin, DOMParser: Parser });
        if (!next) return false;
        cache.set(path, { value: next, at: now() });
        while (cache.size > Math.min(24, Math.max(1, cacheLimit))) cache.delete(cache.keys().next().value);
        current = path;
        succeeded = applyPageHead(documentObject, next);
        return succeeded;
      } catch {
        // architecture: allow-ambiguous-result -- optional head refresh cannot fail the page; safe fallback metadata stays visible.
        // Metadata is nonblocking; an offline/error path retains safe noindex
        // metadata rather than an unrelated previous page's identity.
        return false;
      } finally {
        signal?.removeEventListener?.("abort", abort);
        complete(succeeded);
        if (pending === controller) {
          pending = null;
          pendingPath = null;
          pendingResult = null;
        }
      }
    },
    dispose() {
      disposed = true;
      revision += 1;
      pending?.abort();
      pending = null;
      pendingPath = null;
      pendingResult = null;
      cache.clear();
    },
  });
}
