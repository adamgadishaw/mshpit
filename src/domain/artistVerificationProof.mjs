export function verificationExpiry(value) {
  const timestamp = typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function instagramHandle(value) {
  const handle = String(value || "").trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_][a-z0-9._]{0,29}$/.test(handle) && !handle.endsWith(".") && !handle.includes("..") ? handle : "";
}

export function instagramStoryUrl(value, handle) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname) || url.username || url.password || url.port || url.hash) return "";
    const match = url.pathname.match(/^\/stories\/([a-zA-Z0-9._]+)\/(\d{5,30})\/?$/);
    if (!match || match[1].toLowerCase() !== instagramHandle(handle)) return "";
    return `https://www.instagram.com/stories/${match[1].toLowerCase()}/${match[2]}/`;
  } catch { return ""; }
}

export function artistChallengeState(challenge, { artistName, handle, now = Date.now() } = {}) {
  if (!challenge?.id) return "missing";
  if (verificationExpiry(challenge.expiresAt) <= now || challenge.status === "expired") return "expired";
  if (String(challenge.artistName || "").trim().toLowerCase() !== String(artistName || "").trim().toLowerCase()
    || !instagramHandle(handle) || instagramHandle(challenge.instagramHandle) !== instagramHandle(handle)) return "mismatch";
  return ["active", "submitted"].includes(challenge.status) ? challenge.status : "unavailable";
}

export function officialEvidenceUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const host = url.hostname.toLowerCase();
    if (/^\d+(?:\.\d+){3}$/.test(host) || host.includes(":" ) || /(?:^|\.)(?:localhost|local|internal|lan|home|invalid)$/.test(host)) return "";
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash && host.includes(".") && url.href.length <= 512 ? url.href : "";
  } catch { return ""; }
}

export function artistReviewReady(request, evidence, now = Date.now()) {
  if (String(evidence?.reason || "").trim().length < 12 || evidence?.officialAccountConfirmed !== true || evidence?.ownershipConfirmed !== true) return false;
  if (request?.identityReview?.held && evidence.identityReviewConfirmed !== true) return false;
  if (request?.proof?.method === "instagram_story") {
    const challenge = request.proof.challenge;
    return evidence.method === "instagram_story" && verificationExpiry(challenge?.expiresAt) > now
      && evidence.liveCodeObserved === true && !!challenge?.code && String(evidence.observedCode || "").trim() === challenge.code
      && Number.isFinite(evidence.observedAt) && evidence.observedAt <= now && evidence.observedAt < verificationExpiry(challenge.expiresAt);
  }
  return evidence?.method === "manual" && !!officialEvidenceUrl(evidence.reviewedUrl);
}
