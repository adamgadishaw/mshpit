import { accountMutationIsCurrent, captureAccountMutation } from "./accountMutation.mjs";
import { isLoadCancellation } from "./loadState.mjs";

// Head refreshes, local writes and account changes each invalidate old pages.
// The epoch also rejects A -> B -> A, even when the account ID matches again.
export function captureFeedRead({ accountId, epoch, sequence, mutationRevision }) {
  return { ...captureAccountMutation(accountId, epoch), sequence, mutationRevision };
}

export function feedReadIsCurrent(read, current, { signal, error } = {}) {
  return !isLoadCancellation(error, signal)
    && error?.serverCode !== "IDENTITY_CHANGED"
    && accountMutationIsCurrent(read, current.accountId, current.epoch)
    && read.sequence === current.sequence
    && read.mutationRevision === current.mutationRevision;
}

export function filteredFeedNextAction({ filter, visibleCount, loadedMatchCount, hasMore, loadingMore }) {
  if (filter === "everyone") return "none";
  if (visibleCount < loadedMatchCount) return "reveal";
  if (hasMore && !loadingMore) return "fetch";
  return "none";
}
