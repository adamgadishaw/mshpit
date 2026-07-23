#!/usr/bin/env node
// mshpit.com backend, zero-dependency Node server.
//
//   node server/index.js            # serves API + the exported web build (dist/)
//   PORT=3000 NODE_ENV=production ADMIN_PASSWORD=... node server/index.js
//
// Crash posture: request errors are isolated and JSON bodies are size-capped.
// Truly uncaught process errors trigger a graceful restart; continuing after an
// unknown fatal state can corrupt later requests or database work.
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join, extname, normalize, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { db, q, publicUser } from "./db.js";
import { routes } from "./api.js";
import { ApiError, errorEnvelope } from "./errors.js";
import { injectHead, robotsTxt, sitemapXml } from "./seo.js";
import { getSession, sweepExpiredSessions, sessionCookie, clearCookie, parseCookies, COOKIE, hashPassword, rateLimit } from "./auth.js";
import { startTourDateScheduler } from "./tourdates.js";
import { randomBytes, randomUUID } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === "production";
const DIST = join(HERE, "..", "dist"); // `npx expo export -p web` output
const BODY_LIMIT = 256 * 1024; // 256 KB is plenty for JSON

function mediaConnectOrigin() {
  try {
    const url = new URL(process.env.MEDIA_ENDPOINT || "");
    return url.protocol === "https:" || (!PROD && url.protocol === "http:") ? url.origin : null;
  } catch { return null; }
}
const MEDIA_CONNECT_ORIGIN = mediaConnectOrigin();

// ---- seed the admin account (server-side only, never in the client bundle) --
function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || "adamgadishaw@gmail.com").toLowerCase();
  const existing = q.userByEmail.get(email);
  if (existing) {
    // ADMIN_PASSWORD is the source of truth: set/change it in the host env and
    // redeploy to reset the admin login (and un-ban/re-admin the account).
    if (process.env.ADMIN_PASSWORD) {
      db.prepare("UPDATE users SET pass_hash = ?, role = 'admin', is_banned = 0 WHERE id = ?")
        .run(hashPassword(process.env.ADMIN_PASSWORD), existing.id);
      console.log(`[pit] admin password synced from ADMIN_PASSWORD for ${email}`);
    }
    return;
  }
  const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString("base64url");
  q.insertUser.run(`u_${randomUUID().slice(0, 12)}`, email, "Adam", "admin", hashPassword(password),
    "admin", "Toronto", 43.6532, -79.3832, "AD", "#F2A65A", Date.now());
  console.log(`[pit] admin account created: ${email}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`[pit] generated admin password (SAVE THIS, shown once): ${password}`);
  }
}
seedAdmin();

// ---- security headers --------------------------------------------------------
// CSP: the app hotlinks images from many hosts (Commons/Openverse/web + wsrv.nl
// proxy + YouTube/Unsplash CDNs), so img-src stays broad; everything else locked.
// The interactive Google map (LiveMap) needs the Google Maps domains allowed for
// its loader script, its tile/data fetches, and its vector-map web workers -
// without these the browser blocks the script and the map silently falls back to
// the static image.
const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "img-src * data: blob:",
    "media-src *",
    // expo web build inlines its bootstrap ('unsafe-inline'); Google Maps JS loads
    // from *.googleapis.com / *.gstatic.com. The YouTube IFrame Player API loads
    // its script from www.youtube.com + its widget/player code from s.ytimg.com.
    "script-src 'self' 'unsafe-inline' https://*.googleapis.com https://*.gstatic.com https://www.youtube.com https://s.ytimg.com",
    "style-src 'self' 'unsafe-inline'",
    // Google Maps XHR + the YouTube player's own data/stats fetches.
    `connect-src 'self' https://*.googleapis.com https://*.gstatic.com https://www.youtube.com https://*.googlevideo.com${MEDIA_CONNECT_ORIGIN ? ` ${MEDIA_CONNECT_ORIGIN}` : ""}`,
    "worker-src 'self' blob:", // vector maps run in blob web workers
    "font-src 'self' data: https://*.gstatic.com",
    // In-app player: YouTube video/audio is framed in-app so people never leave
    // the site (full songs, no account needed).
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
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

function sendApiError(res, error, requestId, extra = {}) {
  const safe = error instanceof ApiError ? error : new ApiError(500, "Something broke on our end, it's been logged.", "INTERNAL_ERROR");
  return send(res, safe.status, errorEnvelope(safe, requestId), extra);
}

function withRequestId(body, requestId) {
  if (body && typeof body === "object" && !Array.isArray(body) && !Buffer.isBuffer(body)) return { ...body, requestId };
  return body;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", (c) => {
      if (tooLarge) return; // keep draining so the structured 413 can be sent
      size += c.length;
      if (size > BODY_LIMIT) {
        tooLarge = true;
        chunks.length = 0;
        reject(new ApiError(413, "Request too large.", "VALIDATION_FAILED"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) return;
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new ApiError(400, "Invalid JSON.", "VALIDATION_FAILED")); }
    });
    req.on("error", () => reject(new ApiError(400, "Bad request.", "VALIDATION_FAILED")));
  });
}

// Match "METHOD /api/x/:param/y" patterns against the route table.
function matchRoute(method, pathname) {
  const direct = routes[`${method} ${pathname}`];
  if (direct) return { handler: direct, params: {} };
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
    if (ok) return { handler, params };
  }
  return null;
}

// robots.txt and sitemap.xml must be answered BEFORE the SPA fallback, which
// was quietly serving the app shell for both: sitemap.xml returned HTML, so no
// search engine could read it, and robots.txt fell through to Cloudflare's
// managed default rather than ours.
function serveCrawlerFile(req, res, pathname) {
  const body = pathname === "/robots.txt" ? robotsTxt() : sitemapXml();
  const type = pathname === "/robots.txt" ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8";
  res.writeHead(200, {
    ...HEADERS,
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    // Short cache: the sitemap changes whenever anyone posts a review.
    "Cache-Control": "public, max-age=3600",
  });
  if (req.method === "HEAD") return res.end();
  res.end(body);
}

function serveStatic(req, res, pathname) {
  if (!existsSync(DIST)) {
    return send(res, 503, { error: "Web build not found. Run: npx expo export -p web" });
  }
  // path-traversal proof: normalize then require the DIST prefix
  let file = normalize(join(DIST, pathname === "/" ? "index.html" : pathname));
  const distRoot = normalize(DIST) + sep;
  if (!file.startsWith(distRoot)) return send(res, 403, { error: "Forbidden" });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html"); // SPA fallback
  const ext = extname(file).toLowerCase();

  // The shell is one file for every URL, so per-page metadata has to be injected
  // per request. Without this a shared artist link previews as a blank card
  // titled "Pit", and a crawler that does not run JavaScript sees nothing at
  // all. Only the HTML entry point is rewritten; assets stream untouched.
  if (ext === ".html") {
    let html = readFileSync(file, "utf8");
    try { html = injectHead(html, pathname); } catch { /* never fail the page over metadata */ }
    res.writeHead(200, { ...HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html), "Cache-Control": "no-cache" });
    if (req.method === "HEAD") return res.end();
    return res.end(html);
  }
  const cache = ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable";
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
    console.error(`[pit] static read failed for ${file}:`, error);
    res.destroy(error);
  });
  stream.pipe(res);
}

// The real client address behind Cloudflare and Render.
//
// `cf-connecting-ip` is set by Cloudflare and it strips any client-supplied
// copy, so it is trustworthy whenever traffic must pass through Cloudflare.
// `x-forwarded-for` is a chain, client first; a client that reaches the origin
// directly could forge it, which is a rate-limit-evasion risk rather than an
// auth one, and the alternative (one shared bucket for everybody) is worse.
function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || "?";
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const requestId = randomUUID();
  res.setHeader("X-Request-Id", requestId);
  let pathname = "/", query = {};
  try {
    const u = new URL(req.url, "http://x");
    pathname = u.pathname;
    query = Object.fromEntries(u.searchParams);
  } catch { return sendApiError(res, new ApiError(400, "Bad URL.", "VALIDATION_FAILED"), requestId); }

  // dev CORS (no-op in production, same-origin there)
  const origin = req.headers.origin;
  const cors = !PROD && origin && DEV_ORIGINS.has(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Request-Id", "Access-Control-Expose-Headers": "X-Request-Id" }
    : {};
  if (req.method === "OPTIONS") return send(res, 204, "", cors);

  try {
    if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return serveCrawlerFile(req, res, pathname);

    if (pathname.startsWith("/api/")) {
      // Global flood guard on top of per-route limits.
      //
      // This must use the CLIENT's address, not the socket's. In production the
      // app sits behind Cloudflare and Render's proxy, so `socket.remoteAddress`
      // is the proxy — every visitor collapsed into one bucket and the whole
      // site shared a single 300/minute allowance. That is a self-inflicted
      // outage waiting for the first busy day.
      const ip = clientIp(req);
      // Health checks are exempt: Render polls /api/health to decide whether the
      // service is alive, so letting a traffic spike rate-limit it would turn a
      // busy minute into a restart loop.
      if (pathname !== "/api/health") {
        // Signed-in members are limited per account, like the per-route limiter,
        // so a carrier NAT or office network cannot make its users throttle each
        // other. Guests still share by address, which is the best available key.
        const sessionToken = parseCookies(req.headers.cookie)[COOKIE];
        const flooder = getSession(sessionToken)?.user_id || `ip:${ip}`;
        if (!rateLimit(`global:${flooder}`, 300, 60 * 1000)) return sendApiError(res, new ApiError(429, "Too many requests.", "RATE_LIMITED"), requestId, cors);
      }

      const match = matchRoute(req.method, pathname);
      if (!match) return sendApiError(res, new ApiError(404, "Not found.", "NOT_FOUND"), requestId, cors);

      const token = parseCookies(req.headers.cookie)[COOKIE];
      const sess = getSession(token);
      const user = sess ? q.userById.get(sess.user_id) : null;

      const setCookies = [];
      const proto = (req.headers["x-forwarded-proto"] || "").split(",")[0] || (req.socket.encrypted ? "https" : "http");
      const ctx = {
        // DELETE /api/me requires the current password. Parse JSON on DELETE as
        // well as write verbs so that confirmation is verified server-side.
        body: ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? await readBody(req) : {},
        query, params: match.params, ip, ua: req.headers["user-agent"], token, user,
        host: req.headers.host, proto, origin: `${proto}://${req.headers.host}`, requestId,
        setCookie: (c) => setCookies.push(c),
        setSession: (s) => setCookies.push(sessionCookie(s.token, s.expiresAt, PROD)),
        clearSession: () => setCookies.push(clearCookie(PROD)),
      };
      const result = await match.handler(ctx);
      const extra = { ...cors };
      if (setCookies.length) extra["Set-Cookie"] = setCookies;
      // A handler can 302-redirect (OAuth handoff) by returning { redirect: url }.
      if (result && result.redirect) { res.writeHead(302, { Location: result.redirect, ...extra }); return res.end(); }
      return send(res, 200, withRequestId(result ?? { ok: true }, requestId), extra);
    }

    // everything else = the web app
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed." });
    return serveStatic(req, res, pathname);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status >= 500) {
        const causeName = String(e.cause?.name || "none").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
        const causeCode = String(e.cause?.code || "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
        console.error(`[pit] ${e.status} ${requestId} on ${req.method} ${pathname} (${Date.now() - started}ms): code=${e.code} cause=${causeName}${causeCode ? `/${causeCode}` : ""}`);
      }
      return sendApiError(res, e, requestId, cors);
    }
    console.error(`[pit] 500 ${requestId} on ${req.method} ${pathname} (${Date.now() - started}ms):`, e);
    return sendApiError(res, e, requestId, cors);
  }
});

// Unknown process-level failures are not safe to recover from. Log once, drain
// active requests, close SQLite, and let Render restart a clean process.
process.on("uncaughtException", (e) => { console.error("[pit] uncaughtException:", e); shutdown(1); });
process.on("unhandledRejection", (e) => { console.error("[pit] unhandledRejection:", e); shutdown(1); });

// hourly session sweep
setInterval(sweepExpiredSessions, 60 * 60 * 1000).unref();

// graceful shutdown, finish in-flight requests, close the DB cleanly
let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[pit] shutting down…");
  server.close(() => { try { db.close(); } catch {} process.exit(exitCode); });
  setTimeout(() => process.exit(exitCode), 5000).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

server.listen(PORT, () => {
  console.log(`[pit] up on http://localhost:${PORT} ${PROD ? "(production)" : "(dev)"}, serving API${existsSync(DIST) ? " + web build" : " (no dist/ yet)"}`);
  startTourDateScheduler(); // scrapes tour dates into the DB on a timer (no cron/redeploy)
});
