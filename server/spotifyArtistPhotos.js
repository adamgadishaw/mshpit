import { PROVIDER_JSON_LIMITS, readBoundedJsonResponse } from "./boundedJsonResponse.js";
import { ProviderError } from "./musicProviders.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_ORIGIN = "https://api.spotify.com";
const SPOTIFY_IMAGE_HOST = "i.scdn.co";
const SPOTIFY_ARTIST_HOST = "open.spotify.com";
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/u;
const SPOTIFY_IMAGE_PATH = /^\/image\/[A-Za-z0-9]+$/u;
const TOKEN_MAX_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_EXPIRY_SKEW_MS = 30_000;
const MAX_ATTEMPTS = 2;
const DEFAULT_RATE_LIMIT_BLOCK_MS = 15 * 60 * 1000;
const MIN_RATE_LIMIT_BLOCK_MS = 1_000;
const QUOTA_EXCEEDED_BLOCK_MS = 24 * 60 * 60 * 1000;

const normalizeArtistName = (value) => String(value || "")
  .normalize("NFKC")
  .replace(/\s+/gu, " ")
  .trim()
  .toLocaleLowerCase("en-US");

export const safeSpotifyArtistId = (value) => {
  const id = String(value || "").trim();
  return SPOTIFY_ID.test(id) ? id : "";
};

export function safeSpotifyArtistImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || url.hostname !== SPOTIFY_IMAGE_HOST
      || !SPOTIFY_IMAGE_PATH.test(url.pathname)
      || url.search
      || url.hash) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function safeSpotifyArtistPageUrl(value, expectedId = null) {
  try {
    const url = new URL(String(value || ""));
    const match = url.pathname.match(/^\/artist\/([A-Za-z0-9]{22})\/?$/u);
    if (url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || url.hostname !== SPOTIFY_ARTIST_HOST
      || url.search
      || url.hash
      || !match) return "";
    const id = safeSpotifyArtistId(match[1]);
    const expected = expectedId == null ? "" : safeSpotifyArtistId(expectedId);
    if (!id || (expected && id !== expected)) return "";
    return `https://${SPOTIFY_ARTIST_HOST}/artist/${id}`;
  } catch {
    return "";
  }
}

const imageArea = (image) => {
  const width = Number(image?.width);
  const height = Number(image?.height);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? width * height
    : 0;
};

export function spotifyArtistPhotoRecord(payload, { checkedAt = Date.now() } = {}) {
  const spotifyId = safeSpotifyArtistId(payload?.id);
  if (!spotifyId) return null;
  const exactArtistUrl = safeSpotifyArtistPageUrl(payload?.external_urls?.spotify, spotifyId)
    || `https://${SPOTIFY_ARTIST_HOST}/artist/${spotifyId}`;
  const images = (Array.isArray(payload?.images) ? payload.images : [])
    .map((image) => ({
      url: safeSpotifyArtistImageUrl(image?.url),
      width: Number.isFinite(Number(image?.width)) ? Math.max(0, Math.floor(Number(image.width))) : null,
      height: Number.isFinite(Number(image?.height)) ? Math.max(0, Math.floor(Number(image.height))) : null,
      area: imageArea(image),
    }))
    .filter((image) => image.url)
    .sort((left, right) => right.area - left.area);
  const selected = images[0];
  if (!selected) return null;
  return Object.freeze({
    provider: "spotify",
    spotifyId,
    spotifyPhoto: selected.url,
    spotifyPhotoWidth: selected.width,
    spotifyPhotoHeight: selected.height,
    photoSource: "spotify",
    photoCredit: "Spotify",
    photoSourceUrl: exactArtistUrl,
    photoDisplayPolicy: "original",
    spotifyPhotoCheckedAt: Number.isFinite(Number(checkedAt)) ? Number(checkedAt) : Date.now(),
  });
}

export const spotifyArtistPhotoConfigured = (env = process.env) => Boolean(
  String(env?.SPOTIFY_CLIENT_ID || "").trim()
  && String(env?.SPOTIFY_CLIENT_SECRET || "").trim(),
);

function credentialsFrom(env) {
  const clientId = String(env?.SPOTIFY_CLIENT_ID || "").trim();
  const clientSecret = String(env?.SPOTIFY_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw new ProviderError("Spotify", 503, "Spotify artist photos are not configured.", {
      retryable: false,
      code: "not_configured",
    });
  }
  return { clientId, clientSecret };
}

function abortReason(signal) {
  return signal?.reason || new DOMException("Spotify artist photo work was cancelled.", "AbortError");
}

function providerFailure(status, code, cause = null) {
  const error = new ProviderError("Spotify", status, "Spotify artist photo enrichment is temporarily unavailable.", {
    retryable: !["invalid_request", "not_found", "authentication_failed", "access_revoked"].includes(code),
    code,
    cause: cause || undefined,
  });
  return error;
}

function retryAfterMs(response, now, { defaultMs } = {}) {
  const raw = String(response?.headers?.get?.("retry-after") || "").trim();
  let requested = NaN;
  if (/^\d+(?:\.\d+)?$/u.test(raw)) requested = Number(raw) * 1_000;
  else if (raw) {
    const date = Date.parse(raw);
    if (Number.isFinite(date)) requested = date - now;
  }
  if (!Number.isFinite(requested)) requested = defaultMs || DEFAULT_RATE_LIMIT_BLOCK_MS;
  // Spotify controls Retry-After. Never wake earlier than a valid provider
  // deadline; shortening it causes each restarted worker to repeat blocked work.
  return Math.max(MIN_RATE_LIMIT_BLOCK_MS, Math.ceil(requested));
}

function spotifyRateLimitCode(payload) {
  try {
    return JSON.stringify(payload).toUpperCase().includes("QUOTA_EXCEEDED")
      ? "quota_exceeded"
      : "rate_limited";
  } catch {
    return "rate_limited";
  }
}

function requestController(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(abortReason(parentSignal));
  parentSignal?.addEventListener?.("abort", abort, { once: true });
  if (parentSignal?.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Spotify artist photo request timed out.", "TimeoutError")),
    timeoutMs,
  );
  timer.unref?.();
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      parentSignal?.removeEventListener?.("abort", abort);
    },
  };
}

async function pauseBeforeRetry(wait, signal) {
  if (signal?.aborted) throw abortReason(signal);
  await wait(150);
  if (signal?.aborted) throw abortReason(signal);
}

export function createSpotifyArtistPhotoClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  clock = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  let token = "";
  let tokenExpiresAt = 0;
  let blockedUntil = 0;
  let blockedCode = "rate_limited";

  async function requestJson(url, options, {
    maxBytes = PROVIDER_JSON_LIMITS.standard,
    signal,
    allowNotFound = false,
  } = {}) {
    if (typeof fetchImpl !== "function") throw providerFailure(503, "fetch_unavailable");
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (signal?.aborted) throw abortReason(signal);
      const now = Number(clock());
      if (Number.isFinite(now) && now < blockedUntil) {
        const blocked = providerFailure(429, blockedCode);
        blocked.blockedUntil = blockedUntil;
        blocked.retryAfterMs = blockedUntil - now;
        throw blocked;
      }
      const request = requestController(signal, timeoutMs);
      try {
        const response = await fetchImpl(url, { ...options, redirect: "error", signal: request.signal });
        const status = Number(response?.status) || 502;
        if (allowNotFound && status === 404) return null;
        if (status === 429) {
          let payload = null;
          try {
            payload = await readBoundedJsonResponse(response, { maxBytes, signal: request.signal });
          } catch {
            // architecture: allow-empty-catch -- a malformed or oversized 429 body still activates the safe rate-limit circuit.
          }
          const at = Number(clock());
          blockedCode = spotifyRateLimitCode(payload);
          const retryForMs = retryAfterMs(response, Number.isFinite(at) ? at : Date.now(), {
            defaultMs: blockedCode === "quota_exceeded" ? QUOTA_EXCEEDED_BLOCK_MS : DEFAULT_RATE_LIMIT_BLOCK_MS,
          });
          blockedUntil = (Number.isFinite(at) ? at : Date.now()) + retryForMs;
          const limited = providerFailure(429, blockedCode);
          limited.blockedUntil = blockedUntil;
          limited.retryAfterMs = retryForMs;
          throw limited;
        }
        if (!response?.ok) {
          if (status >= 500 && attempt + 1 < MAX_ATTEMPTS) {
            await pauseBeforeRetry(wait, signal);
            continue;
          }
          const code = status === 401
            ? "authentication_failed"
            : status === 403
              ? "access_forbidden"
              : status >= 500
                ? "http_error"
                : "invalid_request";
          throw providerFailure(status, code);
        }
        try {
          return await readBoundedJsonResponse(response, { maxBytes, signal: request.signal });
        } catch (error) {
          if (signal?.aborted) throw abortReason(signal);
          throw providerFailure(502, "invalid_response", error);
        }
      } catch (error) {
        if (signal?.aborted) throw abortReason(signal);
        if (error instanceof ProviderError) throw error;
        if (attempt + 1 < MAX_ATTEMPTS) {
          await pauseBeforeRetry(wait, signal);
          continue;
        }
        throw providerFailure(502, "network_error", error);
      } finally {
        request.close();
      }
    }
    throw providerFailure(502, "network_error");
  }

  async function accessToken(signal, { forceRefresh = false } = {}) {
    const now = Number(clock());
    if (!forceRefresh && token && now < tokenExpiresAt) return token;
    const { clientId, clientSecret } = credentialsFrom(env);
    let payload;
    try {
      payload = await requestJson(TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      }, { maxBytes: TOKEN_MAX_BYTES, signal });
    } catch (error) {
      if (error instanceof ProviderError && [400, 401, 403].includes(Number(error.status))) {
        throw providerFailure(error.status, "authentication_failed", error);
      }
      throw error;
    }
    const nextToken = typeof payload?.access_token === "string" ? payload.access_token.trim() : "";
    const expiresIn = Number(payload?.expires_in);
    if (!nextToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw providerFailure(502, "invalid_response");
    }
    token = nextToken;
    tokenExpiresAt = now + Math.max(1_000, (expiresIn * 1_000) - TOKEN_EXPIRY_SKEW_MS);
    return token;
  }

  async function apiJson(path, { signal, allowNotFound = false, refreshAttempt = 0 } = {}) {
    const access = await accessToken(signal, { forceRefresh: refreshAttempt > 0 });
    try {
      return await requestJson(`${API_ORIGIN}${path}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${access}` },
      }, { signal, allowNotFound });
    } catch (error) {
      if (error instanceof ProviderError && error.status === 401 && refreshAttempt === 0) {
        token = "";
        tokenExpiresAt = 0;
        return apiJson(path, { signal, allowNotFound, refreshAttempt: 1 });
      }
      throw error;
    }
  }

  async function findArtistPhoto(name, { existingSpotifyId = null, signal } = {}) {
    const expectedName = normalizeArtistName(name);
    if (!expectedName) return null;
    const knownId = safeSpotifyArtistId(existingSpotifyId);
    // A display name is not an identity. Same-name performers are common, and
    // first-page search uniqueness can change over time. Automated artwork is
    // therefore limited to an exact Spotify ID already bound to the local artist.
    if (!knownId) return null;
    const artist = await apiJson(`/v1/artists/${knownId}`, { signal, allowNotFound: true });
    if (!artist || normalizeArtistName(artist.name) !== expectedName) return null;
    return spotifyArtistPhotoRecord(artist, { checkedAt: clock() });
  }

  return Object.freeze({ findArtistPhoto });
}

let defaultClient = null;

export async function findSpotifyArtistPhoto(name, options = {}) {
  if (!defaultClient) defaultClient = createSpotifyArtistPhotoClient();
  return defaultClient.findArtistPhoto(name, options);
}
