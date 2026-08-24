import { createProfileHistoryStore } from "./profileHistoryState.mjs";
import { profileHistoryPageRequest } from "./services/profileHistoryApi.mjs";

export const profileHistoryStore = createProfileHistoryStore({ fetchPage: profileHistoryPageRequest });

const params = (accountId, targetId) => ({ accountId: accountId || null, targetId: targetId || null });
const normalizedAccountId = (accountId) => accountId == null || accountId === "" ? null : String(accountId);
const UNADOPTED_ACCOUNT = Symbol("unadopted-profile-history-account");
let adoptedAccountId = UNADOPTED_ACCOUNT;

export function upsertProfileHistoryPost(accountId, targetId, post, options) {
  return profileHistoryStore.upsertPost(params(accountId, targetId), post, options);
}

export function removeProfileHistoryPost(accountId, targetId, postId) {
  return profileHistoryStore.removePost(params(accountId, targetId), postId);
}

export function invalidateProfileHistoryAccount(accountId) {
  return profileHistoryStore.invalidateAccount(normalizedAccountId(accountId));
}

export function resetProfileHistoryAccount(accountId) {
  return profileHistoryStore.resetAccount(normalizedAccountId(accountId));
}

// Called synchronously at the Store's identity boundary. Clearing both sides of
// a handoff prevents an earlier login for the destination account from becoming
// a private, process-global continuity cache when that account signs in again.
export function adoptProfileHistoryAccount(accountId) {
  const nextAccountId = normalizedAccountId(accountId);
  if (adoptedAccountId === nextAccountId) return false;
  if (adoptedAccountId !== UNADOPTED_ACCOUNT) profileHistoryStore.resetAccount(adoptedAccountId);
  profileHistoryStore.resetAccount(nextAccountId);
  adoptedAccountId = nextAccountId;
  return true;
}

export function scrubBlockedProfileHistoryPerson(accountId, blockedUserId) {
  const blockedId = blockedUserId == null ? "" : String(blockedUserId).trim();
  if (!blockedId) return 0;
  return profileHistoryStore.scrubAccount(normalizedAccountId(accountId), (post) => {
    if (!post || post.userId === blockedId || post.user?.id === blockedId) return null;
    if (!Array.isArray(post.taggedPeople)) return post;
    const taggedPeople = post.taggedPeople.filter((person) => person?.id !== blockedId);
    return taggedPeople.length === post.taggedPeople.length ? post : { ...post, taggedPeople };
  });
}
