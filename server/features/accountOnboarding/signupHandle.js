import { cleanHandle } from "../../../src/domain/validation.mjs";

export const HANDLE_COOLDOWN_DAYS = 10;

export function handleChangeAvailableAt(changedAt) {
  const timestamp = Number(changedAt);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  let added = 0;
  while (added < HANDLE_COOLDOWN_DAYS) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return date.getTime();
}

// Match the existing profile editor's normalization and length policy. The
// pending signup preference is server-owned metadata, never a public reservation.
export function normalizedProfileHandle(value) {
  const handle = cleanHandle(value);
  return handle.length >= 3 ? handle : undefined;
}

export function pendingSignupHandle(extras) {
  if (!extras || typeof extras !== "object" || Array.isArray(extras)) return undefined;
  const handle = normalizedProfileHandle(extras.pendingSignupHandle);
  return handle && handle === extras.pendingSignupHandle ? handle : undefined;
}

// The caller must already hold the verification transaction's write lock. A
// conflict is not a failed verification: setup can ask for another public name.
// A manually chosen handle must never be replaced by an earlier signup draft.
export function claimPendingSignupHandle(database, user, at = Date.now()) {
  if (!user?.id || !user.email_verified_at) return;
  let extras;
  try { extras = JSON.parse(user.extras || "{}"); } catch { return; }
  if (!extras || typeof extras !== "object" || Array.isArray(extras)
    || !Object.hasOwn(extras, "pendingSignupHandle")) return;
  const preferred = pendingSignupHandle(extras);
  delete extras.pendingSignupHandle;
  const mayClaim = !!preferred && user.role === "fan" && !user.handle_changed_at
    && /^pitfan_[a-f0-9]{8}(?:\d+)?$/u.test(user.handle || "");
  const taken = mayClaim
    ? database.prepare("SELECT id FROM users WHERE handle=? AND id<>?").get(preferred, user.id)
    : null;
  if (mayClaim && !taken) {
    database.prepare("UPDATE users SET handle=?,extras=?,profile_updated_at=? WHERE id=?")
      .run(preferred, JSON.stringify(extras), at, user.id);
  } else {
    database.prepare("UPDATE users SET extras=? WHERE id=?").run(JSON.stringify(extras), user.id);
  }
}
