import { cleanHandle } from "./validation.mjs";

const imageUrl = (value) => /^https?:\/\//i.test(String(value || "")) ? value : null;

export function signupProfileSnapshot(user) {
  return { handle: cleanHandle(user?.handle || ""), avatarUri: imageUrl(user?.avatarUri), banner: imageUrl(user?.banner) };
}

export function signupProfilePatch(draft, saved) {
  return Object.fromEntries(["handle", "avatarUri", "banner"]
    .filter((key) => draft[key] !== saved[key]).map((key) => [key, draft[key]]));
}

export function confirmSignupProfile(result, accountId, patch) {
  if (result?.ok !== true) throw result?.error || new Error("Your changes could not be saved. They are still here—try again.");
  if (result.user?.id !== accountId) throw new Error("Mshpit could not confirm your profile. Try saving again.");
  const saved = signupProfileSnapshot(result.user);
  for (const key of Object.keys(patch)) {
    if (saved[key] !== patch[key]) throw new Error("Mshpit could not confirm your " + (key === "avatarUri" ? "profile photo" : key === "handle" ? "username" : "banner") + ". Try saving again.");
  }
  return saved;
}

export function signupHandleLocked(user, now = Date.now()) {
  return Number(user?.handleChangeAvailableAt) > now;
}
