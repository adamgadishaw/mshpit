#!/usr/bin/env node
// mshpit.com backend, zero-dependency Node server.
//
//   node server/index.js            # serves API + the exported web build (dist/)
//   PORT=3000 NODE_ENV=production ADMIN_PASSWORD=... node server/index.js
//
// Crash posture: request errors are isolated and JSON bodies are size-capped.
// Truly uncaught process errors retain Node's fail-fast exit; continuing after
// an unknown fatal state can corrupt later requests or database work.
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join, extname, normalize, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { db, q, publicUser, pruneMissingArtists } from "./db.js";
import { artistDeathWatchService, routes } from "./api.js";
import { ApiError, errorEnvelope } from "./errors.js";
import { assertExpectedAccount } from "./identityBinding.js";
import { maybeAlert, pruneErrors, recordError } from "./errorLog.js";
import { createAlertDrainScheduler } from "./alertDrainScheduler.js";
import { sitemapStartupRefreshDecision } from "./features/seo/sitemapSnapshotManager.js";
import {
  injectHead,
  drainSitemapSnapshotRefresh,
  enforceHtmlRobotsMeta,
  loadSitemapSnapshot,
  origin,
  refreshSitemapSnapshot,
  renderNotFoundDocument,
  robotsTxt,
  seoHttpPlan,
  sitemapResponseForPath,
} from "./seo.js";
import { htmlRobotsDirective, isProduction } from "./environment.js";
import {
  clearSessionCookies,
  getSession,
  parseCookies,
  rateLimit,
  sessionCookieHeaders,
  sessionCookieName,
  sweepExpiredSessions,
} from "./auth.js";
import { startTourDateScheduler } from "./tourdates.js";
import {
  startArtistTourDateDemandRefresh,
  stopArtistTourDateDemandRefresh,
} from "./artistTourDateDemandRefresh.js";
import {
  startMusicBrainzGenreRefreshScheduler,
  stopMusicBrainzGenreRefreshScheduler,
} from "./musicBrainzGenreRefresh.js";
import { startCacheWarmScheduler } from "./cacheWarmer.js";
import { startBackupScheduler } from "./backupScheduler.js";
import { startMediaDeletionScheduler } from "./mediaDeletion.js";
import { startFounderOperationsScheduler } from "./siteHealthDigest.js";
import {
  registerLegacyVideoPosterRelease,
  startLegacyVideoPosterVerificationScheduler,
} from "./legacyVideoPosters.js";
import { emailCampaignRecoveryEnabled, startEmailCampaignScheduler } from "./emailCampaignScheduler.js";
import { pruneEmailOperationalData } from "./emailRetention.js";
import { pruneAnalyticsData } from "./analyticsService.js";
import { pruneGuestSearchAnalytics } from "./guestSearchAnalytics.js";
import { pruneProductSuggestions } from "./features/suggestions/suggestionRetention.js";
import { pruneExpiredAccountSecrets } from "./accountSecretRetention.js";
import { startArtistDeathWatchScheduler } from "./features/artistDeathWatch/artistDeathWatchScheduler.js";
import { missingStaticAssetResponse } from "./staticPolicy.js";
import { publicPageFor, renderPublicPage } from "./publicPages.js";
import { staticAssetCacheControl } from "./staticAssetCache.js";
import { randomUUID } from "node:crypto";
import { createApiResponseHeaders, createApiResponseHeaderSetter } from "./responseHeaders.js";
import { reconcileAdminAccount } from "./adminBootstrap.js";
import { applyHttpServerLimits } from "./httpServerPolicy.js";
import { safeRequestFailureContext } from "./safeLogging.js";
import { assertAccountMutationAccess } from "./accountMutationAccess.js";
import { healthRateLimitPolicy } from "./healthAvailability.js";
import { shouldRecordGeneralRequestFailure } from "./requestFailureObservability.js";
import { crawlerFileRateLimitPolicy } from "./crawlerFileRateLimit.js";
import {
  allowedUnsafeRequestOrigins,
  assertProductionRequestHost,
  assertUnsafeRequestOrigin,
  clientIpFromRequest,
  readJsonBody,
  trustedProxyCidrs,
} from "./requestSecurity.js";
import {
  startVideoVerifierHealthScheduler,
  stopVideoVerifierHealthScheduler,
} from "./videoVerifier.js";
import { verifyPrivateMediaBucketIsolation } from "./media.js";
import {
  ensureLegacyMediaFinalizeSchema,
  expireLegacyMediaUploads,
} from "./mediaLegacyFinalize.js";
import {
  legacyImageRecoveryEnabled,
  startLegacyImageRecoveryScheduler,
} from "./legacyPostImageRecovery.js";
import {
  isDisabledMusicPlayerApiRequest,
  MUSIC_PLAYER_ENABLED,
} from "../src/domain/musicPlayerAvailability.mjs";
import {
  landingMediaPostIdFromPath,
  serveLandingMediaRequest,
} from "./landingMediaDelivery.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === "production";
const DIST = join(HERE, "..", "dist"); // `npx expo export -p web` output
const BODY_LIMIT = 256 * 1024; // 256 KB is plenty for JSON
const UNSAFE_REQUEST_ORIGINS = allowedUnsafeRequestOrigins({
  production: PROD,
  publicOrigin: process.env.PUBLIC_ORIGIN,
  port: PORT,
});
const TRUSTED_PROXY_CIDRS = trustedProxyCidrs(process.env.PIT_TRUSTED_PROXY_CIDRS);
const RENDER_PROXY_HEADERS = process.env.RENDER === "true";
const ACTIVE_SESSION_COOKIE = sessionCookieName(PROD);

function mediaConnectOrigin() {
  try {
    const url = new URL(process.env.MEDIA_ENDPOINT || "");
    return url.protocol === "https:" || (!PROD && url.protocol === "http:") ? url.origin : null;
  } catch { return null; }
}
const MEDIA_CONNECT_ORIGIN = mediaConnectOrigin();

// ---- reconcile the admin account (server-side only, never in the bundle) ----
// Production refuses to start without an explicit secret. Existing credentials
// are rehashed only when that secret changes, and rotations revoke all cookies.
reconcileAdminAccount({ database: db, queries: q, env: process.env, production: PROD });
ensureLegacyMediaFinalizeSchema(db);
const legacyPosterRelease = registerLegacyVideoPosterRelease(db);
if (legacyPosterRelease.active && (legacyPosterRelease.registered || legacyPosterRelease.retired)) {
  console.log(`[media] legacy poster release registered=${legacyPosterRelease.registered} retired=${legacyPosterRelease.retired}`);
}

// ---- security headers --------------------------------------------------------
// CSP: catalog/media assets can come from HTTPS hosts plus local data/blob
// previews. Executable sources remain an explicit allowlist.
// The interactive Google map (LiveMap) needs the Google Maps domains allowed for
// its loader script, its tile/data fetches, and its vector-map web workers -
// without these the browser blocks the script and the map silently falls back to
// the static image.
const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https: blob:",
    // Expo SDK 56's export uses external bundles; its inline shell content is
    // CSS. User-shared YouTube links are validated server-side, so the browser
    // needs provider script origins only when the built-in player is enabled.
    `script-src 'self' https://*.googleapis.com https://*.gstatic.com${MUSIC_PLAYER_ENABLED ? " https://www.youtube.com https://s.ytimg.com" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Google Maps XHR and durable uploaded media remain available while the
    // built-in music player is paused.
    `connect-src 'self' https://*.googleapis.com https://*.gstatic.com${MUSIC_PLAYER_ENABLED ? " https://www.youtube.com https://*.googlevideo.com" : ""}${MEDIA_CONNECT_ORIGIN ? ` ${MEDIA_CONNECT_ORIGIN}` : ""}`,
    "worker-src 'self' blob:", // vector maps run in blob web workers
    "font-src 'self' data: https://*.gstatic.com",
    `frame-src 'self'${MUSIC_PLAYER_ENABLED ? " https://www.youtube.com https://www.youtube-nocookie.com" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  ...(PROD ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
};

// Dev CORS: Expo dev server runs on :8081, API on :3000. In production both are
// same-origin (this server serves dist/), so CORS is OFF entirely.
const DEV_ORIGINS = new Set(["http://localhost:8081", "http://127.0.0.1:8081"]);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".map": "application/json", ".txt": "text/plain",
};

function send(res, status, body, extra = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": extra["Content-Type"] || "application/json; charset=utf-8", ...HEADERS, ...extra });
  res.end(data);
}

function sendCrawlerText(req, res, status, body, extra = {}) {
  const data = String(body || "");
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    ...HEADERS,
    ...extra,
  });
  if (req.method === "HEAD") return res.end();
  return res.end(data);
}

function sendApiError(res, error, requestId, extra = {}) {
  const safe = error instanceof ApiError ? error : new ApiError(500, "Something broke on our end, it's been logged.", "INTERNAL_ERROR");
  return send(res, safe.status, errorEnvelope(safe, requestId), createApiResponseHeaders(extra));
}

function withRequestId(body, requestId) {
  if (body && typeof body === "object" && !Array.isArray(body) && !Buffer.isBuffer(body)) return { ...body, requestId };
  return body;
}

// Match "METHOD /api/x/:param/y" patterns against the route table.
function matchRoute(method, pathname) {
  // `route` is the PATTERN, not the path. Error grouping keys on it, so
  // /api/users/u_abc/badges and /api/users/u_xyz/badges are one problem rather
  // than one row per user id.
  const direct = routes[`${method} ${pathname}`];
  if (direct) return { handler: direct, params: {}, route: pathname };
  const segs = pathname.split("/");
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(" ");
    if (m !== method) continue;
    const pSegs = pattern.split("/");
    if (pSegs.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pSegs.length; i++) {
      if (pSegs[i].startsWith(":")) params[pSegs[i].slice(1)] = segs[i];
      else if (pSegs[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { handler, params, route: pattern };
  }
  return null;
}

// robots.txt and sitemap.xml must be answered BEFORE the SPA fallback, which
// was quietly serving the app shell for both: sitemap.xml returned HTML, so no
// search engine could read it, and robots.txt fell through to Cloudflare's
// managed default rather than ours.
function serveCrawlerFile(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendCrawlerText(req, res, 405, "Method not allowed.\n", {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      Allow: "GET, HEAD",
    });
  }
  const sitemapResponse = pathname === "/robots.txt" ? null : sitemapResponseForPath(pathname);
  const body = pathname === "/robots.txt" ? robotsTxt() : sitemapResponse?.body;
  const type = pathname === "/robots.txt" ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8";
  if (sitemapResponse?.status === "unavailable") {
    return sendCrawlerText(req, res, 503, "Sitemap is warming. Try again shortly.\n", {
      "Cache-Control": "no-store",
      "Retry-After": String(sitemapResponse.retryAfterSeconds || 30),
      "X-Robots-Tag": "noindex",
    });
  }
  if (body == null) {
    return sendCrawlerText(req, res, 404, "Not found.\n", {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    });
  }
  res.writeHead(200, {
    ...HEADERS,
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    // Short cache: the sitemap changes whenever anyone posts a review.
    "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
  });
  if (req.method === "HEAD") return res.end();
  res.end(body);
}

// App stores, search engines, and signed-out people need legal/support pages
// that do not depend on the client bundle or an API session. Keep this before
// the SPA fallback, while leaving every non-document route on the existing app.
function servePublicPage(req, res, pathname) {
  const page = publicPageFor(pathname);
  if (!page) return false;
  if (pathname !== page.path) {
    res.writeHead(301, {
      ...HEADERS,
      Location: page.path,
      "Cache-Control": "public, max-age=3600",
      "X-Robots-Tag": htmlRobotsDirective(),
    });
    res.end();
    return true;
  }
  const body = renderPublicPage(page.path);
  if (!body) return false;
  res.writeHead(200, {
    ...HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    "X-Robots-Tag": htmlRobotsDirective({ indexable: true }),
    Link: `<${origin()}${page.path}>; rel="canonical"`,
  });
  if (req.method === "HEAD") res.end();
  else res.end(body);
  return true;
}

function serveStatic(req, res, pathname) {
  if (!existsSync(DIST)) {
    send(res, 503, { error: "Web build not found. Run: npx expo export -p web" });
    return true;
  }
  if (pathname === "/") return false;
  // path-traversal proof: normalize then require the DIST prefix
  let file = normalize(join(DIST, pathname === "/" ? "index.html" : pathname));
  const distRoot = normalize(DIST) + sep;
  if (!file.startsWith(distRoot)) {
    send(res, 403, { error: "Forbidden" });
    return true;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // A stale hashed chunk must be a real 404. Returning the SPA HTML with 200
    // makes browsers report an opaque module error and defeats safe deploy
    // recovery. Extensionless application routes still receive the shell.
    const missingAsset = missingStaticAssetResponse(pathname);
    if (missingAsset) {
      send(res, missingAsset.status, missingAsset.body, missingAsset.headers);
      return true;
    }
    return false;
  }
  const ext = extname(file).toLowerCase();

  // The shell is one file for every URL, so per-page metadata has to be injected
  // per request. Without this a shared artist link previews as a blank card
  // titled "Pit", and a crawler that does not run JavaScript sees nothing at
  // all. Only the HTML entry point is rewritten; assets stream untouched.
  if (ext === ".html") {
    let html = readFileSync(file, "utf8");
    try { html = injectHead(html, pathname); } catch { /* never fail the page over metadata */ }
    if (!isProduction()) html = enforceHtmlRobotsMeta(html);
    res.writeHead(200, {
      ...HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html),
      "Cache-Control": "no-cache",
      ...(!isProduction() ? { "X-Robots-Tag": htmlRobotsDirective() } : {}),
    });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    res.end(html);
    return true;
  }
  const cache = staticAssetCacheControl(pathname);
  const size = statSync(file).size;
  res.writeHead(200, {
    ...HEADERS,
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": size,
    "Cache-Control": cache,
  });
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(file);
  stream.on("error", (error) => {
    const failure = safeRequestFailureContext({ method: req.method, pathname, error });
    console.error(`[pit] static read failed: cause=${failure.cause}`);
    res.destroy(error);
  });
  stream.pipe(res);
  return true;
}

function serveWebShell(req, res, pathname, {
  noindex = false,
  plan = null,
  status = 200,
  cacheControl = null,
  retryAfter = null,
} = {}) {
  if (!existsSync(DIST)) {
    return send(res, 503, { error: "Web build not found. Run: npx expo export -p web" });
  }
  const file = join(DIST, "index.html");
  if (!existsSync(file)) return send(res, 503, { error: "Web build entry point is missing." });
  let html = readFileSync(file, "utf8");
  // Reuse the request-scoped resolution. Public projections contain several
  // bounded aggregate queries; resolving again here would double crawler load.
  html = injectHead(html, pathname, plan);
  const publicDocument = status === 200 && plan?.type === "document" && !noindex;
  res.writeHead(status, {
    ...HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Cache-Control": cacheControl || (publicDocument
      ? "public, max-age=0, s-maxage=60, must-revalidate"
      : "no-store"),
    "X-Robots-Tag": htmlRobotsDirective({ indexable: publicDocument }),
    ...(publicDocument && plan?.document?.canonicalUrl
      ? { Link: `<${plan.document.canonicalUrl}>; rel="canonical"` }
      : {}),
    ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  res.end(html);
}

function serveSeoRoute(req, res, pathname, { hasQueryString = false } = {}) {
  const plan = seoHttpPlan(pathname);
  if (plan.type === "redirect") {
    res.writeHead(plan.status || 301, {
      ...HEADERS,
      Location: plan.location,
      "Cache-Control": "public, max-age=3600",
    });
    return res.end();
  }
  if (plan.type === "document") {
    const responsePlan = hasQueryString ? { ...plan, indexable: false } : plan;
    return serveWebShell(req, res, pathname, {
      noindex: responsePlan.indexable === false,
      plan: responsePlan,
    });
  }
  if (plan.type === "app") return serveWebShell(req, res, pathname, { noindex: true, plan });
  if (plan.type === "unavailable") {
    return serveWebShell(req, res, pathname, {
      noindex: true,
      plan,
      status: 503,
      cacheControl: "no-store",
      retryAfter: 300,
    });
  }

  const html = renderNotFoundDocument();
  res.writeHead(404, {
    ...HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Cache-Control": "no-store",
    "X-Robots-Tag": htmlRobotsDirective(),
  });
  if (req.method === "HEAD") return res.end();
  res.end(html);
}

// The real client address behind Render and, on the public hostname,
// Cloudflare. Header values are used only after the socket/nearest-hop trust
// boundary is independently verified.
function clientIp(req) {
  return clientIpFromRequest(req, {
    renderEnvironment: RENDER_PROXY_HEADERS,
    trustedIngressCidrs: TRUSTED_PROXY_CIDRS,
  });
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const requestId = randomUUID();
  const requestAbort = new AbortController();
  const abortRequest = () => {
    if (!requestAbort.signal.aborted) requestAbort.abort(new DOMException("HTTP caller disconnected", "AbortError"));
  };
  req.once("aborted", abortRequest);
  res.once("close", () => {
    if (!res.writableEnded) abortRequest();
  });
  res.setHeader("X-Request-Id", requestId);
  let pathname = "/", query = {}, routePattern = "", hasQueryString = false;
  try {
    const u = new URL(req.url, "http://x");
    pathname = u.pathname;
    query = Object.fromEntries(u.searchParams);
    hasQueryString = u.search.length > 1;
  } catch { return sendApiError(res, new ApiError(400, "Bad URL.", "VALIDATION_FAILED"), requestId); }

  try {
    assertProductionRequestHost({
      production: PROD,
      method: req.method,
      pathname,
      host: req.headers.host,
      publicOrigin: process.env.PUBLIC_ORIGIN,
      renderExternalHostname: process.env.RENDER_EXTERNAL_HOSTNAME,
    });
  } catch (error) {
    return sendApiError(res, error, requestId);
  }

  // dev CORS (no-op in production, same-origin there)
  const origin = req.headers.origin;
  const cors = !PROD && origin && DEV_ORIGINS.has(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-Pit-Expected-Account", "Access-Control-Expose-Headers": "X-Request-Id" }
    : {};
  if (req.method === "OPTIONS") return send(res, 204, "", createApiResponseHeaders(cors));

  try {
    if (pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname.startsWith("/sitemaps/")) {
      const crawlerLimit = crawlerFileRateLimitPolicy(clientIp(req));
      if (!rateLimit(crawlerLimit.key, crawlerLimit.max, crawlerLimit.windowMs)) {
        return sendCrawlerText(req, res, 429, "Too many crawler-file requests.\n", {
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex",
          "Retry-After": String(Math.ceil(crawlerLimit.windowMs / 1000)),
        });
      }
      return serveCrawlerFile(req, res, pathname);
    }

    if (landingMediaPostIdFromPath(pathname)) {
      routePattern = "/media/landing/:postId";
      const token = parseCookies(req.headers.cookie)[ACTIVE_SESSION_COOKIE];
      const sess = getSession(token);
      const viewer = sess ? q.userById.get(sess.user_id) : null;
      const mediaViewer = viewer?.id || `ip:${clientIp(req)}`;
      if (!rateLimit(`landing-media:${mediaViewer}`, 180, 60 * 1000)) {
        return send(res, 429, "Too many requests.", {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": "60",
        });
      }
      return serveLandingMediaRequest({
        req,
        res,
        pathname,
        viewerId: viewer?.id || null,
        signal: requestAbort.signal,
        securityHeaders: HEADERS,
      });
    }

    if (pathname.startsWith("/api/")) {
      if (isDisabledMusicPlayerApiRequest(req.method, pathname, query)) {
        return sendApiError(res, new ApiError(404, "Not found.", "NOT_FOUND"), requestId, cors);
      }

      // Cookie authentication needs an explicit browser request boundary.
      // Native clients omit Origin/Fetch Metadata and remain supported; browser
      // writes must originate from the configured first-party app.
      assertUnsafeRequestOrigin(req.method, req.headers, UNSAFE_REQUEST_ORIGINS);

      // Global flood guard on top of per-route limits.
      //
      // This must use the CLIENT's address, not the socket's. In production the
      // app sits behind Cloudflare and Render's proxy, so `socket.remoteAddress`
      // is the proxy — every visitor collapsed into one bucket and the whole
      // site shared a single 300/minute allowance. That is a self-inflicted
      // outage waiting for the first busy day.
      const ip = clientIp(req);
      // Render's liveness probe must not share the application-wide bucket, or
      // normal traffic could turn a busy minute into a restart loop. It still
      // receives its own generous per-address ceiling so the public endpoint
      // cannot be used as an unbounded readiness/SQLite polling surface.
      if (pathname === "/api/health" || pathname === "/api/readiness") {
        const healthLimit = healthRateLimitPolicy(ip);
        if (!rateLimit(healthLimit.key, healthLimit.max, healthLimit.windowMs)) {
          return sendApiError(res, new ApiError(429, "Too many requests.", "RATE_LIMITED"), requestId, cors);
        }
      } else {
        // Signed-in members are limited per account, like the per-route limiter,
        // so a carrier NAT or office network cannot make its users throttle each
        // other. Guests still share by address, which is the best available key.
        const sessionToken = parseCookies(req.headers.cookie)[ACTIVE_SESSION_COOKIE];
        const flooder = getSession(sessionToken)?.user_id || `ip:${ip}`;
        if (!rateLimit(`global:${flooder}`, 300, 60 * 1000)) return sendApiError(res, new ApiError(429, "Too many requests.", "RATE_LIMITED"), requestId, cors);
      }

      const match = matchRoute(req.method, pathname);
      if (!match) return sendApiError(res, new ApiError(404, "Not found.", "NOT_FOUND"), requestId, cors);
      routePattern = match.route || "";

      const token = parseCookies(req.headers.cookie)[ACTIVE_SESSION_COOKIE];
      const sess = getSession(token);
      const user = sess ? q.userById.get(sess.user_id) : null;
      assertAccountMutationAccess({ method: req.method, pathname, user });
      const expectedAccountHeader = req.headers["x-pit-expected-account"];
      const expectedAccount = Array.isArray(expectedAccountHeader) ? expectedAccountHeader[0] : expectedAccountHeader;
      assertExpectedAccount(expectedAccount, user);

      const setCookies = [];
      const responseHeaders = createApiResponseHeaders();
      const proto = (req.headers["x-forwarded-proto"] || "").split(",")[0] || (req.socket.encrypted ? "https" : "http");
      const ctx = {
        // DELETE /api/me requires the current password. Parse JSON on DELETE as
        // well as write verbs so that confirmation is verified server-side.
        body: ["POST", "PATCH", "PUT", "DELETE"].includes(req.method)
          ? await readJsonBody(req, { limit: BODY_LIMIT })
          : {},
        query, params: match.params, ip, ua: req.headers["user-agent"], token, user,
        host: req.headers.host, proto, origin: `${proto}://${req.headers.host}`, requestId,
        signal: requestAbort.signal,
        setCookie: (c) => setCookies.push(c),
        setSession: (s) => setCookies.push(...sessionCookieHeaders(s.token, s.expiresAt, PROD)),
        clearSession: () => setCookies.push(...clearSessionCookies(PROD)),
        setHeader: createApiResponseHeaderSetter(responseHeaders),
      };
      const result = await match.handler(ctx);
      const extra = { ...cors, ...responseHeaders };
      if (setCookies.length) extra["Set-Cookie"] = setCookies;
      // A handler can 302-redirect (OAuth handoff) by returning { redirect: url }.
      if (result && result.redirect) {
        res.writeHead(302, {
          ...HEADERS,
          ...extra,
          Location: result.redirect,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        });
        return res.end();
      }
      return send(res, 200, withRequestId(result ?? { ok: true }, requestId), extra);
    }

    // everything else = the web app
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed." });
    if (servePublicPage(req, res, pathname)) return;
    if (pathname === "/index.html") {
      res.writeHead(301, { ...HEADERS, Location: "/", "Cache-Control": "public, max-age=3600" });
      return res.end();
    }
    if (serveStatic(req, res, pathname)) return;
    return serveSeoRoute(req, res, pathname, { hasQueryString });
  } catch (e) {
    // A client disconnect is an expected cancellation boundary, not an
    // application failure. Downstream storage/decoder helpers may wrap the
    // aborted fetch in a stable 503 for live callers; never record, alert, or
    // attempt a response after this request's signal has been cancelled.
    if (requestAbort.signal.aborted || res.destroyed) return;
    // `routePattern` is set once the router matched, so aggregation groups by
    // pattern. Before that it stays empty rather than falling back to the raw
    // path, which would carry ids and search terms into storage.
    const failure = safeRequestFailureContext({ method: req.method, pathname, routePattern, error: e });
    if (e instanceof ApiError) {
      if (e.status >= 500) {
        console.error(`[pit] ${e.status} ${requestId} on ${failure.method} ${failure.route} (${Date.now() - started}ms): code=${e.code} cause=${failure.cause}`);
        if (shouldRecordGeneralRequestFailure({
          method: failure.method,
          route: routePattern,
          status: e.status,
          code: e.code,
        })) {
          recordError({ level: "error", code: e.code, status: e.status, method: failure.method, route: routePattern, cause: failure.cause, requestId });
          scheduleAlert();
        }
      }
      return sendApiError(res, e, requestId, cors);
    }
    console.error(`[pit] 500 ${requestId} on ${failure.method} ${failure.route} (${Date.now() - started}ms): cause=${failure.cause}`);
    recordError({ level: "error", code: "UNHANDLED", status: 500, method: failure.method, route: routePattern, cause: failure.cause, requestId });
    scheduleAlert();
    return sendApiError(res, e, requestId, cors);
  }
});
applyHttpServerLimits(server);

// Observe fatal errors without installing an `uncaughtException` handler. Node
// explicitly warns that resuming after an uncaught exception is unsafe because
// application state may be corrupted. Under the Node 24 runtime an unhandled
// rejection is thrown by default too, so both paths are logged here and then
// retain Node's fail-fast exit semantics for Render to restart cleanly.
process.on("uncaughtExceptionMonitor", (error, origin) => {
  const failure = safeRequestFailureContext({ method: "PROCESS", routePattern: String(origin || ""), error });
  console.error(`[pit] fatal process error (${failure.route}): cause=${failure.cause}`);
  // Recorded synchronously because the process is about to exit. No alert is
  // scheduled here: a timer would never fire, and Render restarting the service
  // is what surfaces this. The next request after the restart sends the digest.
  recordError({ level: "fatal", code: "PROCESS", status: 0, method: "", route: failure.route, cause: failure.cause });
});

// Hourly maintenance owns its failure at the timer boundary. A transient
// cleanup error should be visible, but it is not an unknown process-level bug.
setInterval(() => {
  try { sweepExpiredSessions(); }
  catch (error) { console.error(`[pit] expired-session sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
  try { pruneErrors(); }
  catch (error) { console.error(`[pit] error-log prune failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
  try { pruneMissingArtists(); }
  catch (error) { console.error(`[pit] missing-artist retention sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
  try { pruneEmailOperationalData(db); }
  catch (error) { console.error(`[mail] operational-retention sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
  try { pruneAnalyticsData({ database: db }); }
  catch (error) { console.error(`[pit] analytics-retention sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
  try { pruneGuestSearchAnalytics({ database: db }); }
  catch (error) { console.error(`[pit] guest-search retention sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
  try { pruneProductSuggestions({ database: db }); }
  catch (error) { console.error(`[pit] suggestion retention sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
  try { pruneExpiredAccountSecrets(db); }
  catch (error) { console.error(`[pit] account-secret retention sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
  try { expireLegacyMediaUploads(db); }
  catch (error) { console.error(`[media] legacy staging-expiry sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
}, 60 * 60 * 1000).unref();

// Alerting is deferred off the request path so a slow mail provider can never
// add latency to the response that triggered it. One pending drain covers every
// error already recorded before its timer runs; a storm no longer creates one
// zero-delay timer per request. maybeAlert still owns the delivery cooldown.
const alertDrains = createAlertDrainScheduler({ drain: () => maybeAlert() });
function scheduleAlert() {
  alertDrains.schedule();
}

// graceful shutdown, finish in-flight requests and campaign work, then close
// the DB cleanly. Stopping the scheduler prevents a new tick from racing the
// close; its current bounded drain is allowed to settle within the hard timeout.
let shuttingDown = false;
let emailCampaignScheduler = null;
let founderOperationsScheduler = null;
let legacyVideoPosterScheduler = null;
let legacyImageRecoveryScheduler = null;
let artistDeathWatchScheduler = null;
let privateMediaIsolationTimer = null;
let sitemapRefreshTimer = null;
let sitemapRetryTimer = null;
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[pit] shutting down…");
  const campaignStop = emailCampaignScheduler?.stop() || Promise.resolve();
  const founderOperationsStop = founderOperationsScheduler?.stop() || Promise.resolve();
  const legacyImageRecoveryStop = legacyImageRecoveryScheduler?.stop() || Promise.resolve();
  const artistDeathWatchStop = artistDeathWatchScheduler?.stop() || Promise.resolve();
  const artistTourDateRefreshStop = stopArtistTourDateDemandRefresh({ abortActive: true });
  const artistGenreRefreshStop = stopMusicBrainzGenreRefreshScheduler({ abortActive: true });
  stopVideoVerifierHealthScheduler({ abortActive: true });
  if (privateMediaIsolationTimer) clearInterval(privateMediaIsolationTimer);
  if (sitemapRefreshTimer) clearInterval(sitemapRefreshTimer);
  if (sitemapRetryTimer) clearTimeout(sitemapRetryTimer);
  const sitemapRefreshStop = drainSitemapSnapshotRefresh();
  legacyVideoPosterScheduler?.stop();
  server.close(async () => {
    try { await campaignStop; }
    catch (error) { console.error(`[mail] campaign recovery shutdown failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    try { await founderOperationsStop; }
    catch (error) { console.error(`[health] founder operations shutdown failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    try { await legacyImageRecoveryStop; }
    catch (error) { console.error(`[media] legacy image recovery shutdown failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    try { await artistDeathWatchStop; }
    catch (error) { console.error(`[memorial-watch] shutdown failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    try { await artistTourDateRefreshStop; }
    catch (error) { console.error(`[pit] exact artist refresh shutdown failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    try { await artistGenreRefreshStop; }
    catch (error) { console.error(`[pit] artist genre refresh shutdown failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    try { await sitemapRefreshStop; }
    catch (error) { console.error(`[seo] sitemap refresh shutdown failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    try { db.close(); }
    catch (error) { console.error(`[pit] database close failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    process.exit(exitCode);
  });
  setTimeout(() => process.exit(exitCode), 5000).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

let privateIsolationProbeActive = false;
async function refreshPrivateMediaIsolation() {
  if (privateIsolationProbeActive) return null;
  privateIsolationProbeActive = true;
  try {
    return await verifyPrivateMediaBucketIsolation({ env: process.env });
  } finally {
    privateIsolationProbeActive = false;
  }
}

function startPrivateMediaIsolationScheduler() {
  if (!PROD || privateMediaIsolationTimer) return;
  privateMediaIsolationTimer = setInterval(() => {
    refreshPrivateMediaIsolationSafely("scheduled");
  }, 5 * 60 * 1000);
  privateMediaIsolationTimer.unref();
}

function ensureLegacyImageRecoveryScheduler() {
  if (shuttingDown || legacyImageRecoveryScheduler) return legacyImageRecoveryScheduler;
  if (!legacyImageRecoveryEnabled(process.env)) return null;
  legacyImageRecoveryScheduler = startLegacyImageRecoveryScheduler({ database: db });
  console.log("[media] verified private storage; bounded legacy image recovery is active");
  return legacyImageRecoveryScheduler;
}
function refreshPrivateMediaIsolationSafely(phase) {
  return refreshPrivateMediaIsolation()
    .then((status) => {
      if (status?.ready) ensureLegacyImageRecoveryScheduler();
      if (status && !status.ready) {
        console.error(`[media] private-storage privacy check failed closed: phase=${phase} code=${status.errorCode || "probe_failed"}`);
      }
      return status;
    })
    .catch((error) => {
      console.error(`[media] private-storage privacy check failed safely: phase=${phase} cause=${safeRequestFailureContext({ error }).cause}`);
      return null;
    });
}

function sitemapRefreshIntervalMs(env = process.env) {
  const configured = Number(env.SITEMAP_REFRESH_INTERVAL_MS);
  if (!Number.isFinite(configured)) return 15 * 60 * 1000;
  return Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Math.floor(configured)));
}

function clearSitemapRetryTimer() {
  if (!sitemapRetryTimer) return;
  clearTimeout(sitemapRetryTimer);
  sitemapRetryTimer = null;
}

function scheduleSitemapRetry(retryAt) {
  if (shuttingDown || !Number.isFinite(Number(retryAt))) return;
  clearSitemapRetryTimer();
  const delay = Math.max(1, Number(retryAt) - Date.now());
  sitemapRetryTimer = setTimeout(() => {
    sitemapRetryTimer = null;
    void refreshSitemapSafely("retry");
  }, delay);
  sitemapRetryTimer.unref();
}

function refreshSitemapSafely(phase, { force = false } = {}) {
  return refreshSitemapSnapshot({ force })
    .then((result) => {
      if (result?.ok) clearSitemapRetryTimer();
      else if (Number.isFinite(Number(result?.retryAt))) scheduleSitemapRetry(result.retryAt);
      if (!result.ok && result.reason !== "backoff") {
        console.error(`[seo] sitemap refresh retained last-known-good snapshot: phase=${phase} category=${result.reason || "refresh_failed"}`);
      }
      return result;
    })
    .catch((error) => {
      console.error(`[seo] sitemap refresh failed safely: phase=${phase} cause=${safeRequestFailureContext({ error }).cause}`);
      return null;
    });
}

function startSitemapRefreshScheduler() {
  if (sitemapRefreshTimer) return;
  sitemapRefreshTimer = setInterval(() => {
    void refreshSitemapSafely("scheduled");
  }, sitemapRefreshIntervalMs());
  sitemapRefreshTimer.unref();
}

async function startServer() {
  const loadedSitemap = await loadSitemapSnapshot();
  const startupSitemapRefresh = sitemapStartupRefreshDecision(loadedSitemap, {
    maximumAgeMs: sitemapRefreshIntervalMs(),
  });
  if (!loadedSitemap.ok && loadedSitemap.reason !== "missing") {
    console.error(`[seo] persisted sitemap rejected safely: category=${loadedSitemap.reason}`);
  }
  server.listen(PORT, () => {
    console.log(`[pit] up on http://localhost:${PORT} ${PROD ? "(production)" : "(dev)"}, serving API${existsSync(DIST) ? " + web build" : " (no dist/ yet)"}`);
    try { pruneEmailOperationalData(db); }
    catch (error) { console.error(`[mail] startup retention sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    try { pruneAnalyticsData({ database: db }); }
    catch (error) { console.error(`[pit] startup analytics-retention sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    try { pruneGuestSearchAnalytics({ database: db }); }
    catch (error) { console.error(`[pit] startup guest-search retention sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    try { pruneProductSuggestions({ database: db }); }
    catch (error) { console.error(`[pit] startup suggestion retention sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    try { pruneExpiredAccountSecrets(db); }
    catch (error) { console.error(`[pit] startup account-secret retention sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    try { expireLegacyMediaUploads(db); }
    catch (error) { console.error(`[media] startup legacy staging-expiry sweep failed safely: cause=${safeRequestFailureContext({ error }).cause}`); }
    if (emailCampaignRecoveryEnabled()) {
      emailCampaignScheduler = startEmailCampaignScheduler(); // bounded continuation after explicit restore/privacy approval
    } else {
      console.log("[mail] automatic campaign recovery disabled; resume only after privacy replay and restore review.");
    }
    startTourDateScheduler(); // scrapes tour dates into the DB on a timer (no cron/redeploy)
    startArtistTourDateDemandRefresh(); // drains durable exact-artist demand without delaying reads
    startMusicBrainzGenreRefreshScheduler(); // exact-MBID genre evidence, bounded and never on a foreground read
    artistDeathWatchScheduler = startArtistDeathWatchScheduler({ service: artistDeathWatchService });
    startCacheWarmScheduler(); // runs keyless catalogue enrichment; provider playback warming obeys the shared product gate
    startBackupScheduler(); // verified daily SQLite snapshot on /data; private off-host copy when configured
    startMediaDeletionScheduler({ database: db }); // bounded, durable cleanup of active user-media objects only
    legacyVideoPosterScheduler = startLegacyVideoPosterVerificationScheduler({ database: db });
    startVideoVerifierHealthScheduler();
    // Sitemap reads serve only the validated persisted/current LKG. Reuse a
    // fresh current-revision snapshot across deploys; missing, stale, future,
    // or incompatible snapshots still rebuild after readiness. HTTP reads never
    // invoke a materialization.
    if (startupSitemapRefresh.refresh) {
      void refreshSitemapSafely("startup", { force: startupSitemapRefresh.force });
    }
    startSitemapRefreshScheduler();
    // Do not couple core availability to an optional remote provider. Until
    // this proof succeeds, capabilities stay off and private media operations
    // fail closed through requirePrivateMediaIsolationReady().
    if (PROD) refreshPrivateMediaIsolationSafely("startup");
    startPrivateMediaIsolationScheduler();
    // A deployment is stamped only from this listen callback, after startup
    // checks have completed and the web process is accepting connections.
    founderOperationsScheduler = startFounderOperationsScheduler({ database: db });
  });
}

startServer().catch((error) => {
  console.error(`[pit] startup failed: cause=${safeRequestFailureContext({ error }).cause}`);
  process.exitCode = 1;
});
