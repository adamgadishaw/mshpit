import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const VIDEO_VERIFIER_PROTOCOL_VERSION = "pit-video-verifier-v2";
export const VIDEO_VERIFIER_PIPELINE_VERSION = "private-derivative-v1";
export const VIDEO_VERIFIER_CLOCK_SKEW_MS = 60_000;

const NONCE = /^[A-Za-z0-9_-]{22,64}$/;
const SIGNATURE = /^v1=([a-f0-9]{64})$/;

function protocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function secretBuffer(secret) {
  const value = typeof secret === "string" ? Buffer.from(secret, "utf8") : Buffer.from(secret || []);
  if (value.byteLength < 32 || value.byteLength > 1_024) {
    throw protocolError("VIDEO_VERIFIER_SECRET_INVALID", "Video verifier authentication is not configured correctly.");
  }
  return value;
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  const lower = name.toLowerCase();
  let value = headers?.[lower] ?? headers?.[name];
  if (value === undefined && headers && typeof headers === "object") {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lower);
    value = entry?.[1];
  }
  return Array.isArray(value) ? value[0] : value;
}

function checkedPath(value) {
  const path = String(value || "");
  if (!/^\/v2\/(?:health|verify)$/.test(path)) {
    throw protocolError("VIDEO_VERIFIER_PATH_INVALID", "Video verifier request path is invalid.");
  }
  return path;
}

function checkedTimestamp(value, at) {
  if (!/^[0-9]{13}$/.test(String(value || ""))) {
    throw protocolError("VIDEO_VERIFIER_TIMESTAMP_INVALID", "Video verifier request timestamp is invalid.");
  }
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || Math.abs(at - timestamp) > VIDEO_VERIFIER_CLOCK_SKEW_MS) {
    throw protocolError("VIDEO_VERIFIER_REQUEST_EXPIRED", "Video verifier request has expired.");
  }
  return timestamp;
}

function checkedNonce(value) {
  const nonce = String(value || "");
  if (!NONCE.test(nonce)) {
    throw protocolError("VIDEO_VERIFIER_NONCE_INVALID", "Video verifier request nonce is invalid.");
  }
  return nonce;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function signatureFor({ secret, direction, path, timestamp, nonce, body }) {
  const message = [
    VIDEO_VERIFIER_PROTOCOL_VERSION,
    direction,
    path,
    String(timestamp),
    nonce,
    sha256(body),
  ].join("\n");
  return createHmac("sha256", secretBuffer(secret)).update(message).digest("hex");
}

function signaturesMatch(expectedHex, received) {
  const match = SIGNATURE.exec(String(received || ""));
  if (!match) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(match[1], "hex");
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

function encodedJson(payload) {
  let body;
  try { body = JSON.stringify(payload); }
  catch { throw protocolError("VIDEO_VERIFIER_BODY_INVALID", "Video verifier request body is invalid."); }
  if (!body || typeof body !== "string") {
    throw protocolError("VIDEO_VERIFIER_BODY_INVALID", "Video verifier request body is invalid.");
  }
  return body;
}

export function createVerifierNonce() {
  return randomBytes(18).toString("base64url");
}

export function signVideoVerifierRequest({
  secret,
  path,
  payload,
  at = Date.now(),
  nonce = createVerifierNonce(),
} = {}) {
  const checked = checkedPath(path);
  const timestamp = checkedTimestamp(String(at), at);
  const requestNonce = checkedNonce(nonce);
  const body = encodedJson(payload);
  const signature = signatureFor({
    secret,
    direction: "request",
    path: checked,
    timestamp,
    nonce: requestNonce,
    body,
  });
  return {
    body,
    nonce: requestNonce,
    timestamp,
    headers: {
      "Content-Type": "application/json",
      "X-Pit-Video-Timestamp": String(timestamp),
      "X-Pit-Video-Nonce": requestNonce,
      "X-Pit-Video-Signature": `v1=${signature}`,
    },
  };
}

export function verifyVideoVerifierRequest({
  secret,
  path,
  body,
  headers,
  at = Date.now(),
} = {}) {
  const checked = checkedPath(path);
  const timestamp = checkedTimestamp(headerValue(headers, "x-pit-video-timestamp"), at);
  const nonce = checkedNonce(headerValue(headers, "x-pit-video-nonce"));
  const rawBody = typeof body === "string" ? body : Buffer.from(body || []).toString("utf8");
  const expected = signatureFor({ secret, direction: "request", path: checked, timestamp, nonce, body: rawBody });
  if (!signaturesMatch(expected, headerValue(headers, "x-pit-video-signature"))) {
    throw protocolError("VIDEO_VERIFIER_AUTH_INVALID", "Video verifier authentication failed.");
  }
  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { throw protocolError("VIDEO_VERIFIER_BODY_INVALID", "Video verifier request body is invalid."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw protocolError("VIDEO_VERIFIER_BODY_INVALID", "Video verifier request body is invalid.");
  }
  return { payload, nonce, timestamp };
}

export function signVideoVerifierResponse({
  secret,
  path,
  requestNonce,
  payload,
  at = Date.now(),
} = {}) {
  const checked = checkedPath(path);
  const timestamp = checkedTimestamp(String(at), at);
  const nonce = checkedNonce(requestNonce);
  const body = encodedJson(payload);
  const signature = signatureFor({
    secret,
    direction: "response",
    path: checked,
    timestamp,
    nonce,
    body,
  });
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Pit-Video-Timestamp": String(timestamp),
      "X-Pit-Video-Nonce": nonce,
      "X-Pit-Video-Signature": `v1=${signature}`,
    },
  };
}

export function verifyVideoVerifierResponse({
  secret,
  path,
  requestNonce,
  body,
  headers,
  at = Date.now(),
} = {}) {
  const checked = checkedPath(path);
  const timestamp = checkedTimestamp(headerValue(headers, "x-pit-video-timestamp"), at);
  const nonce = checkedNonce(headerValue(headers, "x-pit-video-nonce"));
  if (nonce !== checkedNonce(requestNonce)) {
    throw protocolError("VIDEO_VERIFIER_RESPONSE_INVALID", "Video verifier response does not match its request.");
  }
  const rawBody = typeof body === "string" ? body : Buffer.from(body || []).toString("utf8");
  const expected = signatureFor({ secret, direction: "response", path: checked, timestamp, nonce, body: rawBody });
  if (!signaturesMatch(expected, headerValue(headers, "x-pit-video-signature"))) {
    throw protocolError("VIDEO_VERIFIER_RESPONSE_INVALID", "Video verifier response authentication failed.");
  }
  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { throw protocolError("VIDEO_VERIFIER_RESPONSE_INVALID", "Video verifier response body is invalid."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw protocolError("VIDEO_VERIFIER_RESPONSE_INVALID", "Video verifier response body is invalid.");
  }
  return payload;
}
