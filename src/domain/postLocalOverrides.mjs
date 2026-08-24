import { normalizeTaggedPeople } from "./postFriendTags.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";

export function postLocalOverrideKey(accountId, postId) {
  const account = text(accountId);
  const post = text(postId);
  return account && post ? `${account}:${post}` : "";
}

export function withRemovedSelfPostTag(overrides, { accountId, postId, userId, version } = {}) {
  const key = postLocalOverrideKey(accountId, postId);
  const removedId = text(userId);
  if (!key || !removedId) return overrides && typeof overrides === "object" ? overrides : {};
  const source = overrides && typeof overrides === "object" ? overrides : {};
  const current = source[key] && typeof source[key] === "object" ? source[key] : {};
  const removedTaggedUserIds = [...new Set([
    ...(Array.isArray(current.removedTaggedUserIds) ? current.removedTaggedUserIds.map(text).filter(Boolean) : []),
    removedId,
  ])];
  return {
    ...source,
    [key]: {
      removedTaggedUserIds,
      ...(Number.isSafeInteger(version) ? { version } : Number.isSafeInteger(current.version) ? { version: current.version } : {}),
    },
  };
}

export function applyPostLocalOverride(post, overrides, accountId) {
  if (!post || typeof post !== "object") return post;
  const key = postLocalOverrideKey(accountId, String(post.id || ""));
  const override = key && overrides && typeof overrides === "object" ? overrides[key] : null;
  if (!override) return post;
  const removed = new Set(Array.isArray(override.removedTaggedUserIds) ? override.removedTaggedUserIds : []);
  const taggedPeople = normalizeTaggedPeople(post.taggedPeople).filter((person) => !removed.has(person.id));
  const effectiveVersion = Number.isSafeInteger(override.version)
    ? Math.max(Number.isSafeInteger(post.version) ? post.version : 0, override.version)
    : null;
  return {
    ...post,
    taggedPeople,
    ...(effectiveVersion != null
      ? { version: effectiveVersion, editedAt: Math.max(Number.isSafeInteger(post.editedAt) ? post.editedAt : 0, effectiveVersion) }
      : {}),
  };
}
