import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { ApiError } from "../../errors.js";
import { clean } from "../../validate.js";
import { assertSafeAuthoredText } from "../../contentSafety.js";

const DAY = 86_400_000;
const METHODS = new Set(["manual", "instagram_story"]);

export const artistIdentityHeld = (profile) => ["pending", "rejected"].includes(profile?.identity_review_status);

export function artistIdentityReview(profile) {
  let risk = {};
  try { risk = JSON.parse(profile?.identity_review_json || "{}"); }
  catch { risk = {}; /* Corrupt optional risk metadata never changes the durable hold status. */ }
  return { artistKey: profile?.artist_key || null, status: profile?.identity_review_status || "clear",
    held: artistIdentityHeld(profile), reasons: Array.isArray(risk.reasons) ? risk.reasons.slice(0, 12) : [],
    matches: Array.isArray(risk.matches) ? risk.matches.slice(0, 8) : [],
    reason: profile?.identity_review_reason || null };
}

export function verificationReviewReason(value) {
  if (typeof value !== "string" || value.length > 1000) throw new ApiError(400, "Add a concise review reason.", "VALIDATION_FAILED");
  const reason = clean(value, { max: 1000, newlines: true });
  if (reason.length < 12) throw new ApiError(400, "Explain the identity evidence checked in at least 12 characters.", "VALIDATION_FAILED");
  assertSafeAuthoredText(reason, { field: "identity review reason" });
  return reason;
}

export function instagramVerificationHandle(value) {
  if (typeof value !== "string") throw new ApiError(400, "Enter the official Instagram username, not a password or login code.", "VALIDATION_FAILED");
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_][a-z0-9._]{0,29}$/u.test(handle) || handle.endsWith(".") || handle.includes("..")) {
    throw new ApiError(400, "Enter a valid Instagram username without a URL.", "VALIDATION_FAILED");
  }
  return handle;
}

function httpsEvidenceUrl(value) {
  if (typeof value !== "string" || value.length > 1000) throw new ApiError(400, "Add the HTTPS official evidence link you reviewed.", "VALIDATION_FAILED");
  let url;
  try { url = new URL(value); } catch { throw new ApiError(400, "Use a valid HTTPS evidence link.", "VALIDATION_FAILED"); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || !host.includes(".") || isIP(host) || /(?:^|\.)(?:localhost|local|internal|lan|home|invalid)$/u.test(host)
    || url.username || url.password || url.port || url.hash) {
    throw new ApiError(400, "Use a public HTTPS evidence link without credentials.", "VALIDATION_FAILED");
  }
  // Verification links are pointers for a human reviewer, never fetched here.
  url.search = "";
  return url.href;
}

export function manualIdentityReviewEvidence(body) {
  const reason = verificationReviewReason(body.reason);
  if (body.officialAccountConfirmed !== true || body.ownershipConfirmed !== true) {
    throw new ApiError(400, "Confirm the established official account and ownership after directly checking the evidence.", "VALIDATION_FAILED");
  }
  return { reason, reviewedUrl: httpsEvidenceUrl(body.reviewedUrl) };
}

export function instagramStoryEvidenceUrl(value, handle) {
  const url = new URL(httpsEvidenceUrl(value));
  const match = url.pathname.match(/^\/stories\/([a-z0-9._]+)\/([0-9]{5,30})\/?$/iu);
  if (!["instagram.com", "www.instagram.com"].includes(url.hostname.toLowerCase())
    || !match || match[1].toLowerCase() !== handle) {
    throw new ApiError(400, "Use the live Instagram Story link from the same official username as this challenge.", "VALIDATION_FAILED");
  }
  return `https://www.instagram.com/stories/${handle}/${match[2]}/`;
}

export function ensureArtistVerificationSchema(database) {
  const columns = new Set(database.prepare("PRAGMA table_info(artist_profiles)").all().map(row => row.name));
  for (const [name, type] of [
    ["identity_review_status", "TEXT NOT NULL DEFAULT 'clear'"],
    ["identity_review_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["identity_review_reason", "TEXT"], ["identity_reviewed_at", "INTEGER"], ["identity_reviewed_by", "TEXT"],
    ["identity_review_evidence_url", "TEXT"],
  ]) if (!columns.has(name)) database.exec(`ALTER TABLE artist_profiles ADD COLUMN ${name} ${type}`);
  database.exec(`CREATE TABLE IF NOT EXISTS artist_verification_challenges (
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_key TEXT NOT NULL,artist_name TEXT NOT NULL,instagram_handle TEXT NOT NULL,code TEXT NOT NULL,
    created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active','submitted','consumed','revoked')),request_id TEXT UNIQUE
  );
  CREATE INDEX IF NOT EXISTS idx_artist_verification_owner_created ON artist_verification_challenges(user_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS artist_request_evidence (
    request_id TEXT PRIMARY KEY REFERENCES artist_requests(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK(method IN ('manual','instagram_story')),
    challenge_id TEXT UNIQUE REFERENCES artist_verification_challenges(id),story_url TEXT,
    reviewed_url TEXT,reviewed_by TEXT,reviewed_at INTEGER,observed_at INTEGER,review_reason TEXT
  );`);
}

export function createArtistVerification({ database, now = Date.now, uid }) {
  const byId = database.prepare("SELECT * FROM artist_verification_challenges WHERE id=?");
  const proofByRequest = database.prepare("SELECT * FROM artist_request_evidence WHERE request_id=?");
  const view = row => row ? { id: row.id, method: "instagram_story", artistName: row.artist_name,
    instagramHandle: row.instagram_handle, code: row.code, expiresAt: row.expires_at,
    status: row.expires_at <= now() && ["active", "submitted"].includes(row.status) ? "expired" : row.status } : null;
  const ownLatest = (userId, key = null) => view(database.prepare(`SELECT * FROM artist_verification_challenges
    WHERE user_id=? AND (? IS NULL OR artist_key=?) ORDER BY created_at DESC,id DESC LIMIT 1`).get(userId, key, key));
  function issue({ userId, name, key, instagramHandle }) {
    const handle = instagramVerificationHandle(instagramHandle);
    const at = now();
    const latest = database.prepare(`SELECT * FROM artist_verification_challenges
      WHERE user_id=? AND artist_key=? AND status IN ('active','submitted') ORDER BY created_at DESC,id DESC LIMIT 1`).get(userId, key);
    if (latest?.expires_at > at && latest.instagram_handle === handle) return view(latest);
    if (latest?.status === "submitted" && latest.expires_at > at) throw new ApiError(409, "Your current Story proof is awaiting review. Keep that Story available until the review or challenge expiry.", "CONFLICT");
    const count = database.prepare("SELECT COUNT(*) count FROM artist_verification_challenges WHERE user_id=? AND created_at>=?").get(userId, at - DAY).count;
    if (count >= 3) throw new ApiError(429, "You have generated three verification challenges today. Try again after the daily limit resets.", "RATE_LIMITED");
    database.prepare("UPDATE artist_verification_challenges SET status='revoked' WHERE user_id=? AND artist_key=? AND status='active'").run(userId, key);
    // Unbound expired codes contain no review evidence and have bounded retention.
    database.prepare("DELETE FROM artist_verification_challenges WHERE user_id=? AND request_id IS NULL AND expires_at<?").run(userId, at - 7 * DAY);
    const code = `MSHPIT-${randomBytes(8).toString("hex").toUpperCase().match(/.{4}/g).join("-")}`;
    const id = uid("avc");
    database.prepare(`INSERT INTO artist_verification_challenges
      (id,user_id,artist_key,artist_name,instagram_handle,code,created_at,expires_at,status)
      VALUES(?,?,?,?,?,?,?,?,'active')`).run(id, userId, key, name, handle, code, at, at + DAY);
    return view(byId.get(id));
  }
  function submission({ userId, key, body }) {
    const method = body.method || (body.challengeId ? "instagram_story" : "manual");
    if (!METHODS.has(method)) throw new ApiError(400, "Choose a supported verification method.", "VALIDATION_FAILED");
    if (method === "manual") {
      if (body.challengeId || body.storyUrl) throw new ApiError(400, "Instagram Story proof must use the Instagram Story method.", "VALIDATION_FAILED");
      return { method, challenge: null, storyUrl: null };
    }
    const challenge = typeof body.challengeId === "string" ? byId.get(body.challengeId) : null;
    if (!challenge || challenge.user_id !== userId || challenge.artist_key !== key || !["active", "submitted"].includes(challenge.status)) {
      throw new ApiError(409, "That verification challenge does not match this account and artist. Generate a new challenge.", "CONFLICT");
    }
    if (challenge.expires_at <= now()) throw new ApiError(409, "That Story challenge expired. Generate and post a fresh challenge.", "CONFLICT");
    return { method, challenge, storyUrl: instagramStoryEvidenceUrl(body.storyUrl, challenge.instagram_handle) };
  }
  function bind(requestId, proof) {
    if (proof.challenge) {
      const changed = database.prepare(`UPDATE artist_verification_challenges SET status='submitted',request_id=?
        WHERE id=? AND status='active' AND request_id IS NULL AND expires_at>?`).run(requestId, proof.challenge.id, now()).changes;
      if (changed !== 1) throw new ApiError(409, "That challenge has already been submitted. Generate a new challenge after review or expiry.", "CONFLICT");
    }
    database.prepare("INSERT INTO artist_request_evidence(request_id,method,challenge_id,story_url) VALUES(?,?,?,?)")
      .run(requestId, proof.method, proof.challenge?.id || null, proof.storyUrl);
  }
  function details(requestId) {
    const evidence = proofByRequest.get(requestId);
    const challenge = evidence?.challenge_id ? view(byId.get(evidence.challenge_id)) : null;
    return { method: evidence?.method || "manual", storyUrl: evidence?.story_url || null,
      instagramHandle: challenge?.instagramHandle || null, challenge,
      reviewStatus: challenge?.status === "expired" ? "expired" : "pending", reviewReason: evidence?.review_reason || null };
  }
  function approve(request, body, reviewerId) {
    const evidence = proofByRequest.get(request.id);
    const method = evidence?.method || "manual";
    const reason = verificationReviewReason(body.reason);
    if (body.method !== method || body.officialAccountConfirmed !== true || body.ownershipConfirmed !== true) {
      throw new ApiError(400, "Explicitly confirm the established official account and the claimant's ownership after checking the evidence yourself.", "VALIDATION_FAILED");
    }
    let observedAt = null;
    let reviewedUrl;
    if (method === "instagram_story") {
      const challenge = byId.get(evidence.challenge_id);
      if (!challenge || challenge.status !== "submitted" || challenge.request_id !== request.id
        || challenge.user_id !== request.user_id || challenge.artist_key !== request.artist_name.trim().toLowerCase()
        || challenge.expires_at <= now()) throw new ApiError(409, "The live Story code is unavailable or expired. Ask for a fresh challenge before approval.", "CONFLICT");
      observedAt = body.observedAt;
      if (body.liveCodeObserved !== true || typeof body.observedCode !== "string" || body.observedCode.trim() !== challenge.code
        || !Number.isSafeInteger(observedAt) || observedAt < challenge.created_at || observedAt >= challenge.expires_at || observedAt > now()) {
        throw new ApiError(400, "Open the live Story on the established official account, enter the matching code, and record when you observed it.", "VALIDATION_FAILED");
      }
      reviewedUrl = instagramStoryEvidenceUrl(evidence.story_url, challenge.instagram_handle);
      database.prepare("UPDATE artist_verification_challenges SET status='consumed' WHERE id=? AND status='submitted'").run(challenge.id);
    } else reviewedUrl = httpsEvidenceUrl(body.reviewedUrl);
    database.prepare(`INSERT INTO artist_request_evidence(request_id,method,reviewed_url,reviewed_by,reviewed_at,observed_at,review_reason)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET reviewed_url=excluded.reviewed_url,reviewed_by=excluded.reviewed_by,
      reviewed_at=excluded.reviewed_at,observed_at=excluded.observed_at,review_reason=excluded.review_reason`)
      .run(request.id, method, reviewedUrl, reviewerId, now(), observedAt, reason);
    return { reason, method, observedAt, reviewedUrl };
  }
  function reject(request, body, reviewerId) {
    const reason = verificationReviewReason(body.reason);
    const evidence = proofByRequest.get(request.id);
    database.prepare(`INSERT INTO artist_request_evidence(request_id,method,reviewed_by,reviewed_at,review_reason)
      VALUES(?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET reviewed_by=excluded.reviewed_by,
      reviewed_at=excluded.reviewed_at,review_reason=excluded.review_reason`)
      .run(request.id, evidence?.method || "manual", reviewerId, now(), reason);
    if (evidence?.challenge_id) database.prepare("UPDATE artist_verification_challenges SET status='revoked' WHERE id=? AND status='submitted'").run(evidence.challenge_id);
    return reason;
  }
  return { issue, ownLatest, submission, bind, details, approve, reject };
}
