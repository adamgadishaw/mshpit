import { BlockList, isIP } from "node:net";
import { ApiError } from "./errors.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Render terminates public traffic before forwarding it to the service port. Its
// internal hop is expected to be private/loopback; deployments with a different
// ingress can add only their verified ranges through PIT_TRUSTED_PROXY_CIDRS.
export const DEFAULT_TRUSTED_INGRESS_CIDRS = Object.freeze([
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
]);

function oneHeader(value) {
  if (Array.isArray(value)) return value.length === 1 ? String(value[0] || "").trim() : "";
  return typeof value === "string" ? value.trim() : "";
}

function normalizedOrigin(value) {
  const raw = oneHeader(value);
  if (!raw || raw === "null") return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizedHost(value) {
  const raw = oneHeader(value);
  if (!raw || /[\s\\/]/.test(raw)) return null;
  try {
    const url = new URL(`https://${raw}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

export function allowedProductionHosts(publicOrigin) {
  const configured = normalizedOrigin(publicOrigin) || "https://www.mshpit.com";
  const url = new URL(configured);
  const hosts = new Set([url.host.toLowerCase()]);
  if (url.port === "" && (url.hostname === "mshpit.com" || url.hostname === "www.mshpit.com")) {
    hosts.add("mshpit.com");
    hosts.add("www.mshpit.com");
  }
  return hosts;
}

export function assertProductionRequestHost({
  production = false,
  method = "GET",
  pathname = "/",
  host,
  publicOrigin,
  renderExternalHostname,
} = {}) {
  if (!production) return;
  const received = normalizedHost(host);
  if (received && allowedProductionHosts(publicOrigin).has(received)) return;

  const renderHost = normalizedHost(renderExternalHostname);
  const healthMethod = method === "GET" || method === "HEAD";
  if (received && renderHost && received === renderHost && pathname === "/api/health" && healthMethod) return;
  throw new ApiError(400, "Invalid request host.", "VALIDATION_FAILED");
}

export function normalizedIp(value) {
  let raw = oneHeader(value);
  if (!raw || raw.includes(",")) return null;
  if (raw.startsWith("[") && raw.endsWith("]")) raw = raw.slice(1, -1);
  const zone = raw.indexOf("%");
  if (zone >= 0) raw = raw.slice(0, zone);
  if (/^::ffff:/i.test(raw)) {
    const mapped = raw.slice(7);
    if (isIP(mapped) === 4) return mapped;
  }
  return isIP(raw) ? raw : null;
}

function cidrBlockList(cidrs) {
  const blockList = new BlockList();
  for (const entry of Array.isArray(cidrs) ? cidrs : []) {
    const [addressText, prefixText] = String(entry || "").trim().split("/");
    const address = normalizedIp(addressText);
    const family = isIP(address || "");
    const prefix = Number(prefixText);
    const max = family === 4 ? 32 : family === 6 ? 128 : -1;
    if (max < 0 || !Number.isInteger(prefix) || prefix < 0 || prefix > max) continue;
    blockList.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
  }
  return blockList;
}

const DEFAULT_INGRESS_BLOCKS = cidrBlockList(DEFAULT_TRUSTED_INGRESS_CIDRS);

function blockListHas(blockList, address) {
  const family = isIP(address || "");
  return family > 0 && blockList.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function trustedProxyCidrs(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function clientIpFromRequest(req, {
  renderEnvironment = false,
  trustedIngressCidrs = [],
} = {}) {
  const socketIp = normalizedIp(req?.socket?.remoteAddress) || "?";
  // `RENDER=true` is an official platform-provided runtime marker. Outside that
  // environment, forwarded headers are caller input even on loopback dev.
  if (!renderEnvironment) return socketIp;

  const ingressBlocks = trustedIngressCidrs.length
    ? cidrBlockList([...DEFAULT_TRUSTED_INGRESS_CIDRS, ...trustedIngressCidrs])
    : DEFAULT_INGRESS_BLOCKS;
  if (socketIp === "?" || !blockListHas(ingressBlocks, socketIp)) return socketIp;

  // Render documents CF-Connecting-IP as overwritten on every public request:
  // https://render.com/articles/host-pocketbase-on-render. X-Forwarded-For has
  // had both append and first-entry semantics over time, so no element of that
  // chain is treated as authoritative. If the single-value header is missing or
  // malformed, conservatively share the ingress bucket rather than accept a
  // potentially caller-controlled address.
  return normalizedIp(req?.headers?.["cf-connecting-ip"]) || socketIp;
}

export function allowedUnsafeRequestOrigins({ production = false, publicOrigin, port = 3000 } = {}) {
  const origins = new Set();
  const configured = normalizedOrigin(publicOrigin);
  if (configured) origins.add(configured);
  if (production && !configured) {
    origins.add("https://www.mshpit.com");
    origins.add("https://mshpit.com");
  }
  if (configured) {
    const url = new URL(configured);
    if (url.protocol === "https:" && (url.hostname === "mshpit.com" || url.hostname === "www.mshpit.com")) {
      origins.add("https://mshpit.com");
      origins.add("https://www.mshpit.com");
    }
  }
  if (!production) {
    for (const host of ["localhost", "127.0.0.1"]) {
      origins.add(`http://${host}:8081`);
      origins.add(`http://${host}:${port}`);
    }
  }
  return origins;
}

export function assertUnsafeRequestOrigin(method, headers = {}, allowedOrigins = new Set()) {
  if (!UNSAFE_METHODS.has(String(method || "").toUpperCase())) return;
  const fetchSite = oneHeader(headers["sec-fetch-site"]).toLowerCase();
  if (fetchSite === "cross-site") {
    throw new ApiError(403, "Cross-site request blocked.", "FORBIDDEN");
  }

  const rawOrigin = oneHeader(headers.origin);
  if (rawOrigin) {
    const origin = normalizedOrigin(rawOrigin);
    if (!origin || !allowedOrigins.has(origin)) {
      throw new ApiError(403, "Cross-site request blocked.", "FORBIDDEN");
    }
    return;
  }

  // Native fetch implementations generally send neither Origin nor Fetch
  // Metadata. A browser reporting same-site without an exact allowed Origin is a
  // sibling-origin request and must not inherit the session cookie's authority.
  if (fetchSite === "same-site" || (fetchSite && !["same-origin", "none"].includes(fetchSite))) {
    throw new ApiError(403, "Cross-site request blocked.", "FORBIDDEN");
  }
}

export function isJsonContentType(value) {
  const type = oneHeader(value).toLowerCase();
  return /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/.test(type);
}

export function requestDeclaresBody(headers = {}) {
  const transferEncoding = oneHeader(headers["transfer-encoding"]);
  if (transferEncoding) return true;
  const lengthText = oneHeader(headers["content-length"]);
  if (!lengthText) return false;
  const length = Number(lengthText);
  return Number.isFinite(length) && length > 0;
}

export function readJsonBody(req, { limit = 256 * 1024 } = {}) {
  const contentTypeOk = isJsonContentType(req?.headers?.["content-type"]);
  if (requestDeclaresBody(req?.headers) && !contentTypeOk) {
    req.resume?.();
    return Promise.reject(new ApiError(415, "Request body must be JSON.", "MEDIA_TYPE_UNSUPPORTED"));
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    let unsupported = false;
    const chunks = [];
    req.on("data", (chunk) => {
      if (tooLarge || unsupported) return;
      if (!contentTypeOk) {
        unsupported = true;
        chunks.length = 0;
        return;
      }
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (unsupported) return reject(new ApiError(415, "Request body must be JSON.", "MEDIA_TYPE_UNSUPPORTED"));
      if (tooLarge) return reject(new ApiError(413, "Request too large.", "REQUEST_TOO_LARGE"));
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ApiError(400, "Invalid JSON.", "VALIDATION_FAILED"));
      }
    });
    req.on("aborted", () => reject(new ApiError(400, "Bad request.", "VALIDATION_FAILED")));
    req.on("error", () => reject(new ApiError(400, "Bad request.", "VALIDATION_FAILED")));
  });
}
